// ============================================================
// AI agents. Each agent reads the shared datasets (our master dataset, the competitor benchmark and the
// current plan) and returns a structured report: headline, key numbers, findings, a table and next actions.
// The AI Advisor page runs them directly ("Run analysis") and the chatbot routes questions to them.
// ============================================================

import { metricsFor, monthlySeries, periodWindow, regionBreakdown, schemePerformance, campaignResults } from './analytics.ts';
import { ROI_TARGET } from './constants.ts';
import { fmtInt, fmtL, fmtPct, fmtSigned, fmtSL, fmtX, monthLabel, pctChange } from './format.ts';
import { computeOpportunities, explainChange } from './insights.ts';
import { buildSuggestions, marketOverview, regionPressure, type Benchmark } from './benchmark.ts';
import { fmtDate, monitorCampaigns, recommendCampaigns, type Decisions } from './planner.ts';
import { budgetSensitivity, buildScenarios, objectiveMetric, planPeriod, planScope, rankScenarios, type Plan } from './simulation.ts';
import type { Dataset, Region } from './types.ts';

export type PageTarget = 'dashboard' | 'planning' | 'simulation' | 'campaigns' | 'ai-advisor';
export type AgentId = 'performance' | 'promotion' | 'competitor' | 'simulation' | 'recommendation' | 'planner' | 'monitor';

export interface AgentDef {
  id: AgentId;
  name: string;
  tagline: string;
  description: string;
  dataUsed: string[];
  runLabel: string;
  askPrompt: string;    // a question that routes to this agent in the chat
}

export const AGENTS: AgentDef[] = [
  {
    id: 'performance', name: 'Performance Agent', tagline: 'Why did the numbers move?',
    description: 'Explains changes in revenue, visits, margin and retention, and finds the biggest drags by region and segment.',
    dataUsed: ['Master dataset · monthly performance', 'Campaign start/end dates'],
    runLabel: 'Run health check', askPrompt: 'Why did service revenue decline in March?',
  },
  {
    id: 'promotion', name: 'Promotion Agent', tagline: 'Which promotions earn their keep?',
    description: 'Scores every promotion scheme on ROI, spend and uplift, and highlights the best and worst campaigns.',
    dataUsed: ['Master dataset · campaign spend and incremental results', 'ROI target (1.30x)'],
    runLabel: 'Run scheme scorecard', askPrompt: 'Which promotion performed best?',
  },
  {
    id: 'competitor', name: 'Competitor Benchmark Agent', tagline: 'How do we compare with the market?',
    description: 'Compares our offers with competitor promotions, finds where our discount, validity or terms fall behind, and recommends specific fixes with the estimated impact.',
    dataUsed: ['External benchmark · 5 competitors × 5 regions × 3 months', 'Our offer terms', 'Master dataset · results by region', 'Simulation model'],
    runLabel: 'Run competitor gap analysis', askPrompt: 'How do our promotions compare with competitors?',
  },
  {
    id: 'simulation', name: 'Simulation Agent', tagline: 'What happens if we change the plan?',
    description: 'Tests every scheme at your plan\'s budget and shows how returns change as the budget moves.',
    dataUsed: ['Current plan', 'Master dataset · campaign history', 'Response model'],
    runLabel: 'Run plan simulation', askPrompt: 'What happens if I increase the promotion budget by 25%?',
  },
  {
    id: 'planner', name: 'Campaign Planner Agent', tagline: 'What should we run next?',
    description: 'Builds the recommended campaign calendar for the planning period: scheme, budget, timing, predicted ROI and confidence.',
    dataUsed: ['Master dataset', 'External benchmark', 'Current plan (period and scope)', 'Simulation model'],
    runLabel: 'Build campaign calendar', askPrompt: 'Which campaigns should we run next quarter?',
  },
  {
    id: 'monitor', name: 'Campaign Monitor Agent', tagline: 'Are live campaigns on track?',
    description: 'Scores the health of running campaigns (delivery, pacing, ROI vs plan), flags risks, and suggests interventions.',
    dataUsed: ['Master dataset · active campaigns to date', 'External benchmark (competitor pressure)'],
    runLabel: 'Check live campaigns', askPrompt: 'Are my active campaigns on track?',
  },
  {
    id: 'recommendation', name: 'Recommendation Agent', tagline: 'What should we do first?',
    description: 'Combines alerts, competitor gaps and plan findings into one ranked list of next actions.',
    dataUsed: ['All of the above'],
    runLabel: 'Get next best actions', askPrompt: 'What should I do next?',
  },
];

export interface AgentContext { ds: Dataset; bm: Benchmark; plan: Plan; decisions: Decisions }

export interface AgentReport {
  agent: AgentId;
  title: string;
  headline: string;
  metrics: { label: string; value: string; tone?: 'good' | 'bad' | 'neutral' }[];
  findings: string[];
  table?: { columns: string[]; rows: string[][] };
  actions: { label: string; page: PageTarget }[];
  scope: string;
  dataUsed: string[];
}

const def = (id: AgentId) => AGENTS.find(a => a.id === id)!;
const tone = (v: number, good = 0): 'good' | 'bad' => (v >= good ? 'good' : 'bad');

// ------------------------------------------------------------
// Individual agents
// ------------------------------------------------------------

function performanceReport({ ds }: AgentContext): AgentReport {
  const n = ds.months.length;
  const cur = ds.months[n - 1], prev = ds.months[n - 2];
  const e = explainChange(ds, {}, [cur], [prev]);
  const series = monthlySeries(ds);
  const drops = series.slice(1).filter((p, i) => pctChange(p.revenue, series[i].revenue) <= -3);
  const w = periodWindow(ds, 'l3m');
  const regions = regionBreakdown(ds, {}, w);
  const worst = [...regions].filter(r => r.revenueChange !== null).sort((a, b) => (a.revenueChange ?? 0) - (b.revenueChange ?? 0))[0];
  const drags = e.drivers.filter(d => d.deltaRevenue < 0).slice(0, 3);
  return {
    agent: 'performance', title: def('performance').name,
    headline: `${monthLabel(cur, true)} revenue ${e.deltaRevenue >= 0 ? 'rose' : 'fell'} ${Math.abs(e.pctRevenue).toFixed(1)}% to ${fmtL(e.cur.revenue)}; ${Math.abs(e.volumeEffect) >= Math.abs(e.asvEffect) ? 'visit volume' : 'average service value'} drove most of the change.`,
    metrics: [
      { label: `Revenue · ${monthLabel(cur)}`, value: fmtL(e.cur.revenue), tone: tone(e.pctRevenue) },
      { label: 'Change vs prev month', value: `${fmtSigned(e.pctRevenue)}%`, tone: tone(e.pctRevenue) },
      { label: 'Gross margin', value: fmtPct(e.cur.grossMargin), tone: 'neutral' },
      { label: 'Retention', value: fmtPct(e.cur.retention), tone: 'neutral' },
    ],
    findings: [
      `Volume effect ${fmtSL(e.volumeEffect)} (visits ${fmtInt(e.prev.visits)} → ${fmtInt(e.cur.visits)}); price/mix effect ${fmtSL(e.asvEffect)} (ASV ${Math.round(e.prev.asv).toLocaleString('en-IN')} → ${Math.round(e.cur.asv).toLocaleString('en-IN')}).`,
      drags.length ? `Biggest drags: ${drags.map(d => `${d.label} ${fmtSL(d.deltaRevenue)}`).join('; ')}.` : 'No region/segment is dragging revenue down this month.',
      `${drops.length} month${drops.length === 1 ? '' : 's'} this year fell 3% or more vs the previous month${drops.length ? ` (${drops.map(p => monthLabel(p.month)).join(', ')})` : ''}, mostly after campaigns ended.`,
      worst ? `Weakest region over the last 3 months: ${worst.region} (${fmtSigned(worst.revenueChange ?? 0)}% vs the prior 3 months).` : '',
    ].filter(Boolean),
    table: {
      columns: ['Region', 'Revenue (3M)', 'Change', 'Margin', 'Retention', 'ROI'],
      rows: regions.map(r => [r.region, fmtL(r.revenue), r.revenueChange === null ? '—' : `${fmtSigned(r.revenueChange)}%`, fmtPct(r.grossMargin), fmtPct(r.retention), fmtX(r.roi)]),
    },
    actions: [{ label: 'Open Dashboard', page: 'dashboard' }],
    scope: 'All regions · all segments', dataUsed: def('performance').dataUsed,
  };
}

function promotionReport({ ds }: AgentContext): AgentReport {
  const perf = schemePerformance(ds);
  const all = metricsFor(ds, {});
  const best = perf[0], worst = perf[perf.length - 1];
  const done = campaignResults(ds).filter(r => r.plan.status === 'Completed' && r.roi !== null);
  const bestC = [...done].sort((a, b) => (b.roi ?? 0) - (a.roi ?? 0))[0];
  const worstC = [...done].sort((a, b) => (a.roi ?? 0) - (b.roi ?? 0))[0];
  const below = perf.filter(p => p.status === 'Below target');
  return {
    agent: 'promotion', title: def('promotion').name,
    headline: `${best.scheme} leads at ${fmtX(best.roi)}; ${worst.scheme} trails at ${fmtX(worst.roi)}. Portfolio ROI is ${fmtX(all.roi)} against a ${fmtX(ROI_TARGET)} target.`,
    metrics: [
      { label: 'Portfolio ROI', value: fmtX(all.roi), tone: (all.roi ?? 0) >= ROI_TARGET ? 'good' : 'bad' },
      { label: 'Promotion spend', value: fmtL(all.promoSpend), tone: 'neutral' },
      { label: 'Net profit after promotion', value: fmtL(all.incrNetProfit), tone: tone(all.incrNetProfit) },
      { label: 'Schemes below target', value: String(below.length), tone: below.length ? 'bad' : 'good' },
    ],
    findings: [
      `Best campaign: ${bestC.plan.name} (${bestC.plan.id}) at ${fmtX(bestC.roi)} vs ${fmtX(bestC.plan.expectedRoi)} planned.`,
      `Worst campaign: ${worstC.plan.name} (${worstC.plan.id}) at ${fmtX(worstC.roi)} vs ${fmtX(worstC.plan.expectedRoi)} planned.`,
      below.length ? `Below the ROI target: ${below.map(b => `${b.scheme} (${fmtX(b.roi)} on ${fmtL(b.promoSpend)})`).join('; ')}. Consider reallocating this spend to higher-ROI schemes.` : 'Every scheme is at or above target.',
    ],
    table: {
      columns: ['Scheme', 'ROI', 'Spend', 'Extra revenue', 'Visits uplift', 'Status'],
      rows: perf.map(p => [p.scheme, fmtX(p.roi), fmtL(p.promoSpend), fmtL(p.incrRevenue), fmtPct(p.visitsUpliftPct), p.status]),
    },
    actions: [{ label: 'Open Campaign Performance', page: 'campaigns' }, { label: 'Open Dashboard', page: 'dashboard' }],
    scope: 'All regions · all segments · full year', dataUsed: def('promotion').dataUsed,
  };
}

export function competitorReport({ ds, bm }: AgentContext, region: Region | 'All' = 'All'): AgentReport {
  const overview = marketOverview(bm, region);
  const pressure = regionPressure(ds, bm);
  const hot = [...pressure].sort((a, b) => b.avgGapPp - a.avgGapPp)[0];
  const behind = overview.filter(o => o.position === 'Behind');
  const suggestions = buildSuggestions(ds, bm, { region }).filter(s => s.type !== 'Hold');
  const top = suggestions.slice(0, 5);
  const scopeText = region === 'All' ? 'All regions' : `${region} region`;
  return {
    agent: 'competitor', title: def('competitor').name,
    headline: behind.length
      ? `We are behind the market on ${behind.length} of ${overview.length} comparable offers${region === 'All' ? `; pressure is highest in ${hot.region} (our offers are ${hot.avgGapPp.toFixed(1)}pp shallower on average)` : ''}. ${top.length} actions recommended.`
      : `Our offers are at or ahead of the market in ${scopeText}. ${top.length} refinements suggested.`,
    metrics: [
      { label: 'Offers behind market', value: `${behind.length} of ${overview.length}`, tone: behind.length ? 'bad' : 'good' },
      { label: 'Highest pressure', value: region === 'All' ? `${hot.region} (${hot.intensity})` : scopeText, tone: 'bad' },
      { label: 'Competitor offers tracked', value: String(bm.offers.filter(o => o.month === bm.latestMonth && (region === 'All' || o.region === region)).length), tone: 'neutral' },
      { label: 'Actions', value: String(top.length), tone: 'neutral' },
    ],
    findings: top.flatMap(s => [`[${s.priority}] ${s.title}`, `   → ${s.action}`, `   Impact: ${s.impact}`]),
    table: {
      columns: ['Our scheme', 'Our depth', 'Market median', 'Gap', 'Position', 'Validity (ours / market)', 'Top competitor'],
      rows: overview.map(o => [
        o.scheme, `${o.ourDepth}%`, `${o.medianDepth.toFixed(1)}%`, `${o.gapPp >= 0 ? '+' : '−'}${Math.abs(o.gapPp).toFixed(1)}pp`, o.position,
        `${o.ourValidity}d / ${Math.round(o.medianValidity)}d`, `${o.topCompetitor} (${o.maxDepth.toFixed(1)}%)`,
      ]),
    },
    actions: [{ label: 'Simulate a response', page: 'simulation' }, { label: 'Plan defensive campaigns', page: 'planning' }],
    scope: scopeText, dataUsed: def('competitor').dataUsed,
  };
}

function simulationReport({ ds, plan }: AgentContext): AgentReport {
  const { baseline, scenarios } = buildScenarios(ds, plan);
  const ranked = rankScenarios(scenarios, plan.objective);
  const m = objectiveMetric[plan.objective];
  const best = ranked[0];
  const sens = budgetSensitivity(ds, plan, plan.scheme);
  const losers = ranked.filter(s => s.incrNetProfit < 0);
  return {
    agent: 'simulation', title: def('simulation').name,
    headline: `At a ${fmtL(plan.budget)} budget, ${best.label} is best for "${plan.objective}" (${m.format(m.value(best))} ${m.label}).${losers.length ? ` ${losers.map(l => l.label).join(' and ')} would lose money.` : ''}`,
    metrics: [
      { label: 'Baseline revenue', value: fmtL(baseline.revenue, 0), tone: 'neutral' },
      { label: 'Best scheme', value: best.label, tone: 'good' },
      { label: 'Best ROI', value: fmtX(best.roi), tone: (best.roi ?? 0) >= ROI_TARGET ? 'good' : 'bad' },
      { label: 'Net profit (best)', value: fmtL(best.incrNetProfit), tone: tone(best.incrNetProfit) },
    ],
    findings: [
      `Scope: ${planPeriod(plan).label.split(' (')[0]}, budget ${fmtL(plan.budget)}, target ${fmtL(plan.revenueTarget, 0)}.`,
      `Budget sensitivity for ${plan.scheme}: ${sens.map(s => `${fmtL(s.promoCost)} → ${fmtX(s.roi)}`).join(' · ')}.`,
      `Returns fall as spend rises (diminishing returns); doubling the budget does not double the revenue.`,
    ],
    table: {
      columns: ['Scheme', 'Extra revenue', 'Extra visits', 'ROI', 'Net profit'],
      rows: ranked.map(s => [s.label, fmtL(s.incrRevenue), fmtInt(s.incrVisits), fmtX(s.roi), fmtL(s.incrNetProfit)]),
    },
    actions: [{ label: 'Open Simulation', page: 'simulation' }, { label: 'Edit plan', page: 'planning' }],
    scope: `${planPeriod(plan).label} · ${plan.region === 'All' ? 'all regions' : plan.region}`, dataUsed: def('simulation').dataUsed,
  };
}

function plannerReport(ctx: AgentContext): AgentReport {
  const { ds, bm, plan, decisions } = ctx;
  const b = recommendCampaigns(ds, bm, plan, decisions);
  const budget = b.recs.reduce((s, r) => s + r.budget, 0);
  const incr = b.recs.reduce((s, r) => s + r.eval.scenario.incrRevenue, 0);
  const net = b.recs.reduce((s, r) => s + r.eval.scenario.incrNetProfit, 0);
  const attention = b.recs.filter(r => r.needsAttention);
  const top = [...b.recs].sort((a, c) => c.eval.scenario.incrNetProfit - a.eval.scenario.incrNetProfit).slice(0, 5);
  return {
    agent: 'planner', title: def('planner').name,
    headline: `${b.recs.length} campaigns recommended for ${planPeriod(plan).label.split(' (')[0]}: ${fmtL(budget)} budget, ${fmtL(incr, 0)} predicted extra revenue, ${fmtL(net)} net profit. ${attention.length} need review.`,
    metrics: [
      { label: 'Recommended campaigns', value: String(b.recs.length), tone: 'neutral' },
      { label: 'Total budget', value: fmtL(budget), tone: 'neutral' },
      { label: 'Predicted extra revenue', value: fmtL(incr, 0), tone: 'good' },
      { label: 'Need attention', value: String(attention.length), tone: attention.length ? 'bad' : 'good' },
    ],
    findings: [
      `${b.scheduled.length} campaign${b.scheduled.length === 1 ? ' is' : 's are'} already scheduled in this period and excluded from the recommendations (${b.scheduled.map(c => c.id).join(', ') || 'none'}).`,
      ...top.slice(0, 3).map(r => `${r.title}: ${r.rationale}`),
      b.gaps.length ? `Calendar gaps: ${b.gaps.map(g => `${g.region} ${g.segment}`).join(', ')}.` : 'No calendar gaps in the selected scope.',
    ],
    table: {
      columns: ['Campaign', 'Purpose', 'Start', 'Budget', 'Predicted ROI', 'Confidence'],
      rows: top.map(r => [r.title, r.purpose, fmtDate(r.startISO), fmtL(r.budget), fmtX(r.eval.scenario.roi), `${r.eval.confidence}%`]),
    },
    actions: [{ label: 'Open Planning', page: 'planning' }],
    scope: `${planPeriod(plan).label} · ${plan.region === 'All' ? 'all regions' : plan.region}`, dataUsed: def('planner').dataUsed,
  };
}

function monitorReport({ ds, bm }: AgentContext): AgentReport {
  const live = monitorCampaigns(ds, bm);
  const avg = live.length ? live.reduce((s, l) => s + l.health, 0) / live.length : 0;
  const risk = live.filter(l => l.band !== 'Healthy');
  const risky = live.reduce((s, l) => s + l.budgetAtRisk, 0);
  const advice = (l: (typeof live)[number]) => {
    const parts: string[] = [];
    if (l.flags.includes('Underperform')) parts.push('delivery is behind plan — tighten targeting or extend outreach');
    if (l.flags.includes('Below ROI plan')) parts.push('ROI is under plan — review offer design');
    if (l.flags.includes('Overspend')) parts.push('spend is ahead of pace — cap the budget');
    if (l.flags.includes('Underspend')) parts.push('spend is behind pace — check redemption friction');
    if (l.flags.includes('Competitor')) parts.push('competitors run deeper offers here — see the Competitor Benchmark Agent');
    return parts.length ? parts.join('; ') : 'on track — no action needed';
  };
  return {
    agent: 'monitor', title: def('monitor').name,
    headline: live.length ? `${live.length} campaigns are live: average health ${avg.toFixed(0)}/100, ${risk.length} need attention, ${fmtL(risky)} of planned budget at risk.` : 'No campaigns are live right now.',
    metrics: [
      { label: 'Active campaigns', value: String(live.length), tone: 'neutral' },
      { label: 'Average health', value: avg.toFixed(0), tone: avg >= 75 ? 'good' : 'bad' },
      { label: 'At risk', value: String(risk.length), tone: risk.length ? 'bad' : 'good' },
      { label: 'Budget at risk', value: fmtL(risky), tone: risky > 0 ? 'bad' : 'good' },
    ],
    findings: live.map(l => `${l.result.plan.name} (${l.band}, ${l.health}): ${advice(l)}.`),
    table: {
      columns: ['Campaign', 'Day', 'Delivery vs plan', 'ROI (plan)', 'Health', 'Flags'],
      rows: live.map(l => [l.result.plan.name, `D${l.day} of ${l.totalDays}`, fmtPct(l.deliveryPct, 0), `${fmtX(l.roi)} (${fmtX(l.result.plan.expectedRoi)})`, `${l.health} · ${l.band}`, l.flags.join(', ') || '—']),
    },
    actions: [{ label: 'Open Campaign Performance', page: 'campaigns' }],
    scope: `Data through ${monthLabel(ds.latestMonth)}`, dataUsed: def('monitor').dataUsed,
  };
}

function recommendationReport(ctx: AgentContext): AgentReport {
  const { ds, bm, plan } = ctx;
  const items: { pri: number; priority: string; action: string; source: string; impact: string }[] = [];
  for (const o of computeOpportunities(ds, planScope(plan)).slice(0, 3)) {
    items.push({ pri: o.severity === 'high' ? 0 : 1, priority: o.severity === 'high' ? 'High' : 'Medium', action: `${o.title} — ${o.detail.split(/\.\s/)[0].replace(/\.$/, '')}.`, source: o.type === 'Alert' ? 'Performance / Promotion' : 'Promotion', impact: o.impact });
  }
  for (const s of buildSuggestions(ds, bm).filter(x => x.type !== 'Hold').slice(0, 3)) {
    items.push({ pri: s.priority === 'High' ? 0 : 1, priority: s.priority, action: s.action, source: 'Competitor Benchmark', impact: s.impact });
  }
  const b = recommendCampaigns(ds, bm, plan, ctx.decisions);
  const attention = b.recs.filter(r => r.needsAttention).length;
  if (attention) items.push({ pri: 1, priority: 'Medium', action: `Review ${attention} recommended campaign${attention === 1 ? '' : 's'} flagged for attention before accepting.`, source: 'Campaign Planner', impact: 'Protects ROI' });
  const live = monitorCampaigns(ds, bm).filter(l => l.band !== 'Healthy');
  if (live.length) items.push({ pri: 0, priority: 'High', action: `Intervene on ${live.map(l => l.result.plan.name).join(', ')} (health below 75).`, source: 'Campaign Monitor', impact: `${fmtL(live.reduce((s, l) => s + l.budgetAtRisk, 0))} budget at risk` });
  items.sort((a, c) => a.pri - c.pri);
  return {
    agent: 'recommendation', title: def('recommendation').name,
    headline: `${items.filter(i => i.priority === 'High').length} high-priority actions across performance, competitors, planning and live campaigns.`,
    metrics: [
      { label: 'Actions', value: String(items.length), tone: 'neutral' },
      { label: 'High priority', value: String(items.filter(i => i.priority === 'High').length), tone: 'bad' },
    ],
    findings: items.map((i, k) => `${k + 1}. [${i.priority}] ${i.action}`),
    table: { columns: ['#', 'Priority', 'Action', 'Source agent', 'Impact'], rows: items.map((i, k) => [String(k + 1), i.priority, i.action, i.source, i.impact]) },
    actions: [{ label: 'Open Planning', page: 'planning' }, { label: 'Open Dashboard', page: 'dashboard' }],
    scope: describeScopeShort(plan), dataUsed: def('recommendation').dataUsed,
  };
}

const describeScopeShort = (p: Plan) => `${planPeriod(p).label.split(' (')[0]} · ${p.region === 'All' ? 'all regions' : p.region}`;

export function runAgent(id: AgentId, ctx: AgentContext, opts: { region?: Region | 'All' } = {}): AgentReport {
  switch (id) {
    case 'performance': return performanceReport(ctx);
    case 'promotion': return promotionReport(ctx);
    case 'competitor': return competitorReport(ctx, opts.region ?? 'All');
    case 'simulation': return simulationReport(ctx);
    case 'planner': return plannerReport(ctx);
    case 'monitor': return monitorReport(ctx);
    case 'recommendation': return recommendationReport(ctx);
  }
}
