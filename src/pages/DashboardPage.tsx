import { useMemo, useState } from 'react';
import { KpiCard, Card, Badge, Button, EmptyState, OpportunityCard, PageWrapper, Select, TopBar, type KpiDelta } from '@/components/Layout';
import { LineChart, ScatterPlot, HBarChart, DonutChart } from '@/components/Charts';
import { dataset as ds } from '@/data/dataset';
import {
  centersIn, describeScope, metricsFor, monthlySeries, PERIOD_OPTIONS, periodWindow, regionBreakdown, schemePerformance,
  type PeriodKey,
} from '@/lib/analytics';
import { REGIONS, ROI_DEFINITION, ROI_TARGET, SCHEME_COLORS, SEGMENTS } from '@/lib/constants';
import { computeOpportunities } from '@/lib/insights';
import { fmtInr, fmtInt, fmtL, fmtPct, fmtX, monthLabel, monthRangeLabel, monthShort, pctChange } from '@/lib/format';
import type { Region, Scope, Segment } from '@/lib/types';
import { RotateCcw } from 'lucide-react';

// ---------- delta helpers ------------------------------------------------

const FLAT = 0.05;

function relDelta(cur: number, prev: number | undefined, goodWhenUp: boolean | null = true): KpiDelta | null {
  if (prev === undefined || !prev) return null;
  const d = pctChange(cur, prev);
  if (Math.abs(d) < FLAT) return { text: '0.0%', direction: 'flat', good: null };
  return { text: `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}%`, direction: d > 0 ? 'up' : 'down', good: goodWhenUp === null ? null : d > 0 === goodWhenUp };
}

function absDelta(cur: number | null, prev: number | null | undefined, unit: string, digits = 1): KpiDelta | null {
  if (cur === null || prev === null || prev === undefined) return null;
  const d = cur - prev;
  if (Math.abs(d) < FLAT / 10) return { text: `0.0${unit}`, direction: 'flat', good: null };
  return { text: `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(digits)}${unit}`, direction: d > 0 ? 'up' : 'down', good: d > 0 };
}

export function DashboardPage() {
  const [period, setPeriod] = useState<PeriodKey>('l3m');
  const [region, setRegion] = useState<Region | 'All'>('All');
  const [centerId, setCenterId] = useState<string>('All');
  const [segment, setSegment] = useState<Segment | 'All'>('All');

  const scope: Scope = useMemo(() => ({ region, centerId, segment }), [region, centerId, segment]);
  const win = useMemo(() => periodWindow(ds, period), [period]);
  const periodText = monthRangeLabel(win.current);

  const cur = useMemo(() => metricsFor(ds, scope, win.current), [scope, win]);
  const prev = useMemo(() => (win.previous ? metricsFor(ds, scope, win.previous) : null), [scope, win]);
  const series = useMemo(() => monthlySeries(ds, scope), [scope]);
  const schemes = useMemo(() => schemePerformance(ds, scope, win.current), [scope, win]);
  const regions = useMemo(() => regionBreakdown(ds, { segment }, win), [segment, win]);
  const opportunities = useMemo(() => computeOpportunities(ds, scope), [scope]);

  const centerOptions = [{ value: 'All', label: 'All service centers' }, ...centersIn(ds, region).map(c => ({ value: c.id, label: c.name }))];
  const filtered = region !== 'All' || centerId !== 'All' || segment !== 'All' || period !== 'l3m';
  const ctx = win.comparison;
  const empty = cur.visits === 0;

  const onRegion = (v: string) => {
    setRegion(v as Region | 'All');
    setCenterId('All'); // a center only makes sense inside its region
  };
  const reset = () => { setPeriod('l3m'); setRegion('All'); setCenterId('All'); setSegment('All'); };

  return (
    <>
      <TopBar title="Dashboard" subtitle="Understand · business performance and RGM opportunities · FY 2025-26" />
      <PageWrapper>
        {/* Filters */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Select label="Period" value={period} onChange={v => setPeriod(v as PeriodKey)} options={PERIOD_OPTIONS.map(p => ({ value: p.key, label: p.label }))} />
            <Select label="Region" value={region} onChange={onRegion} options={[{ value: 'All', label: 'All regions' }, ...REGIONS]} />
            <Select label="Service center" value={centerId} onChange={setCenterId} options={centerOptions} />
            <Select label="Customer segment" value={segment} onChange={v => setSegment(v as Segment | 'All')} options={[{ value: 'All', label: 'All segments' }, ...SEGMENTS]} />
            <Button variant="secondary" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={reset} disabled={!filtered} className="justify-center">Reset filters</Button>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Showing <span className="font-medium text-slate-600">{describeScope(ds, scope)}</span> · {periodText}
            {prev && <> · compared with {monthRangeLabel(win.previous!)}</>}
          </p>
        </div>

        {empty ? (
          <EmptyState title="No data for this selection" detail="The chosen service center has no activity for this segment and period. Reset the filters to see the full network." />
        ) : (
          <>
            {/* Headline KPIs */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard tier="primary" label="Service Revenue" value={fmtL(cur.revenue)} delta={relDelta(cur.revenue, prev?.revenue)} context={ctx} hint="Total service revenue in the period" />
              <KpiCard tier="primary" label="Gross Margin" value={fmtPct(cur.grossMargin)} delta={absDelta(cur.grossMargin, prev?.grossMargin, 'pp')} context={ctx} hint="Gross profit ÷ service revenue, before promotion spend" />
              <KpiCard tier="primary" label="Promotion-driven Revenue" value={fmtL(cur.incrRevenue)} delta={relDelta(cur.incrRevenue, prev?.incrRevenue)} context={ctx} hint="Incremental revenue attributed to promotion campaigns" />
              <KpiCard tier="primary" label="Promotion ROI" value={fmtX(cur.roi)} delta={absDelta(cur.roi, prev?.roi, 'x', 2)} context={cur.roi === null ? 'no promotion spend' : `${ctx} · target ${fmtX(ROI_TARGET)}`} hint={ROI_DEFINITION} />
            </div>
            {/* Supporting KPIs */}
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <KpiCard tier="secondary" label="Service Visits" value={fmtInt(cur.visits)} delta={relDelta(cur.visits, prev?.visits)} context={ctx} />
              <KpiCard tier="secondary" label="Avg Service Value" value={fmtInr(cur.asv)} delta={relDelta(cur.asv, prev?.asv)} context={ctx} hint="Service revenue ÷ visits" />
              <KpiCard tier="secondary" label="Customer Retention" value={fmtPct(cur.retention)} delta={absDelta(cur.retention, prev?.retention, 'pp')} context={ctx} hint="Customers who returned ÷ customers due for a repeat visit" />
              <KpiCard tier="secondary" label="Promotion Spend" value={fmtL(cur.promoSpend)} delta={relDelta(cur.promoSpend, prev?.promoSpend, null)} context={ctx} />
            </div>

            {/* Trends */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <Card title="Service Revenue Trend" subtitle="₹ lakh per month · full year for the selected scope" className="lg:col-span-2">
                <LineChart
                  data={series.map(s => ({ label: monthShort(s.month), revenue: s.revenue, organic: s.organicRevenue }))}
                  xKey="label"
                  series={[
                    { key: 'revenue', label: 'Service revenue', color: '#0ea5e9' },
                    { key: 'organic', label: 'Excluding promotions', color: '#94a3b8' },
                  ]}
                  yFormat={v => fmtL(v, 0)}
                />
              </Card>
              <Card title="Service Visits" subtitle="Visits per month">
                <LineChart data={series.map(s => ({ label: monthShort(s.month), visits: s.visits }))} xKey="label" series={[{ key: 'visits', label: 'Service visits', color: '#8b5cf6' }]} showLegend={false} yFormat={v => fmtInt(v)} />
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card title="Gross Margin Trend" subtitle="% of service revenue, before promotion spend">
                <LineChart data={series.map(s => ({ label: monthShort(s.month), margin: s.grossMargin }))} xKey="label" series={[{ key: 'margin', label: 'Gross margin', color: '#10b981' }]} showLegend={false} yFormat={v => `${v.toFixed(1)}%`} />
              </Card>
              <Card title="Promotion Spend vs Incremental Revenue" subtitle={`Each dot is a promotion scheme · ${periodText}`}>
                {schemes.length ? (
                  <ScatterPlot
                    data={schemes.map(s => ({ label: s.scheme, x: s.promoSpend, y: s.incrRevenue, color: SCHEME_COLORS[s.scheme] }))}
                    xLabel="Promotion spend (₹L)" yLabel="Incremental revenue (₹L)"
                    xFormat={v => v.toFixed(1)} yFormat={v => v.toFixed(0)}
                  />
                ) : <NoPromo />}
              </Card>
            </div>

            {/* Promotion performance */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <Card title="Promotion Performance" subtitle={`ROI by scheme · ${periodText}`} className="lg:col-span-2" action={<span className="text-[10px] text-slate-400" title={ROI_DEFINITION}>ⓘ ROI definition</span>}>
                {schemes.length ? (
                  <div className="space-y-4">
                    <HBarChart
                      data={schemes.map(s => ({ label: s.scheme, value: s.roi ?? 0, color: SCHEME_COLORS[s.scheme] }))}
                      valueFormat={v => fmtX(v)}
                      target={{ value: ROI_TARGET, label: `ROI target ${fmtX(ROI_TARGET)}` }}
                    />
                    <div className="flex flex-wrap gap-2">
                      {schemes.map(s => (
                        <Badge key={s.scheme} variant={s.status === 'Above target' ? 'success' : s.status === 'On target' ? 'info' : 'error'}>
                          {s.scheme}: {s.status.toLowerCase()} · {s.campaigns} campaign{s.campaigns === 1 ? '' : 's'}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : <NoPromo />}
              </Card>
              <Card title="Promotion Spend Mix" subtitle="Share of spend by scheme">
                {schemes.length ? (
                  <DonutChart
                    data={schemes.map(s => ({ label: s.scheme, value: s.promoSpend, color: SCHEME_COLORS[s.scheme] }))}
                    centerValue={fmtL(schemes.reduce((t, s) => t + s.promoSpend, 0))}
                    centerLabel="Total spend"
                  />
                ) : <NoPromo />}
              </Card>
            </div>

            {/* Regions */}
            <Card title="Regional Performance" subtitle={`${periodText} · all regions (the region and center filters do not apply here)`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
                      <th className="px-3 py-2.5 text-left font-semibold">Region</th>
                      {['Revenue', win.previous ? 'Change' : null, 'Gross margin', 'Retention', 'Promo spend', 'ROI'].filter(Boolean).map(h => (
                        <th key={h} className="px-3 py-2.5 text-right font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {regions.map(r => (
                      <tr key={r.region} className={r.region === region ? 'bg-sky-50/60' : 'hover:bg-slate-50/60'}>
                        <td className="px-3 py-2.5 font-medium text-slate-700">{r.region}</td>
                        <td className="px-3 py-2.5 text-right text-slate-700">{fmtL(r.revenue)}</td>
                        {win.previous && (
                          <td className={`px-3 py-2.5 text-right font-medium ${r.revenueChange === null ? 'text-slate-400' : r.revenueChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {r.revenueChange === null ? '—' : `${r.revenueChange >= 0 ? '+' : '−'}${Math.abs(r.revenueChange).toFixed(1)}%`}
                          </td>
                        )}
                        <td className="px-3 py-2.5 text-right text-slate-600">{fmtPct(r.grossMargin)}</td>
                        <td className="px-3 py-2.5 text-right text-slate-600">{fmtPct(r.retention)}</td>
                        <td className="px-3 py-2.5 text-right text-slate-600">{fmtL(r.promoSpend)}</td>
                        <td className={`px-3 py-2.5 text-right font-medium ${r.roi === null ? 'text-slate-400' : r.roi >= ROI_TARGET ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtX(r.roi)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Opportunities */}
            <div>
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-slate-700">Opportunities &amp; Alerts</h3>
                <span className="text-xs text-slate-400">Computed from the data · {describeScope(ds, scope)} · as of {monthLabel(ds.latestMonth)}</span>
              </div>
              {opportunities.length ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {opportunities.map(o => <OpportunityCard key={o.id} item={o} />)}
                </div>
              ) : (
                <EmptyState title="Nothing needs attention" detail="No alerts or opportunities were triggered for this selection." />
              )}
            </div>
          </>
        )}
      </PageWrapper>
    </>
  );
}

function NoPromo() {
  return <EmptyState title="No promotion spend in this selection" detail="Try a longer period or a broader region / segment." />;
}
