import { SCHEMES } from './constants.ts';
import { aggregate, campaignResults, filterRows } from './analytics.ts';
import { fmtL } from './format.ts';
import type { Dataset, Region, Scheme, Scope, Segment } from './types.ts';

// ------------------------------------------------------------
// Plan (created on the Planning page, evaluated on Simulation)
// ------------------------------------------------------------

export type Objective =
  | 'Maximize Incremental Revenue'
  | 'Maximize ROI'
  | 'Maximize Service Visits'
  | 'Maximize Net Profit';

export const OBJECTIVES: Objective[] = [
  'Maximize Incremental Revenue',
  'Maximize ROI',
  'Maximize Service Visits',
  'Maximize Net Profit',
];

/** Planning periods of FY 2026-27. `monthIdx` indexes the 12 months of the reference year. */
export const PLAN_PERIODS = [
  { label: 'Q1 FY 2026-27 (Apr–Jun)', monthIdx: [0, 1, 2] },
  { label: 'Q2 FY 2026-27 (Jul–Sep)', monthIdx: [3, 4, 5] },
  { label: 'Q3 FY 2026-27 (Oct–Dec)', monthIdx: [6, 7, 8] },
  { label: 'Q4 FY 2026-27 (Jan–Mar)', monthIdx: [9, 10, 11] },
  { label: 'H1 FY 2026-27 (Apr–Sep)', monthIdx: [0, 1, 2, 3, 4, 5] },
  { label: 'H2 FY 2026-27 (Oct–Mar)', monthIdx: [6, 7, 8, 9, 10, 11] },
  { label: 'Full Year FY 2026-27', monthIdx: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
] as const;
export type PlanPeriodLabel = (typeof PLAN_PERIODS)[number]['label'];

export interface Plan {
  period: PlanPeriodLabel;
  region: Region | 'All';
  centerId: string | 'All';
  segment: Segment | 'All';
  objective: Objective;
  revenueTarget: number;  // ₹ lakh
  visitTarget: number;
  budget: number;         // ₹ lakh promotion budget
  scheme: Scheme;         // scheme the plan is built around
}

// ------------------------------------------------------------
// Model assumptions — surfaced in the UI so nothing is hidden
// ------------------------------------------------------------

/** Underlying year-on-year growth applied to the same-months-last-year baseline. */
export const BASELINE_GROWTH = 0.06;
/** Diminishing returns: revenue per ₹ spent changes by (budget / reference)^ELASTICITY. */
export const RESPONSE_ELASTICITY = -0.12;
/** Incremental visits carry ~5% lower ticket than an average visit. */
const INCR_VISIT_TICKET_FACTOR = 0.95;

export const MODEL_ASSUMPTIONS = [
  `Baseline = same months of FY 2025-26 excluding promotion-driven revenue, grown ${(BASELINE_GROWTH * 100).toFixed(0)}% year on year.`,
  'Promotion response per scheme is learned from past campaigns (scope-matched where at least 2 exist, otherwise network-wide).',
  `Diminishing returns: revenue per ₹1 spent changes by (spend intensity ÷ historical intensity)^${RESPONSE_ELASTICITY}, where intensity = promotion spend ÷ baseline revenue.`,
  'The whole promotion budget is assumed to be deployed on the scheme being tested.',
  'Offer depth: cost scales with depth, take-up scales with depth^0.5, and 4% of take-up is lost per percentage point our offer is shallower than the competitor median (assumption).',
];

export const planScope = (plan: Plan): Scope => ({ region: plan.region, centerId: plan.centerId, segment: plan.segment });

export const planPeriod = (plan: Plan) => PLAN_PERIODS.find(p => p.label === plan.period) ?? PLAN_PERIODS[0];

// ------------------------------------------------------------
// Baseline
// ------------------------------------------------------------

export interface Baseline {
  revenue: number;      // ₹ lakh
  visits: number;
  grossProfit: number;
  grossMargin: number;
  asv: number;
  months: number;
}

export function planBaseline(ds: Dataset, plan: Plan): Baseline {
  const idx = planPeriod(plan).monthIdx;
  const months = idx.map(i => ds.months[i]).filter(Boolean);
  const m = aggregate(filterRows(ds, planScope(plan), months));
  const g = 1 + BASELINE_GROWTH;
  const revenue = (m.revenue - m.incrRevenue) * g;
  const visits = (m.visits - m.incrVisits) * g;
  const grossProfit = (m.grossProfit - m.incrGrossProfit) * g;
  return {
    revenue, visits, grossProfit,
    grossMargin: revenue ? (grossProfit / revenue) * 100 : 0,
    asv: visits ? (revenue * 1e5) / visits : 0,
    months: months.length,
  };
}

/** Targets that are a modest stretch (+5%) over the baseline for the plan's scope. */
export function suggestTargets(ds: Dataset, plan: Plan): { revenue: number; visits: number } {
  const b = planBaseline(ds, plan);
  return { revenue: Math.round(b.revenue * 1.05), visits: Math.round(b.visits * 1.05) };
}

export function defaultPlan(ds: Dataset): Plan {
  const base: Plan = {
    period: PLAN_PERIODS[0].label,
    region: 'All',
    centerId: 'All',
    segment: 'All',
    objective: 'Maximize Net Profit',
    revenueTarget: 0,
    visitTarget: 0,
    budget: 15,
    scheme: 'Service + Car Wash Bundle',
  };
  const t = suggestTargets(ds, base);
  return { ...base, revenueTarget: t.revenue, visitTarget: t.visits };
}

// ------------------------------------------------------------
// Scheme response learned from campaign history
// ------------------------------------------------------------

export interface Efficiency {
  scheme: Scheme;
  revenuePerLakh: number;  // incremental revenue per ₹1 lakh spent
  gpMargin: number;        // incremental gross profit / incremental revenue (0-1)
  refIntensity: number;    // spend ÷ organic revenue of the targeted slice at which the response was measured
  refBudget: number;       // typical campaign spend (₹ lakh) — descriptive only
  campaigns: number;
  basis: string;           // human-readable evidence, e.g. "3 campaigns · Premium segment"
  tier: 'slice' | 'segment' | 'region' | 'network'; // how specific the evidence is
  roiCv: number;           // spread of campaign ROIs (std ÷ mean) — higher = less consistent evidence
}

export function schemeEfficiency(ds: Dataset, scheme: Scheme, scope: Partial<Scope>): Efficiency {
  const region = scope.centerId && scope.centerId !== 'All'
    ? ds.centers.find(c => c.id === scope.centerId)?.region ?? 'All'
    : scope.region ?? 'All';
  const segment = scope.segment ?? 'All';

  const all = campaignResults(ds).filter(r => r.plan.scheme === scheme && r.spend > 0);
  // Most specific evidence first; a tier is used only if it has at least 2 campaigns.
  type Result = (typeof all)[number];
  const tiers: { label: string; tier: Efficiency['tier']; slice: Partial<Scope>; test: (r: Result) => boolean }[] = [];
  if (region !== 'All' && segment !== 'All') tiers.push({ label: `${region} · ${segment}`, tier: 'slice', slice: { region, segment }, test: r => r.plan.region === region && r.plan.segment === segment });
  if (segment !== 'All') tiers.push({ label: `${segment} segment`, tier: 'segment', slice: { segment }, test: r => r.plan.segment === segment });
  if (region !== 'All') tiers.push({ label: `${region} region`, tier: 'region', slice: { region }, test: r => r.plan.region === region });

  let picked = all;
  let basisLabel = 'network-wide';
  let slice: Partial<Scope> = {};
  let tierKey: Efficiency['tier'] = 'network';
  for (const t of tiers) {
    const hit = all.filter(t.test);
    if (hit.length >= 2) { picked = hit; basisLabel = t.label; slice = t.slice; tierKey = t.tier; break; }
  }
  const rois = picked.map(r => r.roi ?? 0);
  const roiMean = rois.reduce((s, v) => s + v, 0) / Math.max(rois.length, 1);
  const roiCv = roiMean ? Math.sqrt(rois.reduce((s, v) => s + (v - roiMean) ** 2, 0) / Math.max(rois.length, 1)) / roiMean : 0;
  const completed = picked.filter(r => r.plan.status === 'Completed');
  const refSet = completed.length ? completed : picked;
  const spend = picked.reduce((s, r) => s + r.spend, 0);
  const rev = picked.reduce((s, r) => s + r.incrRevenue, 0);
  const gp = picked.reduce((s, r) => s + r.incrGrossProfit, 0);

  // Spend intensity = the scheme's promotion spend as a share of the organic revenue of the
  // same slice over the same window (full year), so it is comparable to budget ÷ baseline revenue.
  const a = aggregate(filterRows(ds, slice));
  const sliceOrganic = a.revenue - a.incrRevenue;
  return {
    scheme,
    revenuePerLakh: spend ? rev / spend : 0,
    gpMargin: rev ? gp / rev : 0,
    refIntensity: sliceOrganic ? spend / sliceOrganic : 0.03,
    refBudget: refSet.reduce((s, r) => s + r.spend, 0) / Math.max(refSet.length, 1),
    campaigns: picked.length,
    basis: `${picked.length} campaign${picked.length === 1 ? '' : 's'} · ${basisLabel}`,
    tier: tierKey,
    roiCv,
  };
}

const shareCache = new WeakMap<Dataset, Map<Scheme, number>>();

/** Average share of its targeted slice's organic revenue that a past campaign of this scheme spent. */
export function typicalCampaignShare(ds: Dataset, scheme: Scheme): number {
  let byScheme = shareCache.get(ds);
  if (!byScheme) { byScheme = new Map(); shareCache.set(ds, byScheme); }
  const hit = byScheme.get(scheme);
  if (hit !== undefined) return hit;
  const past = campaignResults(ds).filter(r => r.plan.scheme === scheme && r.spend > 0);
  const shares = past.map(r => {
    const months = ds.months.filter(m => m >= r.plan.startMonth && m <= r.plan.endMonth);
    const a = aggregate(filterRows(ds, { region: r.plan.region, segment: r.plan.segment }, months));
    return r.spend / Math.max(a.revenue - a.incrRevenue, 1e-9);
  });
  const value = shares.reduce((s, v) => s + v, 0) / Math.max(shares.length, 1);
  byScheme.set(scheme, value);
  return value;
}

/**
 * Efficiency for evaluating a single campaign window (weeks): same response as schemeEfficiency, but the
 * reference intensity is what past campaigns spent relative to their own window, so a campaign sized like
 * a typical past one reproduces the historical ROI.
 */
export function windowEfficiency(ds: Dataset, scheme: Scheme, scope: Partial<Scope>): Efficiency {
  const eff = schemeEfficiency(ds, scheme, scope);
  const share = typicalCampaignShare(ds, scheme);
  return share > 0 ? { ...eff, refIntensity: share } : eff;
}

/**
 * Baseline for a single campaign window: the organic run-rate of a scope in the reference months,
 * scaled to `weeks` and grown by the same underlying growth as planBaseline.
 */
export function windowBaseline(ds: Dataset, scope: Partial<Scope>, refMonths: string[], weeks: number): Baseline {
  const m = aggregate(filterRows(ds, scope, refMonths));
  const n = Math.max(refMonths.length, 1);
  const scale = (weeks / 4.345) * (1 + BASELINE_GROWTH);
  const revenue = ((m.revenue - m.incrRevenue) / n) * scale;
  const visits = ((m.visits - m.incrVisits) / n) * scale;
  const grossProfit = ((m.grossProfit - m.incrGrossProfit) / n) * scale;
  return {
    revenue, visits, grossProfit,
    grossMargin: revenue ? (grossProfit / revenue) * 100 : 0,
    asv: visits ? (revenue * 1e5) / visits : 0,
    months: weeks / 4.345,
  };
}

// ------------------------------------------------------------
// Scenarios
// ------------------------------------------------------------

export interface Scenario {
  key: string;
  label: string;
  description: string;
  scheme: Scheme | null;
  revenue: number;
  visits: number;
  asv: number;
  grossMargin: number;
  incrRevenue: number;
  incrVisits: number;
  promoCost: number;
  incrGrossProfit: number;
  incrNetProfit: number;
  roi: number | null;
  visitsUpliftPct: number;
  revenueUpliftPct: number;
  evidence: string;
}

const SCHEME_DESCRIPTIONS: Record<Scheme, string> = {
  '10% Service Discount': 'Flat 10% off periodic maintenance',
  '₹500 Discount Voucher': '₹500 voucher on the next service',
  'Free Car Wash': 'Complimentary wash with every periodic service',
  'Free Engine Check': 'Free engine health check, no repair credit',
  'Service + Car Wash Bundle': 'Service + wash bundle with priority slot',
};

export function baselineScenario(b: Baseline): Scenario {
  return {
    key: 'baseline', label: 'Baseline', description: 'No promotion — organic run-rate only', scheme: null,
    revenue: b.revenue, visits: b.visits, asv: b.asv, grossMargin: b.grossMargin,
    incrRevenue: 0, incrVisits: 0, promoCost: 0, incrGrossProfit: 0, incrNetProfit: 0, roi: null,
    visitsUpliftPct: 0, revenueUpliftPct: 0, evidence: 'FY 2025-26 same-period run-rate',
  };
}

/** Default campaign length (weeks) used for reference campaigns and recommendations. */
export const MODEL_HORIZON_WEEKS = 8;

/** How much extra take-up a deeper offer earns: volume scales with (depth ratio)^ε. */
export const DEPTH_ELASTICITY = 0.5;
/** Share of take-up lost to a deeper competitor offer, per percentage point of depth gap. */
export const LEAKAGE_PER_PP = 0.04;
export const LEAKAGE_CAP = 0.4;

/**
 * Offer terms for a what-if on discount depth. `refDepthPct` is our current depth (the terms
 * the historical response was measured at); `marketDepthPct` is the competitor median (or null).
 * Cost scales with depth, take-up scales with depth^ε, and take-up recovers as the gap to the
 * market narrows. At depth = refDepthPct the result equals the plain historical response.
 */
export interface OfferTerms { depthPct: number; refDepthPct: number; marketDepthPct: number | null }

const leakage = (depth: number, market: number | null) =>
  market === null ? 0 : Math.min(LEAKAGE_CAP, LEAKAGE_PER_PP * Math.max(0, market - depth));

export function runScheme(b: Baseline, eff: Efficiency, budget: number, terms?: OfferTerms): Scenario {
  const intensity = b.revenue ? Math.max(budget, 0.001) / b.revenue : eff.refIntensity;
  const multiple = eff.revenuePerLakh * Math.pow(intensity / Math.max(eff.refIntensity, 1e-6), RESPONSE_ELASTICITY);
  let incrRevenue = budget > 0 ? budget * multiple : 0;
  let promoCost = budget;
  if (terms && terms.refDepthPct > 0) {
    const ratio = terms.depthPct / terms.refDepthPct;
    const takeUp = (1 - leakage(terms.depthPct, terms.marketDepthPct)) / (1 - leakage(terms.refDepthPct, terms.marketDepthPct));
    incrRevenue *= Math.pow(ratio, DEPTH_ELASTICITY) * takeUp;
    promoCost = budget * ratio;
  }
  const incrVisits = b.asv ? (incrRevenue * 1e5) / (b.asv * INCR_VISIT_TICKET_FACTOR) : 0;
  const incrGrossProfit = incrRevenue * eff.gpMargin;
  const revenue = b.revenue + incrRevenue;
  const visits = b.visits + incrVisits;
  return {
    key: eff.scheme, label: eff.scheme, description: SCHEME_DESCRIPTIONS[eff.scheme], scheme: eff.scheme,
    revenue, visits,
    asv: visits ? (revenue * 1e5) / visits : 0,
    grossMargin: revenue ? ((b.grossProfit + incrGrossProfit) / revenue) * 100 : 0,
    incrRevenue, incrVisits,
    promoCost,
    incrGrossProfit,
    incrNetProfit: incrGrossProfit - promoCost,
    roi: promoCost > 0 ? incrGrossProfit / promoCost : null,
    visitsUpliftPct: b.visits ? (incrVisits / b.visits) * 100 : 0,
    revenueUpliftPct: b.revenue ? (incrRevenue / b.revenue) * 100 : 0,
    evidence: eff.basis,
  };
}

export function buildScenarios(ds: Dataset, plan: Plan): { baseline: Baseline; scenarios: Scenario[] } {
  const baseline = planBaseline(ds, plan);
  const scope = planScope(plan);
  const scenarios = [
    baselineScenario(baseline),
    ...SCHEMES.map(s => runScheme(baseline, schemeEfficiency(ds, s, scope), plan.budget)),
  ];
  return { baseline, scenarios };
}

/** Same scheme at different budget levels — shows where returns flatten. */
export function budgetSensitivity(ds: Dataset, plan: Plan, scheme: Scheme, multipliers = [0.5, 0.75, 1, 1.25, 1.5, 2]) {
  const baseline = planBaseline(ds, plan);
  const eff = schemeEfficiency(ds, scheme, planScope(plan));
  return multipliers.map(mult => ({ multiplier: mult, ...runScheme(baseline, eff, plan.budget * mult) }));
}

// ------------------------------------------------------------
// Objective-based recommendation
// ------------------------------------------------------------

export const objectiveMetric: Record<Objective, { label: string; value: (s: Scenario) => number; format: (v: number) => string }> = {
  'Maximize Incremental Revenue': { label: 'incremental revenue', value: s => s.incrRevenue, format: v => fmtL(v) },
  'Maximize ROI': { label: 'ROI', value: s => s.roi ?? 0, format: v => `${v.toFixed(2)}x` },
  'Maximize Service Visits': { label: 'incremental visits', value: s => s.incrVisits, format: v => `${Math.round(v).toLocaleString('en-IN')}` },
  'Maximize Net Profit': { label: 'net profit after promotion cost', value: s => s.incrNetProfit, format: v => fmtL(v) },
};

export function rankScenarios(scenarios: Scenario[], objective: Objective): Scenario[] {
  const metric = objectiveMetric[objective].value;
  return scenarios.filter(s => s.scheme).sort((a, b) => metric(b) - metric(a));
}
