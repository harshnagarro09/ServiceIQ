import { useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { Card, Badge, Button, EmptyState, PageWrapper, TopBar, type PageKey } from '@/components/Layout';
import { BarChart, DonutChart, GroupedBarChart, LineChart } from '@/components/Charts';
import { FilterBar, FilterSelect, ProgressBar, Tag, Th } from '@/components/ui';
import { benchmark as bm, dataset as ds } from '@/data/dataset';
import { campaignResults, type CampaignResult } from '@/lib/analytics';
import { marketPosition, OUR_TERMS } from '@/lib/benchmark';
import { REGIONS, ROI_DEFINITION, ROI_TARGET, SCHEMES, SEGMENTS } from '@/lib/constants';
import { campaignLearning } from '@/lib/insights';
import { fmtInt, fmtL, fmtPct, fmtX, monthLabel, monthShort } from '@/lib/format';
import { fmtDate, monitorCampaigns, recommendCampaigns, type Decisions, type LiveCampaign } from '@/lib/planner';
import type { Plan } from '@/lib/simulation';
import type { CampaignStatus } from '@/lib/types';
import { Activity, CheckCircle2, Clock, Lightbulb, Rocket, Swords, Target, TrendingDown, TrendingUp, type LucideProps } from 'lucide-react';

type View = 'live' | 'results' | 'learned' | 'all';
type StatusTab = 'all' | CampaignStatus;

const periodText = (r: CampaignResult) =>
  r.plan.startMonth === r.plan.endMonth ? monthLabel(r.plan.startMonth) : `${monthLabel(r.plan.startMonth)} – ${monthLabel(r.plan.endMonth)}`;

const OUTCOME_COLORS: Record<string, string> = { 'Beat plan': '#10b981', 'On plan': '#0ea5e9', 'Below plan': '#f59e0b', 'Lost money': '#ef4444' };
const outcomeOf = (r: CampaignResult) => {
  const roi = r.roi ?? 0;
  return roi < 1 ? 'Lost money' : roi >= r.plan.expectedRoi * 1.05 ? 'Beat plan' : roi >= r.plan.expectedRoi * 0.95 ? 'On plan' : 'Below plan';
};

interface Props { plan: Plan; decisions: Decisions; onNavigate: (p: PageKey) => void }

export function CampaignPerformancePage({ plan, decisions, onNavigate }: Props) {
  const all = useMemo(() => campaignResults(ds), []);
  const live = useMemo(() => monitorCampaigns(ds, bm), []);
  const queued = useMemo(() => recommendCampaigns(ds, bm, plan, decisions).recs.filter(r => decisions[r.id]?.status === 'Accepted'), [plan, decisions]);

  const [view, setView] = useState<View>('live');
  const [region, setRegion] = useState('All');
  const [segment, setSegment] = useState('All');
  const [scheme, setScheme] = useState('All');
  const [status, setStatus] = useState<StatusTab>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const match = (c: { region: string; segment: string; scheme: string }) =>
    (region === 'All' || c.region === region) && (segment === 'All' || c.segment === segment) && (scheme === 'All' || c.scheme === scheme);
  const base = all.filter(r => match(r.plan));
  const liveShown = live.filter(l => match(l.result.plan));
  const ran = base.filter(r => r.plan.status !== 'Planned' && r.spend > 0);
  const completed = ran.filter(r => r.plan.status === 'Completed' && r.roi !== null).sort((a, b) => a.plan.startMonth.localeCompare(b.plan.startMonth));

  // ---------- headline numbers
  const spend = ran.reduce((s, r) => s + r.spend, 0);
  const gp = ran.reduce((s, r) => s + r.incrGrossProfit, 0);
  const roi = spend ? gp / spend : null;
  const avgHealth = liveShown.length ? liveShown.reduce((s, l) => s + l.health, 0) / liveShown.length : null;
  const atRisk = liveShown.filter(l => l.band !== 'Healthy');
  const budgetAtRisk = liveShown.reduce((s, l) => s + l.budgetAtRisk, 0);

  // ---------- analytics
  let cumSpend = 0, cumIncr = 0;
  const cumulative = ds.months.map(m => {
    for (const r of ran) {
      const p = r.monthly.find(x => x.month === m);
      if (p) { cumSpend += p.spend; cumIncr += p.incrRevenue; }
    }
    return { label: monthShort(m), spend: cumSpend, incr: cumIncr };
  });
  const outcomeMix = Object.keys(OUTCOME_COLORS).map(k => ({ label: k, value: ran.filter(r => outcomeOf(r) === k).length, color: OUTCOME_COLORS[k] })).filter(d => d.value > 0);
  const schemeRoi = SCHEMES.map(s => {
    const rs = ran.filter(r => r.plan.scheme === s);
    const sp = rs.reduce((t, r) => t + r.spend, 0);
    return { label: s, spend: sp, actual: sp ? rs.reduce((t, r) => t + r.incrGrossProfit, 0) / sp : 0, planned: sp ? rs.reduce((t, r) => t + r.plan.expectedRoi * r.spend, 0) / sp : 0 };
  }).filter(x => x.spend > 0);
  const regionRows = REGIONS.map(g => {
    const rs = ran.filter(r => r.plan.region === g);
    return { label: g, spend: rs.reduce((t, r) => t + r.spend, 0), incr: rs.reduce((t, r) => t + r.incrRevenue, 0) };
  }).filter(x => x.spend > 0);
  const designMap = new Map<string, { n: number; gap: number }>();
  for (const r of completed) {
    const e = designMap.get(r.plan.designNote) ?? { n: 0, gap: 0 };
    e.n++; e.gap += (r.roi ?? 0) - r.plan.expectedRoi;
    designMap.set(r.plan.designNote, e);
  }
  const designLearn = [...designMap.entries()].map(([note, e]) => ({ label: `${note} (${e.n})`, note, n: e.n, gap: e.gap / e.n })).sort((a, b) => b.gap - a.gap);

  // ---------- three plain-language takeaways
  const gapByScheme = schemeRoi.map(s => ({ ...s, gap: s.actual - s.planned })).sort((a, b) => b.gap - a.gap);
  const beat = ran.filter(r => outcomeOf(r) === 'Beat plan').length;
  const lost = ran.filter(r => outcomeOf(r) === 'Lost money').length;
  const takeaways: { icon: ComponentType<LucideProps>; tone: string; title: string; text: string }[] = [];
  if (ran.length) {
    takeaways.push({ icon: CheckCircle2, tone: 'text-emerald-600', title: 'Programme result', text: `${beat} of ${ran.length} campaigns beat their plan${lost ? `; ${lost} lost money` : ''}. Portfolio ROI is ${fmtX(roi)} against a ${fmtX(ROI_TARGET)} target.` });
  }
  if (gapByScheme.length > 1) {
    const best = gapByScheme[0], worst = gapByScheme[gapByScheme.length - 1];
    takeaways.push({ icon: TrendingUp, tone: 'text-sky-600', title: 'Scheme gap to plan', text: `${best.label} runs ${best.gap >= 0 ? '+' : '−'}${Math.abs(best.gap).toFixed(2)}x vs plan; ${worst.label} ${worst.gap >= 0 ? '+' : '−'}${Math.abs(worst.gap).toFixed(2)}x.` });
  }
  takeaways.push({
    icon: Activity, tone: atRisk.length ? 'text-amber-600' : 'text-emerald-600', title: 'Live campaigns',
    text: liveShown.length ? (atRisk.length ? `${atRisk.length} of ${liveShown.length} live campaigns need attention (${fmtL(budgetAtRisk)} of planned spend at risk).` : `All ${liveShown.length} live campaigns are healthy.`) : 'No live campaigns match these filters.',
  });

  // ---------- portfolio list
  const counts = { Planned: 0, Active: 0, Completed: 0 } as Record<CampaignStatus, number>;
  for (const r of base) counts[r.plan.status]++;
  const list = (status === 'all' ? base : base.filter(r => r.plan.status === status)).slice().sort((a, b) => b.plan.startMonth.localeCompare(a.plan.startMonth) || a.plan.id.localeCompare(b.plan.id));
  const selected = list.find(r => r.plan.id === selectedId) ?? null;

  const views: { key: View; label: string; hint: string }[] = [
    { key: 'live', label: 'Live campaigns', hint: `${liveShown.length} running` },
    { key: 'results', label: 'Results', hint: 'plan vs actual' },
    { key: 'learned', label: 'What we learned', hint: 'schemes and design' },
    { key: 'all', label: 'All campaigns', hint: `${base.length} in total` },
  ];

  const openCampaign = (id: string) => { setStatus('all'); setSelectedId(id); setView('all'); };

  return (
    <>
      <TopBar title="Campaign Performance" subtitle="Execute · Learn — are live campaigns healthy, and what have past ones taught us?" />
      <FilterBar>
        <FilterSelect label="Region" value={region} onChange={setRegion} options={[{ value: 'All', label: 'All Regions' }, ...REGIONS]} />
        <FilterSelect label="Customer segment" value={segment} onChange={setSegment} options={[{ value: 'All', label: 'All Segments' }, ...SEGMENTS]} />
        <FilterSelect label="Promotion scheme" value={scheme} onChange={setScheme} options={[{ value: 'All', label: 'All Schemes' }, ...SCHEMES]} />
      </FilterBar>

      <PageWrapper>
        {/* Summary strip */}
        <div className="grid grid-cols-2 divide-slate-100 rounded-xl border border-slate-200 bg-white sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
          <Summary label="Live campaigns" value={String(liveShown.length)} desc="Campaigns running right now." />
          <Summary label="Avg health" value={avgHealth === null ? '—' : avgHealth.toFixed(0)} tone={avgHealth === null ? undefined : avgHealth >= 75 ? 'good' : 'bad'} desc="Score out of 100 for live campaigns. 75 or more is healthy; 82 means exactly on plan." />
          <Summary label="Need attention" value={String(atRisk.length)} tone={atRisk.length ? 'bad' : 'good'} desc="Live campaigns scoring below 75 that need a closer look." sub={budgetAtRisk > 0 ? `${fmtL(budgetAtRisk)} of planned spend at risk` : undefined} />
          <Summary label="Invested to date" value={fmtL(spend)} desc="Promotion money spent so far on campaigns that have run." sub={`${ran.length} campaigns`} />
          <Summary label="Portfolio ROI" value={fmtX(roi)} tone={roi === null ? undefined : roi >= ROI_TARGET ? 'good' : 'bad'} desc="Extra gross profit earned per ₹1 spent. 1.0x is break-even." sub={`target ${fmtX(ROI_TARGET)}`} hint={ROI_DEFINITION} />
        </div>

        {/* Takeaways */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {takeaways.map(t => {
            const Icon = t.icon;
            return (
              <div key={t.title} className="flex gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5">
                <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${t.tone}`} />
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t.title}</div>
                  <p className="mt-0.5 text-sm leading-snug text-slate-700">{t.text}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* View switcher */}
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="Campaign views">
          {views.map(v => (
            <button key={v.key} type="button" role="tab" aria-selected={view === v.key} onClick={() => setView(v.key)}
              className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-left transition-colors ${view === v.key ? 'border-sky-500' : 'border-transparent hover:border-slate-300'}`}>
              <span className={`block text-sm font-semibold ${view === v.key ? 'text-sky-700' : 'text-slate-600'}`}>{v.label}</span>
              <span className="block text-[10px] text-slate-400">{v.hint}</span>
            </button>
          ))}
        </div>

        {/* ---------- LIVE ---------- */}
        {view === 'live' && (
          <div className="space-y-6">
            {liveShown.length === 0 ? <EmptyState title="No live campaigns match these filters" detail="Change the region, segment or scheme filter." /> : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {liveShown.map(l => <LiveCard key={l.result.plan.id} l={l} onOpen={() => openCampaign(l.result.plan.id)} />)}
              </div>
            )}
            <Card title="Queued for Launch" subtitle="Campaigns you accepted on the Planning page" action={<Button variant="secondary" className="!px-3 !py-1 text-xs" onClick={() => onNavigate('planning')}>Open Planning</Button>}>
              {queued.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-slate-400"><Rocket className="h-4 w-4" />Nothing queued yet. Accept campaigns on Planning (or apply a simulation) and they will appear here.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {queued.map(r => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                      <div><span className="font-medium text-slate-700">{r.title}</span>{r.applied && <span className="ml-2"><Tag tone="violet">Modified</Tag></span>}<div className="text-[11px] text-slate-400">{r.purpose} · starts {fmtDate(r.startISO)} · {r.weeks}w</div></div>
                      <div className="text-right text-xs text-slate-500"><span className="font-semibold text-slate-700">{fmtL(r.eval.scenario.promoCost)}</span> · predicted {fmtX(r.eval.scenario.roi)} ROI · {r.eval.confidence}% confidence</div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}

        {/* ---------- RESULTS ---------- */}
        {view === 'results' && (
          ran.length === 0 ? <EmptyState title="No campaigns have run in this selection" detail="Widen the region, segment or scheme filters." /> : (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <Card title="ROI vs Plan" subtitle="Completed campaigns · planned against actual ROI (campaign number on the axis)">
                <BarChart data={completed.map(r => ({ label: r.plan.id.replace('CMP-', ''), actual: r.roi ?? 0, planned: r.plan.expectedRoi }))} xKey="label"
                  series={[{ key: 'planned', label: 'Planned', color: '#cbd5e1' }, { key: 'actual', label: 'Actual', color: '#0ea5e9' }]} height={250} valueFormat={v => v.toFixed(2)} />
              </Card>
              <Card title="How Campaigns Compare With Their Plan" subtitle="±5% of planned ROI counts as on plan">
                <DonutChart data={outcomeMix} centerValue={String(ran.length)} centerLabel="campaigns" height={190} />
              </Card>
              <Card title="Spend vs Incremental Revenue" subtitle="₹ lakh, running total by month">
                <LineChart data={cumulative} xKey="label" series={[{ key: 'incr', label: 'Incremental revenue', color: '#10b981' }, { key: 'spend', label: 'Promotion spend', color: '#f59e0b' }]} height={230} yMin="zero" yFormat={v => fmtL(v, 0)} />
              </Card>
              <Card title="Spend and Return by Region" subtitle="₹ lakh · where promotion money went and what it brought back">
                <GroupedBarChart categories={regionRows.map(r => r.label)} series={[{ label: 'Promotion spend', values: regionRows.map(r => r.spend), color: '#f59e0b' }, { label: 'Incremental revenue', values: regionRows.map(r => r.incr), color: '#0ea5e9' }]} height={230} valueFormat={v => v.toFixed(0)} />
              </Card>
            </div>
          )
        )}

        {/* ---------- LEARNED ---------- */}
        {view === 'learned' && (
          ran.length === 0 ? <EmptyState title="Nothing to learn from yet" detail="No campaigns have run in this selection." /> : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <Card title="Which Schemes Beat Their Plan" subtitle="Spend-weighted planned vs actual ROI">
                  <BarChart data={schemeRoi} xKey="label" series={[{ key: 'planned', label: 'Planned', color: '#cbd5e1' }, { key: 'actual', label: 'Actual', color: '#0ea5e9' }]} height={250} valueFormat={v => v.toFixed(2)} />
                </Card>
                <Card title="What the Offer Design Taught Us" subtitle="Average ROI vs plan by offer design · negative = fell short (campaigns in brackets)">
                  {designLearn.length ? <BarChart data={designLearn} xKey="label" series={[{ key: 'gap', label: 'ROI vs plan (x)', color: '#8b5cf6' }]} height={250} showLegend={false} valueFormat={v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`} /> : <EmptyState title="No completed campaigns" />}
                </Card>
              </div>
              {designLearn.length > 0 && (
                <Card title="Lessons to Carry Into the Next Plan">
                  <ul className="space-y-2.5 text-sm text-slate-700">
                    {designLearn.filter(d => d.gap <= -0.1).slice(-3).reverse().map(d => (
                      <li key={d.note} className="flex gap-2"><TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" /><span><strong>Rethink:</strong> “{d.note}” — {d.n} campaign{d.n === 1 ? '' : 's'} averaged {Math.abs(d.gap).toFixed(2)}x below plan.</span></li>
                    ))}
                    {designLearn.filter(d => d.gap >= 0.1).slice(0, 2).map(d => (
                      <li key={d.note} className="flex gap-2"><TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /><span><strong>Repeat:</strong> “{d.note}” — {d.n} campaign{d.n === 1 ? '' : 's'} averaged {d.gap.toFixed(2)}x above plan.</span></li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          )
        )}

        {/* ---------- ALL ---------- */}
        {view === 'all' && (
          <div className="space-y-6">
            <Card title="All Campaigns" subtitle="Click a row for the details and the learning">
              <div className="mb-4 flex flex-wrap gap-2">
                {([['all', 'All', base.length], ['Planned', 'Planned', counts.Planned], ['Active', 'Active', counts.Active], ['Completed', 'Completed', counts.Completed]] as [StatusTab, string, number][]).map(([k, label, n]) => (
                  <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${status === k ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>{label} <span className="opacity-60">{n}</span></button>
                ))}
              </div>
              {list.length === 0 ? <EmptyState title="No campaigns match these filters" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead><tr className="border-b border-slate-200"><Th>Campaign</Th><Th>Target</Th><Th>Period</Th><Th right>ROI (plan)</Th><Th right>Status</Th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {list.map(r => {
                        const active = selected?.plan.id === r.plan.id;
                        const hasRun = r.plan.status !== 'Planned';
                        return (
                          <tr key={r.plan.id} onClick={() => setSelectedId(r.plan.id)} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setSelectedId(r.plan.id)} tabIndex={0} aria-selected={active}
                            className={`cursor-pointer transition-colors hover:bg-slate-50 focus:outline-none focus-visible:bg-sky-50 ${active ? 'bg-sky-50/70' : ''}`}>
                            <td className="px-3 py-3"><div className="font-medium text-slate-800">{r.plan.name}</div><div className="text-[11px] text-slate-400">{r.plan.scheme}</div></td>
                            <td className="px-3 py-3 text-xs text-slate-600">{r.plan.region} · {r.plan.segment}</td>
                            <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">{periodText(r)}</td>
                            <td className="whitespace-nowrap px-3 py-3 text-right">
                              {hasRun && r.roi !== null ? <span className={`font-semibold ${r.roi >= r.plan.expectedRoi ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtX(r.roi)}</span> : <span className="text-slate-300">—</span>}
                              <span className="text-xs text-slate-400"> ({fmtX(r.plan.expectedRoi)})</span>
                            </td>
                            <td className="px-3 py-3 text-right"><StatusBadge status={r.plan.status} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            {selected ? <CampaignDetail r={selected} /> : list.length > 0 && <p className="text-center text-sm text-slate-400">Select a campaign above to see its results and what it taught us.</p>}
          </div>
        )}
      </PageWrapper>
    </>
  );
}

// ------------------------------------------------------------

function Summary({ label, value, desc, sub, tone, hint }: { label: string; value: string; desc: string; sub?: string; tone?: 'good' | 'bad'; hint?: string }) {
  return (
    <div className="px-5 py-4" title={hint}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold tracking-tight ${tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-rose-600' : 'text-slate-900'}`}>{value}</div>
      <p className="mt-1 text-[11px] leading-snug text-slate-500">{desc}</p>
      {sub && <div className="mt-0.5 text-[11px] font-medium text-slate-400">{sub}</div>}
    </div>
  );
}

/** One live campaign as a card: health, three numbers, delivery bar and what to do about it. */
function LiveCard({ l, onOpen }: { l: LiveCampaign; onOpen: () => void }) {
  const p = l.result.plan;
  const band = l.band === 'Healthy' ? { pill: 'bg-emerald-50 text-emerald-700', bar: 'green' as const } : l.band === 'Watch' ? { pill: 'bg-amber-50 text-amber-700', bar: 'amber' as const } : { pill: 'bg-rose-50 text-rose-700', bar: 'red' as const };
  const notes: string[] = [];
  if (l.flags.includes('Underperform')) notes.push(`Delivery is ${fmtPct(l.deliveryPct, 0)} of plan — tighten targeting or extend outreach.`);
  if (l.flags.includes('Below ROI plan')) notes.push('ROI is under plan — review the offer design.');
  if (l.flags.includes('Overspend')) notes.push('Spend is ahead of pace — cap the budget.');
  if (l.flags.includes('Underspend')) notes.push('Spend is behind pace — check redemption friction.');
  if (!notes.length) notes.push('On track — no action needed.');
  const competitor = l.flags.includes('Competitor');
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-800">{p.name}</h3>
          <p className="mt-0.5 text-[11px] text-slate-400">{p.region} · {p.segment} · {p.scheme}</p>
        </div>
        <span className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold ${band.pill}`}>{l.health}<span className="ml-1 font-medium">{l.band}</span></span>
      </div>

      <div className="mt-4">
        <div className="mb-1 flex justify-between text-xs"><span className="text-slate-500">Delivery vs plan · day {l.day} of {l.totalDays}</span><span className="font-semibold text-slate-700">{fmtPct(l.deliveryPct, 0)}</span></div>
        <ProgressBar value={l.deliveryPct} max={125} marker={100} tone={band.bar} />
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Mini label="ROI" value={fmtX(l.roi)} sub={`plan ${fmtX(p.expectedRoi)}`} bad={l.roi < p.expectedRoi * 0.95} />
        <Mini label="Extra visits" value={fmtInt(l.result.incrVisits)} sub={`${l.visitsVsPredPct >= 0 ? '+' : '−'}${Math.abs(l.visitsVsPredPct).toFixed(0)}% vs pred`} bad={l.visitsVsPredPct < -10} />
        <Mini label="Spend pace" value={fmtPct(l.pacePct, 0)} sub="of plan" bad={l.pacePct > 115 || l.pacePct < 70} />
      </dl>

      <ul className="mt-4 flex-1 space-y-1 text-xs leading-snug text-slate-600">
        {notes.map(n => <li key={n} className="flex gap-1.5"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />{n}</li>)}
      </ul>
      {competitor && <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-700"><Swords className="h-3.5 w-3.5" />Competitors run deeper offers in {p.region}.</p>}
      <button type="button" onClick={onOpen} className="mt-4 self-start text-xs font-semibold text-sky-600 hover:text-sky-800">View details →</button>
    </div>
  );
}

function Mini({ label, value, sub, bad }: { label: string; value: string; sub: string; bad?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`text-base font-bold ${bad ? 'text-rose-600' : 'text-slate-800'}`}>{value}</dd>
      <div className="text-[10px] text-slate-400">{sub}</div>
    </div>
  );
}

function CampaignDetail({ r }: { r: CampaignResult }) {
  const { plan } = r;
  const learning = campaignLearning(ds, r);
  const hasRun = plan.status !== 'Planned';
  const toDate = plan.status === 'Active' ? ' (to date)' : '';
  const mp = marketPosition(bm, plan.scheme, plan.region);
  const tone = { positive: 'border-emerald-200 bg-emerald-50 text-emerald-800', negative: 'border-rose-200 bg-rose-50 text-rose-800', neutral: 'border-violet-200 bg-violet-50 text-violet-800' }[learning.tone];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <Card title={plan.name} subtitle={`${plan.id} · ${plan.scheme} · ${plan.region} · ${plan.segment} · ${periodText(r)}`}>
          {hasRun ? (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Compare label={`Extra revenue${toDate}`} expected={fmtL(r.expectedIncrRevenueToDate)} actual={fmtL(r.incrRevenue)} good={r.incrRevenue >= r.expectedIncrRevenueToDate} />
                <Compare label={`Extra visits${toDate}`} expected={fmtInt(r.expectedIncrVisitsToDate)} actual={fmtInt(r.incrVisits)} good={r.incrVisits >= r.expectedIncrVisitsToDate} />
                <Compare label={`Net profit${toDate}`} expected={fmtL(r.expectedNetProfitToDate)} actual={fmtL(r.netProfit)} good={r.netProfit >= r.expectedNetProfitToDate} />
                <Compare label="ROI" expected={fmtX(plan.expectedRoi)} actual={fmtX(r.roi)} good={(r.roi ?? 0) >= plan.expectedRoi} />
              </div>
              {plan.status === 'Active' && <p className="text-xs text-amber-700">Active: {r.elapsedMonths} of {r.totalMonths} months have run, so expected values are scaled to the part completed.</p>}
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Month by month</h4>
                <BarChart data={r.monthly.map(m => ({ label: monthShort(m.month), spend: m.spend, incr: m.incrRevenue }))} xKey="label"
                  series={[{ key: 'spend', label: 'Promotion spend', color: '#f59e0b' }, { key: 'incr', label: 'Incremental revenue', color: '#10b981' }]} height={190} valueFormat={v => v.toFixed(1)} />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Plain label="Planned investment" value={fmtL(plan.investment)} />
                <Plain label="Expected extra revenue" value={fmtL(plan.expectedIncrRevenue)} />
                <Plain label="Expected extra visits" value={fmtInt(plan.expectedIncrVisits)} />
                <Plain label="Expected ROI" value={fmtX(plan.expectedRoi)} />
              </div>
              <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700"><Clock className="h-4 w-4 shrink-0" />Planned for {periodText(r)} — no results yet.</p>
            </div>
          )}
        </Card>
      </div>

      <div className="space-y-6 lg:col-span-2">
        <Card title="What it taught us">
          <div className={`rounded-lg border p-4 ${tone}`}>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Lightbulb className="h-4 w-4" />{learning.headline}</div>
            <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed">{learning.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </div>
          <dl className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm">
            <Fact icon={Target} label="Offer design" value={plan.designNote} />
            {mp && <Fact icon={Swords} label="Market" value={`${mp.medianDepth.toFixed(1)}% vs our ${OUR_TERMS[plan.scheme].depthPct}% (${mp.position.toLowerCase()})`} />}
          </dl>
        </Card>
      </div>
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon: ComponentType<LucideProps>; label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="flex shrink-0 items-center gap-1.5 text-slate-500"><Icon className="h-3.5 w-3.5" />{label}</dt>
      <dd className="text-right font-medium text-slate-700">{value}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: CampaignStatus }) {
  const map = { Planned: 'info', Active: 'warning', Completed: 'success' } as const;
  return <Badge variant={map[status]}>{status}</Badge>;
}

function Compare({ label, expected, actual, good }: { label: string; expected: string; actual: string; good: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-base font-bold ${good ? 'text-emerald-600' : 'text-rose-600'}`}>{actual}</div>
      <div className="text-[10px] text-slate-400">plan {expected}</div>
    </div>
  );
}

function Plain({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-base font-bold text-slate-700">{value}</div>
    </div>
  );
}
