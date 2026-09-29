import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Card, Badge, Button, PageWrapper, TopBar, type PageKey } from '@/components/Layout';
import { FilterSelect, Th } from '@/components/ui';
import { benchmark as bm, dataset as ds } from '@/data/dataset';
import { AGENTS, runAgent, type AgentDef, type AgentId, type AgentReport } from '@/lib/agents';
import { answerQuestion, SUGGESTED_QUESTIONS, type AdvisorAnswer } from '@/lib/advisor';
import { REGIONS } from '@/lib/constants';
import { monthRangeLabel } from '@/lib/format';
import type { Decisions } from '@/lib/planner';
import type { Plan } from '@/lib/simulation';
import type { Region } from '@/lib/types';
import {
  Activity, Bot, CalendarClock, ChevronRight, Database, Eraser, Lightbulb, MessageSquare, Play, Send, SlidersHorizontal, Sparkles, Swords, Tag, TrendingUp, User, Workflow, type LucideProps,
} from 'lucide-react';

type Message = { role: 'user'; text: string } | { role: 'assistant'; answer: AdvisorAnswer };
type Tab = 'agents' | 'chat';

const ICONS: Record<AgentId, ComponentType<LucideProps>> = {
  performance: TrendingUp, promotion: Tag, competitor: Swords, simulation: SlidersHorizontal, planner: CalendarClock, monitor: Activity, recommendation: Lightbulb,
};

const WELCOME: AdvisorAnswer = {
  agent: 'Orchestrator',
  text: 'Hello! I am the ServiceIQ Advisor. Ask about performance, promotions, competitors, campaign plans or live campaigns — every answer is calculated from the same data as the other pages. Pick a suggested question or type your own.',
  bullets: [],
  scope: `Data: ${monthRangeLabel(ds.months)} + competitor benchmark`,
  followUps: [],
};

interface Props { plan: Plan; decisions: Decisions; onNavigate: (p: PageKey) => void }

export function AIAdvisorPage({ plan, decisions, onNavigate }: Props) {
  const [tab, setTab] = useState<Tab>('chat');
  const [activeId, setActiveId] = useState<AgentId>('competitor');
  const [region, setRegion] = useState<Region | 'All'>('All');

  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', answer: WELCOME }]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const report = useMemo(() => runAgent(activeId, { ds, bm, plan, decisions }, { region }), [activeId, region, plan, decisions]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, thinking]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const lastAgent = [...messages].reverse().find((m): m is Extract<Message, { role: 'assistant' }> => m.role === 'assistant')?.answer.agent;

  const ask = (question: string) => {
    const q = question.trim();
    if (!q || thinking) return;
    setTab('chat');
    setMessages(prev => [...prev, { role: 'user', text: q }]);
    setInput('');
    setThinking(true);
    timer.current = setTimeout(() => {
      let answer: AdvisorAnswer;
      try {
        answer = answerQuestion(ds, q, plan, { bm, decisions });
      } catch {
        answer = { agent: 'Orchestrator', text: 'Something went wrong while analysing that question. Please try rephrasing it.', bullets: [], scope: '', followUps: SUGGESTED_QUESTIONS.slice(0, 3) };
      }
      setMessages(prev => [...prev, { role: 'assistant', answer }]);
      setThinking(false);
    }, 450);
  };

  return (
    <>
      <TopBar title="AI Advisor" subtitle="Seven specialist agents and a chat assistant — all working from the same data as the rest of the app" />
      <PageWrapper>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2" role="tablist" aria-label="Advisor views">
          <ModeCard
            active={tab === 'chat'} onClick={() => setTab('chat')} icon={MessageSquare}
            title="Chat" tagline="Ask in your own words"
            body="Type a question, for example “Why did South revenue fall in March?”, and get a short answer with the numbers. Best for specific questions and follow-ups."
          />
          <ModeCard
            active={tab === 'agents'} onClick={() => setTab('agents')} icon={Bot}
            title="AI Agents" tagline="Run a full report with one click"
            body="Seven specialists each produce a complete report (key numbers, a table and recommended actions) without any typing. Best for reviews, or when you are not sure what to ask."
          />
        </div>

        {tab === 'agents' ? (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {AGENTS.map(a => <AgentCard key={a.id} agent={a} active={a.id === activeId} onRun={() => setActiveId(a.id)} onAsk={() => ask(a.askPrompt)} />)}
            </div>
            <ReportPanel report={report} region={region} onRegion={setRegion} isCompetitor={activeId === 'competitor'} onNavigate={onNavigate} onAsk={() => ask(AGENTS.find(a => a.id === activeId)!.askPrompt)} />
          </>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
            <div className="lg:col-span-3">
              <Card
                title="Ask the Advisor"
                subtitle="Performance, promotions, competitors, campaign plans and live campaigns"
                action={<Button variant="ghost" icon={<Eraser className="h-3.5 w-3.5" />} className="!px-2 !py-1 text-xs" onClick={() => setMessages([{ role: 'assistant', answer: WELCOME }])} disabled={messages.length < 2}>Clear</Button>}
              >
                <div ref={scrollRef} className="mb-4 h-[480px] space-y-4 overflow-y-auto pr-2" aria-live="polite">
                  {messages.map((m, i) => (m.role === 'user' ? <UserBubble key={i} text={m.text} /> : <AnswerBubble key={i} answer={m.answer} onAsk={ask} disabled={thinking} />))}
                  {thinking && (
                    <div className="flex gap-3">
                      <Avatar assistant />
                      <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="flex gap-1" aria-label="Analysing">{[0, 150, 300].map(d => <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-slate-300" style={{ animationDelay: `${d}ms` }} />)}</div>
                      </div>
                    </div>
                  )}
                </div>
                <form className="flex gap-2" onSubmit={e => { e.preventDefault(); ask(input); }}>
                  <input
                    type="text" value={input} onChange={e => setInput(e.target.value)} aria-label="Your question"
                    placeholder="e.g. Where is our discount lower than competitors?"
                    className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                  />
                  <button type="submit" disabled={!input.trim() || thinking} className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"><Send className="h-4 w-4" /> Send</button>
                </form>
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <div className="mb-2.5 flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-amber-500" /><span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Suggested questions</span></div>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTED_QUESTIONS.map(q => (
                      <button key={q} type="button" onClick={() => ask(q)} disabled={thinking} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs text-slate-600 transition-all hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 disabled:opacity-50"><ChevronRight className="h-3 w-3 shrink-0" />{q}</button>
                    ))}
                  </div>
                </div>
              </Card>
            </div>
            <Card title="Agents" subtitle="Who answers what">
              <div className="space-y-2">
                <div className={`flex items-center gap-2.5 rounded-lg bg-slate-800 p-2.5 ${lastAgent === 'Orchestrator' ? 'ring-2 ring-sky-400' : ''}`}>
                  <Workflow className="h-4 w-4 text-sky-400" /><div><div className="text-xs font-semibold text-white">Orchestrator</div><div className="text-[10px] text-slate-400">Routes each question</div></div>
                </div>
                {AGENTS.map(a => {
                  const Icon = ICONS[a.id];
                  const on = lastAgent !== undefined && a.name.startsWith(lastAgent);
                  return (
                    <div key={a.id} className={`flex items-start gap-2.5 rounded-lg border p-2.5 transition-colors ${on ? 'border-sky-400 bg-sky-50' : 'border-slate-200 bg-slate-50'}`}>
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white"><Icon className="h-3.5 w-3.5 text-sky-600" /></div>
                      <div className="min-w-0"><div className="text-xs font-semibold text-slate-700">{a.name}</div><div className="text-[10px] leading-tight text-slate-500">{a.tagline}</div></div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-4 border-t border-slate-100 pt-3 text-[10px] leading-relaxed text-slate-400">Answers are calculated from the master dataset and the competitor benchmark using rule-based analytics, not a language model. <code>answerQuestion</code> is the integration point for an LLM.</p>
            </Card>
          </div>
        )}
      </PageWrapper>
    </>
  );
}

/** Selectable card that explains what a mode is for, so users know when to use it. */
function ModeCard({ active, onClick, icon: Icon, title, tagline, body }: { active: boolean; onClick: () => void; icon: ComponentType<LucideProps>; title: string; tagline: string; body: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${active ? 'border-sky-500 bg-sky-50/60 ring-1 ring-sky-500/30' : 'border-slate-200 bg-white hover:border-slate-300'}`}
    >
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-sky-500' : 'bg-slate-100'}`}><Icon className={`h-5 w-5 ${active ? 'text-white' : 'text-slate-500'}`} /></div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2"><span className="text-sm font-semibold text-slate-800">{title}</span><span className="text-xs font-medium text-sky-700">{tagline}</span></div>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">{body}</p>
      </div>
    </button>
  );
}

// ------------------------------------------------------------
// Agents tab
// ------------------------------------------------------------

function AgentCard({ agent, active, onRun, onAsk }: { agent: AgentDef; active: boolean; onRun: () => void; onAsk: () => void }) {
  const Icon = ICONS[agent.id];
  const isNew = agent.id === 'competitor' || agent.id === 'planner' || agent.id === 'monitor';
  return (
    <div className={`flex flex-col rounded-xl border bg-white p-4 transition-shadow ${active ? 'border-sky-500 shadow-sm ring-1 ring-sky-500/30' : 'border-slate-200 hover:shadow-sm'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50"><Icon className="h-5 w-5 text-sky-600" /></div>
        {isNew && <Badge variant="success">New</Badge>}
      </div>
      <h3 className="mt-3 text-sm font-semibold text-slate-800">{agent.name}</h3>
      <p className="text-xs font-medium text-sky-700">{agent.tagline}</p>
      <p className="mt-1.5 flex-1 text-xs leading-relaxed text-slate-500">{agent.description}</p>
      <div className="mt-3 flex flex-wrap gap-1">
        {agent.dataUsed.slice(0, 3).map(d => <span key={d} className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500" title={d}>{d.length > 34 ? `${d.slice(0, 33)}…` : d}</span>)}
      </div>
      <div className="mt-4 flex gap-2">
        <Button icon={<Play className="h-3.5 w-3.5" />} className="flex-1 justify-center !px-3 !py-1.5 text-xs" onClick={onRun}>{active ? 'Selected' : agent.runLabel.split(' ').slice(0, 2).join(' ')}</Button>
        <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={onAsk}>Ask in chat</Button>
      </div>
    </div>
  );
}

const CELL_TONES: [RegExp, string][] = [
  [/^(Behind|Below target|Critical|High)$/, 'text-rose-600 font-semibold'],
  [/^(Ahead|Above target|Healthy)$/, 'text-emerald-600 font-semibold'],
  [/^(Parity|On target|Watch|Medium)$/, 'text-amber-600 font-semibold'],
];

function ReportPanel({ report, region, onRegion, isCompetitor, onNavigate, onAsk }: { report: AgentReport; region: Region | 'All'; onRegion: (r: Region | 'All') => void; isCompetitor: boolean; onNavigate: (p: PageKey) => void; onAsk: () => void }) {
  const def = AGENTS.find(a => a.id === report.agent)!;
  const Icon = ICONS[report.agent];
  const toneClass = { good: 'text-emerald-600', bad: 'text-rose-600', neutral: 'text-slate-900' } as const;
  return (
    <Card
      title={`${report.title} — report`}
      subtitle={`${def.tagline} · ${report.scope}`}
      action={isCompetitor ? <FilterSelect label="Region" value={region} onChange={v => onRegion(v as Region | 'All')} options={[{ value: 'All', label: 'All Regions' }, ...REGIONS]} /> : undefined}
    >
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 p-4">
          <Icon className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
          <p className="text-sm font-medium leading-relaxed text-sky-900">{report.headline}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {report.metrics.map(m => (
            <div key={m.label} className="rounded-lg border border-slate-200 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{m.label}</div>
              <div className={`mt-1 text-lg font-bold ${toneClass[m.tone ?? 'neutral']}`}>{m.value}</div>
            </div>
          ))}
        </div>

        {report.table && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-slate-200">{report.table.columns.map((c, i) => <Th key={c} right={i > 0 && /^[\d₹−+-]/.test(report.table!.rows[0]?.[i] ?? '')}>{c}</Th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {report.table.rows.map((row, ri) => (
                  <tr key={ri} className="hover:bg-slate-50/60">
                    {row.map((cell, ci) => {
                      const cls = CELL_TONES.find(([re]) => re.test(cell))?.[1] ?? (ci === 0 ? 'font-medium text-slate-700' : 'text-slate-600');
                      return <td key={ci} className={`px-3 py-2.5 text-xs ${cls} ${ci > 0 && /^[\d₹−+-]/.test(cell) ? 'text-right' : ''}`}>{cell}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{report.agent === 'competitor' || report.agent === 'recommendation' ? 'Recommended actions' : 'Findings'}</h4>
          <ul className="space-y-1.5 text-sm text-slate-700">
            {report.findings.map((f, i) => f.startsWith('   ')
              ? <li key={i} className="pl-5 text-xs text-slate-500">{f.trim()}</li>
              : <li key={i} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" /><span>{f}</span></li>)}
          </ul>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
            <Database className="h-3.5 w-3.5" /> Data used:
            {report.dataUsed.map(d => <span key={d} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">{d}</span>)}
          </div>
          <div className="flex gap-2">
            {report.actions.map(a => <Button key={a.label} variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => onNavigate(a.page)}>{a.label}</Button>)}
            <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={onAsk}>Ask in chat</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------
// Chat tab
// ------------------------------------------------------------

function Avatar({ assistant }: { assistant?: boolean }) {
  return (
    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${assistant ? 'bg-sky-500' : 'bg-slate-700'}`}>
      {assistant ? <Bot className="h-4 w-4 text-white" /> : <User className="h-4 w-4 text-white" />}
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex flex-row-reverse gap-3">
      <Avatar />
      <div className="max-w-[80%] rounded-xl bg-slate-700 px-4 py-2.5 text-sm leading-relaxed text-white">{text}</div>
    </div>
  );
}

function AnswerBubble({ answer, onAsk, disabled }: { answer: AdvisorAnswer; onAsk: (q: string) => void; disabled: boolean }) {
  return (
    <div className="flex gap-3">
      <Avatar assistant />
      <div className="min-w-0 max-w-[88%]">
        <div className="mb-1"><Badge variant="info">{answer.agent === 'Orchestrator' ? 'Orchestrator' : `Orchestrator → ${answer.agent} Agent`}</Badge></div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700">
          <p>{answer.text}</p>
          {answer.bullets.length > 0 && (
            <ul className="mt-2 space-y-1.5 border-t border-slate-200 pt-2 text-[13px] text-slate-600">
              {answer.bullets.map((b, i) => b.startsWith('   ')
                ? <li key={i} className="pl-4 text-xs text-slate-500">{b.trim()}</li>
                : <li key={i} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" /><span>{b}</span></li>)}
            </ul>
          )}
          {answer.scope && <p className="mt-2 text-[10px] text-slate-400">Based on: {answer.scope}</p>}
        </div>
        {answer.followUps.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {answer.followUps.map(f => <button key={f} type="button" disabled={disabled} onClick={() => onAsk(f)} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-500 hover:border-sky-300 hover:text-sky-700 disabled:opacity-50">{f}</button>)}
          </div>
        )}
      </div>
    </div>
  );
}
