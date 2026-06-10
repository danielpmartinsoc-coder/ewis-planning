import { useState, useEffect, useCallback } from 'react';
import type { ViewId, AIInsight, AppState } from './types';
import { useAppState } from './store/useAppState';
import { ReadonlyContext } from './context/ReadonlyContext';
import { Overview } from './components/overview/Overview';
import { DesignPipeline } from './components/design/DesignPipeline';
import { HarnessPipeline } from './components/pipeline/HarnessPipeline';
import { ImpactRadar } from './components/radar/ImpactRadar';
import { CapacityHeatmap } from './components/heatmap/CapacityHeatmap';
import { Inventory } from './components/inventory/Inventory';
import { WorkOrders } from './components/workorders/WorkOrders';
import { Procurement } from './components/procurement/Procurement';
import { EventsPage } from './components/events/DelayEventsBar';
import { ConnectorCycles } from './components/connectors/ConnectorCycles';
import { ActivityLog } from './components/activitylog/ActivityLog';
import { ChatPanel } from './components/chat/ChatPanel';
import { DraftBanner } from './components/chat/DraftBanner';
import { AIConfigModal } from './components/chat/AIConfigModal';
import { CreateProjectModal, CreateHarnessModal } from './components/shared/CreateModal';
import { PeopleModal } from './components/shared/PeopleModal';
import * as api from './api';

const NAV: { id: ViewId; label: string }[] = [
  { id: 'overview',   label: 'Overview' },
  { id: 'design',     label: 'Design Pipeline' },
  { id: 'pipeline',   label: 'Production Pipeline' },
  { id: 'inventory',   label: 'Inventory' },
  { id: 'workorders',  label: 'Work Orders' },
  { id: 'procurement', label: 'Procurement' },
  { id: 'radar',      label: 'Impact Radar' },
  { id: 'heatmap',    label: 'Capacity Heatmap' },
  { id: 'events',     label: 'Delay Events' },
  { id: 'connectors', label: 'Connector Cycles' },
  { id: 'activitylog', label: 'Activity Log' },
];

// PROGRAMS is derived dynamically from state — see inside App()

// AI insight badge colours
const INSIGHT_COLOR: Record<AIInsight['type'], string> = {
  info:    'bg-done/8 border-done/25 text-done',
  warning: 'bg-risk/8 border-risk/25 text-risk',
  risk:    'bg-blocked/8 border-blocked/25 text-blocked',
};

export default function App() {
  const [view,          setView]        = useState<ViewId>('overview');
  const [program,       setProgram]     = useState<string>('All Programs');
  const [userName,      setUserName]    = useState(() => localStorage.getItem('ewis-user') ?? 'Operator');
  const [readonly,      setReadonly]    = useState(false);
  const [aiAvailable,   setAiAvail]     = useState(false);
  const [showAIConfig,  setAIConf]      = useState(false);
  const [showCreateProj,setCreateProj]  = useState(false);
  const [createHProject,setCreateHProject] = useState<string | null>(null);
  const [insights,      setInsights]    = useState<AIInsight[]>([]);
  const [insightOpen,   setInsightOpen] = useState(false);
  const [chatOpen,      setChatOpen]    = useState(false);
  const [showPeople,    setShowPeople]  = useState(false);

  const {
    state, draft, backendStatus, accepting,
    advanceStage, regressStage, registerBlock, resolveBlock, addNote,
    acceptDraft, rejectDraft, setDraft, refreshState, resetToMock,
  } = useAppState();

  const blockedCount = state.harnesses.filter((h) => h.blocked).length;
  const pendingEcns  = state.ecns.filter((e) => ['pending','aberto_sem_disposicao','aberto_com_disposicao'].includes(e.status)).length;
  const total        = state.harnesses.length;
  const onTrack      = state.harnesses.filter((h) => !h.blocked && h.ecns.length === 0).length;
  const pctOnTrack   = total > 0 ? Math.round((onTrack / total) * 100) : 0;

  // Derive programmes from both harnesses AND milestones so newly created
  // programmes (with no harnesses yet) still appear everywhere.
  const allProjects = [...new Set([
    ...state.milestones.map((m) => m.project),
    ...state.harnesses.map((h) => h.project),
  ])].sort();
  const programOptions = ['All Programs', ...allProjects];

  useEffect(() => { localStorage.setItem('ewis-user', userName); }, [userName]);

  // Detect read-only mode (set by server when running via Cloudflare tunnel)
  useEffect(() => {
    fetch('/api/mode').then((r) => r.json()).then((d) => setReadonly(!!d.readonly)).catch(() => {});
  }, []);

  useEffect(() => {
    if (backendStatus === 'online') {
      api.getAIStatus().then((s) => setAiAvail(!!s.model)).catch(() => {});
    }
  }, [backendStatus]);

  // Background AI insights — poll every 60 s
  const fetchInsights = useCallback(() => {
    if (backendStatus === 'online') {
      api.getAIInsights().then((res) => { if (res.ok) setInsights(res.insights); }).catch(() => {});
    }
  }, [backendStatus]);

  useEffect(() => {
    fetchInsights();
    const id = setInterval(fetchInsights, 60_000);
    return () => clearInterval(id);
  }, [fetchInsights]);

  async function handleAccept() { await acceptDraft(userName); refreshState(); }
  async function handleReject() { await rejectDraft(userName); }

  function handleStateCreated(_newState: AppState) {
    refreshState();
  }

  const filteredState = program === 'All Programs'
    ? state
    : { ...state, harnesses: state.harnesses.filter((h) => h.project === program) };

  const fixedHeight = view === 'pipeline' || view === 'heatmap';

  return (
    <ReadonlyContext.Provider value={readonly}>
    <div className={`flex flex-col bg-bg font-sans ${fixedHeight ? 'h-screen overflow-hidden' : 'min-h-screen'}`}>

      {/* ── Header ── */}
      <header className="shrink-0 bg-surface border-b border-border shadow-card sticky top-0 z-30">

        {/* Brand + controls row */}
        <div className="flex items-center gap-4 px-6 py-3">
          {/* FORGE logo */}
          <div className="flex items-center gap-2.5 mr-1">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 6 L14 2 L24 6 L24 18 Q24 24 14 27 Q4 24 4 18 Z" fill="#1D6FE8" opacity="0.12" />
              <path d="M4 6 L14 2 L24 6 L24 18 Q24 24 14 27 Q4 24 4 18 Z" stroke="#1D6FE8" strokeWidth="1.5" fill="none" />
              <path d="M16 4.5 L10 15 L14.5 15 L12 23.5 L19 13 L14 13 Z" fill="#1D6FE8" />
            </svg>
            <div>
              <div className="font-mono text-sm font-extrabold text-done tracking-[0.18em] leading-tight">FORGE</div>
              <div className="text-[9px] text-dim font-medium tracking-tight leading-tight">
                Production &amp; Engineering Planning
              </div>
            </div>
          </div>

          <div className="w-px h-8 bg-border mx-1" />

          {/* Programme selector */}
          <select value={program} onChange={(e) => setProgram(e.target.value)}
            className="bg-surface2 border border-border text-xs text-text rounded-lg px-3 py-1.5 font-mono focus:outline-none focus:border-accent/60 cursor-pointer shadow-card">
            {programOptions.map((p) => <option key={p}>{p}</option>)}
          </select>

          {/* Create buttons — hidden in readonly mode */}
          {!readonly && (
            <button onClick={() => setCreateProj(true)}
              className="px-3 py-1.5 rounded-lg border border-border bg-surface2 text-xs text-mid font-medium hover:bg-surface3 transition-colors shadow-card">
              + Programme
            </button>
          )}

          <div className="flex-1" />

          {/* AI Insights badge */}
          {insights.length > 0 && (
            <div className="relative">
              <button onClick={() => setInsightOpen((v) => !v)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-done/30 bg-done/8 text-done text-[11px] font-mono font-medium hover:bg-done/14 transition-colors">
                ◈ {insights.length} insight{insights.length !== 1 ? 's' : ''}
              </button>
              {insightOpen && (
                <div className="absolute right-0 top-full mt-2 w-96 bg-surface border border-border rounded-xl shadow-card-md z-50">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <span className="text-sm font-semibold text-text">AI Insights</span>
                    <button onClick={() => setInsightOpen(false)} className="text-dim hover:text-text text-lg">×</button>
                  </div>
                  <div className="divide-y divide-border max-h-72 overflow-y-auto">
                    {insights.map((ins, i) => (
                      <div key={i} className={`flex gap-3 px-4 py-3 ${INSIGHT_COLOR[ins.type]} border-0`}>
                        <span className="text-sm shrink-0">{ins.type === 'risk' ? '🔴' : ins.type === 'warning' ? '⚠️' : 'ℹ️'}</span>
                        <div>
                          <div className="text-xs font-semibold">{ins.title}</div>
                          <div className="text-[10px] mt-0.5 opacity-80">{ins.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="px-4 py-2 border-t border-border text-[9px] text-dim font-mono text-right">
                    Background analysis · updates every 60s
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Right controls */}
          <div className="flex items-center gap-2 text-[11px] font-mono">
            <span className={`px-2.5 py-1 rounded-full border font-medium ${
              backendStatus === 'online'  ? 'bg-ok/10 border-ok/30 text-ok' :
              backendStatus === 'offline' ? 'bg-blocked/10 border-blocked/30 text-blocked' :
              'bg-surface2 border-border text-dim'
            }`}>
              {backendStatus === 'online' ? '● API' : backendStatus === 'offline' ? '○ offline' : '… connecting'}
            </span>

            {!readonly && (
              <button onClick={() => setAIConf(true)}
                className={`px-2.5 py-1 rounded-full border font-medium transition-colors ${
                  aiAvailable ? 'bg-accent/10 border-accent/30 text-accent hover:bg-accent/20'
                              : 'bg-surface2 border-border text-dim hover:text-mid'
                }`}>
                ◈ AI
              </button>
            )}

            {!readonly && (
              <button onClick={() => setShowPeople(true)}
                className="px-2.5 py-1 rounded-full border border-border bg-surface2 text-dim hover:text-mid hover:bg-surface3 transition-colors">
                ♟ People
              </button>
            )}

            {!readonly && (
              <button onClick={resetToMock}
                className="px-2.5 py-1 rounded-full border border-border bg-surface2 text-dim hover:text-mid hover:bg-surface3 transition-colors">
                ↺ Reset
              </button>
            )}

            {!readonly && <button onClick={() => setChatOpen((v) => !v)}
              className={`px-2.5 py-1 rounded-full border font-medium transition-colors flex items-center gap-1.5 ${
                chatOpen
                  ? 'bg-surface border-border text-mid'
                  : 'bg-done/10 border-done/40 text-done hover:bg-done/20'
              }`}>
              ⌘ Agent
              {!aiAvailable && !chatOpen && (
                <span className="w-1.5 h-1.5 rounded-full bg-risk animate-pulse" />
              )}
            </button>}

            {readonly && (
              <span className="px-2.5 py-1 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-400 text-[10px] font-mono font-semibold tracking-widest">
                ◉ READ-ONLY
              </span>
            )}

            <div className="w-px h-4 bg-border mx-1" />
            <span className="text-dim">{userName}</span>
          </div>
        </div>

        {/* Tabs + status row */}
        <div className="flex items-center px-6 border-t border-border/60">
          <nav className="flex">
            {NAV.map(({ id, label }) => (
              <button key={id} onClick={() => setView(id)}
                className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-all whitespace-nowrap ${
                  view === id ? 'border-accent text-accent' : 'border-transparent text-dim hover:text-mid hover:border-border'
                }`}>
                {label}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-2 ml-auto py-1.5 text-[10px] font-mono">
            {blockedCount > 0 && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blocked/8 border border-blocked/25 text-blocked font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-blocked animate-pulse" />
                {blockedCount} blocked
              </span>
            )}
            {pendingEcns > 0 && (
              <span className="px-2.5 py-1 rounded-full bg-risk/8 border border-risk/25 text-risk font-medium">
                ▲ {pendingEcns} ECN pending
              </span>
            )}
            <span className="px-2.5 py-1 rounded-full bg-ok/8 border border-ok/25 text-ok font-medium">
              ✓ {pctOnTrack}% on track
            </span>
          </div>
        </div>
      </header>

      <DraftBanner draft={draft} userName={userName} onAccept={handleAccept} onReject={handleReject} accepting={accepting} />

      {/* Main content */}
      <main className={fixedHeight ? 'flex-1 overflow-hidden' : 'flex-1'}>
        {view === 'overview'   && <Overview state={filteredState} onNavigate={setView} />}
        {view === 'design'     && <DesignPipeline milestones={filteredState.milestones} onStateChange={refreshState} currentUser={userName} onCreateHarness={(proj) => setCreateHProject(proj)} harnesses={filteredState.harnesses} />}
        {view === 'pipeline'   && (
          <HarnessPipeline
            harnesses={filteredState.harnesses}
            currentUser={userName}
            onAdvanceStage={advanceStage}
            onRegressStage={regressStage}
            onRegisterBlock={registerBlock}
            onResolveBlock={resolveBlock}
            onAddNote={addNote}
            onStateChange={refreshState}
            onCreateHarness={(proj) => setCreateHProject(proj)}
          />
        )}
        {view === 'inventory'   && <Inventory />}
        {view === 'workorders'  && <WorkOrders harnesses={state.harnesses} />}
        {view === 'procurement' && <Procurement projects={allProjects} />}
        {view === 'radar'      && <ImpactRadar ecns={state.ecns} harnesses={filteredState.harnesses} onStateChange={refreshState} />}
        {view === 'heatmap'    && <CapacityHeatmap people={state.people} />}
        {view === 'events'     && <EventsPage projects={allProjects} />}
        {view === 'connectors'  && <ConnectorCycles harnesses={state.harnesses.map(h => ({ id: h.id, name: h.name, project: h.project }))} />}
        {view === 'activitylog' && <ActivityLog />}
      </main>

      {showAIConfig && (
        <AIConfigModal onClose={() => {
          setAIConf(false);
          api.getAIStatus().then((s) => setAiAvail(!!s.model)).catch(() => {});
        }} />
      )}

      {showPeople && <PeopleModal onClose={() => setShowPeople(false)} />}

      {showCreateProj && (
        <CreateProjectModal currentUser={userName} onCreated={handleStateCreated} onClose={() => setCreateProj(false)} />
      )}

      {createHProject !== null && (
        <CreateHarnessModal projects={allProjects} initialProject={createHProject} harnesses={state.harnesses} currentUser={userName} onCreated={handleStateCreated} onClose={() => setCreateHProject(null)} />
      )}

      <ChatPanel
        userName={userName}
        onUserNameChange={setUserName}
        onAgentResult={setDraft}
        context={{ view, selection: null }}
        onRunAgent={api.runAgent}
        aiAvailable={aiAvailable}
        open={chatOpen}
        onToggle={() => setChatOpen((v) => !v)}
      />
    </div>
    </ReadonlyContext.Provider>
  );
}
