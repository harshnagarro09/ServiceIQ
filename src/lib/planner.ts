// ============================================================
// Campaign planner + in-flight monitor.
//
//  - recommendCampaigns(): turns the master dataset, the simulation model and the competitor
//    benchmark into a calendar of recommended campaigns (what to run, where, for whom, how big).
//  - monitorCampaigns():   health score + flags for campaigns that are running right now.
// Everything is computed; nothing is typed in.
// ============================================================

import { campaignResults, metricsFor, type CampaignResult } from './analytics.ts';
import { REGIONS, ROI_TARGET, SCHEMES, SEGMENTS } from './constants.ts';
import { fmtPct, fmtX, pctChange } from './format.ts';
import { marketDepthFor, OUR_TERMS, type Benchmark } from './benchmark.ts';
import {
  objectiveMetric, planPeriod, runScheme, typicalCampaignShare, windowBaseline, windowEfficiency,
  type Efficiency, type Objective, type Plan, type Scenario,
} from './simulation.ts';
import type { CampaignPlan, Dataset, Region, Scheme, Segment } from './types.ts';

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export type Purpose = 'Recover decline' | 'Defend vs competitor' | 'Improve retention' | 'Fill coverage gap' | 'Scale a winner';
export const PURPOSES: Purpose[] = ['Scale a winner', 'Fill coverage gap', 'Defend vs competitor', 'Improve retention', 'Recover decline'];

export interface RecSpec {
  region: Region;
  segment: Segment;
  scheme: Scheme;
  weeks: number;
  budget: number;     // ₹ lakh at current offer terms
  depthPct: number;
  startIdx: number;   // index (0 = April) of the month the campaign starts in, FY 2026-27
}

/** What the user changed on the Simulation page and applied. */
export interface RecOverride { scheme: Scheme; budget: number; weeks: number; depthPct: number }
export type Decision = { status: 'Accepted' | 'Rejected'; override?: RecOverride };
export type Decisions = Record<string, Decision>;

export interface Evaluation {
  scenario: Scenario;
  baselineRevenue: number;
  intensityPct: number;        // promotion cost ÷ baseline revenue of the window
  marketDepthPct: number | null;
  gapPp: number | null;        // market median − our depth (null when no competitor equivalent)
  confidence: number;          // 40-95
  eff: Efficiency;
}

export interface Rec {
  id: string;
  title: string;
  region: Region;
  segment: Segment;
  scheme: Scheme;
  purpose: Purpose;
  startISO: string;
  weeks: number;
  budget: number;
  depthPct: number;
  eval: Evaluation;
  flags: string[];
  needsAttention: boolean;
  rationale: string;
  applied: boolean;            // true when the user applied a simulated override
}

export interface CalendarGap { region: Region; segment: Segment; monthlyRevenue: number; retention: number; note: string }

export interface PlanBundle {
  periodMonths: string[];       // FY 2026-27 month keys of the plan period
  recs: Rec[];
  scheduled: CampaignPlan[];    // campaigns already planned/active in the period (from the master dataset)
  gaps: CalendarGap[];
}

/** Planned spend of a scheduled campaign that falls inside the given months (₹ lakh). */
export const plannedSpendIn = (c: CampaignPlan, months: string[]) => months.reduce((s, m) => s + (c.plannedByMonth[m] ?? 0), 0);

// ------------------------------------------------------------
// Dates
// ------------------------------------------------------------

/** FY 2026-27 month key for index i (0 = April 2026). */
export const fyMonthKey = (i: number) => {
  const m = (3 + i) % 12;
  const y = 2026 + Math.floor((3 + i) / 12);
  return `${y}-${String(m + 1).padStart(2, '0')}`;
};

export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (iso: string) => `${Number(iso.slice(8, 10))} ${SHORT_MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

// ------------------------------------------------------------
// Evaluate one campaign spec through the simulation model
// ------------------------------------------------------------

const TIER_BONUS: Record<Efficiency['tier'], number> = { slice: 25, segment: 15, region: 12, network: 5 };

export function evaluateSpec(ds: Dataset, bm: Benchmark, spec: RecSpec): Evaluation {
  const nMonths = Math.max(1, Math.ceil(spec.weeks / 4.345));
  const refMonths = Array.from({ length: nMonths }, (_, k) => ds.months[(spec.startIdx + k) % 12]).filter(Boolean);
  const baseline = windowBaseline(ds, { region: spec.region, segment: spec.segment }, refMonths, spec.weeks);
  const eff = windowEfficiency(ds, spec.scheme, { region: spec.region, segment: spec.segment });
  const ref = OUR_TERMS[spec.scheme].depthPct;
  const market = marketDepthFor(bm, spec.scheme, spec.region);
  const scenario = runScheme(baseline, eff, spec.budget, { depthPct: spec.depthPct, refDepthPct: ref, marketDepthPct: market });
  const confidence = Math.max(40, Math.min(95, Math.round(45 + TIER_BONUS[eff.tier] + Math.min(eff.campaigns, 6) * 4 - Math.min(eff.roiCv * 40, 20))));
  return {
    scenario, baselineRevenue: baseline.revenue,
    intensityPct: baseline.revenue ? (scenario.promoCost / baseline.revenue) * 100 : 0,
    marketDepthPct: market,
    gapPp: market === null ? null : market - spec.depthPct,
    confidence, eff,
  };
}

const DEFAULT_WEEKS: Record<Scheme, number> = {
  '10% Service Discount': 6, '₹500 Discount Voucher': 8, 'Free Car Wash': 6, 'Free Engine Check': 4, 'Service + Car Wash Bundle': 8,
};

const flagsFor = (ev: Evaluation): string[] => {
  const f: string[] = [];
  const roi = ev.scenario.roi ?? 0;
  if (roi < 1) f.push('Loses money at this budget');
  else if (roi < ROI_TARGET) f.push('Below ROI target');
  if (ev.confidence < 65) f.push('Low confidence');
  if (ev.gapPp !== null && ev.gapPp >= 3) f.push(`Competitor deeper by ${ev.gapPp.toFixed(1)}pp`);
  if (ev.intensityPct > 8) f.push('High spend intensity');
  return f;
};

const roundHalf = (v: number) => Math.max(1, Math.round(v * 2) / 2);

// ------------------------------------------------------------
// Recommend a campaign calendar
// ------------------------------------------------------------

export function recommendCampaigns(ds: Dataset, bm: Benchmark, plan: Plan, decisions: Decisions = {}): PlanBundle {
  const idx = [...planPeriod(plan).monthIdx];
  const periodMonths = idx.map(fyMonthKey);
  const startIdx0 = idx[0];
  const periodStart = `${fyMonthKey(startIdx0)}-01`;

  const centerRegion = plan.centerId !== 'All' ? ds.centers.find(c => c.id === plan.centerId)?.region : undefined;
  const regions: Region[] = centerRegion ? [centerRegion] : plan.region !== 'All' ? [plan.region] : [...REGIONS];
  const segments: Segment[] = plan.segment !== 'All' ? [plan.segment] : [...SEGMENTS];

  const inPeriod = (c: CampaignPlan) => c.startMonth <= periodMonths[periodMonths.length - 1] && c.endMonth >= periodMonths[0];
  const scheduled = ds.campaigns.filter(c => c.status !== 'Completed' && inPeriod(c) && regions.includes(c.region) && segments.includes(c.segment));
  const covered = new Set(ds.campaigns.filter(c => c.status !== 'Completed' && inPeriod(c)).map(c => `${c.region}|${c.segment}`));

  const l3 = ds.months.slice(-3), p3 = ds.months.slice(-6, -3);
  const network = metricsFor(ds, {}, ds.months);
  const metric = objectiveMetric[plan.objective].value;
  const shares = new Map<Scheme, number>(SCHEMES.map(s => [s, typicalCampaignShare(ds, s)]));

  // 1) For every uncovered slice, evaluate all schemes at a campaign sized like past ones
  type Option = { spec: RecSpec; ev: Evaluation };
  type SliceOptions = { region: Region; segment: Segment; options: Option[] };
  const slices: SliceOptions[] = [];
  for (const region of regions) for (const segment of segments) {
    if (covered.has(`${region}|${segment}`)) continue;
    const options: Option[] = SCHEMES.map(scheme => {
      const weeks = DEFAULT_WEEKS[scheme];
      const nM = Math.max(1, Math.ceil(weeks / 4.345));
      const ref = Array.from({ length: nM }, (_, k) => ds.months[(startIdx0 + k) % 12]);
      const base = windowBaseline(ds, { region, segment }, ref, weeks);
      const budget = roundHalf((shares.get(scheme) ?? 0.04) * base.revenue);
      const spec: RecSpec = { region, segment, scheme, weeks, budget, depthPct: OUR_TERMS[scheme].depthPct, startIdx: startIdx0 };
      return { spec, ev: evaluateSpec(ds, bm, spec) };
    }).sort((a, b) => metric(b.ev.scenario) - metric(a.ev.scenario));
    slices.push({ region, segment, options });
  }

  // 2) Portfolio rules: never recommend a scheme that loses money in the slice (unless nothing else exists),
  //    and no single scheme may take more than ~40% of the calendar, so the plan is diversified.
  slices.sort((a, b) => metric(b.options[0].ev.scenario) - metric(a.options[0].ev.scenario));
  const capacity = Math.max(2, Math.ceil(0.4 * Math.min(slices.length, 14)));
  const used = new Map<Scheme, number>();
  type Cand = { rec: Omit<Rec, 'startISO' | 'id'>; key: number };
  const cands: Cand[] = [];
  for (const s of slices) {
    const viable = s.options.filter(o => (o.ev.scenario.roi ?? 0) >= 1);
    const pool = viable.length ? viable : s.options;
    const pick = pool.find(o => (used.get(o.spec.scheme) ?? 0) < capacity) ?? pool[0];
    used.set(pick.spec.scheme, (used.get(pick.spec.scheme) ?? 0) + 1);
    const { spec, ev } = pick;
    const { region, segment } = s;
    const diversified = pick !== s.options[0];

    // ---- purpose: why this slice, why now
    const cur = metricsFor(ds, { region, segment }, l3), old = metricsFor(ds, { region, segment }, p3);
    const change = old.revenue ? pctChange(cur.revenue, old.revenue) : 0;
    const retGap = network.retention - cur.retention;
    const everRan = ds.campaigns.some(c => c.region === region && c.segment === segment);
    let purpose: Purpose = 'Scale a winner';
    let rationale = `${spec.scheme} has averaged ROI ${fmtX(ev.eff.revenuePerLakh * ev.eff.gpMargin)} (${ev.eff.basis}); scale it into ${region} ${segment}.`;
    if (change <= -4) {
      purpose = 'Recover decline';
      rationale = `${region} ${segment} revenue is ${Math.abs(change).toFixed(1)}% lower than the prior 3 months. ${spec.scheme} returns ${fmtX(ev.eff.revenuePerLakh * ev.eff.gpMargin)} historically (${ev.eff.basis}).`;
    } else if (ev.gapPp !== null && ev.gapPp >= 3) {
      purpose = 'Defend vs competitor';
      rationale = `Competitors run ${ev.marketDepthPct!.toFixed(1)}% on ${spec.scheme} in ${region} vs our ${spec.depthPct}%. Defend ${segment} customers with this scheme (${ev.eff.basis}).`;
    } else if (retGap >= 2) {
      purpose = 'Improve retention';
      rationale = `${segment} retention in ${region} is ${fmtPct(cur.retention)}, ${retGap.toFixed(1)}pp below the network. ${spec.scheme} lifts repeat visits (${ev.eff.basis}).`;
    } else if (!everRan) {
      purpose = 'Fill coverage gap';
      rationale = `No campaign has ever run for ${segment} customers in ${region}. ${spec.scheme} is a proven scheme for similar slices (${ev.eff.basis}).`;
    }
    if (diversified) rationale += ` Chosen over ${s.options[0].spec.scheme} to keep the calendar diversified (no scheme above ${capacity} campaigns).`;

    cands.push({
      key: metric(ev.scenario),
      rec: {
        title: `${region} · ${segment} — ${spec.scheme}`,
        region, segment, scheme: spec.scheme, purpose, weeks: spec.weeks, budget: spec.budget, depthPct: spec.depthPct,
        eval: ev, flags: flagsFor(ev), needsAttention: (ev.scenario.roi ?? 0) < ROI_TARGET || ev.confidence < 65, rationale, applied: false,
      },
    });
  }

  // Rank, keep the 14 strongest, then order by start date
  cands.sort((a, b) => b.key - a.key);
  const top = cands.slice(0, 14);
  const recs: Rec[] = top.map((c, i) => {
    const id = `REC-${c.rec.region.toUpperCase()}-${c.rec.segment.toUpperCase().replace(/[^A-Z]/g, '')}`;
    const startISO = addDays(periodStart, (i % 12) * 5);
    let rec: Rec = { ...c.rec, id, startISO };
    const d = decisions[id];
    if (d?.override) {
      const o = d.override;
      const spec: RecSpec = { region: rec.region, segment: rec.segment, scheme: o.scheme, weeks: o.weeks, budget: o.budget, depthPct: o.depthPct, startIdx: startIdx0 };
      const ev = evaluateSpec(ds, bm, spec);
      rec = { ...rec, scheme: o.scheme, weeks: o.weeks, budget: o.budget, depthPct: o.depthPct, eval: ev, flags: flagsFor(ev), needsAttention: (ev.scenario.roi ?? 0) < ROI_TARGET || ev.confidence < 65, applied: true, title: `${rec.region} · ${rec.segment} — ${o.scheme}` };
    }
    return rec;
  }).sort((a, b) => a.startISO.localeCompare(b.startISO));

  // Slices that did not make the calendar (and are not already scheduled)
  const usedSlices = new Set(recs.map(r => `${r.region}|${r.segment}`));
  const gaps: CalendarGap[] = [];
  for (const region of regions) for (const segment of segments) {
    const slice = `${region}|${segment}`;
    if (usedSlices.has(slice) || covered.has(slice)) continue;
    const m = metricsFor(ds, { region, segment }, l3);
    gaps.push({ region, segment, monthlyRevenue: m.revenue / 3, retention: m.retention, note: `No campaign planned for ${segment} customers in ${region} during ${planPeriod(plan).label.split(' (')[0]}. Consider a defensive or reactivation offer.` });
  }
  gaps.sort((a, b) => b.monthlyRevenue - a.monthlyRevenue);
  return { periodMonths, recs, scheduled, gaps: gaps.slice(0, 4) };
}

// ------------------------------------------------------------
// In-flight monitor
// ------------------------------------------------------------

export interface LiveCampaign {
  result: CampaignResult;
  day: number;
  totalDays: number;
  deliveryPct: number;     // incremental revenue ÷ expected to date
  pacePct: number;         // spend ÷ planned spend to date
  visitsVsPredPct: number; // incremental visits vs expected to date (%, signed)
  roi: number;
  health: number;          // 0-100
  band: 'Healthy' | 'Watch' | 'Critical';
  flags: string[];
  budgetAtRisk: number;    // planned budget still to be spent on non-healthy campaigns
}

const clampScore = (x: number) => Math.min(Math.max(x, 0), 1.25) / 1.25;

export function monitorCampaigns(ds: Dataset, bm: Benchmark): LiveCampaign[] {
  return campaignResults(ds).filter(r => r.plan.status === 'Active').map(r => {
    const delivery = r.expectedIncrRevenueToDate ? r.incrRevenue / r.expectedIncrRevenueToDate : 1;
    const pace = r.expectedSpendToDate ? r.spend / r.expectedSpendToDate : 1;
    const visitsRatio = r.expectedIncrVisitsToDate ? r.incrVisits / r.expectedIncrVisitsToDate : 1;
    const roi = r.roi ?? 0;
    const score = 0.4 * clampScore(roi / r.plan.expectedRoi) + 0.3 * clampScore(delivery) + 0.2 * clampScore(visitsRatio) + 0.1 * (1 - Math.min(Math.abs(pace - 1), 1));
    const health = Math.round(score * 100);
    const gap = (() => {
      const m = marketDepthFor(bm, r.plan.scheme, r.plan.region);
      return m === null ? 0 : m - OUR_TERMS[r.plan.scheme].depthPct;
    })();
    const flags: string[] = [];
    if (delivery < 0.9) flags.push('Underperform');
    if (roi < r.plan.expectedRoi * 0.95) flags.push('Below ROI plan');
    if (pace > 1.15) flags.push('Overspend');
    if (pace < 0.7) flags.push('Underspend');
    if (gap >= 3) flags.push('Competitor');
    const band: LiveCampaign['band'] = health >= 75 ? 'Healthy' : health >= 55 ? 'Watch' : 'Critical';
    return {
      result: r,
      day: r.elapsedMonths * 30, totalDays: r.totalMonths * 30,
      deliveryPct: delivery * 100, pacePct: pace * 100, visitsVsPredPct: (visitsRatio - 1) * 100,
      roi, health, band, flags,
      budgetAtRisk: band === 'Healthy' ? 0 : Math.max(r.plan.investment - r.spend, 0),
    };
  }).sort((a, b) => a.health - b.health);
}

// ------------------------------------------------------------
// Guardrails and the "AI alternative" search (Simulation page)
// ------------------------------------------------------------

export interface Guardrails { minRoi: number; maxIntensityPct: number }

export function guardrailViolations(ev: Evaluation, g: Guardrails): string[] {
  const out: string[] = [];
  const roi = ev.scenario.roi ?? 0;
  if (roi < g.minRoi) out.push(`Predicted ROI ${roi.toFixed(2)}x is below the minimum guardrail of ${g.minRoi.toFixed(2)}x.`);
  if (ev.intensityPct > g.maxIntensityPct) out.push(`Promotion cost is ${ev.intensityPct.toFixed(1)}% of baseline revenue, above the ${g.maxIntensityPct.toFixed(1)}% maximum.`);
  return out;
}

/**
 * Searches schemes × budget × offer depth for the option that best meets `objective` while respecting the
 * guardrails. If nothing satisfies them, returns the highest-ROI option and marks it infeasible.
 */
export function findAlternative(ds: Dataset, bm: Benchmark, spec: RecSpec, objective: Objective, g: Guardrails): { spec: RecSpec; ev: Evaluation; feasible: boolean } {
  const metric = objectiveMetric[objective].value;
  const options: { spec: RecSpec; ev: Evaluation; ok: boolean }[] = [];
  for (const scheme of SCHEMES) {
    const ref = OUR_TERMS[scheme].depthPct;
    const market = marketDepthFor(bm, scheme, spec.region);
    const depths = [...new Set([ref, market !== null ? Math.min(market, ref + 2.5) : ref, market !== null ? Math.min(market, ref + 5) : ref].map(d => Math.round(d * 10) / 10))];
    for (const mult of [0.5, 0.75, 1, 1.25, 1.5]) for (const depthPct of depths) {
      const s: RecSpec = { ...spec, scheme, depthPct, budget: roundHalf(spec.budget * mult) };
      const ev = evaluateSpec(ds, bm, s);
      options.push({ spec: s, ev, ok: guardrailViolations(ev, g).length === 0 });
    }
  }
  const feasible = options.filter(o => o.ok);
  const best = feasible.length
    ? feasible.reduce((a, b) => (metric(b.ev.scenario) > metric(a.ev.scenario) ? b : a))
    : options.reduce((a, b) => ((b.ev.scenario.roi ?? 0) > (a.ev.scenario.roi ?? 0) ? b : a));
  return { spec: best.spec, ev: best.ev, feasible: feasible.length > 0 };
}