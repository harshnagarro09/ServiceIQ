// Shared UI building blocks for the Planning, Simulation, Campaign Performance and AI Advisor pages.
// (The Dashboard keeps using the components in Layout.tsx untouched.)

import { useId, type ReactNode } from 'react';

// ---------- Filters ------------------------------------------------

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="border-b border-slate-200 bg-white px-4 py-3 sm:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Filters</span>
        {children}
      </div>
    </div>
  );
}

interface FilterSelectProps {
  label: string;
  value: string;
  options: (string | { value: string; label: string })[];
  onChange: (v: string) => void;
  className?: string;
}

/** Compact dropdown with a visually-hidden label, in the style of a filter bar. */
export function FilterSelect({ label, value, options, onChange, className = '' }: FilterSelectProps) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <select
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        title={label}
        className={`max-w-[15rem] rounded-lg border bg-white py-1.5 pl-3 pr-8 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500/20 ${
          /^all/i.test(value) ? 'border-slate-200' : 'border-sky-300 bg-sky-50/40'
        } focus:border-sky-500`}
      >
        {options.map(o => {
          const opt = typeof o === 'string' ? { value: o, label: o } : o;
          return <option key={opt.value} value={opt.value}>{opt.label}</option>;
        })}
      </select>
    </div>
  );
}

// ---------- Tiles, chips, bars -------------------------------------

export function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' | 'good' | 'warn' }) {
  const color = tone === 'bad' ? 'text-rose-600' : tone === 'good' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : 'text-slate-900';
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-1.5 text-2xl font-bold tracking-tight ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

type TagTone = 'dark' | 'green' | 'amber' | 'red' | 'sky' | 'slate' | 'violet';

export function Tag({ tone = 'slate', children, title }: { tone?: TagTone; children: ReactNode; title?: string }) {
  const styles: Record<TagTone, string> = {
    dark: 'bg-slate-900 text-white',
    green: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border border-amber-200',
    red: 'bg-rose-50 text-rose-700 border border-rose-200',
    sky: 'bg-sky-50 text-sky-700 border border-sky-200',
    slate: 'bg-slate-100 text-slate-600 border border-slate-200',
    violet: 'bg-violet-50 text-violet-700 border border-violet-200',
  };
  return <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[10px] font-semibold ${styles[tone]}`}>{children}</span>;
}

export function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
      }`}
    >
      {children}
    </button>
  );
}

/** Progress bar with an optional marker (e.g. "plan = 100%"). */
export function ProgressBar({ value, max = 100, marker, tone = 'sky' }: { value: number; max?: number; marker?: number; tone?: 'sky' | 'green' | 'amber' | 'red' }) {
  const color = { sky: 'bg-sky-500', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-rose-500' }[tone];
  const pct = Math.min(Math.max((value / max) * 100, 0), 100);
  return (
    <div className="relative h-2 w-full rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max}>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      {marker !== undefined && <div className="absolute inset-y-[-3px] w-0.5 bg-slate-700/70" style={{ left: `${Math.min((marker / max) * 100, 100)}%` }} />}
    </div>
  );
}

// ---------- Slider -------------------------------------------------

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  hint?: string;
}

export function Slider({ label, value, min, max, step, format, onChange, hint }: SliderProps) {
  const id = useId();
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label htmlFor={id} className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</label>
        <span className="text-sm font-bold text-slate-800">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-emerald-600"
      />
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{format(min)}</span>
        {hint && <span className="text-slate-500">{hint}</span>}
        <span>{format(max)}</span>
      </div>
    </div>
  );
}

// ---------- Table helpers ------------------------------------------

export function Th({ children, right, className = '' }: { children?: ReactNode; right?: boolean; className?: string }) {
  return <th className={`px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 ${right ? 'text-right' : 'text-left'} ${className}`}>{children}</th>;
}
