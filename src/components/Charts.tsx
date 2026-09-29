import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// ============================================================
// Lightweight SVG charts. Every chart measures its container, so it
// fills the available width at any screen size, and supports hover
// tooltips, negative values and empty data.
// ============================================================

// ---------- helpers ------------------------------------------------

function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(Math.floor(el.clientWidth));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => setW(Math.floor(entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceNum(range: number, round: boolean) {
  const exp = Math.floor(Math.log10(range));
  const f = range / 10 ** exp;
  const nf = round ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10);
  return nf * 10 ** exp;
}

interface Scale { min: number; max: number; step: number; ticks: number[] }

function niceScale(minIn: number, maxIn: number, target = 4): Scale {
  const min = Number.isFinite(minIn) ? minIn : 0;
  let max = Number.isFinite(maxIn) ? maxIn : 1;
  if (max <= min) max = min + (Math.abs(min) || 1);
  const step = niceNum(niceNum(max - min, false) / target, true);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return { min: lo, max: hi, step, ticks };
}

const defaultTick = (step: number) => (v: number) => {
  const digits = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
  return v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

const truncate = (s: string, max: number) => (max <= 1 ? '' : s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s);

interface TipRow { label: string; value: string; color: string }
interface Tip { x: number; y: number; title: string; rows: TipRow[] }

function TooltipBox({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  const flip = tip.x > width * 0.6;
  return (
    <div
      className="pointer-events-none absolute z-20 rounded-lg bg-slate-900/95 px-3 py-2 text-xs text-white shadow-lg"
      style={{ left: flip ? undefined : tip.x + 12, right: flip ? width - tip.x + 12 : undefined, top: Math.max(0, tip.y - 12), maxWidth: 240 }}
    >
      <div className="mb-1 font-semibold">{tip.title}</div>
      {tip.rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 whitespace-nowrap">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} />
          <span className="text-slate-300">{r.label}</span>
          <span className="ml-auto pl-3 font-medium">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function Legend({ items, square }: { items: { label: string; color: string }[]; square?: boolean }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
      {items.map(s => (
        <div key={s.label} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 ${square ? 'rounded-sm' : 'rounded-full'}`} style={{ background: s.color }} />
          <span className="text-xs text-slate-600">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function NoData({ height }: { height: number }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-400" style={{ height }}>
      No data for the current selection
    </div>
  );
}

const finiteValues = (data: Record<string, unknown>[], keys: string[]) =>
  keys.flatMap(k => data.map(d => Number(d[k]))).filter(Number.isFinite);

// ============================================================
// LineChart
// ============================================================

interface Series { key: string; label: string; color: string }

interface LineChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  series: Series[];
  height?: number;
  showLegend?: boolean;
  yFormat?: (v: number) => string;
  /** 'zero' forces the axis to start at 0; 'auto' zooms to the data range. */
  yMin?: 'zero' | 'auto';
}

export function LineChart({ data, xKey, series, height = 280, showLegend = true, yFormat, yMin = 'auto' }: LineChartProps) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  const vals = finiteValues(data, series.map(s => s.key));
  const dMin = vals.length ? Math.min(...vals) : 0;
  const dMax = vals.length ? Math.max(...vals) : 1;
  const lo = yMin === 'zero' || dMin < 0 || dMin <= dMax * 0.5 ? Math.min(0, dMin) : dMin - (dMax - dMin) * 0.2;
  const scale = niceScale(lo, dMax + (dMax - lo) * 0.05);
  const fmt = yFormat ?? defaultTick(scale.step);
  const labels = data.map(d => String(d[xKey]));

  const left = 14 + Math.max(...scale.ticks.map(t => fmt(t).length), 2) * 6.2;
  const M = { top: 12, right: 16, bottom: 26, left };
  const innerW = Math.max(w - M.left - M.right, 10);
  const innerH = height - M.top - M.bottom;
  const n = data.length;
  const xAt = (i: number) => M.left + (n <= 1 ? innerW / 2 : (i * innerW) / (n - 1));
  const yAt = (v: number) => M.top + innerH - ((v - scale.min) / (scale.max - scale.min)) * innerH;
  const stepPx = n > 1 ? innerW / (n - 1) : innerW;
  const maxLabel = Math.max(...labels.map(l => l.length), 1);
  const every = Math.max(1, Math.ceil((maxLabel * 6 + 10) / stepPx));
  const labelChars = Math.floor((stepPx * every - 6) / 6);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.min(n - 1, Math.max(0, Math.round(n <= 1 ? 0 : ((px - M.left) / innerW) * (n - 1))));
    setHover(i);
    setTip({
      x: xAt(i), y: e.clientY - rect.top, title: labels[i],
      rows: series.map(s => ({ label: s.label, value: fmt(Number(data[i][s.key])), color: s.color })),
    });
  };

  if (!n || !vals.length) return <div ref={ref}><NoData height={height} /></div>;
  return (
    <div ref={ref} className="relative w-full">
      {showLegend && series.length > 1 && <Legend items={series} />}
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={series.map(s => s.label).join(', ')} onMouseMove={onMove} onMouseLeave={() => { setHover(null); setTip(null); }}>
          {scale.ticks.map(t => (
            <g key={t}>
              <line x1={M.left} x2={w - M.right} y1={yAt(t)} y2={yAt(t)} stroke="#e2e8f0" />
              <text x={M.left - 8} y={yAt(t) + 3.5} textAnchor="end" className="fill-slate-400" style={{ fontSize: 10 }}>{fmt(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => i % every === 0 && (
            <text key={i} x={xAt(i)} y={height - 8} textAnchor="middle" className="fill-slate-400" style={{ fontSize: 10 }}>{truncate(l, labelChars)}</text>
          ))}
          {hover !== null && <line x1={xAt(hover)} x2={xAt(hover)} y1={M.top} y2={M.top + innerH} stroke="#cbd5e1" strokeDasharray="3 3" />}
          {series.map(s => {
            const pts = data.map((d, i) => [xAt(i), yAt(Number(d[s.key]))] as const).filter(([, y]) => Number.isFinite(y));
            return (
              <g key={s.key}>
                {pts.length > 1 && <polyline points={pts.map(p => p.join(',')).join(' ')} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
                {pts.map(([x, y], i) => (
                  <circle key={i} cx={x} cy={y} r={hover === i ? 5 : n > 14 ? 0 : 3} fill="white" stroke={s.color} strokeWidth={2} />
                ))}
              </g>
            );
          })}
        </svg>
      )}
      <TooltipBox tip={tip} width={w} />
    </div>
  );
}

// ============================================================
// BarChart (single or grouped; supports negative values)
// ============================================================

interface BarChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  series: Series[];
  height?: number;
  showLegend?: boolean;
  valueFormat?: (v: number) => string;
}

export function BarChart({ data, xKey, series, height = 280, showLegend = true, valueFormat }: BarChartProps) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  const vals = finiteValues(data, series.map(s => s.key));
  const scale = niceScale(Math.min(0, ...vals), Math.max(0, ...vals) * 1.05 || 1);
  const fmt = valueFormat ?? defaultTick(scale.step);
  const tickFmt = defaultTick(scale.step);
  const labels = data.map(d => String(d[xKey]));

  const left = 14 + Math.max(...scale.ticks.map(t => tickFmt(t).length), 2) * 6.2;
  const M = { top: 18, right: 12, bottom: 30, left };
  const innerW = Math.max(w - M.left - M.right, 10);
  const innerH = height - M.top - M.bottom;
  const n = data.length;
  const groupW = innerW / Math.max(n, 1);
  const slot = Math.min((groupW * 0.72) / series.length, 44);
  const yAt = (v: number) => M.top + innerH - ((v - scale.min) / (scale.max - scale.min)) * innerH;
  const zeroY = yAt(0);
  const labelChars = Math.floor(groupW / 6.2);

  if (!n || !vals.length) return <div ref={ref}><NoData height={height} /></div>;
  return (
    <div ref={ref} className="relative w-full">
      {showLegend && series.length > 1 && <Legend items={series} square />}
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={series.map(s => s.label).join(', ')} onMouseLeave={() => { setHover(null); setTip(null); }}>
          {scale.ticks.map(t => (
            <g key={t}>
              <line x1={M.left} x2={w - M.right} y1={yAt(t)} y2={yAt(t)} stroke={t === 0 ? '#94a3b8' : '#e2e8f0'} />
              <text x={M.left - 8} y={yAt(t) + 3.5} textAnchor="end" className="fill-slate-400" style={{ fontSize: 10 }}>{tickFmt(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const gx = M.left + i * groupW + (groupW - slot * series.length) / 2;
            return (
              <g key={i}>
                <rect
                  x={M.left + i * groupW} y={M.top} width={groupW} height={innerH} fill={hover === i ? '#f1f5f9' : 'transparent'}
                  onMouseMove={e => {
                    const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                    setHover(i);
                    setTip({ x: M.left + i * groupW + groupW / 2, y: e.clientY - r.top, title: labels[i], rows: series.map(s => ({ label: s.label, value: fmt(Number(d[s.key])), color: s.color })) });
                  }}
                />
                {series.map((s, si) => {
                  const v = Number(d[s.key]);
                  if (!Number.isFinite(v)) return null;
                  const y = yAt(v);
                  const top = Math.min(y, zeroY);
                  const h = Math.max(Math.abs(zeroY - y), v === 0 ? 0 : 1);
                  const x = gx + si * slot;
                  return (
                    <g key={s.key} pointerEvents="none">
                      <rect x={x + 1} y={top} width={Math.max(slot - 2, 1)} height={h} fill={s.color} rx={2} />
                      {valueFormat && slot >= 34 && (
                        <text x={x + slot / 2} y={v >= 0 ? top - 4 : top + h + 11} textAnchor="middle" className="fill-slate-500" style={{ fontSize: 9 }}>{valueFormat(v)}</text>
                      )}
                    </g>
                  );
                })}
                <text x={M.left + i * groupW + groupW / 2} y={height - 10} textAnchor="middle" className="fill-slate-500" style={{ fontSize: 10 }}>
                  <title>{labels[i]}</title>
                  {truncate(labels[i], labelChars)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <TooltipBox tip={tip} width={w} />
    </div>
  );
}

// ============================================================
// GroupedBarChart — convenience wrapper: categories x series
// ============================================================

interface GroupedBarProps {
  categories: string[];
  series: { label: string; values: number[]; color: string }[];
  height?: number;
  valueFormat?: (v: number) => string;
}

export function GroupedBarChart({ categories, series, height = 300, valueFormat }: GroupedBarProps) {
  const data = categories.map((c, i) => ({ category: c, ...Object.fromEntries(series.map(s => [s.label, s.values[i]])) }));
  return <BarChart data={data} xKey="category" series={series.map(s => ({ key: s.label, label: s.label, color: s.color }))} height={height} valueFormat={valueFormat} />;
}

// ============================================================
// ScatterPlot
// ============================================================

interface ScatterPlotProps {
  data: { label: string; x: number; y: number; color?: string }[];
  xLabel: string;
  yLabel: string;
  height?: number;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  /** Legend of point labels above the plot (default on). Turn off when there are many points. */
  showLegend?: boolean;
}

const PALETTE = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export function ScatterPlot({ data, xLabel, yLabel, height = 280, xFormat, yFormat, showLegend = true }: ScatterPlotProps) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);

  const xs = data.map(d => d.x), ys = data.map(d => d.y);
  const sx = niceScale(0, Math.max(...xs, 1) * 1.1);
  const sy = niceScale(0, Math.max(...ys, 1) * 1.1);
  const fx = xFormat ?? defaultTick(sx.step);
  const fy = yFormat ?? defaultTick(sy.step);
  const left = 16 + Math.max(...sy.ticks.map(t => fy(t).length), 2) * 6.2;
  const M = { top: 14, right: 16, bottom: 44, left };
  const innerW = Math.max(w - M.left - M.right, 10);
  const innerH = height - M.top - M.bottom;
  const px = (v: number) => M.left + ((v - sx.min) / (sx.max - sx.min)) * innerW;
  const py = (v: number) => M.top + innerH - ((v - sy.min) / (sy.max - sy.min)) * innerH;

  if (!data.length) return <div ref={ref}><NoData height={height} /></div>;
  const h = hover !== null ? data[hover] : null;
  return (
    <div ref={ref} className="relative w-full">
      {showLegend && <Legend items={data.map((d, i) => ({ label: d.label, color: d.color ?? PALETTE[i % PALETTE.length] }))} />}
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={`${yLabel} vs ${xLabel}`} onMouseLeave={() => setHover(null)}>
          {sy.ticks.map(t => (
            <g key={t}>
              <line x1={M.left} x2={w - M.right} y1={py(t)} y2={py(t)} stroke="#e2e8f0" />
              <text x={M.left - 8} y={py(t) + 3.5} textAnchor="end" className="fill-slate-400" style={{ fontSize: 10 }}>{fy(t)}</text>
            </g>
          ))}
          {sx.ticks.map(t => (
            <text key={t} x={px(t)} y={M.top + innerH + 14} textAnchor="middle" className="fill-slate-400" style={{ fontSize: 10 }}>{fx(t)}</text>
          ))}
          <text x={M.left + innerW / 2} y={height - 6} textAnchor="middle" className="fill-slate-500" style={{ fontSize: 10 }}>{xLabel}</text>
          <text transform={`translate(12 ${M.top + innerH / 2}) rotate(-90)`} textAnchor="middle" className="fill-slate-500" style={{ fontSize: 10 }}>{yLabel}</text>
          {data.map((d, i) => (
            <circle
              key={i} cx={px(d.x)} cy={py(d.y)} r={hover === i ? 8 : 6} fill={d.color ?? PALETTE[i % PALETTE.length]} fillOpacity={0.85} stroke="white" strokeWidth={1.5}
              onMouseEnter={() => setHover(i)} style={{ cursor: 'pointer' }}
            />
          ))}
        </svg>
      )}
      {h && (
        <TooltipBox
          width={w}
          tip={{ x: px(h.x), y: py(h.y) + 28, title: h.label, rows: [{ label: xLabel, value: fx(h.x), color: h.color ?? PALETTE[hover! % PALETTE.length] }, { label: yLabel, value: fy(h.y), color: h.color ?? PALETTE[hover! % PALETTE.length] }] }}
        />
      )}
    </div>
  );
}

// ============================================================
// DonutChart
// ============================================================

interface DonutChartProps {
  data: { label: string; value: number; color: string }[];
  height?: number;
  centerLabel?: string;
  centerValue?: string;
}

export function DonutChart({ data, height = 220, centerLabel, centerValue }: DonutChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!data.length || total <= 0) return <NoData height={height} />;

  const size = height;
  const r = size / 2 - 8, ri = r - 24, cx = size / 2, cy = size / 2;
  let acc = 0;
  return (
    <div className="flex w-full flex-col items-center">
      <svg width={size} height={size} role="img" aria-label="Share of total">
        {data.map((d, i) => {
          if (d.value <= 0) return null;
          const frac = Math.min(d.value / total, 0.9999);
          const start = (acc / total) * 2 * Math.PI - Math.PI / 2;
          acc += d.value;
          const end = start + frac * 2 * Math.PI;
          const large = end - start > Math.PI ? 1 : 0;
          const pt = (rad: number, a: number) => `${cx + rad * Math.cos(a)} ${cy + rad * Math.sin(a)}`;
          return (
            <path
              key={i}
              d={`M ${pt(r, start)} A ${r} ${r} 0 ${large} 1 ${pt(r, end)} L ${pt(ri, end)} A ${ri} ${ri} 0 ${large} 0 ${pt(ri, start)} Z`}
              fill={d.color} fillOpacity={hover === null || hover === i ? 1 : 0.3}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ transition: 'fill-opacity 0.15s' }}
            />
          );
        })}
        {hover !== null ? (
          <>
            <text x={cx} y={cy - 2} textAnchor="middle" className="fill-slate-800" style={{ fontSize: 18, fontWeight: 700 }}>{((data[hover].value / total) * 100).toFixed(1)}%</text>
            <text x={cx} y={cy + 14} textAnchor="middle" className="fill-slate-400" style={{ fontSize: 10 }}>{truncate(data[hover].label, 22)}</text>
          </>
        ) : (
          <>
            {centerValue && <text x={cx} y={cy - 2} textAnchor="middle" className="fill-slate-800" style={{ fontSize: 18, fontWeight: 700 }}>{centerValue}</text>}
            {centerLabel && <text x={cx} y={cy + 14} textAnchor="middle" className="fill-slate-400" style={{ fontSize: 10 }}>{centerLabel}</text>}
          </>
        )}
      </svg>
      <div className="mt-2 flex w-full flex-col gap-1.5">
        {data.map((d, i) => (
          <div key={i} className="flex items-center justify-between text-xs" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} />
              <span className="text-slate-600">{d.label}</span>
            </div>
            <span className="font-semibold text-slate-700">{((d.value / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// HBarChart — ranked horizontal bars (optional target marker)
// ============================================================

interface HBarChartProps {
  data: { label: string; value: number; color?: string }[];
  valueFormat?: (v: number) => string;
  max?: number;
  /** Draws a marker at this value (e.g. an ROI target). */
  target?: { value: number; label: string };
}

export function HBarChart({ data, valueFormat, max, target }: HBarChartProps) {
  if (!data.length) return <NoData height={120} />;
  const maxVal = max ?? (Math.max(...data.map(d => d.value), target?.value ?? 0) * 1.1 || 1);
  return (
    <div className="w-full space-y-2.5">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-40 shrink-0 truncate text-xs text-slate-600" title={d.label}>{d.label}</div>
          <div className="relative h-6 flex-1 rounded-full bg-slate-100">
            <div
              className="flex h-full items-center justify-end overflow-hidden rounded-full pr-2"
              style={{ width: `${Math.max((d.value / maxVal) * 100, 2)}%`, background: d.color ?? PALETTE[i % PALETTE.length], transition: 'width 0.4s ease' }}
            >
              <span className="text-[10px] font-semibold text-white">{valueFormat ? valueFormat(d.value) : d.value}</span>
            </div>
            {target && (
              <div className="absolute inset-y-[-3px] w-0.5 bg-slate-700/70" style={{ left: `${(target.value / maxVal) * 100}%` }} title={target.label} />
            )}
          </div>
        </div>
      ))}
      {target && <div className="pl-[172px] text-[10px] text-slate-400">│ {target.label}</div>}
    </div>
  );
}

// ============================================================
// Sparkline
// ============================================================

export function Sparkline({ values, color = '#0ea5e9', width = 80, height = 24, children }: { values: number[]; color?: string; width?: number; height?: number; children?: ReactNode }) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const min = Math.min(...clean), range = Math.max(...clean) - min || 1;
  const points = clean.map((v, i) => `${(i / (clean.length - 1)) * width},${height - 2 - ((v - min) / range) * (height - 4)}`).join(' ');
  return (
    <svg width={width} height={height} className="shrink-0" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      {children}
    </svg>
  );
}
