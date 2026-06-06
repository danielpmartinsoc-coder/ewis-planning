import { useState, useEffect, useRef } from 'react';
import type { AppState, MilestoneStatus, Milestone } from '../../types';
import type { DesignNote } from '../../api';
import * as api from '../../api';
import {
  addDays, isoDate, startOfMonth, datePct,
  buildTicks, ZOOM_ORDER, ZOOM_LABELS, ZOOM_SPAN_DAYS, MONTHS,
} from '../../utils/dates';
import type { ZoomLevel } from '../../utils/dates';

// ────────────────────────────────────────────────────────────────────────────
const PHASES = ['F2', 'F3', 'F4', 'F5', 'F6'] as const;
const PHASE_LABELS: Record<string, string> = {
  F2: 'Architecture', F3: 'Topology', F4: 'ICD / Devices', F5: 'Schematics', F6: 'BoM Release',
};
const STATUS_STYLE: Record<MilestoneStatus, { bar: string; badge: string; text: string }> = {
  done:    { bar: 'bg-ok/30 border-ok/50',          badge: 'bg-ok/10 border-ok/30 text-ok',          text: 'text-ok' },
  risk:    { bar: 'bg-risk/25 border-risk/45',       badge: 'bg-risk/10 border-risk/30 text-risk',    text: 'text-risk' },
  blocked: { bar: 'bg-blocked/20 border-blocked/40', badge: 'bg-blocked/10 border-blocked/30 text-blocked', text: 'text-blocked' },
  open:    { bar: 'bg-surface2 border-border/60',    badge: 'bg-surface border-border/50 text-dim',   text: 'text-dim' },
};
const STATUS_ICON: Record<MilestoneStatus, string>  = { done: '✓', risk: '▲', blocked: '✕', open: '○' };
const STATUS_LABEL: Record<MilestoneStatus, string> = { done: 'Complete', risk: 'At Risk', blocked: 'Blocked', open: 'Open' };

const NOTE_ICON: Record<string, string>  = { note: '📝', comment: '💬', agreement: '✅' };
const NOTE_LABEL: Record<string, string> = { note: 'Note', comment: 'Comment', agreement: 'Agreement' };
const AGR_STATUS_STYLE: Record<string, string> = {
  approved: 'bg-ok/10 border-ok/30 text-ok',
  rejected: 'bg-blocked/10 border-blocked/30 text-blocked',
  pending:  'bg-risk/10 border-risk/30 text-risk',
  '':       'bg-surface2 border-border text-dim',
};

// ── Small shared modals ───────────────────────────────────────────────────────
function RenameModal({ project, onSave, onClose }: {
  project: string; onSave: (n: string) => Promise<void>; onClose: () => void;
}) {
  const [name, setName] = useState(project);
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || name.trim() === project) { onClose(); return; }
    setBusy(true);
    try { await onSave(name.trim()); onClose(); }
    catch (ex: unknown) { setErr(ex instanceof Error ? ex.message : 'Failed'); }
    finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25" onClick={onClose}>
      <div className="w-80 bg-surface rounded-2xl border border-border shadow-card-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-sm text-text mb-3">Rename Programme</h3>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
            className="px-3 py-2 rounded-lg border border-border bg-bg text-sm font-mono font-bold text-text focus:outline-none focus:border-accent/60" />
          {err && <p className="text-xs text-blocked">{err}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg border border-border text-xs text-dim">Cancel</button>
            <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-lg bg-done/90 text-white text-xs font-semibold disabled:opacity-50">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditMilestoneModal({ ms, onSave, onClose }: {
  ms: Milestone; onSave: (d: Partial<Milestone>) => Promise<void>; onClose: () => void;
}) {
  const [label,   setLabel]   = useState(ms.label);
  const [planned, setPlanned] = useState(ms.planned);
  const [actual,  setActual]  = useState(ms.actual ?? '');
  const [status,  setStatus]  = useState<MilestoneStatus>(ms.status);
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { await onSave({ label, planned, actual: actual || null, status }); onClose(); }
    catch (ex: unknown) { setErr(ex instanceof Error ? ex.message : 'Failed'); }
    finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25" onClick={onClose}>
      <div className="w-[400px] bg-surface rounded-2xl border border-border shadow-card-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm text-text">Edit — {ms.project} · {ms.phase}</h3>
          <button onClick={onClose} className="text-dim hover:text-text text-lg">×</button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Label</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Planned</label>
              <input type="date" value={planned} onChange={(e) => setPlanned(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60" />
            </div>
            <div>
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Actual</label>
              <input type="date" value={actual} onChange={(e) => setActual(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-2">Status</label>
            <div className="flex gap-2 flex-wrap">
              {(['open','done','risk','blocked'] as MilestoneStatus[]).map((s) => (
                <button type="button" key={s} onClick={() => setStatus(s)}
                  className={`px-3 py-1 rounded-lg border text-[11px] font-mono font-bold transition-all ${
                    status === s ? STATUS_STYLE[s].badge : 'border-border text-dim hover:text-mid'
                  }`}>{STATUS_ICON[s]} {STATUS_LABEL[s]}</button>
              ))}
            </div>
          </div>
          {err && <p className="text-xs text-blocked">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg border border-border text-xs text-dim">Cancel</button>
            <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-lg bg-done/90 text-white text-xs font-semibold disabled:opacity-50">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Notes / Comments / Agreements panel ──────────────────────────────────────
type NoteTab = 'note' | 'comment' | 'agreement';

function NotesPanel({ ms, currentUser }: { ms: Milestone; currentUser: string }) {
  const [tab,     setTab]    = useState<NoteTab>('note');
  const [notes,   setNotes]  = useState<DesignNote[]>([]);
  const [loading, setLoad]   = useState(true);
  const [text,    setText]   = useState('');
  const [agrSt,   setAgrSt]  = useState('approved');
  const [busy,    setBusy]   = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  async function load() {
    setLoad(true);
    const res = await api.getDesignNotes(ms.project, ms.phase);
    setNotes(res.notes ?? []);
    setLoad(false);
  }

  useEffect(() => { load(); }, [ms.project, ms.phase]);

  const filtered = notes.filter((n) => n.type === tab);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    const ts = new Date().toISOString();
    await api.addDesignNote(ms.project, ms.phase, {
      type: tab, author: currentUser, text: text.trim(),
      status: tab === 'agreement' ? agrSt : '',
      timestamp: ts,
    });
    setText('');
    await load();
    setBusy(false);
  }

  async function del(id: string) {
    await api.deleteDesignNote(ms.project, ms.phase, id);
    setNotes((p) => p.filter((n) => n.id !== id));
  }

  function fmtTs(ts: string) {
    try { return new Date(ts).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }); }
    catch { return ts; }
  }

  const TABS: NoteTab[] = ['note', 'comment', 'agreement'];

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-border shrink-0">
        {TABS.map((t) => {
          const cnt = notes.filter((n) => n.type === t).length;
          return (
            <button key={t} onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-all ${
                tab === t ? 'border-accent text-accent' : 'border-transparent text-dim hover:text-mid'
              }`}>
              <span>{NOTE_ICON[t]}</span>
              <span>{NOTE_LABEL[t]}s</span>
              {cnt > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-surface2 border border-border text-[9px] font-bold text-mid">{cnt}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Notes list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <p className="text-xs text-dim text-center py-6 animate-pulse">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-2xl mb-2">{NOTE_ICON[tab]}</p>
            <p className="text-xs text-dim">No {NOTE_LABEL[tab].toLowerCase()}s yet.</p>
          </div>
        ) : (
          [...filtered].reverse().map((n) => (
            <div key={n.id} className="group/note bg-surface rounded-xl border border-border p-3 shadow-card">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[12px] text-text">{n.author}</span>
                  {n.type === 'agreement' && n.status && (
                    <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold font-mono ${AGR_STATUS_STYLE[n.status] ?? AGR_STATUS_STYLE['']}`}>
                      {n.status.toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] text-dim">{fmtTs(n.timestamp)}</span>
                  <button onClick={() => del(n.id)}
                    className="w-4 h-4 flex items-center justify-center rounded text-[10px] text-dim hover:text-blocked opacity-0 group-hover/note:opacity-100 transition-opacity">✕</button>
                </div>
              </div>
              <p className="text-[12px] text-text leading-relaxed whitespace-pre-wrap">{n.text}</p>
            </div>
          ))
        )}
      </div>

      {/* Input form */}
      <form onSubmit={submit} className="shrink-0 border-t border-border p-3 bg-surface space-y-2">
        {tab === 'agreement' && (
          <div className="flex gap-2">
            {(['approved','rejected','pending'] as const).map((s) => (
              <button type="button" key={s} onClick={() => setAgrSt(s)}
                className={`px-2.5 py-1 rounded-lg border text-[10px] font-mono font-bold transition-all ${
                  agrSt === s ? AGR_STATUS_STYLE[s] : 'border-border text-dim hover:text-mid'
                }`}>{s.toUpperCase()}</button>
            ))}
          </div>
        )}
        <textarea ref={textRef} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={`Add a ${NOTE_LABEL[tab].toLowerCase()}…`}
          rows={2}
          className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text placeholder-dim focus:outline-none focus:border-accent/60 resize-none" />
        <div className="flex justify-end">
          <button type="submit" disabled={busy || !text.trim()}
            className="px-4 py-1.5 rounded-lg bg-done/90 text-white text-xs font-semibold hover:bg-done disabled:opacity-40">
            {busy ? 'Saving…' : `Add ${NOTE_LABEL[tab]}`}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Gantt chart for design milestones ────────────────────────────────────────
function DesignGantt({
  milestones, selectedMs, onSelectMs, onEditMs,
}: {
  milestones: AppState['milestones'];
  selectedMs: Milestone | null;
  onSelectMs: (ms: Milestone) => void;
  onEditMs: (ms: Milestone) => void;
}) {
  const todayDate = new Date(); todayDate.setHours(0,0,0,0);
  const todayStr  = isoDate(todayDate);

  const allIso = milestones.flatMap((m) => [m.planned, m.actual].filter(Boolean) as string[]);
  const dataCenter = allIso.length
    ? new Date((new Date(allIso.reduce((a,b) => a<b?a:b)).getTime() +
                new Date(allIso.reduce((a,b) => a>b?a:b)).getTime()) / 2)
    : todayDate;

  const [zoom, setZoom] = useState<ZoomLevel>('quarter');
  const [viewStart, setVS] = useState<Date>(() => {
    const span = ZOOM_SPAN_DAYS['quarter'];
    return addDays(dataCenter, -Math.floor(span / 2));
  });

  const spanDays = ZOOM_SPAN_DAYS[zoom];
  const viewEnd  = addDays(viewStart, spanDays);
  const ticks    = buildTicks(zoom, viewStart, viewEnd);

  const todayPct     = datePct(todayStr, viewStart, viewEnd);
  const todayVisible = new Date(todayStr) >= viewStart && new Date(todayStr) <= viewEnd;

  function pan(days: number) { setVS((v) => addDays(v, days)); }
  function goToday() { setVS(addDays(todayDate, -Math.floor(spanDays / 2))); }
  function changeZoom(nz: ZoomLevel) {
    const center = addDays(viewStart, Math.floor(spanDays / 2));
    setVS(addDays(center, -Math.floor(ZOOM_SPAN_DAYS[nz] / 2)));
    setZoom(nz);
  }
  function jumpToMonth(year: number, month: number) {
    setVS(new Date(year, month, 1));
    if (zoom === 'year') changeZoom('quarter');
  }

  const projects = [...new Set(milestones.map((m) => m.project))].sort();
  const ROW_H = 44;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface2 shrink-0 flex-wrap">
        <div className="flex items-center gap-1 border border-border rounded-lg p-0.5 bg-surface">
          <button onClick={() => { const i = ZOOM_ORDER.indexOf(zoom); if (i>0) changeZoom(ZOOM_ORDER[i-1]); }}
            disabled={zoom==='year'}
            className="w-6 h-6 flex items-center justify-center rounded text-sm text-dim hover:text-text disabled:opacity-30">−</button>
          {ZOOM_ORDER.map((z) => (
            <button key={z} onClick={() => changeZoom(z)}
              className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-bold transition-all ${
                zoom===z ? 'bg-done/90 text-white' : 'text-dim hover:text-mid'
              }`}>{ZOOM_LABELS[z]}</button>
          ))}
          <button onClick={() => { const i = ZOOM_ORDER.indexOf(zoom); if (i<ZOOM_ORDER.length-1) changeZoom(ZOOM_ORDER[i+1]); }}
            disabled={zoom==='week'}
            className="w-6 h-6 flex items-center justify-center rounded text-sm text-dim hover:text-text disabled:opacity-30">+</button>
        </div>
        <button onClick={() => pan(-Math.ceil(spanDays/2))}
          className="px-2.5 py-1 rounded-lg border border-border text-xs text-dim hover:text-mid hover:bg-surface3">← Prev</button>
        <button onClick={goToday}
          className="px-2.5 py-1 rounded-lg border border-done/40 bg-done/8 text-done text-[11px] font-semibold hover:bg-done/15">Today</button>
        <button onClick={() => pan(Math.ceil(spanDays/2))}
          className="px-2.5 py-1 rounded-lg border border-border text-xs text-dim hover:text-mid hover:bg-surface3">Next →</button>
        <span className="text-[10px] font-mono text-dim ml-1">{isoDate(viewStart)} → {isoDate(viewEnd)}</span>
      </div>

      {/* Month quick-filter */}
      {zoom !== 'year' && (() => {
        const months: {label:string;year:number;month:number}[] = [];
        let d = startOfMonth(viewStart);
        while (d <= viewEnd) {
          months.push({ label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, year: d.getFullYear(), month: d.getMonth() });
          d = new Date(d.getFullYear(), d.getMonth()+1, 1);
        }
        return (
          <div className="flex gap-1 px-4 py-1.5 border-b border-border bg-surface/60 shrink-0 flex-wrap">
            <span className="text-[9px] font-mono text-dim uppercase tracking-wider mr-1 self-center">Jump:</span>
            {months.map((m) => (
              <button key={`${m.year}-${m.month}`} onClick={() => jumpToMonth(m.year, m.month)}
                className="px-2 py-0.5 rounded border border-border text-[10px] font-mono text-mid hover:bg-done/8 hover:border-done/35 hover:text-done transition-all">
                {m.label}
              </button>
            ))}
          </div>
        );
      })()}

      {/* Chart */}
      <div className="flex flex-1 overflow-auto min-h-0">
        {/* Frozen left column */}
        <div className="shrink-0 w-44 border-r border-border bg-surface z-10">
          <div className="h-10 border-b border-border bg-surface2 flex items-center px-3">
            <span className="text-[9px] font-mono text-dim uppercase tracking-widest">Programme</span>
          </div>
          {projects.map((proj) => {
            const pMs   = milestones.filter((m) => m.project === proj);
            const done  = pMs.filter((m) => m.status === 'done').length;
            return (
              <div key={proj} className="border-b border-border/40 px-3 flex items-center gap-2"
                style={{ height: ROW_H }}>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[11px] font-bold text-text truncate">{proj}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className="flex-1 h-1 bg-border/30 rounded-full overflow-hidden">
                      <div className="h-full bg-ok/60 rounded-full" style={{ width: `${Math.round((done/PHASES.length)*100)}%` }} />
                    </div>
                    <span className="text-[8px] text-dim font-mono shrink-0">{done}/{PHASES.length}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Scrollable chart area */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="relative" style={{ minWidth: '100%' }}>
            {/* Axis */}
            <div className="sticky top-0 z-10 h-10 bg-surface2 border-b border-border relative overflow-hidden">
              {ticks.map((t, i) => (
                <button key={i} onClick={() => jumpToMonth(t.year, t.month)}
                  title={t.label}
                  className={`absolute top-0 bottom-0 flex items-center pl-1.5 hover:bg-done/6 transition-colors text-left ${
                    t.major ? 'border-l-2 border-done/40' : 'border-l border-border/50'
                  }`}
                  style={{ left: `${t.pct}%` }}>
                  <span className={`font-mono leading-tight pointer-events-none ${
                    t.major ? 'text-[10px] font-bold text-text' : 'text-[9px] text-dim'
                  }`}>{t.label}</span>
                </button>
              ))}
              {todayVisible && (
                <div className="absolute top-0 bottom-0 w-0.5 bg-risk/70 z-20 pointer-events-none"
                  style={{ left: `${todayPct}%` }}>
                  <span className="absolute top-0.5 left-1 text-[8px] font-mono font-bold text-risk whitespace-nowrap">▼ today</span>
                </div>
              )}
            </div>

            {/* Rows */}
            {projects.map((proj) => {
              const pMs = milestones.filter((m) => m.project === proj);
              return (
                <div key={proj} className="relative border-b border-border/30" style={{ height: ROW_H }}>
                  {/* Grid lines */}
                  {ticks.filter((t) => t.major).map((t, i) => (
                    <div key={i} className="absolute top-0 bottom-0 w-px bg-border/40 pointer-events-none"
                      style={{ left: `${t.pct}%` }} />
                  ))}
                  {todayVisible && (
                    <div className="absolute top-0 bottom-0 w-px bg-risk/40 pointer-events-none z-10"
                      style={{ left: `${todayPct}%` }} />
                  )}

                  {/* Phase bars and connecting line */}
                  {(() => {
                    const sorted = PHASES
                      .map((ph) => pMs.find((m) => m.phase === ph))
                      .filter(Boolean) as Milestone[];

                    return sorted.map((ms, idx) => {
                      const nextMs = sorted[idx + 1];
                      const msPct  = datePct(ms.planned, viewStart, viewEnd);
                      const inView = new Date(ms.planned) >= viewStart && new Date(ms.planned) <= viewEnd;

                      // Bar spans from this milestone to next (or self+small width if last)
                      const barEnd    = nextMs ? nextMs.planned : ms.planned;
                      const barEndPct = nextMs ? datePct(barEnd, viewStart, viewEnd) : Math.min(100, msPct + 4);
                      const barW      = Math.max(0.5, barEndPct - msPct);
                      const st        = STATUS_STYLE[ms.status];
                      const isSelected = selectedMs?.project === ms.project && selectedMs?.phase === ms.phase;

                      return (
                        <div key={ms.phase}>
                          {/* Bar segment */}
                          {barW > 0.3 && (
                            <button
                              onClick={() => onSelectMs(ms)}
                              title={`${ms.project} · ${ms.phase} ${PHASE_LABELS[ms.phase]}\nPlanned: ${ms.planned}${ms.actual ? '\nActual: '+ms.actual : ''}`}
                              className={`absolute rounded-md border transition-all group/bar ${st.bar} ${
                                isSelected ? 'ring-2 ring-done/60 ring-offset-1' : 'hover:brightness-95'
                              }`}
                              style={{ top: 8, height: ROW_H - 16, left: `${msPct}%`, width: `${barW}%` }}
                            >
                              {/* Phase label inside bar */}
                              {barW > 5 && (
                                <span className={`absolute inset-0 flex items-center px-2 font-mono text-[9px] font-bold ${st.text}`}>
                                  {ms.phase}
                                  {barW > 12 && <span className="ml-1 font-normal opacity-70 truncate">{PHASE_LABELS[ms.phase]}</span>}
                                </span>
                              )}
                              {/* Actual completion diamond */}
                              {ms.actual && inView && (() => {
                                const aPct = datePct(ms.actual, viewStart, viewEnd);
                                const rel  = ((aPct - msPct) / barW) * 100;
                                if (rel < 0 || rel > 100) return null;
                                return (
                                  <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-sm bg-ok rotate-45 border border-ok/60 shadow-sm"
                                    title={`Completed: ${ms.actual}`}
                                    style={{ left: `calc(${rel}% - 5px)` }} />
                                );
                              })()}
                              {/* Edit button on hover */}
                              <button
                                onClick={(e) => { e.stopPropagation(); onEditMs(ms); }}
                                className="absolute top-0.5 right-0.5 w-4 h-4 flex items-center justify-center rounded bg-surface/80 text-[9px] text-dim hover:text-done opacity-0 group-hover/bar:opacity-100 transition-opacity">✏</button>
                            </button>
                          )}

                          {/* Milestone marker (diamond) at planned date */}
                          {inView && (
                            <div className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-sm rotate-45 border-2 shadow-sm ${
                              ms.status === 'done' ? 'bg-ok border-ok' :
                              ms.status === 'risk' ? 'bg-risk border-risk' :
                              ms.status === 'blocked' ? 'bg-blocked border-blocked' :
                              'bg-surface border-border'
                            }`}
                              style={{ left: `calc(${msPct}% - 6px)`, pointerEvents: 'none' }} />
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="shrink-0 flex items-center gap-5 px-4 py-2 border-t border-border bg-surface text-[9px] font-mono text-dim">
        {(['done','risk','blocked','open'] as MilestoneStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`w-6 h-3 rounded inline-block border ${STATUS_STYLE[s].bar}`} />
            {STATUS_LABEL[s]}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm rotate-45 bg-ok border border-ok inline-block" /> Actual date
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-px h-4 bg-risk/60 inline-block" /> Today
        </span>
        <span className="ml-auto text-dim/50">Click a phase bar to open notes · ✏ to edit dates</span>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
interface Props {
  milestones: AppState['milestones'];
  onStateChange: () => void;
  currentUser?: string;
}

export function DesignPipeline({ milestones, onStateChange, currentUser = 'Operator' }: Props) {
  const [renaming,   setRenaming]  = useState<string | null>(null);
  const [editingMs,  setEditingMs] = useState<Milestone | null>(null);
  const [selectedMs, setSelected]  = useState<Milestone | null>(null);

  const projects = [...new Set(milestones.map((m) => m.project))].sort();

  async function handleRename(project: string, newName: string) {
    const res = await api.renameProject(project, newName, 'ui');
    if (!res.ok) throw new Error(res.error);
    onStateChange();
  }

  async function handleDeleteProject(project: string) {
    if (!confirm(`Delete programme "${project}" and ALL its harnesses and milestones? This cannot be undone.`)) return;
    const res = await api.deleteProject(project);
    if (!res.ok) { alert(res.error); return; }
    if (selectedMs?.project === project) setSelected(null);
    onStateChange();
  }

  async function handleEditMilestone(ms: Milestone, data: Partial<Milestone>) {
    const res = await api.upsertMilestone({
      project: ms.project, phase: ms.phase,
      label:   data.label   ?? ms.label,
      planned: data.planned ?? ms.planned,
      status:  data.status  ?? ms.status,
      actual:  data.actual  !== undefined ? (data.actual || null) : ms.actual,
    });
    if (!res.ok) throw new Error(res.error);
    onStateChange();
  }

  async function handleDeleteMilestone(ms: Milestone) {
    if (!confirm(`Delete milestone ${ms.phase} — "${ms.label}" from ${ms.project}?`)) return;
    const res = await api.deleteMilestone(ms.project, ms.phase);
    if (!res.ok) { alert(res.error); return; }
    if (selectedMs?.project === ms.project && selectedMs?.phase === ms.phase) setSelected(null);
    onStateChange();
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">

      {/* ── Sub-header ── */}
      <div className="flex items-center gap-4 px-6 py-2.5 border-b border-border bg-surface shrink-0">
        <div>
          <h1 className="font-semibold text-text text-sm">Design Pipeline</h1>
          <p className="text-[10px] text-dim font-mono">F2–F6 engineering milestones — {projects.length} programmes</p>
        </div>

        {/* Programme management */}
        <div className="flex gap-2 ml-6 flex-wrap">
          {projects.map((proj) => {
            const pMs  = milestones.filter((m) => m.project === proj);
            const done = pMs.filter((m) => m.status === 'done').length;
            const hasRisk    = pMs.some((m) => m.status === 'risk');
            const hasBlocked = pMs.some((m) => m.status === 'blocked');
            return (
              <div key={proj} className="flex items-center gap-1 group/prog">
                <button
                  onClick={() => setSelected(pMs[0] ?? null)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-mono font-semibold transition-all ${
                    hasBlocked ? 'border-blocked/40 bg-blocked/8 text-blocked' :
                    hasRisk    ? 'border-risk/40 bg-risk/8 text-risk' :
                    done === PHASES.length ? 'border-ok/40 bg-ok/8 text-ok' :
                    'border-border bg-surface2 text-mid'
                  }`}>
                  {hasBlocked ? '✕' : hasRisk ? '▲' : done === PHASES.length ? '✓' : '○'}
                  {proj}
                  <span className="text-[9px] opacity-60">{done}/{PHASES.length}</span>
                </button>
                <div className="flex gap-0.5 opacity-0 group-hover/prog:opacity-100 transition-opacity">
                  <button onClick={() => setRenaming(proj)} title="Rename"
                    className="w-5 h-5 flex items-center justify-center rounded border border-border text-[10px] text-dim hover:text-done hover:border-done/40">✏</button>
                  <button onClick={() => handleDeleteProject(proj)} title="Delete"
                    className="w-5 h-5 flex items-center justify-center rounded border border-border text-[10px] text-dim hover:text-blocked hover:border-blocked/40">✕</button>
                </div>
              </div>
            );
          })}
        </div>

        {projects.length === 0 && (
          <p className="text-xs text-dim italic">No programmes — use + Programme to create one.</p>
        )}
      </div>

      {/* ── Body: Gantt (top) + detail panel (bottom) ── */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Gantt */}
        <div className={`overflow-hidden transition-all ${selectedMs ? 'flex-[0_0_55%]' : 'flex-1'}`}>
          {projects.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-dim">
              No phases to display. Create a programme first.
            </div>
          ) : (
            <DesignGantt
              milestones={milestones}
              selectedMs={selectedMs}
              onSelectMs={setSelected}
              onEditMs={setEditingMs}
            />
          )}
        </div>

        {/* Detail panel — slides in when milestone selected */}
        {selectedMs && (
          <div className="flex-[0_0_45%] border-t-2 border-done/30 bg-surface flex flex-col min-h-0">
            {/* Panel header */}
            <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border bg-surface2 shrink-0">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-sm rotate-45 ${
                  selectedMs.status === 'done' ? 'bg-ok' :
                  selectedMs.status === 'risk' ? 'bg-risk' :
                  selectedMs.status === 'blocked' ? 'bg-blocked' : 'bg-border'
                }`} />
                <span className="font-mono text-[11px] font-bold text-text">{selectedMs.project}</span>
                <span className="text-dim">·</span>
                <span className="font-mono text-[11px] font-bold text-done">{selectedMs.phase}</span>
                <span className="text-sm text-text">{selectedMs.label}</span>
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <span className={`px-2 py-0.5 rounded border text-[10px] font-mono font-bold ${STATUS_STYLE[selectedMs.status].badge}`}>
                  {STATUS_ICON[selectedMs.status]} {STATUS_LABEL[selectedMs.status]}
                </span>
                <span className="text-[10px] text-dim font-mono">P: {selectedMs.planned}</span>
                {selectedMs.actual && <span className="text-[10px] text-ok font-mono">A: {selectedMs.actual}</span>}
                <button onClick={() => setEditingMs(selectedMs)}
                  className="px-2.5 py-1 rounded-lg border border-border text-[11px] text-mid hover:text-done hover:border-done/40 transition-colors">✏ Edit</button>
                <button onClick={() => handleDeleteMilestone(selectedMs)}
                  className="px-2.5 py-1 rounded-lg border border-border text-[11px] text-mid hover:text-blocked hover:border-blocked/40 transition-colors">✕ Delete</button>
                <button onClick={() => setSelected(null)}
                  className="w-6 h-6 flex items-center justify-center rounded border border-border text-dim hover:text-text ml-1">×</button>
              </div>
            </div>

            {/* Notes/Comments/Agreements */}
            <div className="flex-1 min-h-0">
              <NotesPanel ms={selectedMs} currentUser={currentUser} />
            </div>
          </div>
        )}
      </div>

      {renaming  && <RenameModal project={renaming} onSave={(n) => handleRename(renaming, n)} onClose={() => setRenaming(null)} />}
      {editingMs && <EditMilestoneModal ms={editingMs} onSave={(d) => handleEditMilestone(editingMs, d)} onClose={() => setEditingMs(null)} />}
    </div>
  );
}
