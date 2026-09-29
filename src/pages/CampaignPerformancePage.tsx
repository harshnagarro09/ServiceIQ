import { useMemo, useState, type ComponentType } from 'react';
import { Card, Badge, Button, EmptyState, PageWrapper, TopBar, type PageKey } from '@/components/Layout';
import { BarChart, DonutChart, GroupedBarChart, HBarChart, LineChart, ScatterPlot } from '@/components/Charts';
import { FilterBar, FilterSelect, ProgressBar, StatTile, Tag, Th } from '@/components/ui';
import { benchmark as bm, dataset as ds } from '@/data/dataset';
import { campaignResults, type CampaignResult } from '@/lib/analytics';
import { marketPosition, OUR_TERMS } from '@/lib/benchmark';
import { REGIONS, ROI_DEFINITION, ROI_TARGET, SCHEMES, SCHEME_COLORS, SEGMENTS } from '@/lib/constants';
import { campaignLearning } from '@/lib/insights';
import { fmtInt, fmtL, fmtPct, fmtX, monthLabel, monthShort } from '@/lib/format';
import { fmtDate, monitorCampaigns, recommendCampaigns, type Decisions, type LiveCampaign } from '@/lib/planner';
import type { Plan } from '@/lib/simulation';
import type { CampaignStatus } from '@/lib/types';
import { Clock, Lightbulb, Target, IndianRupee, TrendingUp, TrendingDown, Swords, type LucideProps } from 'lucide-react';

type Tab = 'all' | CampaignStatus;

const periodText = (r: CampaignResult) =>
  r.plan.startMonth === r.plan.endMonth ? monthLabel(r.plan.startMonth) : `${monthLabel(r.plan.startMonth)} – ${monthLabel(r.plan.endMonth)}`;

interface Props { plan: Plan; decisions: Decisions; onNavigate: (p: PageKey) => void }

export function CampaignPerformancePage({ plan, decisions, onNavigate }: Props) {
  const all = useMemo(() => campaignResults(ds), []);
  const live = useMemo(() => monitorCampaigns(ds, bm), []);
  const queued = useMemo(() => recommendCampaigns(ds, bm, plan, decisions).recs.filter(r => decisions[r.id]?.status === 'Accepted'), [plan, decisions]);

  const [tab, setTab] = useState<Tab>('all');
  const [region, setRegion] = useState('All');
  const [segment, setSegment] = useState('All');
  const [scheme, setScheme] = useState('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const match = (c: { region: string; segment: string; scheme: string }) =>
    (region === 'All' || c.region === region) && (segment === 'All' || c.segment === segment) && (scheme === 'All' || c.scheme === scheme);
  const base = all.filter(r => match(r.plan));
  const liveShown = live.filter(l => match(l.result.plan));

  const counts = { Planned: 0, Active: 0, Completed: 0 } as Record<CampaignStatus, number>;
  for (const r of base) counts[r.plan.status]++;
  const filtered = (tab === 'all' ? base : base.filter(r => r.plan.status === tab)).slice().sort((a, b) => b.plan.startMonth.localeCompare(a.plan.startMonth) || a.plan.id.localeCompare(b.plan.id));
  const selected = filtered.find(r => r.plan.id === selectedId) ?? filtered[0] ?? null;

  const ran = base.filter(r => r.plan.status !== 'Planned');
  const spend = ran.reduce((s, r) => s + r.spend, 0);
  const gp = ran.reduce((s, r) => s + r.incrGrossProfit, 0);
  const portfolio = { spend, incr: ran.reduce((s, r) => s + r.incrRevenue, 0), net: gp - spend, roi: spend ? gp / spend : null };
  const beatPlan = ran.filter(r => r.plan.status === 'Completed' && (r.roi ?? 0) >= r.plan.expectedRoi).length;
  const completedN = ran.filter(r => r.plan.status === 'Completed').length;

  const avgHealth = liveShown.length ? liveShown.reduce((s, l) => s + l.health, 0) / liveShown.length : 0;
  const atRisk = liveShown.filter(l => l.band !== 'Healthy');
  const budgetAtRisk = liveShown.reduce((s, l) => s + l.budgetAtRisk, 0);

  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: 'all', label: 'All campaigns', n: base.length },
    { key: 'Planned', label: 'Planned', n: counts.Planned },
    { key: 'Active', label: 'Active', n: counts.Active },
    { key: 'Completed', label: 'Completed', n: counts.Completed },
  ];
  const completed = base.filter(r => r.plan.status === 'Completed' && r.roi !== null).sort((a, b) => a.plan.startMonth.localeCompare(b.plan.startMonth));

  // ---------- analytics for the campaigns that have run (respecting the filters)
  const ranRows = base.filter(r => r.plan.status !== 'Planned' && r.spend > 0);
  let cumSpend = 0, cumIncr = 0;
  const cumulative = ds.months.map(m => {
    for (const r of ranRows) {
      const p = r.monthly.find(x => x.month === m);
      if (p) { cumSpend += p.spend; cumIncr += p.incrRevenue; }
    }
    return { label: monthShort(m), spend: cumSpend, incr: cumIncr };
  });
  const outcomeOf = (r: CampaignResult) => {
    const roi = r.roi ?? 0;
    return roi < 1 ? 'Lost money' : roi >= r.plan.expectedRoi * 1.05 ? 'Beat plan' : roi >= r.plan.expectedRoi * 0.95 ? 'On plan' : 'Below plan';
  };
  const OUTCOME_COLORS: Record<string, string> = { 'Beat plan': '#10b981', 'On plan': '#0ea5e9', 'Below plan': '#f59e0b', 'Lost money': '#ef4444' };
  const outcomeMix = Object.keys(OUTCOME_COLORS).map(k => ({ label: k, value: ranRows.filter(r => outcomeOf(r) === k).length, color: OUTCOME_COLORS[k] })).filter(d => d.value > 0);
  const schemeRoi = SCHEMES.map(s => {
    const rs = ranRows.filter(r => r.plan.scheme === s);
    const sp = rs.reduce((t, r) => t + r.spend, 0);
    return {
      label: s, spend: sp,
      actual: sp ? rs.reduce((t, r) => t + r.incrGrossProfit, 0) / sp : 0,
      planned: sp ? rs.reduce((t, r) => t + r.plan.expectedRoi * r.spend, 0) / sp : 0,
    };
  }).filter(x => x.spend > 0);
  const regionRows = REGIONS.map(g => {
    const rs = ranRows.filter(r => r.plan.region === g);
    return { label: g, spend: rs.reduce((t, r) => t + r.spend, 0), incr: rs.reduce((t, r) => t + r.incrRevenue, 0) };
  }).filter(x => x.spend > 0);
  const netByCampaign = ranRows.map(r => ({ label: r.plan.id.replace('CMP-', ''), net: r.netProfit })).sort((a, b) => b.net - a.net);
  const designMap = new Map<string, { n: number; gap: number }>();
  for (const r of completed) {
    const e = designMap.get(r.plan.designNote) ?? { n: 0, gap: 0 };
    e.n++; e.gap += (r.roi ?? 0) - r.plan.expectedRoi;
    designMap.set(r.plan.designNote, e);
  }
  const designLearn = [...designMap.entries()].map(([note, e]) => ({ label: `${note} (${e.n})`, gap: e.gap / e.n })).sort((a, b) => b.gap - a.gap);

  return (
    <>
      <TopBar title="Campaign Performance" subtitle="Execute · Learn — live campaign monitoring, plan vs actual, and what each campaign taught us" />
      <FilterBar>
        <FilterSelect label="Region" value={region} onChange={setRegion} options={[{ value: 'All', label: 'All Regions' }, ...REGIONS]} />
        <FilterSelect label="Customer segment" value={segment} onChange={setSegment} options={[{ value: 'All', label: 'All Segments' }, ...SEGMENTS]} />
        <FilterSelect label="Promotion scheme" value={scheme} onChange={setScheme} options={[{ value: 'All', label: 'All Schemes' }, ...SCHEMES]} />
        <FilterSelect label="Status" value={tab} onChange={v => setTab(v as Tab)} options={[{ value: 'all', label: 'All Statuses' }, 'Planned', 'Active', 'Completed']} />
      </FilterBar>

      <PageWrapper>
        {/* Live KPIs */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Active campaigns" value={String(liveShown.length)} sub={`Live · data through ${monthLabel(ds.latestMonth)}`} />
          <StatTile label="Avg health score" value={liveShown.length ? avgHealth.toFixed(0) : '—'} tone={liveShown.length ? (avgHealth >= 75 ? 'good' : 'bad') : undefined} sub="vs 82 when exactly on plan" />
          <StatTile label="Campaigns at risk" value={String(atRisk.length)} tone={atRisk.length ? 'bad' : 'good'} sub="Health below 75" />
          <StatTile label="Budget at risk" value={fmtL(budgetAtRisk)} tone={budgetAtRisk > 0 ? 'bad' : 'good'} sub="Planned spend still to come, on at-risk campaigns" />
        </div>

        {/* In-flight monitor */}
        <Card title="Active Campaign Monitor" subtitle="Live · click a row to inspect" action={<Tag tone="red">● Live</Tag>}>
          {liveShown.length === 0 ? <EmptyState title="No active campaigns match these filters" /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead><tr className="border-b border-slate-200"><Th>Campaign / scheme</Th><Th>Day</Th><Th>Delivery vs plan</Th><Th>Extra visits vs predicted</Th><Th>ROI (plan)</Th><Th>Health</Th><Th>Flags</Th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {liveShown.map(l => <LiveRow key={l.result.plan.id} l={l} active={selected?.plan.id === l.result.plan.id} onSelect={() => { setTab('all'); setSelectedId(l.result.plan.id); }} />)}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {liveShown.length > 0 && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Delivery Compliance — Active Campaigns" subtitle="Incremental revenue delivered so far as % of the plan to date (marker = 100% of plan)">
              <div className="space-y-4">
                {liveShown.map(l => (
                  <div key={l.result.plan.id}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="font-medium text-slate-700">{l.result.plan.name}</span>
                      <span className="text-slate-500">{l.result.plan.region} · D{l.day}/{l.totalDays} · <span className={l.deliveryPct >= 100 ? 'font-semibold text-emerald-600' : 'font-semibold text-amber-600'}>{fmtPct(l.deliveryPct, 1)} ({l.deliveryPct >= 100 ? '+' : '−'}{Math.abs(l.deliveryPct - 100).toFixed(1)}pp)</span></span>
                    </div>
                    <ProgressBar value={l.deliveryPct} max={125} marker={100} tone={l.deliveryPct >= 100 ? 'green' : l.deliveryPct >= 90 ? 'amber' : 'red'} />
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Health Score — Active Campaigns" subtitle="0–100 · 75 or above is healthy (marker at 75)">
              <HBarChart
                data={liveShown.map(l => ({ label: l.result.plan.name, value: l.health, color: l.band === 'Healthy' ? '#10b981' : l.band === 'Watch' ? '#f59e0b' : '#ef4444' }))}
                max={100} valueFormat={v => String(v)} target={{ value: 75, label: 'Healthy threshold (75)' }}
              />
              <p className="mt-3 text-[11px] leading-relaxed text-slate-400">Health = 40% ROI vs plan + 30% revenue delivery + 20% visit delivery + 10% spend pace. A campaign exactly on plan scores 82.</p>
            </Card>
          </div>
        )}

        {/* Queued from Planning */}
        <Card title="Queued for Launch" subtitle="Campaigns you accepted on the Planning page" action={<Button variant="secondary" className="!px-3 !py-1 text-xs" onClick={() => onNavigate('planning')}>Open Planning</Button>}>
          {queued.length === 0 ? <p className="text-sm text-slate-400">Nothing queued yet. Accept campaigns on the Planning page (or apply a simulation) and they will appear here.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead><tr className="border-b border-slate-100"><Th>Campaign</Th><Th>Start</Th><Th right>Budget</Th><Th right>Predicted ROI</Th><Th right>Predicted extra revenue</Th><Th right>Confidence</Th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {queued.map(r => (
                    <tr key={r.id}>
                      <td className="px-3 py-2.5"><div className="font-medium text-slate-700">{r.title}</div><div className="text-[10px] text-slate-400">{r.purpose}{r.applied ? ' · modified in Simulation' : ''}</div></td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-600">{fmtDate(r.startISO)} · {r.weeks}w</td>
                      <td className="px-3 py-2.5 text-right text-slate-700">{fmtL(r.eval.scenario.promoCost)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-slate-700">{fmtX(r.eval.scenario.roi)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-700">{fmtL(r.eval.scenario.incrRevenue)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-700">{r.eval.confidence}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Portfolio */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Invested to date" value={fmtL(portfolio.spend)} sub={`${ran.length} campaigns that have run`} />
          <StatTile label="Incremental revenue" value={fmtL(portfolio.incr)} />
          <StatTile label="Net profit after promotion" value={fmtL(portfolio.net)} tone={portfolio.net >= 0 ? 'good' : 'bad'} />
          <div title={ROI_DEFINITION}><StatTile label="Portfolio ROI" value={fmtX(portfolio.roi)} tone={portfolio.roi === null ? undefined : portfolio.roi >= ROI_TARGET ? 'good' : 'bad'} sub={`target ${fmtX(ROI_TARGET)} · ${beatPlan} of ${completedN} completed beat plan`} /></div>
        </div>

        {completed.length > 0 && (
          <Card title="ROI vs Plan — Completed Campaigns" subtitle="Actual ROI against the planned ROI for each completed campaign (campaign number on the axis; hover for details)">
            <BarChart
              data={completed.map(r => ({ label: r.plan.id.replace('CMP-', ''), actual: r.roi ?? 0, planned: r.plan.expectedRoi }))}
              xKey="label"
              series={[{ key: 'planned', label: 'Planned ROI', color: '#94a3b8' }, { key: 'actual', label: 'Actual ROI', color: '#0ea5e9' }]}
              height={240}
              valueFormat={v => v.toFixed(2)}
            />
          </Card>
        )}

        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Performance Analytics <span className="ml-2 text-xs font-normal text-slate-400">for the campaigns that match the filters above</span></h2>
          {ranRows.length === 0 ? <EmptyState title="No campaigns have run in this selection" detail="Widen the region, segment or scheme filters." /> : (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <Card title="Spend vs Incremental Revenue — Cumulative" subtitle="₹ lakh, running total by month · the widening gap is the value created">
                <LineChart data={cumulative} xKey="label" series={[{ key: 'incr', label: 'Incremental revenue', color: '#10b981' }, { key: 'spend', label: 'Promotion spend', color: '#f59e0b' }]} height={240} yMin="zero" yFormat={v => fmtL(v, 0)} />
              </Card>
              <Card title="Outcome Mix" subtitle="How the campaigns that have run compare with their own plan (±5% counts as on plan)">
                <DonutChart data={outcomeMix} centerValue={String(ranRows.length)} centerLabel="campaigns" height={190} />
              </Card>
              <Card title="Actual vs Planned ROI by Scheme" subtitle="Spend-weighted · schemes short of the planned bar are underdelivering">
                <BarChart data={schemeRoi} xKey="label" series={[{ key: 'planned', label: 'Planned ROI', color: '#94a3b8' }, { key: 'actual', label: 'Actual ROI', color: '#0ea5e9' }]} height={250} valueFormat={v => v.toFixed(2)} />
              </Card>
              <Card title="Plan Attainment per Campaign" subtitle="Expected (x) vs actual (y) incremental revenue to date, ₹ lakh · points above the diagonal beat their plan">
                <ScatterPlot
                  data={ranRows.map(r => ({ label: r.plan.name, x: r.expectedIncrRevenueToDate, y: r.incrRevenue, color: SCHEME_COLORS[r.plan.scheme] }))}
                  xLabel="Expected incremental revenue (₹L)" yLabel="Actual (₹L)" height={250} showLegend={false} xFormat={v => v.toFixed(0)} yFormat={v => v.toFixed(0)}
                />
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">{SCHEMES.map(s => <span key={s} className="flex items-center gap-1 text-[10px] text-slate-500"><span className="h-2 w-2 rounded-full" style={{ background: SCHEME_COLORS[s] }} />{s}</span>)}</div>
              </Card>
              <Card title="Net Profit by Campaign" subtitle="₹ lakh, incremental gross profit minus promotion spend · red bars lost money">
                <BarChart data={netByCampaign} xKey="label" series={[{ key: 'net', label: 'Net profit (₹L)', color: '#10b981' }]} height={240} showLegend={false} valueFormat={v => v.toFixed(1)} />
              </Card>
              <Card title="Spend and Return by Region" subtitle="₹ lakh · where promotion money went and what it brought back">
                <GroupedBarChart categories={regionRows.map(r => r.label)} series={[{ label: 'Promotion spend', values: regionRows.map(r => r.spend), color: '#f59e0b' }, { label: 'Incremental revenue', values: regionRows.map(r => r.incr), color: '#0ea5e9' }]} height={240} valueFormat={v => v.toFixed(0)} />
              </Card>
              {designLearn.length > 0 && (
                <Card title="What the Offer Design Taught Us" subtitle="Average ROI vs plan for completed campaigns, by offer design (n in brackets) · negative = fell short" className="xl:col-span-2">
                  <BarChart data={designLearn} xKey="label" series={[{ key: 'gap', label: 'ROI vs plan (x)', color: '#8b5cf6' }]} height={250} showLegend={false} valueFormat={v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`} />
                </Card>
              )}
            </div>
          )}
        </div>

        <Card title="Campaign Portfolio" subtitle="Actuals are summed from the same performance data as the Dashboard">
          <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-100" role="tablist">
            {tabs.map(t => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors ${tab === t.key ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {t.label} <span className="ml-1 text-xs text-slate-400">{t.n}</span>
              </button>
            ))}
          </div>
          {filtered.length === 0 ? <EmptyState title="No campaigns match these filters" detail="Try another status tab, region, segment or scheme." /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead><tr className="border-b border-slate-200"><Th>Campaign</Th><Th>Scheme</Th><Th>Period</Th><Th>Target</Th><Th right>Spend / plan</Th><Th right>Incr. revenue</Th><Th right>ROI (plan)</Th><Th right>Status</Th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(r => {
                    const active = selected?.plan.id === r.plan.id;
                    const ranR = r.plan.status !== 'Planned';
                    return (
                      <tr key={r.plan.id} onClick={() => setSelectedId(r.plan.id)} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setSelectedId(r.plan.id)} tabIndex={0} aria-selected={active}
                        className={`cursor-pointer transition-colors hover:bg-slate-50/70 focus:outline-none focus-visible:bg-sky-50 ${active ? 'bg-sky-50/60' : ''}`}>
                        <td className="px-3 py-2.5"><div className="font-medium text-slate-700">{r.plan.name}</div><div className="text-[10px] text-slate-400">{r.plan.id}</div></td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">{r.plan.scheme}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-600">{periodText(r)}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">{r.plan.region} · {r.plan.segment}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-600">{ranR ? fmtL(r.spend) : '—'} <span className="text-xs text-slate-400">/ {fmtL(r.plan.investment)}</span></td>
                        <td className="px-3 py-2.5 text-right text-slate-600">{ranR ? fmtL(r.incrRevenue) : '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right">
                          {ranR && r.roi !== null ? <span className={`font-semibold ${r.roi >= r.plan.expectedRoi ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtX(r.roi)}</span> : <span className="text-slate-400">—</span>}
                          <span className="text-xs text-slate-400"> ({fmtX(r.plan.expectedRoi)})</span>
                        </td>
                        <td className="px-3 py-2.5 text-right"><StatusBadge status={r.plan.status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {selected && <CampaignDetail r={selected} />}
      </PageWrapper>
    </>
  );
}

// ------------------------------------------------------------

function LiveRow({ l, active, onSelect }: { l: LiveCampaign; active: boolean; onSelect: () => void }) {
  const p = l.result.plan;
  const bandStyle = l.band === 'Healthy' ? 'bg-emerald-50 text-emerald-700' : l.band === 'Watch' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700';
  return (
    <tr onClick={onSelect} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onSelect()} tabIndex={0} className={`cursor-pointer align-middle hover:bg-slate-50/70 focus:outline-none focus-visible:bg-sky-50 ${active ? 'bg-sky-50/60' : ''}`}>
      <td className="px-3 py-3"><div className="font-medium text-slate-800">{p.name}</div><div className="text-[10px] text-slate-400">{p.region} · {p.segment} · {p.scheme}</div></td>
      <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">D{l.day} <span className="text-slate-400">of {l.totalDays}</span></td>
      <td className="w-48 px-3 py-3">
        <div className="flex items-center gap-2"><div className="flex-1"><ProgressBar value={l.deliveryPct} max={125} marker={100} tone={l.deliveryPct >= 100 ? 'green' : l.deliveryPct >= 90 ? 'amber' : 'red'} /></div><span className="w-12 text-right text-xs font-semibold text-slate-700">{fmtPct(l.deliveryPct, 1)}</span></div>
        <div className="mt-0.5 text-[10px] text-slate-400">plan 100% · spend pace {fmtPct(l.pacePct, 0)}</div>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-xs"><div className="font-semibold text-slate-800">{fmtInt(l.result.incrVisits)}</div><div className={l.visitsVsPredPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{l.visitsVsPredPct >= 0 ? '+' : '−'}{Math.abs(l.visitsVsPredPct).toFixed(1)}% vs pred</div></td>
      <td className="whitespace-nowrap px-3 py-3 text-xs"><span className={`font-semibold ${l.roi >= p.expectedRoi ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtX(l.roi)}</span> <span className="text-slate-400">({fmtX(p.expectedRoi)})</span></td>
      <td className="px-3 py-3"><span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${bandStyle}`}>{l.health} · {l.band}</span></td>
      <td className="px-3 py-3"><div className="flex flex-wrap gap-1">{l.flags.length ? l.flags.map(f => <Tag key={f} tone={f === 'Competitor' ? 'amber' : 'red'}>{f === 'Competitor' && <Swords className="h-3 w-3" />}{f}</Tag>) : <span className="text-slate-300">—</span>}</div></td>
    </tr>
  );
}

function CampaignDetail({ r }: { r: CampaignResult }) {
  const { plan } = r;
  const learning = campaignLearning(ds, r);
  const ranC = plan.status !== 'Planned';
  const toDate = plan.status === 'Active' ? ' (to date)' : '';
  const paceBase = plan.status === 'Active' ? r.expectedSpendToDate : plan.investment;
  const util = paceBase ? Math.min((r.spend / paceBase) * 100, 150) : 0;
  const mp = marketPosition(bm, plan.scheme, plan.region);
  const tone = { positive: 'border-emerald-200 bg-emerald-50 text-emerald-800', negative: 'border-rose-200 bg-rose-50 text-rose-800', neutral: 'border-violet-200 bg-violet-50 text-violet-800' }[learning.tone];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card title={`Campaign Detail: ${plan.name}`} subtitle={`${plan.id} · ${plan.scheme} · ${plan.region} · ${plan.segment} · ${periodText(r)}`}>
          {ranC ? (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <CompareTile label={`Incremental revenue${toDate}`} expected={fmtL(r.expectedIncrRevenueToDate)} actual={fmtL(r.incrRevenue)} good={r.incrRevenue >= r.expectedIncrRevenueToDate} />
                <CompareTile label={`Incremental visits${toDate}`} expected={fmtInt(r.expectedIncrVisitsToDate)} actual={fmtInt(r.incrVisits)} good={r.incrVisits >= r.expectedIncrVisitsToDate} />
                <CompareTile label={`Net profit${toDate}`} expected={fmtL(r.expectedNetProfitToDate)} actual={fmtL(r.netProfit)} good={r.netProfit >= r.expectedNetProfitToDate} />
                <CompareTile label="ROI" expected={fmtX(plan.expectedRoi)} actual={fmtX(r.roi)} good={(r.roi ?? 0) >= plan.expectedRoi} />
              </div>
              {plan.status === 'Active' && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Active campaign: {r.elapsedMonths} of {r.totalMonths} months have run (data through {monthLabel(ds.latestMonth)}). Expected values are scaled to the part of the campaign completed.</p>
              )}
              <div>
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Expected vs actual{toDate}</h4>
                <BarChart
                  data={[{ label: 'Incremental revenue', expected: r.expectedIncrRevenueToDate, actual: r.incrRevenue }, { label: 'Net profit', expected: r.expectedNetProfitToDate, actual: r.netProfit }]}
                  xKey="label" series={[{ key: 'expected', label: 'Expected', color: '#94a3b8' }, { key: 'actual', label: 'Actual', color: '#0ea5e9' }]} height={220} valueFormat={v => fmtL(v)}
                />
              </div>
              <div>
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Month by month</h4>
                <BarChart
                  data={r.monthly.map(m => ({ label: monthShort(m.month), spend: m.spend, incr: m.incrRevenue }))} xKey="label"
                  series={[{ key: 'spend', label: 'Promotion spend', color: '#f59e0b' }, { key: 'incr', label: 'Incremental revenue', color: '#10b981' }]} height={200} valueFormat={v => v.toFixed(1)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <PlanTile label="Planned investment" value={fmtL(plan.investment)} />
                <PlanTile label="Expected incr. revenue" value={fmtL(plan.expectedIncrRevenue)} />
                <PlanTile label="Expected incr. visits" value={fmtInt(plan.expectedIncrVisits)} />
                <PlanTile label="Expected ROI" value={fmtX(plan.expectedRoi)} />
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3"><Clock className="h-4 w-4 shrink-0 text-amber-600" /><span className="text-sm text-amber-700">Planned for {periodText(r)} — no actuals yet. Results appear here once the campaign starts.</span></div>
            </div>
          )}
        </Card>
      </div>

      <div>
        <Card title="Campaign Learning" subtitle="Generated from plan vs actual">
          <div className={`rounded-lg border p-4 ${tone}`}>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Lightbulb className="h-4 w-4" />{learning.headline}</div>
            <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed">{learning.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </div>
          {ranC && (
            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between text-sm"><span className="text-slate-500">{plan.status === 'Active' ? 'Spend vs planned pace' : 'Budget utilisation'}</span><span className="font-semibold text-slate-700">{util.toFixed(0)}%</span></div>
              <ProgressBar value={util} max={100} />
              <div className="mt-1 text-[10px] text-slate-400">{fmtL(r.spend)} spent of {fmtL(paceBase)}{plan.status === 'Active' ? ' planned to date' : ' planned'}</div>
            </div>
          )}
          <div className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm">
            <Line icon={Target} label="Target" value={`${plan.region} · ${plan.segment}`} />
            <Line icon={IndianRupee} label="Offer design" value={plan.designNote} />
            {mp && <Line icon={Swords} label="Market" value={`${mp.medianDepth.toFixed(1)}% vs our ${OUR_TERMS[plan.scheme].depthPct}% (${mp.position.toLowerCase()})`} />}
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-slate-500"><TrendingUp className="h-3.5 w-3.5" /> ROI vs plan</span>
              {ranC && r.roi !== null ? (
                <span className={`flex items-center gap-1 font-medium ${r.roi >= plan.expectedRoi ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {r.roi >= plan.expectedRoi ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}{r.roi >= plan.expectedRoi ? 'Above' : 'Below'} plan
                </span>
              ) : <span className="text-slate-400">—</span>}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Line({ icon: Icon, label, value }: { icon: ComponentType<LucideProps>; label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="flex shrink-0 items-center gap-1.5 text-slate-500"><Icon className="h-3.5 w-3.5" /> {label}</span>
      <span className="text-right font-medium text-slate-700">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: CampaignStatus }) {
  const map = { Planned: 'info', Active: 'warning', Completed: 'success' } as const;
  return <Badge variant={map[status]}>{status}</Badge>;
}

function CompareTile({ label, expected, actual, good }: { label: string; expected: string; actual: string; good: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="flex items-center gap-2">
        <div><div className="text-[10px] text-slate-400">Expected</div><div className="text-sm font-medium text-slate-600">{expected}</div></div>
        <div className="text-slate-300">→</div>
        <div><div className="text-[10px] text-slate-400">Actual</div><div className={`text-sm font-bold ${good ? 'text-emerald-600' : 'text-rose-600'}`}>{actual}</div></div>
      </div>
    </div>
  );
}

function PlanTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm font-bold text-slate-700">{value}</div>
    </div>
  );
}
