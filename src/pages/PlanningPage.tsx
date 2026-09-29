import { useMemo, useState } from 'react';
import { Card, NumberField, Button, PageWrapper, TopBar, EmptyState, type PageKey } from '@/components/Layout';
import { DonutChart, HBarChart, BarChart } from '@/components/Charts';
import { FilterBar, FilterSelect, StatTile, Tag, ProgressBar, Th } from '@/components/ui';
import { benchmark as bm, dataset as ds } from '@/data/dataset';
import { centersIn, describeScope, metricsFor } from '@/lib/analytics';
import { regionPressure, OUR_TERMS } from '@/lib/benchmark';
import { REGIONS, ROI_TARGET, SCHEMES, SCHEME_COLORS, SEGMENTS } from '@/lib/constants';
import { fmtInt, fmtL, fmtPct, fmtX, monthShort } from '@/lib/format';
import { fmtDate, PURPOSES, recommendCampaigns, type Decision, type Decisions, type Purpose, type Rec } from '@/lib/planner';
import { OBJECTIVES, PLAN_PERIODS, planBaseline, planPeriod, planScope, suggestTargets, type Objective, type Plan, type PlanPeriodLabel } from '@/lib/simulation';
import type { Region, Scheme, Segment } from '@/lib/types';
import { AlertTriangle, Check, CheckCircle2, Flag, Pencil, Sparkles, Undo2, Wand2, X } from 'lucide-react';

interface Props {
  plan: Plan;
  onPlanChange: (p: Plan) => void;
  decisions: Decisions;
  onDecide: (id: string, d: Decision | null) => void;
  onOpenSimulation: (id: string) => void;
  onNavigate: (p: PageKey) => void;
}

/** Parses a typed number ("1,250", "12.5"); null when it is not a valid non-negative number. */
function parseNumber(s: string): number | null {
  const t = s.replace(/,/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function PlanningPage({ plan, onPlanChange, decisions, onDecide, onOpenSimulation, onNavigate }: Props) {
  const [schemeFilter, setSchemeFilter] = useState<Scheme | 'All'>('All');
  const [purposeFilter, setPurposeFilter] = useState<Purpose | 'All'>('All');
  const [drafts, setDrafts] = useState({ revenue: String(plan.revenueTarget), visits: String(plan.visitTarget), budget: String(plan.budget) });

  const bundle = useMemo(() => recommendCampaigns(ds, bm, plan, decisions), [plan, decisions]);
  const baseline = useMemo(() => planBaseline(ds, plan), [plan]);
  const suggested = useMemo(() => suggestTargets(ds, plan), [plan]);
  const pressure = useMemo(() => regionPressure(ds, bm), []);

  // ---------- filters (period / scope / objective drive the plan; scheme and purpose only filter the list)
  const targetsUntouched = plan.revenueTarget === suggested.revenue && plan.visitTarget === suggested.visits;
  const apply = (patch: Partial<Plan>) => {
    let next: Plan = { ...plan, ...patch };
    if (['period', 'region', 'centerId', 'segment'].some(k => k in patch) && targetsUntouched) {
      const t = suggestTargets(ds, next);
      next = { ...next, revenueTarget: t.revenue, visitTarget: t.visits };
      setDrafts(d => ({ ...d, revenue: String(t.revenue), visits: String(t.visits) }));
    }
    onPlanChange(next);
  };
  const setNumber = (key: 'revenue' | 'visits' | 'budget', text: string) => {
    setDrafts(d => ({ ...d, [key]: text }));
    const n = parseNumber(text);
    if (n === null || (key !== 'budget' && n === 0)) return;
    onPlanChange({ ...plan, [key === 'revenue' ? 'revenueTarget' : key === 'visits' ? 'visitTarget' : 'budget']: n });
  };
  const errors = {
    revenue: parseNumber(drafts.revenue) ? null : 'Enter a number greater than 0',
    visits: parseNumber(drafts.visits) ? null : 'Enter a number greater than 0',
    budget: parseNumber(drafts.budget) === null ? 'Enter a number (0 or more)' : null,
  };

  // ---------- derived lists
  const visible = bundle.recs.filter(r => (schemeFilter === 'All' || r.scheme === schemeFilter) && (purposeFilter === 'All' || r.purpose === purposeFilter));
  const statusOf = (r: Rec) => decisions[r.id]?.status;
  const main = visible.filter(r => !r.needsAttention || statusOf(r) === 'Accepted');
  const attention = visible.filter(r => r.needsAttention && statusOf(r) !== 'Accepted');
  const scheduled = bundle.scheduled.filter(c => schemeFilter === 'All' || c.scheme === schemeFilter);

  const live = bundle.recs.filter(r => statusOf(r) !== 'Rejected');
  const accepted = bundle.recs.filter(r => statusOf(r) === 'Accepted');
  const pendingAttention = bundle.recs.filter(r => r.needsAttention && !statusOf(r));
  const committed = scheduled.reduce((s, c) => s + c.investment, 0) + accepted.reduce((s, r) => s + r.eval.scenario.promoCost, 0);
  const atRisk = pendingAttention.reduce((s, r) => s + r.eval.scenario.promoCost, 0);

  // ---------- plan progress
  const acceptedCost = accepted.reduce((s, r) => s + r.eval.scenario.promoCost, 0);
  const acceptedRevenue = accepted.reduce((s, r) => s + r.eval.scenario.incrRevenue, 0);
  const projected = baseline.revenue + acceptedRevenue;
  const gap = plan.revenueTarget - baseline.revenue;
  const fy = metricsFor(ds, planScope(plan));
  const histIntensity = fy.revenue ? (fy.promoSpend / (fy.revenue - fy.incrRevenue)) * 100 : 0;
  const planIntensity = baseline.revenue ? (plan.budget / baseline.revenue) * 100 : 0;
  const centers = centersIn(ds, plan.region);

  // ---------- chart data
  const roiBars = live.map(r => ({ label: r.title.replace(' — ', ' · '), value: r.eval.scenario.roi ?? 0, color: SCHEME_COLORS[r.scheme] }))
    .sort((a, b) => b.value - a.value).slice(0, 8);
  const bySchemeSpend = SCHEMES.map(s => ({ label: s, value: live.filter(r => r.scheme === s).reduce((t, r) => t + r.eval.scenario.promoCost, 0), color: SCHEME_COLORS[s] })).filter(d => d.value > 0);

  return (
    <>
      <TopBar title="Planning" subtitle="Plan · AI-recommended campaign calendar with predicted results — accept, reject or modify each campaign" />
      <FilterBar>
        <FilterSelect label="Planning period" value={plan.period} onChange={v => apply({ period: v as PlanPeriodLabel })} options={PLAN_PERIODS.map(p => p.label)} />
        <FilterSelect label="Region" value={plan.region} onChange={v => apply({ region: v as Region | 'All', centerId: 'All' })} options={[{ value: 'All', label: 'All Regions' }, ...REGIONS]} />
        <FilterSelect label="Service center" value={plan.centerId} onChange={v => apply({ centerId: v })} options={[{ value: 'All', label: 'All Service Centers' }, ...centers.map(c => ({ value: c.id, label: c.name }))]} />
        <FilterSelect label="Customer segment" value={plan.segment} onChange={v => apply({ segment: v as Segment | 'All' })} options={[{ value: 'All', label: 'All Segments' }, ...SEGMENTS]} />
        <FilterSelect label="Promotion scheme" value={schemeFilter} onChange={v => setSchemeFilter(v as Scheme | 'All')} options={[{ value: 'All', label: 'All Schemes' }, ...SCHEMES]} />
        <FilterSelect label="Campaign purpose" value={purposeFilter} onChange={v => setPurposeFilter(v as Purpose | 'All')} options={[{ value: 'All', label: 'All Purposes' }, ...PURPOSES]} />
        <FilterSelect label="Optimise for" value={plan.objective} onChange={v => apply({ objective: v as Objective })} options={OBJECTIVES.map(o => ({ value: o, label: `Optimise: ${o.replace('Maximize ', '')}` }))} />
      </FilterBar>

      <PageWrapper>
        {/* KPI tiles */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Total upcoming" value={`${live.length + bundle.scheduled.length} campaigns`} sub={`${live.length} recommended · ${bundle.scheduled.length} already scheduled`} />
          <StatTile label="Budget committed" value={fmtL(committed)} sub={`${accepted.length} accepted + ${bundle.scheduled.length} scheduled`} />
          <StatTile label="Needing action" value={`${pendingAttention.length} campaigns`} tone={pendingAttention.length ? 'bad' : 'good'} sub="Flagged by the planner" />
          <StatTile label="Budget at risk" value={fmtL(atRisk)} tone={atRisk > 0 ? 'bad' : 'good'} sub="On flagged, undecided campaigns" />
        </div>

        {/* Targets, budget and plan progress */}
        <Card title="Plan Targets & Budget" subtitle={`${planPeriod(plan).label} · ${describeScope(ds, planScope(plan))}`}>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-2">
              <NumberField label="Revenue target" prefix="₹" suffix="L" value={drafts.revenue} onChange={t => setNumber('revenue', t)} error={errors.revenue} hint={`Baseline ${fmtL(baseline.revenue, 0)}`} />
              <NumberField label="Service visit target" value={drafts.visits} onChange={t => setNumber('visits', t)} error={errors.visits} hint={`Baseline ${fmtInt(baseline.visits)}`} />
              <NumberField label="Promotion budget" prefix="₹" suffix="L" value={drafts.budget} onChange={t => setNumber('budget', t)} error={errors.budget} hint={`${fmtPct(planIntensity, 2)} of baseline revenue (last year ${fmtPct(histIntensity, 2)})`} />
              <div className="sm:col-span-3">
                <Button variant="ghost" icon={<Wand2 className="h-3.5 w-3.5" />} onClick={() => {
                  setDrafts(d => ({ ...d, revenue: String(suggested.revenue), visits: String(suggested.visits) }));
                  onPlanChange({ ...plan, revenueTarget: suggested.revenue, visitTarget: suggested.visits });
                }} disabled={targetsUntouched} className="!px-2 !py-1 text-xs">Use suggested targets (+5% on baseline)</Button>
              </div>
            </div>
            <div className="space-y-4 rounded-lg bg-slate-50 p-4">
              <div>
                <div className="mb-1 flex justify-between text-xs"><span className="text-slate-500">Budget allocated to accepted campaigns</span><span className="font-semibold text-slate-700">{fmtL(acceptedCost)} of {fmtL(plan.budget)}</span></div>
                <ProgressBar value={acceptedCost} max={Math.max(plan.budget, 0.1)} tone={acceptedCost > plan.budget ? 'red' : 'sky'} />
                {acceptedCost > plan.budget && <p className="mt-1 text-[11px] text-rose-600">Accepted campaigns exceed the plan budget by {fmtL(acceptedCost - plan.budget)}.</p>}
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs"><span className="text-slate-500">Projected revenue vs target</span><span className="font-semibold text-slate-700">{fmtL(projected, 0)} of {fmtL(plan.revenueTarget, 0)}</span></div>
                <ProgressBar value={projected} max={Math.max(plan.revenueTarget, 1)} marker={baseline.revenue} tone={projected >= plan.revenueTarget ? 'green' : 'amber'} />
                <p className="mt-1 text-[11px] text-slate-400">Marker = baseline {fmtL(baseline.revenue, 0)}. {gap > 0 ? `Gap to target: ${fmtL(gap, 0)}; accepted campaigns close ${Math.min(999, (acceptedRevenue / gap) * 100).toFixed(0)}%.` : 'Target is at or below baseline.'}</p>
              </div>
            </div>
          </div>
        </Card>

        {/* AI recommended campaigns */}
        <Card
          title="AI Recommended Campaigns"
          subtitle={`${main.length} campaign${main.length === 1 ? '' : 's'} recommended for ${planPeriod(plan).label.split(' (')[0]} · optimised for ${plan.objective.replace('Maximize ', '').toLowerCase()}`}
          action={<Tag tone="green"><Sparkles className="h-3 w-3" />AI Generated</Tag>}
        >
          {main.length === 0 ? <EmptyState title="No campaigns to show" detail="Change the filters, or reset the Scheme / Purpose filters to see all recommendations." /> : (
            <CampaignTable recs={main} decisions={decisions} onDecide={onDecide} onOpenSimulation={onOpenSimulation} />
          )}
        </Card>

        {attention.length > 0 && (
          <section className="rounded-xl border border-amber-200 bg-amber-50/50">
            <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><AlertTriangle className="h-4 w-4 text-amber-500" />Needs Attention</h3>
                <p className="mt-0.5 text-xs text-slate-500">The planner flagged these campaigns for review before committing (ROI under target or low confidence)</p>
              </div>
              <Tag tone="amber">{attention.length} campaign{attention.length === 1 ? '' : 's'}</Tag>
            </div>
            <div className="px-5 pb-4"><CampaignTable recs={attention} decisions={decisions} onDecide={onDecide} onOpenSimulation={onOpenSimulation} /></div>
          </section>
        )}

        {/* Already scheduled */}
        <Card title="Already Scheduled" subtitle="Campaigns in the master dataset that overlap this period — excluded from the recommendations above">
          {scheduled.length === 0 ? <p className="text-sm text-slate-400">No scheduled or active campaigns overlap this period in the selected scope.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="border-b border-slate-100"><Th>Campaign</Th><Th>Scheme</Th><Th>Target</Th><Th>Window</Th><Th right>Budget</Th><Th right>Expected ROI</Th><Th right>Status</Th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {scheduled.map(c => (
                    <tr key={c.id}>
                      <td className="px-3 py-2.5"><div className="font-medium text-slate-700">{c.name}</div><div className="text-[10px] text-slate-400">{c.id}</div></td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">{c.scheme}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">{c.region} · {c.segment}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-600">{c.startMonth} → {c.endMonth}</td>
                      <td className="px-3 py-2.5 text-right text-slate-700">{fmtL(c.investment)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-700">{fmtX(c.expectedRoi)}</td>
                      <td className="px-3 py-2.5 text-right"><Tag tone={c.status === 'Active' ? 'amber' : 'sky'}>{c.status}</Tag></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card title="Predicted ROI by Campaign" subtitle="Top 8 recommended · target marker at 1.30x" className="lg:col-span-2">
            {roiBars.length ? <HBarChart data={roiBars} valueFormat={v => fmtX(v)} target={{ value: ROI_TARGET, label: `ROI target ${fmtX(ROI_TARGET)}` }} /> : <EmptyState title="No campaigns" />}
          </Card>
          <Card title="Budget by Scheme" subtitle="Recommended campaigns (excludes rejected)">
            {bySchemeSpend.length ? <DonutChart data={bySchemeSpend} centerValue={fmtL(bySchemeSpend.reduce((s, d) => s + d.value, 0))} centerLabel="Total budget" height={190} /> : <EmptyState title="No budget allocated" />}
          </Card>
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title="Competitor Pressure by Region" subtitle="Average depth gap: market median minus our offer (pp) · positive = we are behind">
            <BarChart data={pressure.map(p => ({ label: p.region, gap: Math.round(p.avgGapPp * 10) / 10 }))} xKey="label" series={[{ key: 'gap', label: 'Depth gap (pp)', color: '#f59e0b' }]} height={220} showLegend={false} valueFormat={v => `${v.toFixed(1)}pp`} />
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
              <span>Recommendations tagged “Competitor deeper” already account for this gap.</span>
              <Button variant="secondary" className="!px-3 !py-1 text-xs" onClick={() => onNavigate('ai-advisor')}>Ask the Competitor Benchmark Agent</Button>
            </div>
          </Card>
          <Card title="Historical Context" subtitle={`Same months last year (FY 2025-26) · ${describeScope(ds, planScope(plan))}`}>
            <BarChart
              data={planPeriod(plan).monthIdx.map(i => ({ month: monthShort(ds.months[i]), revenue: metricsFor(ds, planScope(plan), [ds.months[i]]).revenue }))}
              xKey="month" series={[{ key: 'revenue', label: 'Service revenue (₹L)', color: '#10b981' }]} height={220} showLegend={false} valueFormat={v => v.toFixed(0)}
            />
          </Card>
        </div>

        {/* Calendar gaps */}
        <Card title="Calendar Gaps Detected" subtitle="Unscheduled opportunities identified by the planner">
          {bundle.gaps.length === 0 ? <p className="text-sm text-slate-400">No gaps: every customer segment in scope has a scheduled or recommended campaign.</p> : (
            <ul className="space-y-2">
              {bundle.gaps.map(g => (
                <li key={`${g.region}-${g.segment}`} className="flex items-start gap-3 rounded-lg border border-slate-200 px-4 py-3">
                  <Tag tone="amber"><Flag className="h-3 w-3" />Gap</Tag>
                  <div className="min-w-0 text-sm">
                    <div className="font-semibold text-slate-700">{g.region} · {g.segment} <span className="ml-1 text-xs font-normal text-slate-400">{fmtL(g.monthlyRevenue, 0)}/month · retention {fmtPct(g.retention)}</span></div>
                    <div className="text-xs text-slate-500">{g.note}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </PageWrapper>
    </>
  );
}

// ------------------------------------------------------------

function CampaignTable({ recs, decisions, onDecide, onOpenSimulation }: { recs: Rec[]; decisions: Decisions; onDecide: (id: string, d: Decision | null) => void; onOpenSimulation: (id: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead>
          <tr className="border-b border-slate-200">
            <Th>Campaign &amp; offer</Th><Th>Purpose</Th><Th>Start / duration</Th><Th right>Budget</Th><Th>Predicted</Th><Th right>Confidence</Th><Th right>Actions</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {recs.map(r => {
            const d = decisions[r.id];
            const sc = r.eval.scenario;
            const roi = sc.roi ?? 0;
            const terms = OUR_TERMS[r.scheme];
            return (
              <tr key={r.id} className={`align-top ${d?.status === 'Rejected' ? 'opacity-50' : ''}`}>
                <td className="max-w-[30rem] px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-800">{r.title}</span>
                    {r.flags.filter(f => f.startsWith('Competitor')).map(f => <Tag key={f} tone="amber" title="Competitors run a deeper equivalent offer in this region">{f}</Tag>)}
                    {r.applied && <Tag tone="violet">Modified</Tag>}
                  </div>
                  <div className="mt-0.5 text-xs font-medium text-emerald-700">{terms.description} · {r.depthPct}% depth · {r.segment}</div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-400" title={r.rationale}>{r.rationale}</p>
                </td>
                <td className="px-3 py-3"><Tag tone="dark">{r.purpose}</Tag></td>
                <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600"><div className="font-medium text-slate-700">{fmtDate(r.startISO)}</div>{r.weeks}w duration</td>
                <td className="px-3 py-3 text-right font-semibold text-slate-800">{fmtL(sc.promoCost)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-xs">
                  <div className="font-semibold text-slate-800">+{fmtInt(sc.incrVisits)} visits</div>
                  <div className={`font-semibold ${roi >= ROI_TARGET ? 'text-emerald-600' : roi >= 1 ? 'text-amber-600' : 'text-rose-600'}`}>{fmtX(roi)} ROI</div>
                  <div className="text-slate-400">+{fmtL(sc.incrRevenue)} revenue</div>
                </td>
                <td className="px-3 py-3 text-right text-sm text-slate-700">{r.eval.confidence}%</td>
                <td className="px-3 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    {d ? (
                      <>
                        <Tag tone={d.status === 'Accepted' ? 'green' : 'red'}>{d.status === 'Accepted' ? <CheckCircle2 className="h-3 w-3" /> : <X className="h-3 w-3" />}{d.status}</Tag>
                        <button type="button" onClick={() => onDecide(r.id, null)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"><Undo2 className="h-3 w-3" />Undo</button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => onDecide(r.id, { status: 'Accepted' })} className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"><Check className="h-3 w-3" />Accept</button>
                        <button type="button" onClick={() => onDecide(r.id, { status: 'Rejected' })} className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"><X className="h-3 w-3" />Reject</button>
                      </>
                    )}
                    <button type="button" onClick={() => onOpenSimulation(r.id)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Pencil className="h-3 w-3" />Modify</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
