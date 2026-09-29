import { parseCsv } from './csv.ts';
import { REGIONS, SCHEMES, SEGMENTS } from './constants.ts';
import type { CampaignPlan, CampaignStatus, Center, Dataset, PerfRow, Region, Scheme, Segment } from './types.ts';

const FILE = 'serviceiq_master_dataset.csv';

function num(row: Record<string, string>, key: string): number {
  const v = Number(row[key]);
  if (row[key] === undefined || row[key] === '' || !Number.isFinite(v)) {
    throw new Error(`${FILE}: invalid number in column "${key}": "${row[key]}"`);
  }
  return v;
}

function oneOf<T extends string>(value: string, allowed: readonly T[], what: string): T {
  if (!(allowed as readonly string[]).includes(value)) throw new Error(`${FILE}: unknown ${what} "${value}"`);
  return value as T;
}

/**
 * Builds the in-memory dataset from the single master CSV.
 *
 * The single CSV holds three record types; this function uses the first two:
 *  - "Actual":     one row per month x service center x customer segment (measured performance)
 *  - "Plan":       campaign months that have not happened yet (plan values only)
 *  - "Competitor": external competitor offers — ignored here, read by buildBenchmark()
 * Campaign attributes are repeated on each campaign row and plan amounts are allocated additively,
 * so campaign totals are simply sums over campaign_id.
 *
 * Pure function (no file or bundler access) so the same code runs in the browser and in Node checks.
 */
export function buildDataset(masterCsv: string): Dataset {
  const raw = parseCsv(masterCsv);
  if (!raw.length) throw new Error(`${FILE} is empty`);

  const centerMap = new Map<string, Center>();
  const rows: PerfRow[] = [];
  const campaignMap = new Map<string, CampaignPlan>();

  for (const r of raw) {
    if (r.record_type === 'Competitor') continue; // external market data lives in the same file
    const type = oneOf(r.record_type, ['Actual', 'Plan'] as const, 'record_type');
    const region = oneOf<Region>(r.region, REGIONS, 'region');
    const segment = oneOf<Segment>(r.segment, SEGMENTS, 'segment');

    const known = centerMap.get(r.center_id);
    if (known && (known.name !== r.center_name || known.region !== region)) {
      throw new Error(`${FILE}: center ${r.center_id} has inconsistent name/region`);
    }
    centerMap.set(r.center_id, { id: r.center_id, name: r.center_name, city: r.city, region });

    // ---- campaign attributes (only on rows tagged with a campaign)
    const campaignId = r.campaign_id ?? '';
    let scheme: Scheme | '' = '';
    if (campaignId) {
      scheme = oneOf<Scheme>(r.scheme, SCHEMES, 'scheme');
      let c = campaignMap.get(campaignId);
      if (!c) {
        c = {
          id: campaignId,
          name: r.campaign_name,
          scheme,
          region,
          segment,
          startMonth: r.campaign_start,
          endMonth: r.campaign_end,
          status: oneOf<CampaignStatus>(r.campaign_status, ['Planned', 'Active', 'Completed'], 'campaign_status'),
          investment: 0,
          plannedByMonth: {},
          expectedRoi: num(r, 'expected_roi'),
          expectedIncrRevenue: 0,
          expectedIncrVisits: 0,
          designNote: r.campaign_design_note,
        };
        campaignMap.set(campaignId, c);
      } else if (c.scheme !== scheme || c.region !== region || c.segment !== segment || c.name !== r.campaign_name) {
        throw new Error(`${FILE}: campaign ${campaignId} has inconsistent attributes across rows`);
      }
      const planned = num(r, 'planned_promo_spend_lakh');
      c.investment += planned;
      c.plannedByMonth[r.month] = (c.plannedByMonth[r.month] ?? 0) + planned;
      c.expectedIncrRevenue += num(r, 'expected_incremental_revenue_lakh');
      c.expectedIncrVisits += num(r, 'expected_incremental_visits');
    }

    if (type === 'Plan') continue; // plan rows only contribute campaign plan totals

    rows.push({
      month: r.month,
      centerId: r.center_id,
      region,
      segment,
      visits: num(r, 'service_visits'),
      revenue: num(r, 'service_revenue_lakh'),
      cost: num(r, 'cost_of_service_lakh'),
      grossProfit: num(r, 'gross_profit_lakh'),
      due: num(r, 'customers_due'),
      retained: num(r, 'customers_retained'),
      campaignId,
      scheme,
      promoSpend: num(r, 'promo_spend_lakh'),
      incrVisits: num(r, 'incremental_visits'),
      incrRevenue: num(r, 'incremental_revenue_lakh'),
      incrGrossProfit: num(r, 'incremental_gross_profit_lakh'),
    });
  }

  if (!rows.length) throw new Error(`${FILE} has no Actual rows`);
  const months = [...new Set(rows.map(r => r.month))].sort();
  const campaigns = [...campaignMap.values()]
    .map(c => ({
      ...c,
      investment: Math.round(c.investment * 100) / 100,
      plannedByMonth: Object.fromEntries(Object.entries(c.plannedByMonth).map(([m, v]) => [m, Math.round(v * 1000) / 1000])),
      expectedIncrRevenue: Math.round(c.expectedIncrRevenue * 10) / 10,
      expectedIncrVisits: Math.round(c.expectedIncrVisits),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const centers = [...centerMap.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { centers, rows, campaigns, months, latestMonth: months[months.length - 1] };
}
