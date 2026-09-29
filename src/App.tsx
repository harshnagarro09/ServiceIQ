import { useState } from 'react';
import { Sidebar, MobileNav, type PageKey } from '@/components/Layout';
import { DashboardPage } from '@/pages/DashboardPage';
import { PlanningPage } from '@/pages/PlanningPage';
import { SimulationPage } from '@/pages/SimulationPage';
import { CampaignPerformancePage } from '@/pages/CampaignPerformancePage';
import { AIAdvisorPage } from '@/pages/AIAdvisorPage';
import { dataset } from '@/data/dataset';
import { defaultPlan, type Plan } from '@/lib/simulation';
import type { Decision, Decisions } from '@/lib/planner';

function App() {
  const [page, setPage] = useState<PageKey>('dashboard');
  // Shared across pages: the plan (Planning → Simulation → AI Advisor) and the accept / reject / modify
  // decisions on recommended campaigns (Planning ↔ Simulation → Campaign Performance).
  const [plan, setPlan] = useState<Plan>(() => defaultPlan(dataset));
  const [decisions, setDecisions] = useState<Decisions>({});
  const [selectedRecId, setSelectedRecId] = useState<string | null>(null);

  const decide = (id: string, decision: Decision | null) =>
    setDecisions(prev => {
      const next = { ...prev };
      if (decision) next[id] = decision; else delete next[id];
      return next;
    });

  const openSimulation = (id: string) => { setSelectedRecId(id); setPage('simulation'); };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 md:flex-row">
      <MobileNav current={page} onNavigate={setPage} />
      <Sidebar current={page} onNavigate={setPage} />
      <main className="min-w-0 flex-1">
        {page === 'dashboard' && <DashboardPage />}
        {page === 'planning' && <PlanningPage plan={plan} onPlanChange={setPlan} decisions={decisions} onDecide={decide} onOpenSimulation={openSimulation} onNavigate={setPage} />}
        {page === 'simulation' && <SimulationPage plan={plan} onPlanChange={setPlan} decisions={decisions} onDecide={decide} selectedId={selectedRecId} onSelect={setSelectedRecId} onNavigate={setPage} />}
        {page === 'campaigns' && <CampaignPerformancePage plan={plan} decisions={decisions} onNavigate={setPage} />}
        {page === 'ai-advisor' && <AIAdvisorPage plan={plan} decisions={decisions} onNavigate={setPage} />}
      </main>
    </div>
  );
}

export default App;
