// ============================================================
// ServiceIQ — synthetic dataset generator
//
// Produces ONE CSV in /data (serviceiq_master_dataset.csv) — the single source of truth for every page
// (dashboard, planning, simulation, campaign performance and the AI Advisor), holding three record types:
//
//   Actual     month x service center x customer segment performance (480 rows)
//   Plan       campaign months after the data window: plan values only, actuals = 0 (21 rows)
//   Competitor external market data: competitor offers by region and month (219 rows, illustrative)
//
// Campaign attributes are repeated on every row of a campaign, and plan amounts are allocated additively,
// so SUM over a campaign_id gives the campaign totals (actuals and plan). Competitor rows leave the
// performance columns blank, and vice versa.
//
// Deterministic (seeded) — re-running produces identical files.
//   node scripts/generate-dataset.mjs
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Write only when the content changed (avoids needless rewrites of unchanged, possibly synced/locked files)
function writeIfChanged(url, text) {
  if (existsSync(url) && readFileSync(url, 'utf8') === text) return false;
  writeFileSync(url, text);
  return true;
}

const OUT = new URL('../data/', import.meta.url);

// ---------- seeded PRNG -------------------------------------
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260331);
const jitter = amp => 1 + (rand() * 2 - 1) * amp;
const r3 = v => Math.round(v * 1000) / 1000;

// ---------- reference data ----------------------------------
const MONTHS = [
  '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09',
  '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
];
const monthIdx = m => MONTHS.indexOf(m);

const CENTERS = [
  { id: 'SC-01', name: 'Delhi Downtown',        city: 'Delhi',      region: 'North',   weight: 0.13, asv: 1.06 },
  { id: 'SC-02', name: 'Mumbai Andheri',        city: 'Mumbai',     region: 'West',    weight: 0.14, asv: 1.08 },
  { id: 'SC-03', name: 'Bengaluru Whitefield',  city: 'Bengaluru',  region: 'South',   weight: 0.14, asv: 1.05 },
  { id: 'SC-04', name: 'Hyderabad Hitech',      city: 'Hyderabad',  region: 'South',   weight: 0.11, asv: 1.00 },
  { id: 'SC-05', name: 'Chennai OMR',           city: 'Chennai',    region: 'South',   weight: 0.09, asv: 1.00 },
  { id: 'SC-06', name: 'Kolkata Salt Lake',     city: 'Kolkata',    region: 'East',    weight: 0.08, asv: 0.95 },
  { id: 'SC-07', name: 'Pune Hinjewadi',        city: 'Pune',       region: 'West',    weight: 0.10, asv: 1.02 },
  { id: 'SC-08', name: 'Jaipur Vaishali',       city: 'Jaipur',     region: 'North',   weight: 0.06, asv: 0.93 },
  { id: 'SC-09', name: 'Nagpur Sitabuldi',      city: 'Nagpur',     region: 'Central', weight: 0.08, asv: 0.92 },
  { id: 'SC-10', name: 'Indore Vijay Nagar',    city: 'Indore',     region: 'Central', weight: 0.07, asv: 0.92 },
];

const SEGMENTS = {
  Premium:      { share: 0.18, asv: 9800, margin: 0.43, retention: 92.0 },
  'Mid-Market': { share: 0.42, asv: 6800, margin: 0.39, retention: 89.0 },
  Value:        { share: 0.27, asv: 4600, margin: 0.34, retention: 86.0 },
  Fleet:        { share: 0.13, asv: 7200, margin: 0.33, retention: 84.0 },
};

// Network-wide visit seasonality, Apr..Mar (festive + winter peak, monsoon dip)
const SEASONAL = [0.92, 0.95, 0.98, 0.96, 1.0, 1.03, 1.08, 1.02, 1.08, 1.10, 1.02, 0.97];
const BASE_VISITS = 6500;     // network visits in an average month before seasonality
const VISIT_TREND = 0.005;    // +0.5% per month underlying growth
const ASV_TREND = 0.002;      // +0.2% per month price/mix drift

// Discount-led schemes dilute gross margin in the rows they run in
const DISCOUNT_HIT = {
  '10% Service Discount': 0.012,
  '₹500 Discount Voucher': 0.010,
  'Free Car Wash': 0.004,
  'Free Engine Check': 0.003,
  'Service + Car Wash Bundle': 0.005,
};

// ---------- campaigns ----------------------------------------
// roiActual is the delivered ROI target for the generator only:
//   ROI = incremental gross profit / promotion spend
// `null` roiActual = planned campaign (no rows generated).
const CAMPAIGNS = [
  { id: 'CMP-2501', name: 'Summer Car Care Camp',   scheme: 'Free Car Wash',             region: 'East',    segment: 'Mid-Market', start: '2025-04', end: '2025-05', pct: 0.055, expRoi: 1.30, roiActual: 1.41, spendFactor: 0.98, status: 'Completed', note: 'Wash offered with every periodic service' },
  { id: 'CMP-2502', name: 'Monsoon Service Camp',   scheme: '10% Service Discount',      region: 'West',    segment: 'Mid-Market', start: '2025-06', end: '2025-08', pct: 0.055, expRoi: 1.25, roiActual: 1.56, spendFactor: 0.97, status: 'Completed', note: 'Flat 10% off periodic maintenance' },
  { id: 'CMP-2503', name: 'Fleet Health Pilot',     scheme: 'Free Engine Check',         region: 'North',   segment: 'Fleet',      start: '2025-08', end: '2025-09', pct: 0.055, expRoi: 1.20, roiActual: 1.05, spendFactor: 0.96, status: 'Completed', note: 'Free 21-point engine check, no repair credit' },
  { id: 'CMP-2504', name: 'Monsoon Shield Bundle',  scheme: 'Service + Car Wash Bundle', region: 'West',    segment: 'Value',      start: '2025-07', end: '2025-09', pct: 0.055, expRoi: 1.30, roiActual: 1.38, spendFactor: 0.99, status: 'Completed', note: 'Service + wash bundle at a fixed price' },
  { id: 'CMP-2505', name: 'Festive Voucher Drop',   scheme: '₹500 Discount Voucher',     region: 'North',   segment: 'Value',      start: '2025-10', end: '2025-11', pct: 0.055, expRoi: 1.30, roiActual: 1.12, spendFactor: 0.95, status: 'Completed', note: '60-day voucher expiry' },
  { id: 'CMP-2506', name: 'Diwali Free Wash',       scheme: 'Free Car Wash',             region: 'South',   segment: 'Mid-Market', start: '2025-10', end: '2025-11', pct: 0.055, expRoi: 1.30, roiActual: 1.47, spendFactor: 0.98, status: 'Completed', note: 'Wash bundled into festive service slots' },
  { id: 'CMP-2507', name: 'Metro Bundle Refresh',   scheme: 'Service + Car Wash Bundle', region: 'Central', segment: 'Premium',    start: '2025-11', end: '2025-12', pct: 0.055, expRoi: 1.35, roiActual: 1.52, spendFactor: 1.00, status: 'Completed', note: 'Priority slot included' },
  { id: 'CMP-2508', name: 'Winter Wash Bundle',     scheme: 'Service + Car Wash Bundle', region: 'South',   segment: 'Premium',    start: '2025-12', end: '2026-01', pct: 0.055, expRoi: 1.40, roiActual: 1.58, spendFactor: 0.95, status: 'Completed', note: 'Priority slot included' },
  { id: 'CMP-2509', name: 'Year-End Voucher',       scheme: '₹500 Discount Voucher',     region: 'East',    segment: 'Value',      start: '2025-12', end: '2026-01', pct: 0.055, expRoi: 1.25, roiActual: 1.28, spendFactor: 0.97, status: 'Completed', note: '90-day voucher expiry' },
  { id: 'CMP-2510', name: 'Republic Day Service Offer', scheme: '10% Service Discount',  region: 'North',   segment: 'Premium',    start: '2026-01', end: '2026-02', pct: 0.055, expRoi: 1.30, roiActual: 1.38, spendFactor: 0.98, status: 'Completed', note: 'Flat 10% off periodic maintenance' },
  { id: 'CMP-2511', name: 'Engine Health Check',    scheme: 'Free Engine Check',         region: 'Central', segment: 'Fleet',      start: '2026-01', end: '2026-03', pct: 0.055, expRoi: 1.20, roiActual: 0.92, spendFactor: 0.96, status: 'Completed', note: 'Free check with no repair credit' },
  { id: 'CMP-2512', name: 'Spring Refresh Promo',   scheme: 'Free Car Wash',             region: 'East',    segment: 'Mid-Market', start: '2026-03', end: '2026-04', pct: 0.055, expRoi: 1.35, roiActual: 1.28, spendFactor: 1.00, status: 'Active',    note: 'Wash offered with every periodic service' },
  { id: 'CMP-2513', name: 'Highway Care Drive',     scheme: '₹500 Discount Voucher',     region: 'West',    segment: 'Value',      start: '2026-03', end: '2026-05', pct: 0.055, expRoi: 1.25, roiActual: 1.21, spendFactor: 1.00, status: 'Active',    note: '90-day voucher expiry' },
  { id: 'CMP-2514', name: 'Priority Slot Weekends',  scheme: 'Service + Car Wash Bundle', region: 'North',   segment: 'Premium',    start: '2025-11', end: '2025-12', pct: 0.055, expRoi: 1.35, roiActual: 1.50, spendFactor: 0.98, status: 'Completed', note: 'Priority slot included' },
  { id: 'CMP-2515', name: 'Fleet Wash Pilot',        scheme: 'Free Car Wash',             region: 'East',    segment: 'Fleet',      start: '2025-09', end: '2025-10', pct: 0.055, expRoi: 1.25, roiActual: 1.22, spendFactor: 0.97, status: 'Completed', note: 'Wash offered at fleet depot visits' },
  { id: 'CMP-2516', name: 'Southern Value Voucher',  scheme: '₹500 Discount Voucher',     region: 'South',   segment: 'Value',      start: '2025-09', end: '2025-10', pct: 0.055, expRoi: 1.30, roiActual: 1.15, spendFactor: 0.96, status: 'Completed', note: '60-day voucher expiry' },
  { id: 'CMP-2517', name: 'Mid-Market Service Month', scheme: '10% Service Discount',     region: 'North',   segment: 'Mid-Market', start: '2025-07', end: '2025-08', pct: 0.055, expRoi: 1.30, roiActual: 1.44, spendFactor: 0.98, status: 'Completed', note: 'Flat 10% off periodic maintenance' },
  { id: 'CMP-2518', name: 'Premium Wash Weeks',      scheme: 'Free Car Wash',             region: 'West',    segment: 'Premium',    start: '2025-11', end: '2025-12', pct: 0.055, expRoi: 1.30, roiActual: 1.36, spendFactor: 0.99, status: 'Completed', note: 'Wash offered with every periodic service' },
  { id: 'CMP-2519', name: 'Central Bundle Drive',    scheme: 'Service + Car Wash Bundle', region: 'Central', segment: 'Mid-Market', start: '2026-01', end: '2026-02', pct: 0.055, expRoi: 1.40, roiActual: 1.55, spendFactor: 0.97, status: 'Completed', note: 'Service + wash bundle at a fixed price' },
  { id: 'CMP-2520', name: 'South Fleet Engine Check', scheme: 'Free Engine Check',        region: 'South',   segment: 'Fleet',      start: '2025-05', end: '2025-06', pct: 0.055, expRoi: 1.20, roiActual: 1.02, spendFactor: 0.95, status: 'Completed', note: 'Free 21-point engine check, no repair credit' },
  { id: 'CMP-2521', name: 'Spring Bundle Push',      scheme: 'Service + Car Wash Bundle', region: 'West',    segment: 'Mid-Market', start: '2026-03', end: '2026-05', pct: 0.055, expRoi: 1.40, roiActual: 1.44, spendFactor: 1.00, status: 'Active',    note: 'Service + wash bundle at a fixed price' },
  { id: 'CMP-2601', name: 'Q1 Fleet Retention',     scheme: 'Service + Car Wash Bundle', region: 'North',   segment: 'Fleet',      start: '2026-04', end: '2026-06', pct: 0.055, expRoi: 1.50, roiActual: null, spendFactor: 1, status: 'Planned',   note: 'Bundle with annual maintenance plan' },
  { id: 'CMP-2602', name: 'EV Service Launch',      scheme: '10% Service Discount',      region: 'South',   segment: 'Premium',    start: '2026-05', end: '2026-06', pct: 0.055, expRoi: 1.30, roiActual: null, spendFactor: 1, status: 'Planned',   note: 'Introductory discount for EV owners' },
];

const monthSpan = (start, end) => {
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  return (ey - sy) * 12 + (em - sm) + 1;
};
const inRange = (m, start, end) => m >= start && m <= end;

// Sanity: no two campaigns may overlap for the same region+segment in a month
for (const a of CAMPAIGNS) for (const b of CAMPAIGNS) {
  if (a.id < b.id && a.region === b.region && a.segment === b.segment && a.start <= b.end && b.start <= a.end) {
    throw new Error(`Campaign overlap: ${a.id} and ${b.id}`);
  }
}

// ---------- service_performance ------------------------------
const regionWeight = region => CENTERS.filter(c => c.region === region).reduce((s, c) => s + c.weight, 0);

// Pass 1 — organic (baseline) demand for every month x center x segment
const cells = [];
MONTHS.forEach((month, mi) => {
  for (const c of CENTERS) {
    for (const [segName, seg] of Object.entries(SEGMENTS)) {
      let visitsBase = BASE_VISITS * SEASONAL[mi] * (1 + VISIT_TREND * mi) * c.weight * seg.share * jitter(0.03);
      let asv = seg.asv * c.asv * (1 + ASV_TREND * mi) * jitter(0.012);

      // March 2026 shocks (give the analytics something real to explain)
      if (month === '2026-03') {
        if (c.region === 'South' && segName === 'Premium') asv *= 0.93;    // ASV compression
        if (c.region === 'North' && segName === 'Value') visitsBase *= 0.93; // footfall dip
      }
      visitsBase = Math.round(visitsBase);
      cells.push({ month, mi, c, segName, seg, visitsBase, asv, revenueBase: (visitsBase * asv) / 1e5 });
    }
  }
});

// Campaign investment is sized as a share of the organic revenue of the slice it targets
// (region x segment over the campaign's life), so campaigns are realistic for their market size.
// Months beyond the data window use the slice's last-3-month average.
function sliceRevenue(region, segment, start, end) {
  const monthly = m => cells.filter(x => x.month === m && x.c.region === region && x.segName === segment).reduce((s, x) => s + x.revenueBase, 0);
  const lastAvg = MONTHS.slice(-3).reduce((s, m) => s + monthly(m), 0) / 3;
  let total = 0;
  for (let y = +start.slice(0, 4), mo = +start.slice(5); `${y}-${String(mo).padStart(2, '0')}` <= end; mo === 12 ? (y++, mo = 1) : mo++) {
    const key = `${y}-${String(mo).padStart(2, '0')}`;
    total += MONTHS.includes(key) ? monthly(key) : lastAvg;
  }
  return total;
}
for (const k of CAMPAIGNS) k.inv = Math.max(1, Math.round(k.pct * sliceRevenue(k.region, k.segment, k.start, k.end) * 10) / 10);


// Pass 2 — apply campaigns, margins, retention
const monthKeys = (start, end) => {
  const out = [];
  for (let y = +start.slice(0, 4), mo = +start.slice(5); `${y}-${String(mo).padStart(2, '0')}` <= end; mo === 12 ? (y++, mo = 1) : mo++) {
    out.push(`${y}-${String(mo).padStart(2, '0')}`);
  }
  return out;
};

// Per-campaign plan totals, allocated additively to rows (so SUM over rows = campaign total)
const planFor = (camp, c) => {
  const seg = SEGMENTS[camp.segment];
  const span = monthSpan(camp.start, camp.end);
  const share = c.weight / regionWeight(c.region);
  const nominalMargin = seg.margin - DISCOUNT_HIT[camp.scheme];
  const expRev = (camp.inv * camp.expRoi) / nominalMargin;
  return {
    span, share,
    plannedSpend: (camp.inv / span) * share,
    expRev: (expRev / span) * share,
    expVisits: ((expRev * 1e5) / (seg.asv * 0.95) / span) * share,
  };
};

const campaignCols = (camp, c) => {
  if (!camp) {
    return {
      campaign_id: '', campaign_name: '', scheme: '', campaign_status: '', campaign_start: '', campaign_end: '', campaign_design_note: '',
      expected_roi: '', planned_promo_spend_lakh: 0, expected_incremental_revenue_lakh: 0, expected_incremental_visits: 0,
    };
  }
  const p = planFor(camp, c);
  return {
    campaign_id: camp.id, campaign_name: camp.name, scheme: camp.scheme, campaign_status: camp.status,
    campaign_start: camp.start, campaign_end: camp.end, campaign_design_note: camp.note,
    expected_roi: camp.expRoi,
    planned_promo_spend_lakh: r3(p.plannedSpend),
    expected_incremental_revenue_lakh: r3(p.expRev),
    expected_incremental_visits: Math.round(p.expVisits * 100) / 100,
  };
};

const master = [];
for (const { month, mi, c, segName, seg, visitsBase, asv, revenueBase } of cells) {
  const camp = CAMPAIGNS.find(k =>
    k.roiActual !== null && k.region === c.region && k.segment === segName && inRange(month, k.start, k.end));
  const hit = camp ? DISCOUNT_HIT[camp.scheme] : 0;
  const margin = Math.min(0.6, Math.max(0.2, seg.margin + (c.asv - 1) * 0.06 - hit + (rand() * 2 - 1) * 0.008 + 0.0008 * mi));

  let promoSpend = 0, incrGP = 0, incrRev = 0, incrVisits = 0;
  if (camp) {
    const span = monthSpan(camp.start, camp.end);
    const centerShare = c.weight / regionWeight(c.region);
    promoSpend = (camp.inv / span) * camp.spendFactor * centerShare * jitter(0.06);
    incrGP = promoSpend * camp.roiActual * jitter(0.07);
    incrRev = incrGP / margin;
    incrVisits = Math.round((incrRev * 1e5) / (asv * 0.95));
  }
  incrRev = r3(incrRev);
  const visits = visitsBase + incrVisits;
  const revenue = r3(revenueBase + incrRev);
  const cost = r3(revenue * (1 - margin));
  const grossProfit = r3(revenue - cost);
  const incrGrossProfit = r3(incrRev * margin);

  const due = Math.round(visits * 0.8);
  const rate = seg.retention + 0.03 * mi + (camp ? 0.8 : 0) + (rand() * 2 - 1) * 0.6;
  const retained = Math.round((due * Math.min(rate, 97)) / 100);

  master.push({
    record_type: 'Actual', month, fiscal_month: mi + 1,
    center_id: c.id, center_name: c.name, city: c.city, region: c.region, segment: segName,
    service_visits: visits,
    service_revenue_lakh: revenue,
    cost_of_service_lakh: cost,
    gross_profit_lakh: grossProfit,
    avg_service_value_inr: Math.round((revenue * 1e5) / visits),
    customers_due: due,
    customers_retained: retained,
    ...campaignCols(camp, c),
    promo_spend_lakh: r3(promoSpend),
    incremental_visits: incrVisits,
    incremental_revenue_lakh: incrRev,
    incremental_gross_profit_lakh: incrGrossProfit,
  });
}

// Plan rows: campaign months that fall after the data window (active campaigns' remaining months
// and planned campaigns). They carry plan values only; every actual measure is 0.
for (const camp of CAMPAIGNS) {
  for (const month of monthKeys(camp.start, camp.end)) {
    if (MONTHS.includes(month)) continue;
    for (const c of CENTERS.filter(x => x.region === camp.region)) {
      master.push({
        record_type: 'Plan', month, fiscal_month: ((+month.slice(5) + 8) % 12) + 1,
        center_id: c.id, center_name: c.name, city: c.city, region: c.region, segment: camp.segment,
        service_visits: 0, service_revenue_lakh: 0, cost_of_service_lakh: 0, gross_profit_lakh: 0, avg_service_value_inr: 0,
        customers_due: 0, customers_retained: 0,
        ...campaignCols(camp, c),
        promo_spend_lakh: 0, incremental_visits: 0, incremental_revenue_lakh: 0, incremental_gross_profit_lakh: 0,
      });
    }
  }
}

// ---------- write the single master CSV (UTF-8 with BOM so Excel shows ₹ correctly) ----
function toCsv(rows, cols = Object.keys(rows[0])) {
  const esc = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [cols.join(','), ...rows.map(r => cols.map(k => esc(r[k])).join(','))].join('\n') + '\n';
}

mkdirSync(OUT, { recursive: true });
// (the single CSV is written at the end of this script, after the competitor rows are generated)

// ---------- console summary -----------------------------------
const actual = master.filter(r => r.record_type === 'Actual');
const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);
console.log(`Actual + Plan rows: ${master.length} (${actual.length} actual + ${master.length - actual.length} plan)`);
console.log('\nmonth      revenue(L)  visits   ASV    margin  promo(L)  incrRev(L)  ROI');
for (const m of MONTHS) {
  const rs = actual.filter(r => r.month === m);
  const rev = sum(rs, 'service_revenue_lakh');
  const v = sum(rs, 'service_visits');
  const sp = sum(rs, 'promo_spend_lakh');
  const gp = sum(rs, 'gross_profit_lakh');
  console.log(
    `${m}   ${rev.toFixed(1).padStart(8)}  ${String(v).padStart(6)}  ${Math.round((rev * 1e5) / v)}  ${(100 * gp / rev).toFixed(1)}%  ${sp.toFixed(2).padStart(7)}  ${sum(rs, 'incremental_revenue_lakh').toFixed(1).padStart(9)}  ${sp ? (sum(rs, 'incremental_gross_profit_lakh') / sp).toFixed(2) : '-'}`,
  );
}

// =====================================================================
// External benchmark: competitor promotions (illustrative, anonymised)
// Generated here but written into the SAME single CSV as record_type = Competitor.
// =====================================================================
const rand2 = mulberry32(777);
const j2 = amp => 1 + (rand2() * 2 - 1) * amp;
const TICKET = 6910; // network average service ticket (₹) used to express offer value as % of ticket
const REGION_AGGRESSION = { South: 1.25, West: 1.15, North: 1.08, Central: 0.95, East: 0.7 };
const ALL_REGIONS = ['North', 'South', 'East', 'West', 'Central'];
const BM_MONTHS = ['2026-01', '2026-02', '2026-03'];
const COMPETITORS = [
  { id: 'COMP-A', name: 'Competitor A', type: 'National multi-brand chain', source: 'Public price list', conf: 'High', regions: ALL_REGIONS, offers: [
    { mech: 'Percentage service discount', scheme: '10% Service Discount', depth: 15, validity: 30, channel: 'In-store', desc: '15% off periodic service', escalates: true },
    { mech: 'Fixed-value voucher', scheme: '₹500 Discount Voucher', value: 750, validity: 90, channel: 'In-store', desc: '₹750 voucher on next service, 90-day validity' },
    { mech: 'Free inspection', scheme: 'Free Engine Check', value: 450, credit: 500, validity: 30, channel: 'In-store', desc: 'Free 30-point check with ₹500 repair credit' },
    { mech: 'Service bundle', scheme: 'Service + Car Wash Bundle', depth: 14, validity: 30, channel: 'In-store', desc: 'Service + wash + interior clean bundle', escalates: true },
  ] },
  { id: 'COMP-B', name: 'Competitor B', type: 'OEM-authorised network', source: 'Mystery shopper', conf: 'Medium', regions: ALL_REGIONS, offers: [
    { mech: 'Percentage service discount', scheme: '10% Service Discount', depth: 8, validity: 30, channel: 'In-store', desc: '8% off for out-of-warranty cars' },
    { mech: 'Free add-on', scheme: 'Free Car Wash', value: 350, validity: 30, channel: 'In-store', desc: 'Free wash with any paid service' },
    { mech: 'Free inspection', scheme: 'Free Engine Check', value: 500, credit: 500, validity: 30, channel: 'In-store', desc: 'Free health check + ₹500 repair credit' },
    { mech: 'Service bundle', scheme: 'Service + Car Wash Bundle', depth: 9, validity: 365, channel: 'In-store', desc: 'Annual maintenance plan' },
  ] },
  { id: 'COMP-C', name: 'Competitor C', type: 'App-based service aggregator', source: 'App listing', conf: 'High', regions: ['North', 'South', 'West'], offers: [
    { mech: 'Percentage service discount', scheme: '10% Service Discount', depth: 20, validity: 30, channel: 'App', desc: 'First-booking 20% off in app', escalates: true },
    { mech: 'Fixed-value voucher', scheme: '₹500 Discount Voucher', value: 1000, validity: 120, channel: 'App', desc: '₹1,000 app wallet credit, 120-day validity' },
    { mech: 'Service bundle', scheme: 'Service + Car Wash Bundle', depth: 16, validity: 30, channel: 'App', desc: 'Service + wash combo at app-only price', escalates: true },
  ] },
  { id: 'COMP-D', name: 'Competitor D', type: 'Express service chain', source: 'Mystery shopper', conf: 'Medium', regions: ['South', 'West', 'Central'], offers: [
    { mech: 'Percentage service discount', scheme: '10% Service Discount', depth: 12, validity: 30, channel: 'In-store', desc: '12% off express service' },
    { mech: 'Free add-on', scheme: 'Free Car Wash', value: 350, validity: 30, channel: 'In-store', desc: 'Free wash with express service' },
    { mech: 'Fixed-value voucher', scheme: '₹500 Discount Voucher', value: 600, validity: 60, channel: 'In-store', desc: '₹600 voucher, 60-day validity' },
  ] },
  { id: 'COMP-E', name: 'Competitor E', type: 'Regional independent garages', source: 'Public price list', conf: 'Medium', regions: ALL_REGIONS, offers: [
    { mech: 'Percentage service discount', scheme: '10% Service Discount', depth: 12, validity: 30, channel: 'In-store', desc: '12% off labour charges' },
    { mech: 'Free inspection', scheme: 'Free Engine Check', value: 300, credit: 0, validity: 30, channel: 'In-store', desc: 'Free check-up, no credit' },
    { mech: 'Free add-on', scheme: 'Free Car Wash', value: 300, validity: 30, channel: 'In-store', desc: 'Free basic wash' },
  ] },
];

const benchmark = [];
BM_MONTHS.forEach((month, mi) => {
  for (const comp of COMPETITORS) for (const region of comp.regions) for (const o of comp.offers) {
    const agg = REGION_AGGRESSION[region];
    let value, depth;
    if (o.depth !== undefined) {
      depth = o.depth * agg * (o.escalates && (region === 'South' || region === 'West') ? 1 + 0.02 * mi : 1) * j2(0.05);
      value = Math.round(((depth / 100) * TICKET) / 10) * 10;
    } else {
      value = Math.round((o.value * Math.sqrt(agg) * j2(0.04)) / 10) * 10;
      depth = (value / TICKET) * 100;
    }
    benchmark.push({
      record_type: 'Competitor',
      month,
      competitor_id: comp.id, competitor_name: comp.name, competitor_type: comp.type,
      region, mechanic: o.mech, our_equivalent_scheme: o.scheme, offer_description: o.desc,
      discount_depth_pct: Math.round(depth * 10) / 10,
      offer_value_inr: value,
      validity_days: o.validity,
      repair_credit_inr: o.credit ?? 0,
      channel: o.channel,
      market_reach_pct: Math.min(45, Math.max(8, Math.round(15 + 12 * agg + rand2() * 6))),
      source_type: comp.source,
      confidence: comp.conf,
    });
  }
});

// ---------- ONE CSV: our records (Actual, Plan) + external competitor observations ----------
const OUR_COLS = Object.keys(master[0]);
const COMPETITOR_COLS = [
  'competitor_id', 'competitor_name', 'competitor_type', 'mechanic', 'our_equivalent_scheme', 'offer_description',
  'discount_depth_pct', 'offer_value_inr', 'validity_days', 'repair_credit_inr', 'channel', 'market_reach_pct', 'source_type', 'confidence',
];
const ALL_COLS = [...OUR_COLS, ...COMPETITOR_COLS];
const wrote = writeIfChanged(new URL('serviceiq_master_dataset.csv', OUT), toCsv([...master, ...benchmark], ALL_COLS));
console.log(`\nserviceiq_master_dataset.csv  ${master.length + benchmark.length} rows x ${ALL_COLS.length} columns  (${actual.length} Actual + ${master.length - actual.length} Plan + ${benchmark.length} Competitor)${wrote ? '' : '  [unchanged]'}`);
