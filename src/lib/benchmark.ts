// ============================================================
// External benchmark: competitor promotions.
//
// Read from the `Competitor` rows of the single data/serviceiq_master_dataset.csv (illustrative,
// anonymised market data, kept apart from our own rows by record_type). This module compares OUR offer terms with
// what competitors run, finds gaps, and turns them into actionable, quantified suggestions.
// ============================================================

import { parseCsv } from './csv.ts';
import { REGIONS, SCHEMES } from './constants.ts';
import { campaignResults, metricsFor } from './analytics.ts';
import { pctChange } from './format.ts';
import { MODEL_HORIZON_WEEKS, runScheme, windowBaseline, windowEfficiency, PLAN_PERIODS } from './simulation.ts';
import type { Dataset, Region, Scheme } from './types.ts';

const FILE = 'serviceiq_master_dataset.csv (record_type = Competitor)';

export interface CompetitorOffer {
  month: string;
  competitorId: string;
  competitor: string;
  competitorType: string;
  region: Region;
  mechanic: string;
  scheme: Scheme;               // our equivalent scheme
  description: string;
  depthPct: number;             // offer value as % of the average service ticket
  valueInr: number;
  validityDays: number;
  repairCreditInr: number;
  channel: string;
  reachPct: number;
  source: string;
  confidence: string;
}

export interface Benchmark {
  offers: CompetitorOffer[];
  months: string[];
  latestMonth: string;
  competitors: { id: string; name: string; type: string }[];
}

export function buildBenchmark(csv: string): Benchmark {
  const num = (r: Record<string, string>, k: string) => {
    const v = Number(r[k]);
    if (r[k] === '' || !Number.isFinite(v)) throw new Error(`${FILE}: invalid number in "${k}": "${r[k]}"`);
    return v;
  };
  // The competitor observations live in the same single CSV, tagged record_type = Competitor.
  const offers: CompetitorOffer[] = parseCsv(csv).filter(r => r.record_type === 'Competitor').map(r => {
    if (!(REGIONS as string[]).includes(r.region)) throw new Error(`${FILE}: unknown region "${r.region}"`);
    if (!(SCHEMES as string[]).includes(r.our_equivalent_scheme)) throw new Error(`${FILE}: unknown scheme "${r.our_equivalent_scheme}"`);
    return {
      month: r.month,
      competitorId: r.competitor_id,
      competitor: r.competitor_name,
      competitorType: r.competitor_type,
      region: r.region as Region,
      mechanic: r.mechanic,
      scheme: r.our_equivalent_scheme as Scheme,
      description: r.offer_description,
      depthPct: num(r, 'discount_depth_pct'),
      valueInr: num(r, 'offer_value_inr'),
      validityDays: num(r, 'validity_days'),
      repairCreditInr: num(r, 'repair_credit_inr'),
      channel: r.channel,
      reachPct: num(r, 'market_reach_pct'),
      source: r.source_type,
      confidence: r.confidence,
    };
  });
  if (!offers.length) throw new Error(`${FILE} is empty`);
  const months = [...new Set(offers.map(o => o.month))].sort();
  const seen = new Map<string, { id: string; name: string; type: string }>();
  for (const o of offers) if (!seen.has(o.competitorId)) seen.set(o.competitorId, { id: o.competitorId, name: o.competitor, type: o.competitorType });
  return { offers, months, latestMonth: months[months.length - 1], competitors: [...seen.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}

// ------------------------------------------------------------
// Our current offer terms (configuration, not measured data)
// ------------------------------------------------------------

export interface OurTerms { valueInr: number; depthPct: number; validityDays: number; repairCreditInr: number; description: string }

/** Depth = offer value as % of the ₹6,910 network-average ticket, so it is comparable with competitors. */
export const OUR_TERMS: Record<Scheme, OurTerms> = {
  '10% Service Discount': { valueInr: 690, depthPct: 10, validityDays: 30, repairCreditInr: 0, description: 'Flat 10% off periodic maintenance' },
  '₹500 Discount Voucher': { valueInr: 500, depthPct: 7.2, validityDays: 60, repairCreditInr: 0, description: '₹500 voucher, 60-day validity' },
  'Free Car Wash': { valueInr: 350, depthPct: 5.1, validityDays: 30, repairCreditInr: 0, description: 'Free wash with every periodic service' },
  'Free Engine Check': { valueInr: 450, depthPct: 6.5, validityDays: 30, repairCreditInr: 0, description: 'Free engine check, no repair credit' },
  'Service + Car Wash Bundle': { valueInr: 800, depthPct: 11.6, validityDays: 30, repairCreditInr: 0, description: 'Service + wash bundle with priority slot' },
};

// ------------------------------------------------------------
// Market position
// ------------------------------------------------------------

const median = (v: number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const GAP_THRESHOLD_PP = 3;

export interface MarketPosition {
  scheme: Scheme;
  region: Region | 'All';
  competitors: number;
  medianDepth: number;
  maxDepth: number;
  minDepth: number;
  topCompetitor: string;
  medianValueInr: number;
  medianValidity: number;
  creditShare: number;        // share of competitor offers that include a repair credit (0-1)
  trendPp: number;            // change in median depth, first → latest observation month
  ourDepth: number;
  ourValidity: number;
  gapPp: number;              // market median − our depth (positive = we are behind)
  validityGapDays: number;
  position: 'Behind' | 'Parity' | 'Ahead';
}

export function marketPosition(bm: Benchmark, scheme: Scheme, region: Region | 'All' = 'All'): MarketPosition | null {
  const inScope = (o: CompetitorOffer) => o.scheme === scheme && (region === 'All' || o.region === region);
  const latest = bm.offers.filter(o => inScope(o) && o.month === bm.latestMonth);
  if (!latest.length) return null;
  const first = bm.offers.filter(o => inScope(o) && o.month === bm.months[0]);
  const our = OUR_TERMS[scheme];
  const med = median(latest.map(o => o.depthPct));
  const top = [...latest].sort((a, b) => b.depthPct - a.depthPct)[0];
  const gap = med - our.depthPct;
  return {
    scheme, region,
    competitors: new Set(latest.map(o => o.competitorId)).size,
    medianDepth: med,
    maxDepth: Math.max(...latest.map(o => o.depthPct)),
    minDepth: Math.min(...latest.map(o => o.depthPct)),
    topCompetitor: top.competitor,
    medianValueInr: median(latest.map(o => o.valueInr)),
    medianValidity: median(latest.map(o => o.validityDays)),
    creditShare: latest.filter(o => o.repairCreditInr > 0).length / latest.length,
    trendPp: first.length ? med - median(first.map(o => o.depthPct)) : 0,
    ourDepth: our.depthPct,
    ourValidity: our.validityDays,
    gapPp: gap,
    validityGapDays: median(latest.map(o => o.validityDays)) - our.validityDays,
    position: gap >= GAP_THRESHOLD_PP ? 'Behind' : gap <= -GAP_THRESHOLD_PP ? 'Ahead' : 'Parity',
  };
}

export function marketOverview(bm: Benchmark, region: Region | 'All' = 'All'): MarketPosition[] {
  return SCHEMES.map(s => marketPosition(bm, s, region)).filter((m): m is MarketPosition => m !== null);
}

export interface RegionPressure {
  region: Region;
  offers: number;
  competitors: number;
  avgGapPp: number;           // average of (market median − our depth) across schemes
  behindSchemes: number;
  intensity: 'High' | 'Medium' | 'Low';
  revenueShare: number;       // % of network revenue
  revenueChangeL3M: number | null;
}

export function regionPressure(ds: Dataset, bm: Benchmark): RegionPressure[] {
  const l3 = ds.months.slice(-3), prev = ds.months.slice(-6, -3);
  const total = metricsFor(ds, {}).revenue;
  return REGIONS.map(region => {
    const ov = marketOverview(bm, region);
    const avgGap = ov.length ? ov.reduce((s, m) => s + m.gapPp, 0) / ov.length : 0;
    const cur = metricsFor(ds, { region }, l3), old = metricsFor(ds, { region }, prev);
    return {
      region,
      offers: bm.offers.filter(o => o.region === region && o.month === bm.latestMonth).length,
      competitors: new Set(bm.offers.filter(o => o.region === region && o.month === bm.latestMonth).map(o => o.competitorId)).size,
      avgGapPp: avgGap,
      behindSchemes: ov.filter(m => m.position === 'Behind').length,
      intensity: avgGap >= 3 ? 'High' : avgGap >= 1 ? 'Medium' : 'Low',
      revenueShare: (metricsFor(ds, { region }).revenue / total) * 100,
      revenueChangeL3M: old.revenue ? pctChange(cur.revenue, old.revenue) : null,
    };
  });
}

/** Market depth for one of our schemes in a region (null when no competitor runs an equivalent). */
export const marketDepthFor = (bm: Benchmark, scheme: Scheme, region: Region | 'All') => marketPosition(bm, scheme, region)?.medianDepth ?? null;

// ------------------------------------------------------------
// Depth what-if (used by suggestions and the Simulation page)
// ------------------------------------------------------------

/** Impact of moving a scheme's depth for a reference campaign (`budget` at current terms) in a region. */
export function depthImpact(ds: Dataset, bm: Benchmark, scheme: Scheme, region: Region | 'All', depthPct: number, budget = 10, weeks = MODEL_HORIZON_WEEKS) {
  const eff = windowEfficiency(ds, scheme, { region });
  const idx = PLAN_PERIODS[0].monthIdx;
  const refMonths = idx.map(i => ds.months[i]);
  const base = windowBaseline(ds, { region }, refMonths, weeks);
  const market = marketDepthFor(bm, scheme, region);
  const ref = OUR_TERMS[scheme].depthPct;
  const now = runScheme(base, eff, budget, { depthPct: ref, refDepthPct: ref, marketDepthPct: market });
  const next = runScheme(base, eff, budget, { depthPct: depthPct, refDepthPct: ref, marketDepthPct: market });
  return { now, next, dRevenue: next.incrRevenue - now.incrRevenue, dVisits: next.incrVisits - now.incrVisits, dNet: next.incrNetProfit - now.incrNetProfit, dCost: next.promoCost - now.promoCost };
}

/** Depth (between current and market median, in 0.5pp steps) that maximises net profit. */
export function bestDepth(ds: Dataset, bm: Benchmark, scheme: Scheme, region: Region | 'All', budget = 10) {
  const ref = OUR_TERMS[scheme].depthPct;
  const market = marketDepthFor(bm, scheme, region);
  if (market === null || market <= ref) return { depth: ref, impact: depthImpact(ds, bm, scheme, region, ref, budget) };
  let best = { depth: ref, impact: depthImpact(ds, bm, scheme, region, ref, budget) };
  for (let d = ref + 0.5; d <= market + 1e-9; d += 0.5) {
    const impact = depthImpact(ds, bm, scheme, region, d, budget);
    if (impact.dNet > best.impact.dNet) best = { depth: d, impact };
  }
  return best;
}

// ------------------------------------------------------------
// Suggestions
// ------------------------------------------------------------

export interface PromoSuggestion {
  id: string;
  priority: 'High' | 'Medium' | 'Low';
  type: 'Match depth' | 'Extend validity' | 'Add repair credit' | 'Hold' | 'Expand where competition is low';
  scheme: Scheme;
  region: Region | 'All';
  title: string;
  evidence: string[];
  action: string;
  impact: string;
  impactNet: number;   // ₹ lakh per reference campaign (for ranking)
  score: number;
}

const sL = (v: number) => `${v < 0 ? '−' : '+'}₹${Math.abs(v).toFixed(1)}L`;
const sN = (v: number) => `${v < 0 ? '−' : '+'}${Math.abs(Math.round(v)).toLocaleString('en-IN')}`;
const sPp = (v: number) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)}pp`;

const fmtRoiList = (v: number[]) => v.map(x => `${x.toFixed(2)}x`).join(', ');

export function buildSuggestions(ds: Dataset, bm: Benchmark, opts: { region?: Region | 'All' } = {}): PromoSuggestion[] {
  const out: PromoSuggestion[] = [];
  const focus = opts.region && opts.region !== 'All' ? opts.region : null;
  const revShare = new Map(regionPressure(ds, bm).map(r => [r.region, r.revenueShare]));
  const REF_BUDGET = 10;
  const MAX_STEP_PP = 5; // phase deeper offers in: never recommend more than +5pp in one step
  const results = campaignResults(ds).filter(r => r.plan.status !== 'Planned' && r.spend > 0);

  // ---- Depth gaps, region by region (they differ by market)
  for (const region of focus ? [focus] : REGIONS) {
    for (const mp of marketOverview(bm, region)) {
      if (mp.position !== 'Behind') continue;
      if (mp.scheme !== '10% Service Discount' && mp.scheme !== '₹500 Discount Voucher' && mp.scheme !== 'Service + Car Wash Bundle') continue;
      const our = OUR_TERMS[mp.scheme];
      const share = revShare.get(region) ?? 0;
      const evidenceBase = `${mp.competitors} competitor${mp.competitors === 1 ? '' : 's'} in ${region}; market median ${mp.medianDepth.toFixed(1)}% vs our ${our.depthPct}%`;
      const target = Math.min(mp.medianDepth, our.depthPct + MAX_STEP_PP);
      const best = bestDepth(ds, bm, mp.scheme, region, REF_BUDGET);
      const depth = Math.min(best.depth, target);
      const impact = depthImpact(ds, bm, mp.scheme, region, depth, REF_BUDGET);

      if (depth > our.depthPct + 1e-9 && impact.dNet > 0) {
        out.push({
          id: `depth-${mp.scheme}-${region}`,
          // Priority follows the money: a big gap only earns "High" when a deeper offer clearly pays back
          priority: impact.dNet < 0.5 ? 'Low' : mp.gapPp >= 5 && impact.dNet >= 1 ? 'High' : 'Medium',
          type: 'Match depth', scheme: mp.scheme, region,
          title: `${region}: our ${mp.scheme} is ${mp.gapPp.toFixed(1)}pp shallower than the market`,
          evidence: [
            `${evidenceBase} (gap ${mp.gapPp.toFixed(1)}pp)`,
            `Deepest offer: ${mp.topCompetitor} at ${mp.maxDepth.toFixed(1)}%; market median moved ${sPp(mp.trendPp)} between ${bm.months[0]} and ${bm.latestMonth}`,
            `${region} is ${share.toFixed(0)}% of our revenue — ${mp.gapPp >= 5 ? 'highly' : 'moderately'} exposed to price-led switching`,
          ],
          action: `Raise ${mp.scheme} depth from ${our.depthPct}% to ${depth.toFixed(1)}% in ${region}, aimed at price-sensitive segments (Value, Mid-Market)${depth < mp.medianDepth ? `; review again before closing the remaining ${(mp.medianDepth - depth).toFixed(1)}pp` : ''}.`,
          impact: `Per ₹${REF_BUDGET}L campaign: ${sL(impact.dRevenue)} revenue, ${sN(impact.dVisits)} visits, ${sL(impact.dNet)} net profit (cost ${sL(impact.dCost)})`,
          impactNet: impact.dNet,
          score: (mp.gapPp * share) / 10 + Math.max(impact.dNet, 0),
        });
      } else if (focus) {
        out.push({
          id: `hold-${mp.scheme}-${region}`, priority: 'Low', type: 'Hold', scheme: mp.scheme, region,
          title: `${region}: ${mp.scheme} is behind the market, but a deeper offer would not pay back`,
          evidence: [evidenceBase, 'Net profit does not improve at any deeper level tested up to the market median'],
          action: `Keep ${our.depthPct}% and compete on non-price levers (validity, priority service, bundling).`,
          impact: 'No change in spend', impactNet: 0, score: 0.5,
        });
      }
    }
    // ---- Low competition → scale without deepening
    for (const mp of marketOverview(bm, region)) {
      if (mp.position === 'Ahead' && mp.gapPp <= -1) {
        out.push({
          id: `expand-${mp.scheme}-${region}`, priority: 'Medium', type: 'Expand where competition is low',
          scheme: mp.scheme, region,
          title: `${region}: our ${mp.scheme} is deeper than the market — little competitive pressure`,
          evidence: [`${mp.competitors} competitors in ${region}; market median ${mp.medianDepth.toFixed(1)}% vs our ${mp.ourDepth}%`],
          action: `Scale ${mp.scheme} here at the current depth; there is room to trim depth without losing competitiveness.`,
          impact: 'Protects margin', impactNet: 0.4, score: 1.5,
        });
      }
    }
  }

  // ---- Terms that are network-wide policy (one suggestion, not one per region)
  const scopeRegion: Region | 'All' = focus ?? 'All';
  const voucher = marketPosition(bm, '₹500 Discount Voucher', scopeRegion);
  if (voucher && voucher.validityGapDays >= 20) {
    const ourV = OUR_TERMS['₹500 Discount Voucher'];
    const v60 = results.filter(r => r.plan.scheme === '₹500 Discount Voucher' && r.plan.designNote.includes('60-day'));
    const v90 = results.filter(r => r.plan.scheme === '₹500 Discount Voucher' && r.plan.designNote.includes('90-day'));
    const gapTo = (rs: typeof v60) => rs.length ? rs.reduce((s, r) => s + ((r.roi ?? 0) - r.plan.expectedRoi), 0) / rs.length : null;
    const g60 = gapTo(v60), g90 = gapTo(v90);
    out.push({
      id: `validity-${scopeRegion}`, priority: 'High', type: 'Extend validity', scheme: '₹500 Discount Voucher', region: scopeRegion,
      title: `Our voucher expires in ${ourV.validityDays} days; competitors give a median of ${Math.round(voucher.medianValidity)}`,
      evidence: [
        `Competitor vouchers: median ₹${Math.round(voucher.medianValueInr)} valid ${Math.round(voucher.medianValidity)} days vs our ₹${ourV.valueInr} valid ${ourV.validityDays} days`,
        v60.length ? `Our 60-day voucher campaigns returned ${fmtRoiList(v60.map(r => r.roi ?? 0))} (${g60 !== null ? `${g60 >= 0 ? '+' : '−'}${Math.abs(g60).toFixed(2)}x vs plan on average` : ''})` : '',
        v90.length && g90 !== null ? `Our 90-day voucher campaigns returned ${fmtRoiList(v90.map(r => r.roi ?? 0))} (${g90 >= 0 ? '+' : '−'}${Math.abs(g90).toFixed(2)}x vs plan on average)` : '',
      ].filter(Boolean),
      action: `Extend voucher validity to ${Math.min(90, Math.round(voucher.medianValidity))} days at the same face value before raising the voucher amount.`,
      impact: 'Near-zero extra cost; targets the ROI shortfall vs plan on short-validity vouchers', impactNet: 0.6, score: 4,
    });
  }
  const check = marketPosition(bm, 'Free Engine Check', scopeRegion);
  if (check && check.creditShare >= 0.5 && OUR_TERMS['Free Engine Check'].repairCreditInr === 0) {
    const ck = results.filter(r => r.plan.scheme === 'Free Engine Check');
    out.push({
      id: `credit-${scopeRegion}`, priority: 'High', type: 'Add repair credit', scheme: 'Free Engine Check', region: scopeRegion,
      title: `${(check.creditShare * 100).toFixed(0)}% of competitor free checks include a ₹500 repair credit — ours has none`,
      evidence: [
        'Competitors pair the free check with a repair credit so it converts into paid work',
        ck.length ? `Our ${ck.length} Free Engine Check campaigns returned ${fmtRoiList(ck.map(r => r.roi ?? 0))} against a plan of ${fmtRoiList(ck.map(r => r.plan.expectedRoi))}` : '',
      ].filter(Boolean),
      action: 'Add a ₹500 repair credit (redeemable on repairs above ₹3,000), or retire the scheme for Fleet customers.',
      impact: 'Expected to lift conversion of free checks into paid repairs; pilot in one region first', impactNet: 0.8, score: 4.5,
    });
  }

  const order = { High: 0, Medium: 1, Low: 2 } as const;
  return out.sort((a, b) => order[a.priority] - order[b.priority] || b.score - a.score);
}