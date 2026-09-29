import { REGIONS, ROI_TARGET, SCHEMES } from './constants.ts';
import { pctChange } from './format.ts';
import type { CampaignPlan, Dataset, Metrics, PerfRow, Region, Scheme, Scope } from './types.ts';

export const ALL_SCOPE: Scope = { region: 'All', centerId: 'All', segment: 'All' };

// ------------------------------------------------------------
// Filtering & aggregation
// ------------------------------------------------------------

export function filterRows(ds: Dataset, scope: Partial<Scope> = {}, months?: string[]): PerfRow[] {
  const monthSet = months ? new Set(months) : null;
  return ds.rows.filter(r =>
    (!scope.region || scope.region === 'All' || r.region === scope.region) &&
    (!scope.centerId || scope.centerId === 'All' || r.centerId === scope.centerId) &&
    (!scope.segment || scope.segment === 'All' || r.segment === scope.segment) &&
    (!monthSet || monthSet.has(r.month)),
  );
}

export function aggregate(rows: PerfRow[]): Metrics {
  let revenue = 0, visits = 0, grossProfit = 0, promoSpend = 0, incrRevenue = 0, incrVisits = 0, incrGrossProfit = 0, due = 0, retained = 0;
  for (const r of rows) {
    revenue += r.revenue; visits += r.visits; grossProfit += r.grossProfit; promoSpend += r.promoSpend;
    incrRevenue += r.incrRevenue; incrVisits += r.incrVisits; incrGrossProfit += r.incrGrossProfit;
    due += r.due; retained += r.retained;
  }
  return {
    revenue,
    organicRevenue: revenue - incrRevenue,
    visits,
    asv: visits ? (revenue * 1e5) / visits : 0,
    grossProfit,
    grossMargin: revenue ? (grossProfit / revenue) * 100 : 0,
    promoSpend,
    incrRevenue,
    incrVisits,
    incrGrossProfit,
    roi: promoSpend > 0 ? incrGrossProfit / promoSpend : null,
    incrNetProfit: incrGrossProfit - promoSpend,
    due,
    retained,
    retention: due ? (retained / due) * 100 : 0,
  };
}

export const metricsFor = (ds: Dataset, scope: Partial<Scope> = {}, months?: string[]) =>
  aggregate(filterRows(ds, scope, months));

/** Centers that belong to a region (all centers when 'All'). */
export const centersIn = (ds: Dataset, region: Region | 'All') =>
  ds.centers.filter(c => region === 'All' || c.region === region);

/** Human-readable description of a scope, for captions and chatbot footnotes. */
export function describeScope(ds: Dataset, scope: Partial<Scope>): string {
  const parts: string[] = [];
  if (scope.centerId && scope.centerId !== 'All') parts.push(ds.centers.find(c => c.id === scope.centerId)?.name ?? scope.centerId);
  else parts.push(scope.region && scope.region !== 'All' ? `${scope.region} region` : 'All regions');
  parts.push(scope.segment && scope.segment !== 'All' ? `${scope.segment} segment` : 'all segments');
  return parts.join(' · ');
}

// ------------------------------------------------------------
// Periods (dashboard comparison windows)
// ------------------------------------------------------------

export type PeriodKey = 'latest' | 'l3m' | 'l6m' | 'fy';

export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: 'latest', label: 'Latest month' },
  { key: 'l3m', label: 'Last 3 months' },
  { key: 'l6m', label: 'Last 6 months' },
  { key: 'fy', label: 'Full year (FY 2025-26)' },
];

export interface PeriodWindow {
  current: string[];
  previous: string[] | null; // null when there is no earlier window to compare against
  comparison: string;        // caption for delta, e.g. "vs prev 3 months"
}

export function periodWindow(ds: Dataset, key: PeriodKey): PeriodWindow {
  const n = ds.months.length;
  const size = key === 'latest' ? 1 : key === 'l3m' ? 3 : key === 'l6m' ? 6 : n;
  const current = ds.months.slice(n - size);
  const previous = size < n && n - 2 * size >= 0 ? ds.months.slice(n - 2 * size, n - size) : null;
  const comparison = key === 'latest' ? 'vs prev month' : key === 'fy' ? 'full year' : `vs prev ${size} months`;
  return { current, previous, comparison };
}

// ------------------------------------------------------------
// Trends & breakdowns
// ------------------------------------------------------------

export interface MonthlyPoint extends Metrics { month: string }

export function monthlySeries(ds: Dataset, scope: Partial<Scope> = {}): MonthlyPoint[] {
  const rows = filterRows(ds, scope);
  const by = new Map<string, PerfRow[]>();
  for (const r of rows) (by.get(r.month) ?? by.set(r.month, []).get(r.month)!).push(r);
  return ds.months.map(month => ({ month, ...aggregate(by.get(month) ?? []) }));
}

export interface SchemePerf extends Metrics {
  scheme: Scheme;
  campaigns: number;
  visitsUpliftPct: number;   // incremental visits as % of organic visits in the rows where the scheme ran
  status: 'Above target' | 'On target' | 'Below target';
}

export function roiStatus(roi: number | null): SchemePerf['status'] {
  if (roi === null) return 'On target';
  return roi >= ROI_TARGET * 1.05 ? 'Above target' : roi >= ROI_TARGET * 0.95 ? 'On target' : 'Below target';
}

/** Promotion performance by scheme within a scope / set of months. Schemes with no spend are omitted. */
export function schemePerformance(ds: Dataset, scope: Partial<Scope> = {}, months?: string[]): SchemePerf[] {
  const rows = filterRows(ds, scope, months).filter(r => r.scheme);
  return SCHEMES.map(scheme => {
    const rs = rows.filter(r => r.scheme === scheme);
    const m = aggregate(rs);
    const campaigns = new Set(rs.filter(r => r.promoSpend > 0).map(r => r.campaignId)).size;
    const organicVisits = m.visits - m.incrVisits;
    return {
      ...m,
      scheme,
      campaigns,
      visitsUpliftPct: organicVisits > 0 ? (m.incrVisits / organicVisits) * 100 : 0,
      status: roiStatus(m.roi),
    };
  }).filter(s => s.promoSpend > 0).sort((a, b) => (b.roi ?? 0) - (a.roi ?? 0));
}

export interface RegionPerf extends Metrics {
  region: Region;
  revenueChange: number | null; // % vs previous window
}

export function regionBreakdown(ds: Dataset, scope: Partial<Scope>, window: PeriodWindow): RegionPerf[] {
  return REGIONS.map(region => {
    const s = { ...scope, region, centerId: 'All' as const };
    const cur = metricsFor(ds, s, window.current);
    const prev = window.previous ? metricsFor(ds, s, window.previous) : null;
    return { ...cur, region, revenueChange: prev && prev.revenue ? pctChange(cur.revenue, prev.revenue) : null };
  }).filter(r => r.visits > 0);
}

// ------------------------------------------------------------
// Campaign results (actuals come from the performance rows)
// ------------------------------------------------------------

export interface CampaignResult {
  plan: CampaignPlan;
  totalMonths: number;
  elapsedMonths: number;          // months of the campaign that have data
  spend: number;                  // actual spend to date
  incrRevenue: number;
  incrVisits: number;
  incrGrossProfit: number;
  netProfit: number;              // incremental gross profit - spend
  roi: number | null;
  /** Expected values scaled to the part of the campaign that has run. */
  expectedIncrRevenueToDate: number;
  expectedIncrVisitsToDate: number;
  expectedNetProfitToDate: number;
  expectedSpendToDate: number;
  monthly: { month: string; spend: number; incrRevenue: number; incrGrossProfit: number }[];
}

const monthsBetween = (a: string, b: string) => {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am) + 1;
};

const campaignCache = new WeakMap<Dataset, CampaignResult[]>();

/** Campaign plan vs actuals. Memoised per dataset. */
export function campaignResults(ds: Dataset): CampaignResult[] {
  const cached = campaignCache.get(ds);
  if (cached) return cached;
  const results = computeCampaignResults(ds);
  campaignCache.set(ds, results);
  return results;
}

function computeCampaignResults(ds: Dataset): CampaignResult[] {
  return ds.campaigns.map(plan => {
    const rows = ds.rows.filter(r => r.campaignId === plan.id);
    const m = aggregate(rows);
    const totalMonths = monthsBetween(plan.startMonth, plan.endMonth);
    const elapsedMonths = plan.status === 'Planned' ? 0 : Math.min(totalMonths, Math.max(0, monthsBetween(plan.startMonth, ds.latestMonth)));
    const share = totalMonths ? elapsedMonths / totalMonths : 0;
    const byMonth = ds.months
      .filter(mo => mo >= plan.startMonth && mo <= plan.endMonth)
      .map(month => {
        const a = aggregate(rows.filter(r => r.month === month));
        return { month, spend: a.promoSpend, incrRevenue: a.incrRevenue, incrGrossProfit: a.incrGrossProfit };
      });
    return {
      plan,
      totalMonths,
      elapsedMonths,
      spend: m.promoSpend,
      incrRevenue: m.incrRevenue,
      incrVisits: m.incrVisits,
      incrGrossProfit: m.incrGrossProfit,
      netProfit: m.incrNetProfit,
      roi: m.roi,
      expectedIncrRevenueToDate: plan.expectedIncrRevenue * share,
      expectedIncrVisitsToDate: plan.expectedIncrVisits * share,
      expectedNetProfitToDate: (plan.expectedRoi - 1) * plan.investment * share,
      expectedSpendToDate: plan.investment * share,
      monthly: byMonth,
    };
  });
}
