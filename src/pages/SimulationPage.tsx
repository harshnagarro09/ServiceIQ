import { useMemo, useState } from 'react';
import { Card, Button, PageWrapper, TopBar, EmptyState, type PageKey } from '@/components/Layout';
import { GroupedBarChart, LineChart } from '@/components/Charts';
import { ChartPanel, FilterBar, FilterSelect, Pill, Slider, Tag, Th } from '@/components/ui';
import { benchmark as bm, dataset as ds } from '@/data/dataset';
import { centersIn } from '@/lib/analytics';
import { marketPosition, OUR_TERMS } from '@/lib/benchmark';
import { REGIONS, ROI_TARGET, SCHEMES, SEGMENTS } from '@/lib/constants';
import { fmtInt, fmtL, fmtPct, fmtX } from '@/lib/format';
import { evaluateSpec, findAlternative, fmtDate, guardrailViolations, recommendCampaigns, type Decision, type Decisions, type Evaluation, type Rec, type RecSpec } from '@/lib/planner';
import { MODEL_ASSUMPTIONS, OBJECTIVES, PLAN_PERIODS, planPeriod, type Objective, type Plan, type PlanPeriodLabel } from '@/lib/simulation';
import type { Region, Scheme, Segment } from '@/lib/types';
import { AlertOctagon, ArrowLeft, Check, Info, Sparkles } from 'lucide-react';

interface Props {
  plan: Plan;
  onPlanChange: (p: Plan) => void;
  decisions: Decisions;
  onDecide: (id: string, d: Decision | null) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNavigate: (p: PageKey) => void;
}

export function SimulationPage({ plan, onPlanChange, decisions, onDecide, selectedId, onSelect, onNavigate }: Props) {
  const bundle = useMemo(() => recommendCampaigns(ds, bm, plan, decisions), [plan, decisions]);
  const aiBundle = useMemo(() => recommendCampaigns(ds, bm, plan, {}), [plan]);
  const recs = bundle.recs;
  const selected = recs.find(r => r.id === selectedId) ?? recs[0] ?? null;
  const centers = centersIn(ds, plan.region);

  const patch = (p: Partial<Plan>) => onPlanChange({ ...plan, ...p });

  return (
    <>
      <TopBar title="Simulation" subtitle="Simulate · model campaign scenarios on the recommended campaigns before you commit" />
      <FilterBar>
        <FilterSelect label="Planning period" value={plan.period} onChange={v => patch({ period: v as PlanPeriodLabel })} options={PLAN_PERIODS.map(p => p.label)} />
        <FilterSelect label="Region" value={plan.region} onChange={v => patch({ region: v as Region | 'All', centerId: 'All' })} options={[{ value: 'All', label: 'All Regions' }, ...REGIONS]} />
        <FilterSelect label="Service center" value={plan.centerId} onChange={v => patch({ centerId: v })} options={[{ value: 'All', label: 'All Service Centers' }, ...centers.map(c => ({ value: c.id, label: c.name }))]} />
        <FilterSelect label="Customer segment" value={plan.segment} onChange={v => patch({ segment: v as Segment | 'All' })} options={[{ value: 'All', label: 'All Segments' }, ...SEGMENTS]} />
      </FilterBar>

      <PageWrapper>
        {!selected ? (
          <EmptyState title="No campaigns to simulate" detail="Widen the filters above, or pick a planning period where slices are not already covered by scheduled campaigns." />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
            {/* Campaign list */}
            <aside className="rounded-xl border border-slate-200 bg-white lg:sticky lg:top-24 lg:self-start">
              <div className="border-b border-slate-100 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Campaigns ({recs.length})</div>
              <ul className="max-h-[70vh] overflow-y-auto p-2" aria-label="Recommended campaigns">
                {recs.map(r => {
                  const d = decisions[r.id]?.status;
                  const active = r.id === selected.id;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(r.id)}
                        aria-current={active ? 'true' : undefined}
                        className={`mb-1 w-full rounded-lg px-3 py-2.5 text-left transition-colors ${active ? 'bg-slate-900 text-white' : 'hover:bg-slate-50'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className={`text-xs font-semibold leading-snug ${active ? 'text-white' : 'text-slate-800'}`}>{r.title}</span>
                          <Tag tone={d === 'Accepted' ? (active ? 'green' : 'dark') : d === 'Rejected' ? 'red' : r.needsAttention ? 'amber' : 'green'}>{d ?? (r.needsAttention ? 'Needs attention' : 'Recommended')}</Tag>
                        </div>
                        <div className={`mt-1 text-[10px] ${active ? 'text-slate-300' : 'text-slate-400'}`}>{r.purpose} · {fmtX(r.eval.scenario.roi)} ROI</div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>

            <Workspace
              key={selected.id}
              rec={selected}
              aiRec={aiBundle.recs.find(r => r.id === selected.id) ?? selected}
              plan={plan}
              decision={decisions[selected.id]}
              onDecide={onDecide}
              onNavigate={onNavigate}
            />
          </div>
        )}

        <Card title="Model assumptions" subtitle="How the simulation works — every number on this page is an estimate learned from past campaigns">
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">{MODEL_ASSUMPTIONS.map(a => <li key={a}>{a}</li>)}</ul>
        </Card>
      </PageWrapper>
    </>
  );
}

// ------------------------------------------------------------

interface WorkspaceProps {
  rec: Rec;
  aiRec: Rec;                 // the untouched AI recommendation for this campaign
  plan: Plan;
  decision?: Decision;
  onDecide: (id: string, d: Decision | null) => void;
  onNavigate: (p: PageKey) => void;
}

function Workspace({ rec, aiRec, plan, decision, onDecide, onNavigate }: WorkspaceProps) {
  const startIdx = planPeriod(plan).monthIdx[0];
  const [objective, setObjective] = useState<Objective>(plan.objective);
  const [scheme, setScheme] = useState<Scheme>(rec.scheme);
  const [budget, setBudget] = useState(rec.budget);
  const [weeks, setWeeks] = useState(rec.weeks);
  const [depth, setDepth] = useState(rec.depthPct);
  const [minRoi, setMinRoi] = useState(1.1);
  const [maxIntensity, setMaxIntensity] = useState(8);
  const [note, setNote] = useState<string | null>(null);
  const [chart, setChart] = useState('schemes'); // which chart the panel shows; follows the lever you move

  const spec: RecSpec = { region: rec.region, segment: rec.segment, scheme, weeks, budget, depthPct: depth, startIdx };
  const sim = useMemo(() => evaluateSpec(ds, bm, spec), [scheme, budget, weeks, depth, rec.region, rec.segment, startIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  const ai = aiRec.eval;
  const guard = { minRoi, maxIntensityPct: maxIntensity };
  const violations = guardrailViolations(sim, guard);
  const ref = OUR_TERMS[scheme].depthPct;
  const mp = marketPosition(bm, scheme, rec.region);
  const marketDepth = mp?.medianDepth ?? null;

  const changeScheme = (s: Scheme) => { setScheme(s); setDepth(OUR_TERMS[s].depthPct); setNote(null); setChart('schemes'); };
  const reset = () => { setScheme(aiRec.scheme); setBudget(aiRec.budget); setWeeks(aiRec.weeks); setDepth(aiRec.depthPct); setNote(null); };
  const getAlternative = () => {
    const alt = findAlternative(ds, bm, spec, objective, guard);
    setScheme(alt.spec.scheme); setBudget(alt.spec.budget); setDepth(alt.spec.depthPct);
    setNote(alt.feasible
      ? `AI alternative applied: ${alt.spec.scheme} at ${fmtL(alt.spec.budget)} and ${alt.spec.depthPct}% depth → ${fmtX(alt.ev.scenario.roi)} ROI, ${fmtL(alt.ev.scenario.incrNetProfit)} net profit, within both guardrails.`
      : `No option meets both guardrails for this campaign. Showing the highest-ROI option (${alt.spec.scheme}, ${fmtL(alt.spec.budget)}, ${alt.spec.depthPct}% depth: ${fmtX(alt.ev.scenario.roi)}). Relax a guardrail or change the scope.`);
  };

  // ---- charts: built lazily, only for the chart currently selected in the panel
  const schemeChartData = () => SCHEMES.map(s => ({ s, e: evaluateSpec(ds, bm, { ...spec, scheme: s, depthPct: OUR_TERMS[s].depthPct }) }));
  const budgetCurveData = () => [0.5, 0.75, 1, 1.25, 1.5, 2].map(m => {
    const e = evaluateSpec(ds, bm, { ...spec, budget: Math.max(0.5, Math.round(spec.budget * m * 2) / 2) });
    return { label: fmtL(e.scenario.promoCost), net: e.scenario.incrNetProfit, roi: e.scenario.roi };
  });
  const depthCurveData = () => {
    const out: { label: string; net: number; roi: number | null }[] = [];
    const depthMax = Math.ceil(Math.max(marketDepth ?? ref, ref) + 3);
    for (let d = Math.max(3, Math.floor(ref - 2)); d <= depthMax; d += 1) {
      const e = evaluateSpec(ds, bm, { ...spec, depthPct: d });
      out.push({ label: `${d}%`, net: e.scenario.incrNetProfit, roi: e.scenario.roi });
    }
    return out;
  };

  const applied = decision?.status === 'Accepted';
  const competitors = bm.offers.filter(o => o.scheme === scheme && o.region === rec.region && o.month === bm.latestMonth).sort((a, b) => b.depthPct - a.depthPct);

  return (
    <div className="min-w-0 space-y-6">
      <div className="text-xs text-slate-500">
        <button type="button" className="hover:text-sky-600" onClick={() => onNavigate('planning')}>Planning</button>
        <span className="mx-1.5">/</span>
        <span className="font-medium text-slate-700">Simulation: {rec.title}</span>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm">
        <span className="font-semibold text-slate-800">{rec.title}</span>
        <span className="text-slate-500"> · {rec.purpose} · starts {fmtDate(rec.startISO)} · </span>
        <span className="text-slate-500">AI recommendation: {aiRec.scheme}, {aiRec.weeks}w, {fmtL(aiRec.budget)} → </span>
        <span className="font-semibold text-emerald-600">{fmtX(ai.scenario.roi)} ROI</span>
      </div>

      {/* Controls */}
      <Card title="Simulation Controls" subtitle="Change the levers; results below update instantly">
        <div className="space-y-5">
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Optimise for</div>
            <div className="flex flex-wrap gap-2">{OBJECTIVES.map(o => <Pill key={o} active={objective === o} onClick={() => setObjective(o)}>{o.replace('Maximize ', '')}</Pill>)}</div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Target</div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{rec.region} · {rec.segment}</div>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="sim-scheme" className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Promotion scheme</label>
              <select id="sim-scheme" value={scheme} onChange={e => changeScheme(e.target.value as Scheme)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20">
                {SCHEMES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
            <Slider label="Offer depth (% of average ticket)" value={depth} min={3} max={25} step={0.5} format={v => `${v}%`} onChange={v => { setDepth(v); setNote(null); setChart('depth'); }} hint={marketDepth !== null ? `now ${ref}% · market ${marketDepth.toFixed(1)}%` : `now ${ref}%`} />
            <Slider label="Duration" value={weeks} min={2} max={12} step={1} format={v => `${v}w`} onChange={v => { setWeeks(v); setNote(null); }} />
            <Slider label="Campaign budget (at current terms)" value={budget} min={0.5} max={Math.max(20, Math.ceil(aiRec.budget * 4))} step={0.5} format={v => fmtL(v)} onChange={v => { setBudget(v); setNote(null); setChart('budget'); }} hint="promotion cost scales with depth" />
            <Slider label="Min ROI guardrail" value={minRoi} min={0.8} max={1.8} step={0.05} format={v => `${v.toFixed(2)}x`} onChange={setMinRoi} />
            <Slider label="Max spend intensity (% of baseline revenue)" value={maxIntensity} min={1} max={15} step={0.5} format={v => `${v}%`} onChange={setMaxIntensity} />
            <div className="flex items-end"><Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={reset}>Reset to AI recommendation</Button></div>
          </div>
        </div>
      </Card>

      {note && (
        <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-800" role="status"><Info className="mt-0.5 h-4 w-4 shrink-0" />{note}</div>
      )}

      {violations.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-5 py-4" role="alert">
          <div className="flex items-start gap-3">
            <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
            <div>
              <div className="text-sm font-semibold text-rose-700">Guardrail violated — simulated scenario cannot be applied</div>
              <ul className="mt-1 list-disc pl-4 text-xs text-rose-600">{violations.map(v => <li key={v}>{v}</li>)}</ul>
            </div>
          </div>
          <Button variant="secondary" icon={<Sparkles className="h-3.5 w-3.5 text-amber-500" />} onClick={getAlternative} className="border-amber-300 !text-amber-700">Get AI alternative</Button>
        </div>
      )}

      {/* Scenario comparison */}
      <Card title="Scenario Comparison" subtitle="AI recommended baseline vs your adjusted simulation">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ScenarioCard
            tone="ai" tag="AI Recommended" line={`${aiRec.scheme} · ${aiRec.depthPct}% depth · ${aiRec.weeks}w · ${fmtL(aiRec.budget)}`} ev={ai}
            button={<Button variant="secondary" className="w-full justify-center" onClick={() => onDecide(rec.id, { status: 'Accepted' })}>Apply AI Recommended</Button>}
          />
          <ScenarioCard
            tone="sim" tag="Simulated" line={`${scheme} · ${depth}% depth · ${weeks}w · ${fmtL(budget)}`} ev={sim} compareTo={ai}
            button={
              <Button className="w-full justify-center" disabled={violations.length > 0} onClick={() => onDecide(rec.id, { status: 'Accepted', override: { scheme, budget, weeks, depthPct: depth } })}>Apply Simulated</Button>
            }
          />
        </div>
        {applied && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800" role="status">
            <span className="flex items-center gap-2"><Check className="h-4 w-4" />Applied to the plan{decision?.override ? ' with your changes' : ' as recommended'}. It now counts toward the plan budget and appears under “Queued for launch” on Campaign Performance.</span>
            <Button variant="secondary" icon={<ArrowLeft className="h-3.5 w-3.5" />} className="!px-3 !py-1 text-xs" onClick={() => onNavigate('planning')}>Back to Planning</Button>
          </div>
        )}
      </Card>

      {/* Analysis — one view at a time; it follows the slider you move */}
      <ChartPanel
        title="Scenario Analysis"
        selected={chart}
        onSelect={setChart}
        options={[
          {
            key: 'schemes', label: 'Compare all schemes', subtitle: `Same target, ${weeks}w and ${fmtL(budget)} budget · each scheme at its current offer terms`,
            render: () => {
              const data = schemeChartData();
              return (
                <>
                  <GroupedBarChart
                    categories={data.map(x => x.s)}
                    series={[
                      { label: 'Extra revenue', values: data.map(x => x.e.scenario.incrRevenue), color: '#0ea5e9' },
                      { label: 'Promotion cost', values: data.map(x => x.e.scenario.promoCost), color: '#94a3b8' },
                    ]}
                    height={250} valueFormat={v => v.toFixed(0)}
                  />
                  <p className="mt-2 text-xs text-slate-500">ROI: {data.map(x => `${x.s.split(' ').slice(0, 2).join(' ')} ${fmtX(x.e.scenario.roi)}`).join(' · ')}</p>
                </>
              );
            },
          },
          {
            key: 'budget', label: 'Budget sensitivity', subtitle: `Net profit for ${scheme} as the budget changes`,
            render: () => {
              const data = budgetCurveData();
              return (
                <>
                  <LineChart data={data} xKey="label" series={[{ key: 'net', label: 'Net profit (₹L)', color: '#10b981' }]} showLegend={false} height={240} yFormat={v => fmtL(v, 1)} />
                  <p className="mt-2 text-xs text-slate-500">ROI: {data.map(b => `${b.label} → ${fmtX(b.roi)}`).join(' · ')}</p>
                </>
              );
            },
          },
          {
            key: 'depth', label: 'Offer depth sensitivity', subtitle: `Net profit for ${scheme} at different discount depths${marketDepth !== null ? ` · market median ${marketDepth.toFixed(1)}%` : ''}`,
            render: () => (
              <>
                <LineChart data={depthCurveData()} xKey="label" series={[{ key: 'net', label: 'Net profit (₹L)', color: '#8b5cf6' }]} showLegend={false} height={240} yFormat={v => fmtL(v, 1)} />
                <p className="mt-2 text-xs text-slate-500">Deeper offers cost more but win back customers lost to competitors; profit peaks where the two effects balance. Current depth: {ref}%.</p>
              </>
            ),
          },
          {
            key: 'market', label: 'Competitor benchmark', subtitle: `${scheme} · ${rec.region} · ${bm.latestMonth}`,
            render: () => (
              <>
                {competitors.length === 0 ? <p className="text-sm text-slate-400">No competitor runs an equivalent offer in {rec.region}.</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] text-xs">
                      <thead><tr className="border-b border-slate-100"><Th>Who</Th><Th>Offer</Th><Th right>Depth</Th><Th right>Validity</Th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        <tr className="bg-sky-50/60"><td className="px-3 py-2 font-semibold text-slate-800">Us</td><td className="px-3 py-2 text-slate-600">{OUR_TERMS[scheme].description}</td><td className="px-3 py-2 text-right font-semibold">{ref}%</td><td className="px-3 py-2 text-right">{OUR_TERMS[scheme].validityDays}d</td></tr>
                        {competitors.map(c => (
                          <tr key={c.competitorId}><td className="px-3 py-2 text-slate-700">{c.competitor}</td><td className="px-3 py-2 text-slate-600">{c.description}</td><td className={`px-3 py-2 text-right font-semibold ${c.depthPct > ref + 3 ? 'text-rose-600' : 'text-slate-700'}`}>{c.depthPct.toFixed(1)}%</td><td className="px-3 py-2 text-right">{c.validityDays}d</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {mp && <p className="mt-3 text-xs text-slate-500">Market median {mp.medianDepth.toFixed(1)}% vs our {ref}% — <strong className={mp.position === 'Behind' ? 'text-rose-600' : 'text-slate-700'}>{mp.position.toLowerCase()}</strong> ({mp.gapPp >= 0 ? '' : '−'}{Math.abs(mp.gapPp).toFixed(1)}pp).</p>}
              </>
            ),
          },
        ]}
      />
    </div>
  );
}

function ScenarioCard({ tone, tag, line, ev, compareTo, button }: { tone: 'ai' | 'sim'; tag: string; line: string; ev: Evaluation; compareTo?: Evaluation; button: React.ReactNode }) {
  const s = ev.scenario;
  const delta = (a: number, b?: number, fmt: (v: number) => string = v => v.toFixed(1)) => {
    if (b === undefined || Math.abs(a - b) < 1e-6) return null;
    return <span className={`ml-1 text-[10px] font-medium ${a > b ? 'text-emerald-600' : 'text-rose-600'}`}>{a > b ? '▲' : '▼'} {fmt(Math.abs(a - b))}</span>;
  };
  const c = compareTo?.scenario;
  const roi = s.roi ?? 0;
  return (
    <div className={`rounded-xl border p-4 ${tone === 'ai' ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}>
      <Tag tone={tone === 'ai' ? 'green' : 'dark'}>{tone === 'ai' && <Sparkles className="h-3 w-3" />}{tag}</Tag>
      <p className="mt-2 text-xs text-slate-500">{line}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        <Metric label="Extra visits">{fmtInt(s.incrVisits)}{delta(s.incrVisits, c?.incrVisits, v => fmtInt(v))}</Metric>
        <Metric label="Extra revenue">{fmtL(s.incrRevenue)}{delta(s.incrRevenue, c?.incrRevenue, v => fmtL(v))}</Metric>
        <Metric label="ROI"><span className={roi >= ROI_TARGET ? 'text-emerald-600' : roi >= 1 ? 'text-amber-600' : 'text-rose-600'}>{fmtX(s.roi)}</span>{delta(roi, c?.roi ?? undefined, v => v.toFixed(2))}</Metric>
        <Metric label="Net profit">{fmtL(s.incrNetProfit)}{delta(s.incrNetProfit, c?.incrNetProfit, v => fmtL(v))}</Metric>
        <Metric label="Promotion cost">{fmtL(s.promoCost)}</Metric>
        <Metric label="Spend intensity">{fmtPct(ev.intensityPct)}</Metric>
        <Metric label="Competitor gap">{ev.gapPp === null ? 'No equivalent' : <span className={ev.gapPp >= 3 ? 'text-rose-600' : ''}>{ev.gapPp >= 0 ? '' : '−'}{Math.abs(ev.gapPp).toFixed(1)}pp</span>}</Metric>
        <Metric label="Confidence">{ev.confidence}%</Metric>
      </dl>
      <div className="mt-4">{button}</div>
    </div>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-lg font-bold text-slate-800">{children}</dd>
    </div>
  );
}
