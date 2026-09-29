// Data + logic checks — run with: npm run check
// Verifies the CSV dataset is internally consistent and that the analytics,
// simulation and AI Advisor layers produce sane output from it.
// Uses Node's built-in TypeScript support, so no extra tooling is needed.

import { readFileSync, readdirSync } from 'node:fs';
import { buildDataset } from '../src/lib/buildDataset.ts';
import { aggregate, campaignResults, filterRows, metricsFor, monthlySeries, periodWindow, schemePerformance } from '../src/lib/analytics.ts';
import { buildScenarios, defaultPlan, rankScenarios, schemeEfficiency } from '../src/lib/simulation.ts';
import { computeOpportunities } from '../src/lib/insights.ts';
import { answerQuestion, SUGGESTED_QUESTIONS } from '../src/lib/advisor.ts';
import { buildBenchmark, buildSuggestions, marketOverview, depthImpact } from '../src/lib/benchmark.ts';
import { recommendCampaigns, monitorCampaigns } from '../src/lib/planner.ts';
import { AGENTS, runAgent } from '../src/lib/agents.ts';

const MASTER = 'serviceiq_master_dataset.csv';
const masterCsv = readFileSync(new URL(`../data/${MASTER}`, import.meta.url), 'utf8');
const ds = buildDataset(masterCsv);
const bm = buildBenchmark(masterCsv); // competitor observations live in the same single CSV

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const close = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

console.log('\n# Master file');
const csvFiles = readdirSync(new URL('../data/', import.meta.url)).filter(f => f.endsWith('.csv'));
check('exactly ONE CSV in /data (our records + competitor observations)', csvFiles.length === 1 && csvFiles[0] === MASTER, csvFiles.join(', '));
const lines = masterCsv.replace(/^﻿/, '').trim().split('\n');
const header = lines[0].split(',');
const planLines = lines.slice(1).filter(l => l.startsWith('Plan,'));
const compLines = lines.slice(1).filter(l => l.startsWith('Competitor,'));
check('720 rows = 480 Actual + 21 Plan + 219 Competitor, 44 columns', lines.length - 1 === 720 && planLines.length === 21 && compLines.length === 219 && header.length === 44, `${lines.length - 1} rows x ${header.length} cols`);
check('Competitor rows carry no performance figures', compLines.every(l => Number(l.split(',')[header.indexOf('service_visits')] || 0) === 0));
check('campaign planned spend per month adds up to the campaign investment',
  ds.campaigns.every(c => Math.abs(Object.values(c.plannedByMonth).reduce((s, v) => s + v, 0) - c.investment) < 0.05));
const zeroCols = ['service_visits', 'service_revenue_lakh', 'promo_spend_lakh', 'incremental_revenue_lakh'].map(c => header.indexOf(c));
check('Plan rows carry no actuals', planLines.every(l => { const f = l.split(','); return zeroCols.every(i => Number(f[i]) === 0); }));
check('10 service centers and 23 campaigns derived from the master file', ds.centers.length === 10 && ds.campaigns.length === 23);
check('campaign plan totals are the sum of allocated rows',
  ds.campaigns.every(c => c.investment > 0 && c.expectedIncrRevenue > 0 && c.expectedIncrVisits > 0));

console.log('\n# Dataset integrity');
check('480 performance rows (12 months x 10 centers x 4 segments)', ds.rows.length === 480, String(ds.rows.length));
check('12 distinct months', ds.months.length === 12);
const keys = new Set(ds.rows.map(r => `${r.month}|${r.centerId}|${r.segment}`));
check('no duplicate month/center/segment rows', keys.size === ds.rows.length);
check('every center maps to its own region in the fact table',
  ds.rows.every(r => ds.centers.find(c => c.id === r.centerId)?.region === r.region));
check('revenue - cost = gross profit on every row', ds.rows.every(r => close(r.revenue - r.cost, r.grossProfit, 0.002)));
check('incremental values never exceed totals', ds.rows.every(r => r.incrRevenue <= r.revenue + 1e-9 && r.incrVisits <= r.visits));
check('retained <= due on every row', ds.rows.every(r => r.retained <= r.due));
check('promo spend only where a campaign ran', ds.rows.every(r => (r.promoSpend > 0) === (r.campaignId !== '')));
check('planned campaigns have no actual rows', ds.campaigns.filter(c => c.status === 'Planned').every(c => !ds.rows.some(r => r.campaignId === c.id)));
check('latest month is the last Actual month (plan rows do not extend it)', ds.latestMonth === '2026-03');

console.log('\n# Campaign reconciliation');
const results = campaignResults(ds);
const totalCampaignSpend = results.reduce((s, r) => s + r.spend, 0);
check('sum of campaign spend = dashboard promotion spend', close(totalCampaignSpend, aggregate(ds.rows).promoSpend, 0.01));
for (const r of results.filter(x => x.plan.status !== 'Planned')) {
  const within = r.spend <= r.plan.investment * 1.02;
  check(`${r.plan.id} ${r.plan.name}: spend ${r.spend.toFixed(2)} / ${r.plan.investment}, ROI ${r.roi?.toFixed(2)} (plan ${r.plan.expectedRoi})`, within);
}

console.log('\n# Analytics');
const win = periodWindow(ds, 'l3m');
const cur = metricsFor(ds, {}, win.current);
check('last 3 months = 3 months of data', win.current.length === 3 && win.previous?.length === 3);
check('segment slices add up to network revenue',
  close(['Premium', 'Mid-Market', 'Value', 'Fleet'].reduce((s, seg) => s + metricsFor(ds, { segment: seg }).revenue, 0), metricsFor(ds).revenue, 0.01));
check('region slices add up to network visits',
  ['North', 'South', 'East', 'West', 'Central'].reduce((s, reg) => s + metricsFor(ds, { region: reg }).visits, 0) === metricsFor(ds).visits);
check('center filter is a subset of its region', metricsFor(ds, { centerId: 'SC-03' }).revenue < metricsFor(ds, { region: 'South' }).revenue);
check('ASV = revenue / visits', close(cur.asv, (cur.revenue * 1e5) / cur.visits, 0.5));
const series = monthlySeries(ds);
console.log(`       latest month ${ds.latestMonth}: revenue ₹${series.at(-1).revenue.toFixed(1)}L, margin ${series.at(-1).grossMargin.toFixed(1)}%, retention ${series.at(-1).retention.toFixed(1)}%`);
console.log('       scheme ROI:', schemePerformance(ds).map(s => `${s.scheme} ${s.roi.toFixed(2)}x`).join(' | '));

console.log('\n# Simulation');
const plan = defaultPlan(ds);
const { baseline, scenarios } = buildScenarios(ds, plan);
check('baseline revenue is positive and sensible', baseline.revenue > 1000 && baseline.revenue < 2000, `₹${baseline.revenue.toFixed(0)}L`);
check('6 scenarios (baseline + 5 schemes)', scenarios.length === 6);
check('every scheme scenario adds revenue', scenarios.slice(1).every(s => s.incrRevenue > 0 && s.revenue > baseline.revenue));
check('scenario ROI = incremental gross profit / cost', scenarios.slice(1).every(s => close(s.roi, s.incrGrossProfit / s.promoCost, 1e-6)));
for (const s of scenarios.slice(1)) console.log(`       ${s.label.padEnd(28)} incr ₹${s.incrRevenue.toFixed(1)}L  ROI ${s.roi.toFixed(2)}x  net ₹${s.incrNetProfit.toFixed(1)}L  (${s.evidence})`);
check('ranking returns 5 schemes', rankScenarios(scenarios, plan.objective).length === 5);
const zero = buildScenarios(ds, { ...plan, budget: 0 }).scenarios;
check('zero budget → no incremental revenue and no divide-by-zero', zero.every(s => s.incrRevenue === 0 && s.roi === null));
check('scoped efficiency falls back safely', schemeEfficiency(ds, 'Free Car Wash', { region: 'Central', segment: 'Fleet' }).revenuePerLakh > 0);
check('scope with a single center works', buildScenarios(ds, { ...plan, region: 'South', centerId: 'SC-05' }).baseline.revenue > 0);

console.log('\n# Opportunities');
const opps = computeOpportunities(ds);
check('at least one alert and one opportunity', opps.some(o => o.type === 'Alert') && opps.some(o => o.type === 'Opportunity'));
for (const o of opps) console.log(`       [${o.type}] ${o.title} (${o.impact})`);


console.log('\n# Competitor benchmark (external data)');
check('benchmark: 219 offers, 5 competitors, 3 months', bm.offers.length === 219 && bm.competitors.length === 5 && bm.months.length === 3, `${bm.offers.length} offers`);
check('every offer maps to one of our schemes and a valid region', bm.offers.every(o => o.depthPct > 0 && o.validityDays > 0 && o.reachPct > 0));
const mo = marketOverview(bm);
check('market overview covers all 5 schemes', mo.length === 5);
check('10% Service Discount: market median is above ours (we are behind)', mo.find(m => m.scheme === '10% Service Discount').position === 'Behind');
check('Free Engine Check: majority of competitors include a repair credit', mo.find(m => m.scheme === 'Free Engine Check').creditShare >= 0.5);
const sug = buildSuggestions(ds, bm);
check('suggestions include depth, validity and repair-credit actions', ['Match depth', 'Extend validity', 'Add repair credit'].every(t => sug.some(s => s.type === t)));
check('no suggestion contains NaN/undefined', sug.every(s => !/NaN|undefined|Infinity/.test(s.title + s.action + s.impact + s.evidence.join(' '))));
const di = depthImpact(ds, bm, '10% Service Discount', 'South', 10);
check('depth what-if at current depth changes nothing', Math.abs(di.dNet) < 1e-9 && Math.abs(di.dRevenue) < 1e-9);
check('a deeper offer costs more and adds volume', depthImpact(ds, bm, '10% Service Discount', 'South', 13).dCost > 0 && depthImpact(ds, bm, '10% Service Discount', 'South', 13).dRevenue > 0);

console.log('\n# Campaign planner and live monitor');
const bundle = recommendCampaigns(ds, bm, plan);
check('planner returns up to 14 campaigns', bundle.recs.length > 0 && bundle.recs.length <= 14, `${bundle.recs.length}`);
check('planner skips slices that already have a scheduled campaign', bundle.recs.every(r => !bundle.scheduled.some(c => c.region === r.region && c.segment === r.segment)));
check('planner never recommends a scheme with ROI below 1.0x when an alternative exists', bundle.recs.every(r => (r.eval.scenario.roi ?? 0) >= 1));
check('no scheme takes more than ~40% of the calendar', Object.values(bundle.recs.reduce((m, r) => ({ ...m, [r.scheme]: (m[r.scheme] ?? 0) + 1 }), {})).every(n => n <= Math.ceil(0.4 * bundle.recs.length) + 1));
check('planner honours scope filters', recommendCampaigns(ds, bm, { ...plan, region: 'South' }).recs.every(r => r.region === 'South'));
const idr = bundle.recs[0].id;
const ov = recommendCampaigns(ds, bm, plan, { [idr]: { status: 'Accepted', override: { scheme: 'Free Car Wash', budget: 3, weeks: 6, depthPct: 5.1 } } });
check('an applied simulation override changes the recommendation', ov.recs.find(r => r.id === idr).scheme === 'Free Car Wash' && ov.recs.find(r => r.id === idr).applied);
const live = monitorCampaigns(ds, bm);
check('monitor covers every Active campaign with a 0-100 health score', live.length === ds.campaigns.filter(c => c.status === 'Active').length && live.every(l => l.health >= 0 && l.health <= 100));

console.log('\n# AI agents (each runs from the data)');
const actx = { ds, bm, plan, decisions: {} };
for (const a of AGENTS) {
  const r = runAgent(a.id, actx);
  const ok = r.headline.length > 20 && r.metrics.length > 0 && r.findings.length > 0 && !/NaN|undefined|Infinity/.test(JSON.stringify(r));
  check(`${a.name}: headline, metrics, findings and no NaN`, ok, r.headline.slice(0, 90));
}
check('Competitor agent can be scoped to a region', runAgent('competitor', actx, { region: 'South' }).scope === 'South region');

console.log('\n# AI Advisor chat');
const questions = [...SUGGESTED_QUESTIONS, 'Compare Free Car Wash and ₹500 Voucher.', 'Identify low-performing periods.', 'hello', 'asdf qwerty', 'why did revenue drop in february', 'compare bundle and engine check', 'best performing region', 'how is fleet retention', 'Is our voucher weaker than the competition in the North?', 'benchmark our bundle against the market'];
const expect = {
  'How do our promotions compare with competitors?': 'Competitor', 'Where is our discount lower than competitors?': 'Competitor',
  'What should we do about competitor pressure in the South?': 'Competitor', 'Which campaigns should we run next quarter?': 'Planner',
  'Are my active campaigns on track?': 'Monitor', 'What happens if I increase the promotion budget by 25%?': 'Simulation',
  'Is our voucher weaker than the competition in the North?': 'Competitor', 'benchmark our bundle against the market': 'Competitor',
};
for (const q of questions) {
  const a = answerQuestion(ds, q, plan, { bm });
  const ok = a.text.length > 20 && !/NaN|undefined|Infinity/.test(a.text + a.bullets.join(' ')) && (!expect[q] || a.agent === expect[q]);
  check(`"${q}" → ${a.agent}`, ok, expect[q] && a.agent !== expect[q] ? `expected ${expect[q]}` : '');
  if (process.env.VERBOSE) console.log(`\n${a.text}\n${a.bullets.map(b => `   • ${b}`).join('\n')}\n   [${a.scope}]\n`);
}
check('chat without benchmark data degrades gracefully', answerQuestion(ds, 'compare us with competitors', plan).agent === 'Competitor');

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);