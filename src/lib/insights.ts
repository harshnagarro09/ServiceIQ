import { campaignResults, metricsFor, schemePerformance, type CampaignResult } from './analytics.ts';
import { REGIONS, ROI_TARGET, SEGMENTS } from './constants.ts';
import { fmtL, fmtPct, fmtSigned, fmtSL, fmtX, monthLabel, pctChange } from './format.ts';
import { schemeEfficiency } from './simulation.ts';
import type { Dataset, Metrics, Region, Scope, Segment } from './types.ts';

// ------------------------------------------------------------
// Explain a change between two windows (used by dashboard alerts and the AI Advisor)
// ------------------------------------------------------------

export interface Driver { label: string; region: Region; segment: Segment; deltaRevenue: number; deltaVisitsPct: number; deltaAsvPct: number }

export interface ChangeExplanation {
  cur: Metrics;
  prev: Metrics;
  deltaRevenue: number;
  pctRevenue: number;
  volumeEffect: number;  // ₹ lakh of the change explained by visits
  asvEffect: number;     // ₹ lakh of the change explained by average service value
  drivers: Driver[];     // region x segment cells, worst first (most negative Δ revenue)
}

export function explainChange(ds: Dataset, scope: Partial<Scope>, curMonths: string[], prevMonths: string[]): ChangeExplanation {
  const cur = metricsFor(ds, scope, curMonths);
  const prev = metricsFor(ds, scope, prevMonths);
  const volumeEffect = ((cur.visits - prev.visits) * prev.asv) / 1e5;
  const asvEffect = (cur.visits * (cur.asv - prev.asv)) / 1e5;

  const drivers: Driver[] = [];
  for (const region of REGIONS) {
    if (scope.region && scope.region !== 'All' && scope.region !== region) continue;
    for (const segment of SEGMENTS) {
      if (scope.segment && scope.segment !== 'All' && scope.segment !== segment) continue;
      const s = { ...scope, region, segment };
      const c = metricsFor(ds, s, curMonths);
      const p = metricsFor(ds, s, prevMonths);
      if (!c.visits && !p.visits) continue;
      drivers.push({
        label: `${region} · ${segment}`, region, segment,
        deltaRevenue: c.revenue - p.revenue,
        deltaVisitsPct: pctChange(c.visits, p.visits),
        deltaAsvPct: pctChange(c.asv, p.asv),
      });
    }
  }
  drivers.sort((a, b) => a.deltaRevenue - b.deltaRevenue);
  return { cur, prev, deltaRevenue: cur.revenue - prev.revenue, pctRevenue: pctChange(cur.revenue, prev.revenue), volumeEffect, asvEffect, drivers };
}

// ------------------------------------------------------------
// Dashboard opportunities & alerts — all derived from the dataset
// ------------------------------------------------------------

export interface Opportunity {
  id: string;
  type: 'Opportunity' | 'Alert';
  title: string;
  detail: string;
  impact: string;
  severity: 'high' | 'medium' | 'low';
}

export function computeOpportunities(ds: Dataset, scope: Partial<Scope> = {}): Opportunity[] {
  const out: Opportunity[] = [];
  const months = ds.months;
  const latest = months[months.length - 1];
  const prevMonth = months[months.length - 2];

  // 1. Revenue movement in the latest month
  if (prevMonth) {
    const e = explainChange(ds, scope, [latest], [prevMonth]);
    if (e.pctRevenue <= -3) {
      const top = e.drivers.slice(0, 2).filter(d => d.deltaRevenue < 0);
      const visitsPct = pctChange(e.cur.visits, e.prev.visits);
      const asvPct = pctChange(e.cur.asv, e.prev.asv);
      out.push({
        id: 'ALERT-REV', type: 'Alert',
        title: `${monthLabel(latest, true)} service revenue decline`,
        detail: `Revenue fell ${Math.abs(e.pctRevenue).toFixed(1)}% vs ${monthLabel(prevMonth)} (visits ${fmtSigned(visitsPct)}%, avg service value ${fmtSigned(asvPct)}%). ` +
          (top.length ? `Largest drags: ${top.map(d => `${d.label} (${fmtSL(d.deltaRevenue)})`).join(', ')}.` : ''),
        impact: `−${fmtL(Math.abs(e.deltaRevenue))}`,
        severity: e.pctRevenue <= -5 ? 'high' : 'medium',
      });
    }
  }

  // 2. Schemes below the ROI target
  const schemes = schemePerformance(ds, scope);
  for (const s of schemes.filter(x => x.status === 'Below target')) {
    const shortfall = s.promoSpend * (ROI_TARGET - (s.roi ?? 0));
    out.push({
      id: `ALERT-${s.scheme}`, type: 'Alert',
      title: `${s.scheme} below ROI target`,
      detail: `ROI of ${fmtX(s.roi)} vs ${fmtX(ROI_TARGET)} target on ${fmtL(s.promoSpend)} spend across ${s.campaigns} campaign${s.campaigns === 1 ? '' : 's'}; visits uplift ${fmtPct(s.visitsUpliftPct)}.` +
        ((s.roi ?? 0) < 1 ? ' Spend is not recovering its cost.' : ' Consider reallocating budget to higher-ROI schemes.'),
      impact: `−${fmtL(shortfall)} vs target`,
      severity: (s.roi ?? 0) < 1 ? 'high' : 'medium',
    });
  }

  // 3. Extend the best scheme to regions where it has not run
  const best = schemes[0];
  if (best && best.status !== 'Below target') {
    // Regions with no campaign of this scheme (planned campaigns count as coverage)
    const covered = new Set(ds.campaigns.filter(c => c.scheme === best.scheme).map(c => c.region));
    const gaps = REGIONS.filter(r => !covered.has(r) && (!scope.region || scope.region === 'All' || scope.region === r));
    if (gaps.length) {
      const target = gaps
        .map(region => ({ region, rev: metricsFor(ds, { ...scope, region, centerId: 'All' }, ds.months).revenue }))
        .sort((a, b) => b.rev - a.rev)[0];
      // Size it as a 2-month campaign on the region's Mid-Market slice, at the same share of that
      // slice's revenue that past campaigns of this scheme spent.
      const segment = scope.segment && scope.segment !== 'All' ? scope.segment : 'Mid-Market';
      const eff = schemeEfficiency(ds, best.scheme, { ...scope, region: target.region, segment });
      const past = campaignResults(ds).filter(r => r.plan.scheme === best.scheme && r.spend > 0);
      const shares = past.map(r => {
        const months = ds.months.filter(m => m >= r.plan.startMonth && m <= r.plan.endMonth);
        return r.spend / Math.max(metricsFor(ds, { region: r.plan.region, segment: r.plan.segment }, months).organicRevenue, 1e-9);
      });
      const typicalShare = shares.reduce((s, v) => s + v, 0) / Math.max(shares.length, 1);
      const slice = metricsFor(ds, { region: target.region, segment }, ds.months.slice(-3));
      const spend = typicalShare * (slice.organicRevenue / 3) * 2;
      const incr = spend * eff.revenuePerLakh;
      out.push({
        id: 'OPP-EXTEND', type: 'Opportunity',
        title: `Extend ${best.scheme} to ${target.region}`,
        detail: `${best.scheme} delivers the best ROI (${fmtX(best.roi)}) but has no campaign in ${gaps.join(', ')}. A 2-month ${segment} campaign in ${target.region} (about ${fmtL(spend)} spend) could add roughly ${fmtL(incr)} incremental revenue.`,
        impact: `+${fmtL(incr)}`,
        severity: 'high',
      });
    }
  }

  // 4. Retention gap
  const network = metricsFor(ds, { ...scope, segment: 'All' });
  const segs = SEGMENTS
    .filter(s => !scope.segment || scope.segment === 'All' || scope.segment === s)
    .map(segment => ({ segment, m: metricsFor(ds, { ...scope, segment }) }))
    .filter(x => x.m.due > 0)
    .sort((a, b) => a.m.retention - b.m.retention);
  const weakest = segs[0];
  if (weakest && network.retention - weakest.m.retention >= 2) {
    const gap = network.retention - weakest.m.retention;
    const recoverable = ((gap / 100) * weakest.m.due * weakest.m.asv) / 1e5;
    out.push({
      id: 'OPP-RETENTION', type: 'Opportunity',
      title: `${weakest.segment} retention gap`,
      detail: `${weakest.segment} retention is ${fmtPct(weakest.m.retention)}, ${gap.toFixed(1)}pp below the ${fmtPct(network.retention)} average. Closing the gap would bring back about ${fmtL(recoverable)} of service revenue per year.`,
      impact: `+${fmtL(recoverable)}`,
      severity: 'medium',
    });
  }

  const order = { high: 0, medium: 1, low: 2 } as const;
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

// ------------------------------------------------------------
// Campaign learning — generated from plan vs actual
// ------------------------------------------------------------

export interface Learning {
  tone: 'positive' | 'negative' | 'neutral';
  headline: string;
  points: string[];
}

export function campaignLearning(ds: Dataset, r: CampaignResult): Learning {
  const { plan } = r;
  if (plan.status === 'Planned') {
    return { tone: 'neutral', headline: 'Not started yet', points: ['Learnings appear once the campaign has run. Expected values are planning assumptions.'] };
  }
  const points: string[] = [];
  const roi = r.roi ?? 0;
  const roiGap = roi - plan.expectedRoi;
  const revPct = r.expectedIncrRevenueToDate ? pctChange(r.incrRevenue, r.expectedIncrRevenueToDate) : 0;
  const visitPct = r.expectedIncrVisitsToDate ? pctChange(r.incrVisits, r.expectedIncrVisitsToDate) : 0;
  const suffix = plan.status === 'Active' ? ' to date' : '';

  points.push(`ROI${suffix} ${fmtX(roi)} vs ${fmtX(plan.expectedRoi)} planned; incremental revenue ${fmtSigned(revPct)}% and incremental visits ${fmtSigned(visitPct)}% vs plan.`);

  const others = campaignResults(ds).filter(o => o.plan.id !== plan.id && o.plan.scheme === plan.scheme && o.spend > 0);
  if (others.length) {
    const spend = others.reduce((s, o) => s + o.spend, 0);
    const gp = others.reduce((s, o) => s + o.incrGrossProfit, 0);
    const avg = gp / spend;
    points.push(`${plan.scheme} averaged ${fmtX(avg)} across ${others.length} other campaign${others.length === 1 ? '' : 's'}; this one is ${roi >= avg ? 'above' : 'below'} that.`);
  }

  if (plan.status === 'Completed') {
    const util = plan.investment ? (r.spend / plan.investment) * 100 : 0;
    points.push(`Spent ${fmtL(r.spend)} of ${fmtL(plan.investment)} planned (${util.toFixed(0)}%). Net profit after promotion cost: ${fmtL(r.netProfit)}.`);
  } else {
    const pace = r.expectedSpendToDate ? (r.spend / r.expectedSpendToDate) * 100 : 0;
    points.push(`${r.elapsedMonths} of ${r.totalMonths} months elapsed; spend is ${pace.toFixed(0)}% of the planned pace.`);
  }

  let headline: string;
  let tone: Learning['tone'];
  if (roi < 1) {
    tone = 'negative';
    headline = 'Did not recover its cost';
    points.push(`Recommendation: pause or redesign this offer for ${plan.segment} customers (${plan.designNote.toLowerCase()}); a free service without repair credit is not converting to paid work.`);
  } else if (roiGap < -0.05 * plan.expectedRoi) {
    tone = 'negative';
    headline = 'Below plan';
    points.push(`Recommendation: review targeting and offer design before repeating (${plan.designNote.toLowerCase()}).`);
  } else if (roiGap > 0.05 * plan.expectedRoi) {
    tone = 'positive';
    headline = 'Ahead of plan';
    points.push(`Recommendation: candidate to repeat or extend to other regions (${plan.designNote.toLowerCase()}).`);
  } else {
    tone = 'neutral';
    headline = 'On plan';
    points.push('Recommendation: keep the design; monitor redemption and margin.');
  }
  return { tone, headline, points };
}
