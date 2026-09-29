import { useId, type ReactNode } from 'react';
import {
  LayoutDashboard, CalendarRange, FlaskConical, BarChart3, Bot,
  TrendingUp, TrendingDown, Minus, AlertTriangle, Lightbulb, Gauge, Database, Inbox,
} from 'lucide-react';
import { dataset } from '@/data/dataset';
import { monthLabel } from '@/lib/format';
import { APP_NAME, APP_TAGLINE } from '@/lib/brand';
import { Sparkline } from '@/components/Charts';
import type { Opportunity } from '@/lib/insights';

// ============================================================
// Navigation
// ============================================================

export type PageKey = 'dashboard' | 'planning' | 'simulation' | 'campaigns' | 'ai-advisor';

const NAV_ITEMS: { key: PageKey; label: string; stage: string; icon: typeof Bot }[] = [
  { key: 'dashboard', label: 'Dashboard', stage: 'Understand', icon: LayoutDashboard },
  { key: 'planning', label: 'Planning', stage: 'Plan', icon: CalendarRange },
  { key: 'simulation', label: 'Simulation', stage: 'Simulate', icon: FlaskConical },
  { key: 'campaigns', label: 'Campaign Performance', stage: 'Execute · Learn', icon: BarChart3 },
  { key: 'ai-advisor', label: 'AI Advisor', stage: 'Ask anything', icon: Bot },
];

interface NavProps {
  current: PageKey;
  onNavigate: (page: PageKey) => void;
}

export function Sidebar({ current, onNavigate }: NavProps) {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-slate-900 text-slate-300 md:flex">
      <div className="border-b border-slate-800 px-5 py-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500">
            <Gauge className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-sm font-bold leading-tight tracking-tight text-white">{APP_NAME}</div>
            <div className="text-[10px] leading-tight text-slate-500">{APP_TAGLINE}</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-4" aria-label="Main">
        <div className="mb-2 px-5 text-[10px] font-semibold tracking-wider text-slate-500">WORKFLOW</div>
        <div className="space-y-0.5">
          {NAV_ITEMS.map((item, i) => {
            const Icon = item.icon;
            const active = current === item.key;
            return (
              <button
                key={item.key}
                onClick={() => onNavigate(item.key)}
                aria-current={active ? 'page' : undefined}
                className={`flex w-full items-center gap-3 border-l-2 px-5 py-2.5 text-left text-sm transition-colors ${
                  active ? 'border-sky-500 bg-sky-500/10 text-sky-400' : 'border-transparent text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block font-medium leading-tight">{item.label}</span>
                  <span className="block text-[10px] font-normal leading-tight text-slate-500">
                    {i < 4 ? `${i + 1}. ` : ''}{item.stage}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="border-t border-slate-800 px-5 py-4">
        <div className="flex items-start gap-2 text-[10px] leading-snug text-slate-500">
          <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Master dataset · {dataset.centers.length} service centers, {dataset.campaigns.length} campaigns</span>
        </div>
      </div>
    </aside>
  );
}

/** Compact navigation for screens narrower than `md`, where the sidebar is hidden. */
export function MobileNav({ current, onNavigate }: NavProps) {
  return (
    <nav className="sticky top-0 z-30 flex gap-1 overflow-x-auto bg-slate-900 px-3 py-2 md:hidden" aria-label="Main">
      {NAV_ITEMS.map(item => (
        <button
          key={item.key}
          onClick={() => onNavigate(item.key)}
          aria-current={current === item.key ? 'page' : undefined}
          className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium ${current === item.key ? 'bg-sky-500 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

// ============================================================
// Page chrome
// ============================================================

export function TopBar({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:px-8 md:sticky md:top-0 md:z-10">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-slate-800">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700" title="FY 2025-26: April 2025 – March 2026">
        <Database className="h-3.5 w-3.5" />
        Data through {monthLabel(dataset.latestMonth)}
      </div>
    </header>
  );
}

export function PageWrapper({ children }: { children: ReactNode }) {
  return <div className="animate-[fadeIn_0.3s_ease] space-y-6 p-4 sm:p-8">{children}</div>;
}

// ============================================================
// KPI card — "primary" tier for headline metrics, "secondary" for supporting ones
// ============================================================

export interface KpiDelta {
  text: string;                       // already formatted, e.g. "+4.2%" or "−0.3pp"
  direction: 'up' | 'down' | 'flat';
  good: boolean | null;               // null = neutral (no colour judgement)
}

interface KpiCardProps {
  label: string;
  value: string;
  delta: KpiDelta | null;
  context: string;
  spark?: number[];
  tier: 'primary' | 'secondary';
  hint?: string;
}

export function KpiCard({ label, value, delta, context, spark, tier, hint }: KpiCardProps) {
  const primary = tier === 'primary';
  const tone = !delta || delta.good === null
    ? { pill: 'bg-slate-100 text-slate-600', stroke: '#64748b' }
    : delta.good
      ? { pill: 'bg-emerald-50 text-emerald-700', stroke: '#10b981' }
      : { pill: 'bg-rose-50 text-rose-700', stroke: '#ef4444' };
  const Icon = !delta || delta.direction === 'flat' ? Minus : delta.direction === 'up' ? TrendingUp : TrendingDown;

  return (
    <div
      title={hint}
      className={`rounded-xl border bg-white transition-shadow hover:shadow-sm ${primary ? 'border-slate-200 border-t-2 border-t-sky-500 p-5' : 'border-slate-200 p-3.5'}`}
    >
      <div className={`font-semibold uppercase tracking-wider text-slate-500 ${primary ? 'text-xs' : 'text-[10px]'}`}>{label}</div>
      <div className={`flex items-end justify-between gap-3 ${primary ? 'mt-3' : 'mt-1.5'}`}>
        <div className={`font-bold leading-none tracking-tight text-slate-900 ${primary ? 'text-3xl xl:text-4xl' : 'text-xl'}`}>{value}</div>
        {spark && spark.length > 1 && <Sparkline values={spark} color={tone.stroke} width={primary ? 96 : 56} height={primary ? 32 : 18} />}
      </div>
      <div className={`flex items-center gap-1.5 ${primary ? 'mt-3' : 'mt-2'}`}>
        {delta ? (
          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold ${tone.pill} ${primary ? 'text-xs' : 'text-[10px]'}`}>
            <Icon className={primary ? 'h-3.5 w-3.5' : 'h-3 w-3'} />
            {delta.text}
          </span>
        ) : null}
        <span className={`truncate text-slate-400 ${primary ? 'text-xs' : 'text-[10px]'}`}>{context}</span>
      </div>
    </div>
  );
}

// ============================================================
// Building blocks
// ============================================================

interface CardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function Card({ title, subtitle, children, action, className = '' }: CardProps) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white ${className}`}>
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

export function Badge({ variant, children }: { variant: BadgeVariant; children: ReactNode }) {
  const styles: Record<BadgeVariant, string> = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    error: 'bg-rose-50 text-rose-700 border-rose-200',
    info: 'bg-sky-50 text-sky-700 border-sky-200',
    neutral: 'bg-slate-100 text-slate-600 border-slate-200',
  };
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium ${styles[variant]}`}>{children}</span>;
}

export function OpportunityCard({ item }: { item: Opportunity }) {
  const isAlert = item.type === 'Alert';
  const Icon = isAlert ? AlertTriangle : Lightbulb;
  const sevColor = item.severity === 'high' ? 'border-l-rose-500' : item.severity === 'medium' ? 'border-l-amber-500' : 'border-l-sky-500';
  const negative = item.impact.startsWith('−') || item.impact.startsWith('-');

  return (
    <div className={`rounded-xl border border-l-4 border-slate-200 bg-white p-4 transition-shadow hover:shadow-sm ${sevColor}`}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${isAlert ? 'text-rose-500' : 'text-amber-500'}`} />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className={`text-[10px] font-semibold uppercase tracking-wide ${isAlert ? 'text-rose-500' : 'text-amber-600'}`}>{item.type}</span>
            <span className={`text-xs font-bold ${negative ? 'text-rose-600' : 'text-emerald-600'}`}>{item.impact}</span>
          </div>
          <h4 className="mb-1 text-sm font-semibold text-slate-700">{item.title}</h4>
          <p className="text-xs leading-relaxed text-slate-500">{item.detail}</p>
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <Inbox className="mb-2 h-8 w-8 text-slate-300" />
      <div className="text-sm font-medium text-slate-600">{title}</div>
      {detail && <div className="mt-1 max-w-md text-xs text-slate-400">{detail}</div>}
    </div>
  );
}

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: ReactNode;
  className?: string;
  disabled?: boolean;
}

export function Button({ children, onClick, variant = 'primary', icon, className = '', disabled }: ButtonProps) {
  const styles = {
    primary: 'bg-sky-600 text-white hover:bg-sky-700 shadow-sm',
    secondary: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}

// ============================================================
// Form controls
// ============================================================

interface SelectProps {
  label: string;
  value: string;
  options: (string | { value: string; label: string })[];
  onChange: (v: string) => void;
}

export function Select({ label, value, options, onChange }: SelectProps) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-slate-500">{label}</label>
      <select
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
      >
        {options.map(o => {
          const opt = typeof o === 'string' ? { value: o, label: o } : o;
          return <option key={opt.value} value={opt.value}>{opt.label}</option>;
        })}
      </select>
    </div>
  );
}

interface NumberFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
  error?: string | null;
  hint?: string;
}

/** Text input restricted to positive numbers; shows an inline error instead of silently accepting junk. */
export function NumberField({ label, value, onChange, prefix, suffix, error, hint }: NumberFieldProps) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-slate-500">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">{prefix}</span>}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={e => onChange(e.target.value)}
          aria-invalid={!!error}
          className={`w-full rounded-lg border bg-white py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 ${prefix ? 'pl-7' : 'pl-3'} ${suffix ? 'pr-10' : 'pr-3'} ${
            error ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20' : 'border-slate-200 focus:border-sky-500 focus:ring-sky-500/20'
          }`}
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">{suffix}</span>}
      </div>
      {error ? <p className="mt-1 text-[11px] text-rose-600">{error}</p> : hint ? <p className="mt-1 text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  );
}
