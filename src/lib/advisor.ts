// ============================================================
// AI Advisor — rule-based orchestrator + four analytical agents.
//
// Every number in an answer is computed from the shared dataset at
// question time (nothing is canned). The orchestrator detects intent and
// entities (month, region, segment, service center, scheme) and routes to:
//
//   Performance    – why did revenue move, weak periods, retention, regions
//   Promotion      – scheme ranking, head-to-head comparison, ROI trend
//   Simulation     – what-if on promotion budget using the plan model
//   Recommendation – ranked next actions for the current plan
//
// The `answerQuestion` signature is the seam for a future LLM backend.
// ============================================================

import {
  aggregate, campaignResults, filterRows, metricsFor, monthlySeries, periodWindow, regionBreakdown,
  schemePerformance, describeScope,
} from './analytics.ts';
import { REGIONS, ROI_DEFINITION, ROI_TARGET, SCHEMES, SEGMENTS } from './constants.ts';
import { fmtInr, fmtInt, fmtL, fmtPct, fmtSigned, fmtSL, fmtX, monthLabel, pctChange } from './format.ts';
import { computeOpportunities, explainChange } from './insights.ts';
import { competitorReport, runAgent, type AgentContext, type AgentId, type AgentReport } from './agents.ts';
import { buildSuggestions, marketPosition, type Benchmark } from './benchmark.ts';
import type { Decisions } from './planner.ts';
import {
  budgetSensitivity, buildScenarios, objectiveMetric, planPeriod, rankScenarios, runScheme, schemeEfficiency, planBaseline, planScope,
  type Plan,
} from './simulation.ts';
import type { Dataset, Region, Scheme, Scope, Segment } from './types.ts';

export type AgentName = 'Orchestrator' | 'Performance' | 'Promotion' | 'Competitor' | 'Simulation' | 'Planner' | 'Monitor' | 'Recommendation';

export interface AdvisorAnswer {
  agent: AgentName;
  text: string;
  bullets: string[];
  scope: string;       // what data the answer is based on
  followUps: string[];
}

export const SUGGESTED_QUESTIONS = [
  'Why did service revenue decline in March?',
  'Which promotion performed best?',
  'How do our promotions compare with competitors?',
  'Where is our discount lower than competitors?',
  'What should we do about competitor pressure in the South?',
  'Which campaigns should we run next quarter?',
  'Are my active campaigns on track?',
  'What happens if I increase the promotion budget by 25%?',
  'How is campaign ROI trending, and why?',
  'What should I do next?',
];

/** Everything the assistant can read besides the master dataset. */
export interface AdvisorContext { bm?: Benchmark; decisions?: Decisions }

const AGENT_NAME: Record<AgentId, AgentName> = {
  performance: 'Performance', promotion: 'Promotion', competitor: 'Competitor', simulation: 'Simulation',
  planner: 'Planner', monitor: 'Monitor', recommendation: 'Recommendation',
};

/** Converts a structured agent report into a chat answer. */
export function reportToAnswer(r: AgentReport, followUps: string[]): AdvisorAnswer {
  return { agent: AGENT_NAME[r.agent], text: r.headline, bullets: r.findings, scope: r.scope, followUps };
}

// ------------------------------------------------------------
// Entity extraction
// ------------------------------------------------------------

const MONTH_PATTERNS: [RegExp, string][] = [
  [/\bjan(uary)?\b/, '01'], [/\bfeb(ruary)?\b/, '02'], [/\bmar(ch)?\b/, '03'], [/\bapr(il)?\b/, '04'],
  [/\bmay\b/, '05'], [/\bjun(e)?\b/, '06'], [/\bjul(y)?\b/, '07'], [/\baug(ust)?\b/, '08'],
  [/\bsep(t(ember)?)?\b/, '09'], [/\boct(ober)?\b/, '10'], [/\bnov(ember)?\b/, '11'], [/\bdec(ember)?\b/, '12'],
];

function parseMonth(ds: Dataset, q: string): string | null {
  for (const [re, mm] of MONTH_PATTERNS) {
    if (re.test(q)) return ds.months.find(m => m.endsWith(`-${mm}`)) ?? null;
  }
  return null;
}

function parseScope(ds: Dataset, q: string): Partial<Scope> {
  const scope: Partial<Scope> = {};
  const region = REGIONS.find(r => new RegExp(`\\b${r.toLowerCase()}\\b`).test(q));
  if (region) scope.region = region;
  const segRe: [Segment, RegExp][] = [
    ['Premium', /\bpremium\b/], ['Mid-Market', /\bmid[- ]?market\b/],
    ['Value', /\bvalue (segment|customers?)\b|\bvalue-segment\b/], ['Fleet', /\bfleet\b/],
  ];
  const seg = segRe.find(([, re]) => re.test(q));
  if (seg) scope.segment = seg[0];
  const center = ds.centers.find(c => q.includes(c.city.toLowerCase()) || q.includes(c.name.toLowerCase()));
  if (center) { scope.centerId = center.id; scope.region = center.region; }
  return scope;
}

function parseSchemes(q: string): Scheme[] {
  const found: Scheme[] = [];
  let rest = q;
  const take = (re: RegExp, scheme: Scheme) => {
    if (re.test(rest)) { found.push(scheme); rest = rest.replace(re, ' '); }
  };
  take(/service \+ car ?wash( bundle)?|bundle|combo/, 'Service + Car Wash Bundle');
  take(/engine( health)?( check)?/, 'Free Engine Check');
  take(/voucher|₹\s?500|rs\.?\s?500/, '₹500 Discount Voucher');
  take(/10\s?%\s*(service\s*)?discount|service discount|discount/, '10% Service Discount');
  take(/car ?wash|wash/, 'Free Car Wash');
  return found;
}

const has = (q: string, re: RegExp) => re.test(q);

/** Whether a campaign targets something inside the scope (used to keep explanations relevant). */
function campaignInScope(ds: Dataset, c: { region: Region; segment: Segment }, scope: Partial<Scope>): boolean {
  const region = scope.centerId && scope.centerId !== 'All' ? ds.centers.find(x => x.id === scope.centerId)?.region : scope.region;
  return (!region || region === 'All' || c.region === region) && (!scope.segment || scope.segment === 'All' || c.segment === scope.segment);
}

// ------------------------------------------------------------
// Orchestrator
// ------------------------------------------------------------

export function answerQuestion(ds: Dataset, question: string, plan: Plan, extra: AdvisorContext = {}): AdvisorAnswer {
  const q = question.toLowerCase().trim();
  const scope = parseScope(ds, q);
  const schemes = parseSchemes(q);
  const month = parseMonth(ds, q);
  const ctx: AgentContext | null = extra.bm ? { ds, bm: extra.bm, plan, decisions: extra.decisions ?? {} } : null;

  if (!q || has(q, /^(hi|hello|hey|help)\b|what can you (do|answer)|how (do|can) (i|you) use/)) return helpAnswer(ds);

  // ---- agents backed by the external benchmark / planner / live monitor
  if (has(q, /competitor|competition|competitive|benchmark|rival|the market|market (rate|median|average|offer|price)|industry|how do we compare/)) {
    return ctx ? competitorAnswer(ctx, scope, schemes) : noBenchmark();
  }
  if (ctx && has(q, /campaign.*(on track|health|at risk|pacing|running now)|(active|live|in[- ]flight|running) campaigns?|(on track|at risk).*campaign|monitor/)) {
    return reportToAnswer(runAgent('monitor', ctx), ['Where is our discount lower than competitors?', 'What should I do next?']);
  }
  if (ctx && has(q, /(which|what) campaigns?.*(run|launch|plan|next)|campaign (calendar|plan|recommendations?)|upcoming campaigns?|recommended campaigns?|next quarter/)) {
    return reportToAnswer(runAgent('planner', ctx), ['What happens if I increase the promotion budget by 25%?', 'How do our promotions compare with competitors?']);
  }

  if (has(q, /\broi\b/) && has(q, /declin|drop|fall|fell|decreas|down|lower|worse|dip|slip|deteriorat|trend|chang|over time|why/)) return roiTrend(ds);
  if (has(q, /low[- ]?perform|under[- ]?perform.*(period|month)|(weak|worst|poor|bad)(est)? (month|period|quarter)|which (months?|periods?)/)) return weakPeriods(ds, scope);
  if (has(q, /\b(why|explain|reason|driver|cause|what happened)\b/) && has(q, /revenue|sales|visits|volume|margin|service value|declin|drop|fell|fall|down|increase|rise|grew|jump/)) {
    return explainRevenue(ds, scope, month);
  }
  if (has(q, /what if|what happens|simulat|scenario|budget|increase|reduce|decrease|double|halve|\bcut\b|spend (more|less)/)) return simulateBudget(ds, q, plan, scope, schemes);
  if (schemes.length >= 2) return compareSchemes(ds, scope, schemes[0], schemes[1]);
  if (has(q, /recommend|suggest|should (i|we)|next step|next action|priorit|reallocat|opportunit|what to do|advice|what now/)) return recommend(ds, plan);
  if (has(q, /promotion|scheme|campaign|offer|discount|voucher|wash|engine|bundle|\broi\b|return/)) return promotionRanking(ds, scope, schemes[0], has(q, /worst|lowest|underperform|weak|poor|bottom/));
  if (has(q, /retention|churn|loyal|repeat|returning/)) return retentionView(ds, scope);
  if (has(q, /region|segment|center|centre|city|location|branch|fleet|premium|mid-market|by area/) || Object.keys(scope).length) return breakdown(ds, scope);
  if (has(q, /revenue|visit|margin|kpi|summary|overview|how are we|how is|status|performance|asv|service value/)) return summary(ds, scope);
  return fallback(ds);
}

const route = (agent: AgentName) => agent;

// ------------------------------------------------------------
// Agents
// ------------------------------------------------------------

function noBenchmark(): AdvisorAnswer {
  return {
    agent: 'Competitor',
    text: 'The competitor benchmark data is not loaded, so I cannot compare our promotions with the market.',
    bullets: [], scope: 'No benchmark data', followUps: SUGGESTED_QUESTIONS.slice(0, 3),
  };
}

function competitorAnswer(ctx: AgentContext, scope: Partial<Scope>, schemes: Scheme[]): AdvisorAnswer {
  const { ds, bm } = ctx;
  const region: Region | 'All' = (scope.region as Region | undefined) ?? 'All';
  const report = competitorReport(ctx, region);
  const followUps = ['What should we do about competitor pressure in the South?', 'Which campaigns should we run next quarter?', 'What should I do next?'];
  if (!schemes.length) return reportToAnswer(report, followUps);

  // A specific scheme was named: lead with its position, then the suggestions that concern it
  const mp = marketPosition(bm, schemes[0], region);
  if (!mp) return { ...reportToAnswer(report, followUps), text: `No competitor runs an equivalent of ${schemes[0]} in ${region === 'All' ? 'any region' : region}. ${report.headline}` };
  const related = buildSuggestions(ds, bm, { region }).filter(s => s.scheme === mp.scheme && s.type !== 'Hold');
  const dir = mp.position === 'Behind' ? 'lower than' : mp.position === 'Ahead' ? 'higher than' : 'in line with';
  return {
    agent: 'Competitor',
    text: `${mp.scheme} in ${region === 'All' ? 'all regions' : region}: our offer is worth ${mp.ourDepth}% of the average ticket, ${dir} the market median of ${mp.medianDepth.toFixed(1)}% (gap ${mp.gapPp >= 0 ? '' : '−'}${Math.abs(mp.gapPp).toFixed(1)}pp; ${mp.competitors} competitors, deepest ${mp.topCompetitor} at ${mp.maxDepth.toFixed(1)}%).`,
    bullets: [
      `Validity: ours ${mp.ourValidity} days vs market median ${Math.round(mp.medianValidity)} days. ${mp.creditShare > 0 ? `${(mp.creditShare * 100).toFixed(0)}% of competitor offers include a repair credit.` : ''}`.trim(),
      `Market trend: median depth ${mp.trendPp >= 0 ? 'up' : 'down'} ${Math.abs(mp.trendPp).toFixed(1)}pp since ${bm.months[0]}.`,
      ...related.flatMap(s => [`[${s.priority}] ${s.action}`, `   Impact: ${s.impact}`]),
      ...(related.length ? [] : ['No change recommended for this scheme in this scope.']),
    ],
    scope: region === 'All' ? 'All regions' : `${region} region`,
    followUps,
  };
}

function helpAnswer(ds: Dataset): AdvisorAnswer {
  return {
    agent: 'Orchestrator',
    text: 'I am the RGM Advisor. I answer from the same dataset that drives the dashboard, planning, simulation and campaign pages, so my numbers always match what you see there.',
    bullets: [
      'Performance — why revenue moved, weak periods, retention, regional and segment views',
      'Promotion — which scheme performs best, head-to-head comparisons, why ROI is changing',
      'Simulation — what happens if you change the promotion budget (uses your current plan)',
      'Recommendation — ranked next actions for your plan',
      'Tip: name a month, region, segment, service center or scheme to narrow the answer, e.g. "Why did South revenue fall in March?"',
    ],
    scope: `Dataset: ${monthLabel(ds.months[0])} – ${monthLabel(ds.latestMonth)}`,
    followUps: SUGGESTED_QUESTIONS.slice(0, 3),
  };
}

function fallback(ds: Dataset): AdvisorAnswer {
  const m = metricsFor(ds, {}, [ds.latestMonth]);
  return {
    agent: 'Orchestrator',
    text: 'I could not map that question to something I can calculate from the dataset. I can analyse revenue and visit movements, promotion and campaign ROI, budget what-ifs and next-best actions.',
    bullets: [
      `Latest month (${monthLabel(ds.latestMonth)}): revenue ${fmtL(m.revenue)}, ${fmtInt(m.visits)} visits, gross margin ${fmtPct(m.grossMargin)}.`,
      'Try rephrasing with a month, region, segment or promotion name.',
    ],
    scope: 'All regions · all segments',
    followUps: SUGGESTED_QUESTIONS.slice(0, 3),
  };
}

function summary(ds: Dataset, scope: Partial<Scope>): AdvisorAnswer {
  const cur = metricsFor(ds, scope, [ds.latestMonth]);
  const prev = metricsFor(ds, scope, [ds.months[ds.months.length - 2]]);
  const fy = metricsFor(ds, scope);
  return {
    agent: 'Performance',
    text: `In ${monthLabel(ds.latestMonth, true)} service revenue was ${fmtL(cur.revenue)} (${fmtSigned(pctChange(cur.revenue, prev.revenue))}% vs previous month) on ${fmtInt(cur.visits)} visits at ${fmtInr(cur.asv)} average service value.`,
    bullets: [
      `Gross margin ${fmtPct(cur.grossMargin)} (${fmtSigned(cur.grossMargin - prev.grossMargin)}pp vs previous month); customer retention ${fmtPct(cur.retention)}.`,
      `Promotion spend ${fmtL(cur.promoSpend)}, ROI ${fmtX(cur.roi)} (target ${fmtX(ROI_TARGET)}).`,
      `Full year: revenue ${fmtL(fy.revenue)}, gross margin ${fmtPct(fy.grossMargin)}, promotion ROI ${fmtX(fy.roi)}.`,
    ],
    scope: describeScope(ds, scope),
    followUps: ['Identify low-performing periods.', 'Which promotion performed best?'],
  };
}

function explainRevenue(ds: Dataset, scope: Partial<Scope>, monthArg: string | null): AdvisorAnswer {
  const month = monthArg ?? ds.latestMonth;
  const idx = ds.months.indexOf(month);
  const scopeText = describeScope(ds, scope);
  if (idx <= 0) {
    return {
      agent: 'Performance',
      text: `${monthLabel(month, true)} is the first month in the dataset, so there is no earlier month to compare it with.`,
      bullets: [], scope: scopeText, followUps: ['Identify low-performing periods.'],
    };
  }
  const prevMonth = ds.months[idx - 1];
  const e = explainChange(ds, scope, [month], [prevMonth]);
  const up = e.deltaRevenue >= 0;
  const visitsPct = pctChange(e.cur.visits, e.prev.visits);
  const asvPct = pctChange(e.cur.asv, e.prev.asv);
  const bullets: string[] = [];

  bullets.push(`Volume effect ${fmtSL(e.volumeEffect)} (visits ${fmtInt(e.prev.visits)} → ${fmtInt(e.cur.visits)}, ${fmtSigned(visitsPct)}%); price/mix effect ${fmtSL(e.asvEffect)} (average service value ${fmtInr(e.prev.asv)} → ${fmtInr(e.cur.asv)}, ${fmtSigned(asvPct)}%).`);

  const ranked = up ? [...e.drivers].reverse() : e.drivers;
  const top = ranked.filter(d => (up ? d.deltaRevenue > 0 : d.deltaRevenue < 0)).slice(0, 3);
  if (top.length) {
    bullets.push(`Biggest ${up ? 'contributors' : 'drags'}: ${top.map(d => `${d.label} ${fmtSL(d.deltaRevenue)} (visits ${fmtSigned(d.deltaVisitsPct)}%, ASV ${fmtSigned(d.deltaAsvPct)}%)`).join('; ')}.`);
  }

  const ended = ds.campaigns.filter(c => c.endMonth === prevMonth && c.status !== 'Planned' && campaignInScope(ds, c, scope));
  const started = ds.campaigns.filter(c => c.startMonth === month && c.status !== 'Planned' && campaignInScope(ds, c, scope));
  const promoPrev = e.prev.promoSpend, promoCur = e.cur.promoSpend;
  if (promoPrev > 0 || promoCur > 0) {
    let promo = `Promotion-driven revenue ${fmtL(e.prev.incrRevenue)} → ${fmtL(e.cur.incrRevenue)} (spend ${fmtL(promoPrev)} → ${fmtL(promoCur)}).`;
    if (ended.length) promo += ` Campaigns that ended in ${monthLabel(prevMonth)}: ${ended.map(c => c.name).join(', ')}.`;
    if (started.length) promo += ` Started in ${monthLabel(month)}: ${started.map(c => c.name).join(', ')}.`;
    bullets.push(promo);
  } else {
    bullets.push('No promotion campaigns were running in this scope in either month, so the change is organic.');
  }
  bullets.push(`Gross margin ${fmtPct(e.prev.grossMargin)} → ${fmtPct(e.cur.grossMargin)}; retention ${fmtPct(e.prev.retention)} → ${fmtPct(e.cur.retention)}.`);

  return {
    agent: 'Performance',
    text: `Service revenue ${up ? 'rose' : 'fell'} ${Math.abs(e.pctRevenue).toFixed(1)}% in ${monthLabel(month, true)} (${fmtL(e.prev.revenue)} → ${fmtL(e.cur.revenue)}, ${fmtSL(e.deltaRevenue)}). ${
      Math.abs(e.volumeEffect) >= Math.abs(e.asvEffect) ? 'Most of the movement came from visit volume.' : 'Most of the movement came from average service value.'}`,
    bullets,
    scope: scopeText,
    followUps: ['Identify low-performing periods.', 'What should I do next?'],
  };
}

function weakPeriods(ds: Dataset, scope: Partial<Scope>): AdvisorAnswer {
  const series = monthlySeries(ds, scope);
  const moves = series.slice(1).map((p, i) => ({ p, prev: series[i], pct: pctChange(p.revenue, series[i].revenue) }));
  const declines = moves.filter(m => m.pct <= -3).sort((a, b) => a.pct - b.pct);
  const avgMargin = aggregate(filterRows(ds, scope)).grossMargin;
  const lowMargin = series.filter(p => p.grossMargin < avgMargin - 0.5);
  const lowRoi = series.filter(p => p.roi !== null && Number(p.roi.toFixed(2)) < ROI_TARGET && p.promoSpend > 0);

  const bullets = declines.slice(0, 4).map(m => {
    const e = explainChange(ds, scope, [m.p.month], [m.prev.month]);
    const ended = ds.campaigns.filter(c => c.endMonth === m.prev.month && c.status !== 'Planned' && campaignInScope(ds, c, scope)).map(c => c.name);
    const drag = e.drivers[0];
    return `${monthLabel(m.p.month)}: ${fmtSigned(m.pct)}% (${fmtL(m.prev.revenue)} → ${fmtL(m.p.revenue)}). ` +
      `Promotion spend ${fmtL(m.prev.promoSpend)} → ${fmtL(m.p.promoSpend)}${ended.length ? ` as ${ended.join(' and ')} ended` : ''}` +
      (drag && drag.deltaRevenue < 0 ? `; biggest drag ${drag.label} (${fmtSL(drag.deltaRevenue)}).` : '.');
  });
  if (lowMargin.length) bullets.push(`Gross margin below the ${fmtPct(avgMargin)} average in ${lowMargin.map(p => monthLabel(p.month)).join(', ')}.`);
  if (lowRoi.length) bullets.push(`Promotion ROI under the ${fmtX(ROI_TARGET)} target in ${lowRoi.map(p => `${monthLabel(p.month)} (${fmtX(p.roi)})`).join(', ')}.`);

  return {
    agent: 'Performance',
    text: declines.length
      ? `${declines.length} month${declines.length === 1 ? '' : 's'} show revenue down 3% or more vs the previous month; the weakest is ${monthLabel(declines[0].p.month, true)} (${fmtSigned(declines[0].pct)}%). Drops follow peak months and campaign wind-downs, so smoothing promotion cadence would reduce the cliff.`
      : 'No month fell 3% or more vs the previous month in this scope.',
    bullets,
    scope: describeScope(ds, scope),
    followUps: [`Why did service revenue decline in ${monthLabel(declines[0]?.p.month ?? ds.latestMonth, true).split(' ')[0]}?`, 'How is campaign ROI trending, and why?'],
  };
}

function retentionView(ds: Dataset, scope: Partial<Scope>): AdvisorAnswer {
  const all = metricsFor(ds, { ...scope, segment: 'All' });
  const rows = SEGMENTS.map(s => ({ s, m: metricsFor(ds, { ...scope, segment: s }) })).filter(x => x.m.due > 0).sort((a, b) => a.m.retention - b.m.retention);
  const series = monthlySeries(ds, scope);
  const first = series[0], last = series[series.length - 1];
  const weakest = rows[0];
  return {
    agent: 'Performance',
    text: `Customer retention is ${fmtPct(all.retention)} for the year${scope.region && scope.region !== 'All' ? ` in ${scope.region}` : ''}. ${weakest.s} is the weakest segment at ${fmtPct(weakest.m.retention)} (${(all.retention - weakest.m.retention).toFixed(1)}pp below average).`,
    bullets: [
      ...rows.map(x => `${x.s}: ${fmtPct(x.m.retention)} retention on ${fmtInt(x.m.due)} customers due`),
      `Trend: ${fmtPct(first.retention)} in ${monthLabel(first.month)} → ${fmtPct(last.retention)} in ${monthLabel(last.month)}.`,
    ],
    scope: describeScope(ds, scope),
    followUps: ['What should I do next?', 'Which promotion performed best?'],
  };
}

function breakdown(ds: Dataset, scope: Partial<Scope>): AdvisorAnswer {
  const window = periodWindow(ds, 'l3m');
  const regions = regionBreakdown(ds, { ...scope, region: 'All' }, window);
  const best = [...regions].sort((a, b) => b.revenue - a.revenue)[0];
  const weakest = [...regions].filter(r => r.revenueChange !== null).sort((a, b) => (a.revenueChange ?? 0) - (b.revenueChange ?? 0))[0];
  return {
    agent: 'Performance',
    text: `Over the last 3 months ${best.region} is the largest region at ${fmtL(best.revenue)}` +
      (weakest ? (weakest.region === best.region ? ', but it also has the weakest trend' : `, and ${weakest.region} has the weakest trend`) + ` (${fmtSigned(weakest.revenueChange ?? 0)}% vs the prior 3 months).` : '.'),
    bullets: regions.map(r => `${r.region}: ${fmtL(r.revenue)} (${r.revenueChange === null ? 'n/a' : `${fmtSigned(r.revenueChange)}%`}), margin ${fmtPct(r.grossMargin)}, retention ${fmtPct(r.retention)}, ROI ${fmtX(r.roi)}`),
    scope: `Last 3 months · ${scope.segment && scope.segment !== 'All' ? `${scope.segment} segment` : 'all segments'}`,
    followUps: ['Identify low-performing periods.', 'What should I do next?'],
  };
}

function promotionRanking(ds: Dataset, scope: Partial<Scope>, focus: Scheme | undefined, wantWorst: boolean): AdvisorAnswer {
  const perf = schemePerformance(ds, scope);
  const scopeText = describeScope(ds, scope);
  if (!perf.length) {
    return { agent: 'Promotion', text: 'No promotion spend is recorded in this scope, so there is nothing to rank yet.', bullets: [], scope: scopeText, followUps: ['Which promotion performed best?'] };
  }
  const best = perf[0], worst = perf[perf.length - 1];
  const pick = focus ? perf.find(p => p.scheme === focus) : wantWorst ? worst : best;
  if (focus && !pick) {
    return { agent: 'Promotion', text: `${focus} has not run in this scope.`, bullets: perf.map(p => `${p.scheme}: ${fmtX(p.roi)}`), scope: scopeText, followUps: ['Which promotion performed best?'] };
  }
  const p = pick!;
  const rank = perf.indexOf(p) + 1;
  const results = campaignResults(ds).filter(r => r.plan.scheme === p.scheme && r.spend > 0 && (!scope.region || scope.region === 'All' || r.plan.region === scope.region) && (!scope.segment || scope.segment === 'All' || r.plan.segment === scope.segment));
  const bestCampaign = [...campaignResults(ds)].filter(r => r.plan.status === 'Completed' && r.roi !== null).sort((a, b) => (b.roi ?? 0) - (a.roi ?? 0))[0];

  const bullets = perf.map((s, i) => `${i + 1}. ${s.scheme}: ROI ${fmtX(s.roi)} · spend ${fmtL(s.promoSpend)} · incremental revenue ${fmtL(s.incrRevenue)} · visits uplift ${fmtPct(s.visitsUpliftPct)} · ${s.status.toLowerCase()}`);
  if (bestCampaign && !focus && !wantWorst) bullets.push(`Best single campaign: ${bestCampaign.plan.name} (${bestCampaign.plan.id}) at ${fmtX(bestCampaign.roi)} vs ${fmtX(bestCampaign.plan.expectedRoi)} planned.`);
  bullets.push(ROI_DEFINITION);

  const verb = focus ? 'is ranked' : wantWorst ? 'is the weakest performer' : 'is the top performer';
  return {
    agent: 'Promotion',
    text: `${p.scheme} ${verb}${focus ? ` #${rank} of ${perf.length}` : ''}: ROI ${fmtX(p.roi)} vs a ${fmtX(ROI_TARGET)} target, ${fmtL(p.incrRevenue)} incremental revenue on ${fmtL(p.promoSpend)} spend, ${fmtPct(p.visitsUpliftPct)} visits uplift across ${results.length || p.campaigns} campaign${(results.length || p.campaigns) === 1 ? '' : 's'}.` +
      (!focus && !wantWorst && worst.status === 'Below target' ? ` ${worst.scheme} is the laggard at ${fmtX(worst.roi)}.` : ''),
    bullets,
    scope: scopeText,
    followUps: ['How is campaign ROI trending, and why?', 'What should I do next?'],
  };
}

function compareSchemes(ds: Dataset, scope: Partial<Scope>, a: Scheme, b: Scheme): AdvisorAnswer {
  const perf = schemePerformance(ds, scope);
  const A = perf.find(p => p.scheme === a), B = perf.find(p => p.scheme === b);
  const scopeText = describeScope(ds, scope);
  if (!A || !B) {
    return {
      agent: 'Promotion',
      text: `${!A ? a : b} has no spend in this scope, so I cannot compare the two here.`,
      bullets: perf.map(p => `${p.scheme}: ROI ${fmtX(p.roi)}`),
      scope: scopeText, followUps: ['Which promotion performed best?'],
    };
  }
  const line = (s: typeof A) => `${s.scheme}: spend ${fmtL(s.promoSpend)}, incremental revenue ${fmtL(s.incrRevenue)}, ROI ${fmtX(s.roi)}, visits uplift ${fmtPct(s.visitsUpliftPct)}, net profit ${fmtL(s.incrNetProfit)} (${s.campaigns} campaign${s.campaigns === 1 ? '' : 's'})`;
  const moreEfficient = (A.roi ?? 0) >= (B.roi ?? 0) ? A : B;
  const moreRevenue = A.incrRevenue >= B.incrRevenue ? A : B;
  const verdict = moreEfficient.scheme === moreRevenue.scheme
    ? `${moreEfficient.scheme} wins on both ROI and absolute incremental revenue.`
    : `${moreEfficient.scheme} is more capital-efficient (higher ROI); ${moreRevenue.scheme} drives more absolute incremental revenue. Choose ${moreEfficient.scheme} when budget-constrained and ${moreRevenue.scheme} when chasing top-line.`;
  return {
    agent: 'Promotion',
    text: `${moreEfficient.scheme} returns ${fmtX(moreEfficient.roi)} vs ${fmtX((moreEfficient === A ? B : A).roi)} for ${(moreEfficient === A ? B : A).scheme}.`,
    bullets: [line(A), line(B), verdict],
    scope: scopeText,
    followUps: ['Which promotion performed best?', 'What should I do next?'],
  };
}

function roiTrend(ds: Dataset): AdvisorAnswer {
  const quarters = [0, 3, 6, 9].map(i => ds.months.slice(i, i + 3)).filter(m => m.length === 3);
  const q = quarters.map(months => ({ months, m: metricsFor(ds, {}, months) }));
  const first = q[0], last = q[q.length - 1];
  const dropped = (last.m.roi ?? 0) < (first.m.roi ?? 0);
  const label = (months: string[]) => `${monthLabel(months[0]).split(' ')[0]}–${monthLabel(months[2]).split(' ')[0]}`;

  const results = campaignResults(ds).filter(r => r.plan.status !== 'Planned' && r.roi !== null && r.spend > 0);
  const shortfalls = results
    .map(r => ({ r, gap: (r.plan.expectedRoi - (r.roi ?? 0)) * r.spend }))
    .filter(x => x.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 3);
  const perf = schemePerformance(ds);
  const belowShare = (months: string[]) => {
    const sp = schemePerformance(ds, {}, months);
    const total = sp.reduce((s, x) => s + x.promoSpend, 0);
    const bad = sp.filter(x => (perfRoi(perf, x.scheme) ?? 0) < ROI_TARGET * 0.95).reduce((s, x) => s + x.promoSpend, 0);
    return total ? (bad / total) * 100 : 0;
  };

  return {
    agent: 'Promotion',
    text: dropped
      ? `Portfolio ROI declined from ${fmtX(first.m.roi)} (${label(first.months)}) to ${fmtX(last.m.roi)} (${label(last.months)}), against a ${fmtX(ROI_TARGET)} target.`
      : `Portfolio ROI has held up rather than declined: ${fmtX(first.m.roi)} in ${label(first.months)} and ${fmtX(last.m.roi)} in ${label(last.months)}, against a ${fmtX(ROI_TARGET)} target. The drag comes from individual under-performing campaigns, not the portfolio as a whole.`,
    bullets: [
      `By quarter: ${q.map(x => `${label(x.months)} ${fmtX(x.m.roi)} on ${fmtL(x.m.promoSpend)}`).join(' · ')}.`,
      ...(shortfalls.length ? [`Campaigns furthest below plan: ${shortfalls.map(x => `${x.r.plan.name} (${fmtX(x.r.roi)} vs ${fmtX(x.r.plan.expectedRoi)} planned)`).join('; ')}.`] : []),
      `Share of spend going to below-target schemes: ${belowShare(first.months).toFixed(0)}% → ${belowShare(last.months).toFixed(0)}%.`,
      `Promotion spend ${fmtSigned(pctChange(last.m.promoSpend, first.m.promoSpend), 0)}% while incremental gross profit ${fmtSigned(pctChange(last.m.incrGrossProfit, first.m.incrGrossProfit), 0)}% between those quarters.`,
      ROI_DEFINITION,
    ],
    scope: 'All regions · all segments',
    followUps: ['What should I do next?', 'Which promotion performed best?'],
  };
}
const perfRoi = (perf: ReturnType<typeof schemePerformance>, s: Scheme) => perf.find(p => p.scheme === s)?.roi ?? null;

function simulateBudget(ds: Dataset, q: string, plan: Plan, scope: Partial<Scope>, schemes: Scheme[]): AdvisorAnswer {
  const scenarioPlan: Plan = {
    ...plan,
    ...(scope.region ? { region: scope.region as Region, centerId: 'All' } : {}),
    ...(scope.centerId ? { centerId: scope.centerId } : {}),
    ...(scope.segment ? { segment: scope.segment } : {}),
    scheme: schemes[0] ?? plan.scheme,
  };
  const pcts = [...q.matchAll(/(\d+(?:\.\d+)?)\s?%/g)].map(m => Number(m[1]));
  let mult = 1.25;
  let note = '';
  if (/discount/.test(q) && pcts.length >= 2 && /\bto\b/.test(q)) {
    mult = pcts[1] / pcts[0];
    note = `Discount depth is not tracked in the data (every discount campaign ran at ${pcts[0]}%), so I modelled a deeper discount as proportionally higher spend (×${mult.toFixed(2)}).`;
  } else if (/double/.test(q)) mult = 2;
  else if (/halve|half/.test(q)) mult = 0.5;
  else if (pcts.length) {
    const down = /reduce|decrease|cut|lower|less|drop/.test(q);
    mult = 1 + (down ? -1 : 1) * (pcts[0] / 100);
  } else if (/reduce|decrease|cut|lower|less/.test(q)) mult = 0.75;
  mult = Math.max(0.05, Math.min(mult, 5));

  const baseline = planBaseline(ds, scenarioPlan);
  const eff = schemeEfficiency(ds, scenarioPlan.scheme, planScope(scenarioPlan));
  const before = runScheme(baseline, eff, scenarioPlan.budget);
  const after = runScheme(baseline, eff, scenarioPlan.budget * mult);
  const dBudget = after.promoCost - before.promoCost;
  const marginal = dBudget !== 0 ? (after.incrGrossProfit - before.incrGrossProfit) / dBudget : null;
  const sens = budgetSensitivity(ds, scenarioPlan, scenarioPlan.scheme);

  const worthIt = marginal !== null ? (mult > 1 ? marginal >= 1 : marginal < 1) : false;
  const bullets = [
    `Incremental revenue ${fmtL(before.incrRevenue)} → ${fmtL(after.incrRevenue)} (${fmtSL(after.incrRevenue - before.incrRevenue)}); incremental visits ${fmtInt(before.incrVisits)} → ${fmtInt(after.incrVisits)}.`,
    `ROI ${fmtX(before.roi)} → ${fmtX(after.roi)}; net profit after promotion cost ${fmtL(before.incrNetProfit)} → ${fmtL(after.incrNetProfit)}.`,
    marginal !== null ? `Marginal return: each extra ₹1 of budget ${dBudget > 0 ? 'earns' : 'gives up'} ₹${Math.abs(marginal).toFixed(2)} of gross profit (break-even is ₹1.00).` : '',
    `Sensitivity: ${sens.map(s => `${s.multiplier}× budget → ROI ${fmtX(s.roi)}`).join(' · ')}.`,
    note,
    `Evidence: ${before.evidence}. Diminishing returns are assumed; see the Simulation page for all assumptions.`,
  ].filter(Boolean);

  const changePct = (mult - 1) * 100;
  return {
    agent: 'Simulation',
    text: `${scenarioPlan.scheme}, ${planPeriod(scenarioPlan).label}: changing the promotion budget from ${fmtL(before.promoCost)} to ${fmtL(after.promoCost)} (${fmtSigned(changePct, 0)}%) ${
      mult > 1
        ? worthIt ? 'still returns more than it costs at the margin, though returns per ₹ fall.' : 'adds volume but the extra spend does not pay back at the margin.'
        : worthIt ? 'saves more cost than the gross profit it gives up.' : 'gives up more gross profit than it saves.'}`,
    bullets,
    scope: `${describeScope(ds, planScope(scenarioPlan))} · ${planPeriod(scenarioPlan).label}`,
    followUps: ['What should I do next?', 'Compare Free Car Wash and ₹500 Voucher.'],
  };
}

function recommend(ds: Dataset, plan: Plan): AdvisorAnswer {
  const { scenarios } = buildScenarios(ds, plan);
  const ranked = rankScenarios(scenarios, plan.objective);
  const metric = objectiveMetric[plan.objective];
  const best = ranked[0];
  const current = ranked.find(s => s.scheme === plan.scheme)!;
  const opps = computeOpportunities(ds, planScope(plan));

  const bullets: string[] = [];
  if (best.scheme === plan.scheme) {
    bullets.push(`Your plan already uses the best scheme for "${plan.objective}": ${best.label} (${metric.label} ${metric.format(metric.value(best))}).`);
  } else {
    bullets.push(`Switch the plan from ${current.label} to ${best.label}: ${metric.label} ${metric.format(metric.value(current))} → ${metric.format(metric.value(best))} at the same ${fmtL(plan.budget)} budget.`);
  }
  bullets.push(`Runner-up: ${ranked[1].label} (${metric.format(metric.value(ranked[1]))}). Weakest: ${ranked[ranked.length - 1].label} (${metric.format(metric.value(ranked[ranked.length - 1]))}).`);
  for (const o of opps.slice(0, 3)) bullets.push(`${o.type === 'Alert' ? 'Watch' : 'Opportunity'}: ${o.title} (${o.impact}) — ${o.detail}`);

  return {
    agent: 'Recommendation',
    text: `For ${planPeriod(plan).label} in ${describeScope(ds, planScope(plan))} with a ${fmtL(plan.budget)} budget and the objective "${plan.objective}", ${best.label} is the strongest option.`,
    bullets,
    scope: `Current plan · ${describeScope(ds, planScope(plan))}`,
    followUps: ['What happens if I increase the promotion budget by 25%?', 'How is campaign ROI trending, and why?'],
  };
}

export { route as _route };
export { SCHEMES };
