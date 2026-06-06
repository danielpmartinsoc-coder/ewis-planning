import { useState, useEffect } from 'react';
import type { Harness, HarnessNote } from '../../types';
import { addDays, isoDate, startOfMonth, datePct, buildTicks, ZOOM_ORDER, ZOOM_LABELS, ZOOM_SPAN_DAYS, MONTHS } from '../../utils/dates';
import type { ZoomLevel } from '../../utils/dates';
import { STAGES } from '../../types';
import { BlockPanel } from './BlockPanel';
import { StageMoveDialog } from './StageMoveDialog';
import { HarnessNotes } from './HarnessNotes';
import * as api from '../../api';

interface Props {
  harnesses: Harness[];
  currentUser: string;
  onAdvanceStage: (id: string, reason: string) => void;
  onRegressStage: (id: string, reason: string) => void;
  onRegisterBlock: (id: string, reason: string, responsible: string) => void;
  onResolveBlock: (id: string, note: string) => void;
  onAddNote: (harnessId: string, author: string, text: string, attachments: HarnessNote['attachments']) => void;
  onStateChange?: () => void;
}

// ── Edit Harness modal ────────────────────────────────────────────────────────
function EditHarnessModal({ harness, onSave, onClose }: {
  harness: Harness;
  onSave: () => void;
  onClose: () => void;
}) {
  const [name,         setName]        = useState(harness.name);
  const [responsible,  setResponsible] = useState(harness.responsible ?? '');
  const [revision,     setRevision]    = useState(harness.revision);
  const [plannedStart, setPS]          = useState(harness.plannedStart ?? '');
  const [plannedEnd,   setPE]          = useState(harness.plannedEnd   ?? '');
  const [actualStart,  setAS]          = useState(harness.actualStart  ?? '');
  const [actualEnd,    setAE]          = useState(harness.actualEnd    ?? '');
  const [busy,         setBusy]        = useState(false);
  const [err,          setErr]         = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await api.updateHarness(harness.id, {
      name: name.trim(), responsible: responsible.trim(), revision: revision.trim(),
      plannedStart: plannedStart || undefined, plannedEnd: plannedEnd || undefined,
      actualStart:  actualStart  || undefined, actualEnd:  actualEnd  || undefined,
    });
    setBusy(false);
    if (!res.ok) { setErr(res.error ?? 'Failed'); return; }
    onSave();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25" onClick={onClose}>
      <div className="w-96 bg-surface rounded-2xl border border-border shadow-card-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-sm text-text">Edit Harness</h3>
            <span className="font-mono text-[11px] text-dim">{harness.id}</span>
          </div>
          <button onClick={onClose} className="text-dim hover:text-text text-lg">×</button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
              className="w-full px-3 py-1.5 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Responsible</label>
              <input value={responsible} onChange={(e) => setResponsible(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60" />
            </div>
            <div>
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Revision</label>
              <input value={revision} onChange={(e) => setRevision(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60" />
            </div>
          </div>
          <div className="border-t border-border/50 pt-3">
            <p className="text-[10px] font-mono text-dim uppercase tracking-wider mb-2">Schedule</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Planned Start', plannedStart, setPS],
                ['Planned End',   plannedEnd,   setPE],
                ['Actual Start',  actualStart,  setAS],
                ['Actual End',    actualEnd,    setAE],
              ].map(([label, val, setter]) => (
                <div key={label as string}>
                  <label className="text-[10px] font-mono text-dim block mb-1">{label as string}</label>
                  <input type="date" value={val as string} onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60" />
                </div>
              ))}
            </div>
          </div>
          {err && <p className="text-xs text-blocked">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg border border-border text-xs text-dim hover:text-mid">Cancel</button>
            <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-lg bg-done/90 text-white text-xs font-semibold disabled:opacity-50">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}

type Filter = string; // dynamic — 'ALL' | any project name

// Cycle through distinguishable colours for unlimited programmes
const PROJ_PALETTE = [
  'border-l-done text-done bg-done/4',
  'border-l-ok text-ok bg-ok/4',
  'border-l-risk text-risk bg-risk/4',
  'border-l-accent text-accent bg-accent/4',
  'border-l-delivered text-delivered bg-delivered/4',
  'border-l-mid text-mid bg-mid/4',
];
function projHdr(index: number): string {
  return PROJ_PALETTE[index % PROJ_PALETTE.length];
}

interface MoveTarget { harness: Harness; direction: 'advance' | 'back' }

export function HarnessPipeline({
  harnesses, currentUser,
  onAdvanceStage, onRegressStage, onRegisterBlock, onResolveBlock, onAddNote,
  onStateChange,
}: Props) {
  // Derive projects dynamically from the harnesses prop
  const projects = [...new Set(harnesses.map((h) => h.project))].sort();
  const projIndex = Object.fromEntries(projects.map((p, i) => [p, i]));

  const [filter, setFilter]            = useState<Filter>('ALL');
  const [viewMode, setViewMode]        = useState<'stage' | 'gantt'>('stage');
  const [selectedHarness, setSelected] = useState<Harness | null>(null);
  const [moveTarget, setMoveTarget]    = useState<MoveTarget | null>(null);
  const [notesHarness, setNotesH]      = useState<Harness | null>(null);
  const [editHarness,   setEditH]      = useState<Harness | null>(null);
  const [search, setSearch]            = useState('');
  const [onlyBlocked, setOnlyBlocked]  = useState(false);
  const [page, setPage]                = useState(0);
  const PAGE_SIZE = 100;

  const filters: Filter[] = ['ALL', ...projects];
  const visibleProjects = filter === 'ALL' ? projects : projects.filter((p) => p === filter);

  // Apply text/blocked filters once, up front — scales to thousands of rows
  const q = search.trim().toLowerCase();
  const matches = (h: Harness) =>
    (!onlyBlocked || h.blocked) &&
    (!q || h.id.toLowerCase().includes(q) || h.name.toLowerCase().includes(q) ||
      (h.responsible ?? '').toLowerCase().includes(q));

  const visibleSet = new Set<string>(visibleProjects);
  const filteredHarnesses = harnesses.filter((h) => visibleSet.has(h.project) && matches(h));
  const totalFiltered = filteredHarnesses.length;
  const pageCount = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pageHarnesses = filteredHarnesses.slice(pageStart, pageStart + PAGE_SIZE);

  // Reset to first page whenever the active filters change
  useEffect(() => { setPage(0); }, [filter, search, onlyBlocked]);

  // Group the current page's rows by project (preserves project headers)
  const pageByProject = visibleProjects
    .map((proj) => ({ proj, rows: pageHarnesses.filter((h) => h.project === proj) }))
    .filter((g) => g.rows.length > 0);

  function handleCellClick(harness: Harness, stageIdx: number) {
    if (harness.blocked && stageIdx === harness.stage) { setSelected(harness); return; }
    if (!harness.blocked && stageIdx === harness.stage + 1 && harness.stage < 7)
      setMoveTarget({ harness, direction: 'advance' });
    else if (!harness.blocked && stageIdx === harness.stage - 1 && harness.stage > 0)
      setMoveTarget({ harness, direction: 'back' });
    else if (stageIdx === harness.stage)
      setSelected(harness);
  }

  function confirmMove(reason: string) {
    if (!moveTarget) return;
    if (moveTarget.direction === 'advance') onAdvanceStage(moveTarget.harness.id, reason);
    else onRegressStage(moveTarget.harness.id, reason);
    setMoveTarget(null);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-header */}
      <div className="flex items-center gap-3 px-5 py-2 border-b border-border bg-surface/70 shrink-0">
        <div className="shrink-0">
          <h1 className="font-semibold text-text text-sm tracking-tight">Production Pipeline</h1>
          <p className="text-[10px] text-dim mt-0.5 font-mono">
            F7 execution — {totalFiltered} of {harnesses.length} harnesses
          </p>
        </div>

        {/* Search */}
        <div className="relative ml-4 w-64">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dim text-xs">⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ID, name, responsible…"
            className="w-full pl-7 pr-3 py-1.5 rounded-md bg-surface2 border border-border/60 text-xs text-text placeholder-dim focus:outline-none focus:border-accent/50 font-mono"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-dim hover:text-text text-xs">×</button>
          )}
        </div>

        <button
          onClick={() => setOnlyBlocked((v) => !v)}
          className={`px-2.5 py-1.5 rounded-md text-[10px] font-mono font-bold tracking-wider border transition-all ${
            onlyBlocked
              ? 'bg-blocked/12 border-blocked/35 text-blocked'
              : 'border-border/60 text-dim hover:text-mid hover:border-mid/30'
          }`}
        >
          ● BLOCKED
        </button>

        {/* View mode toggle */}
        <div className="flex gap-1 border border-border rounded-lg p-0.5 bg-surface2">
          {(['stage', 'gantt'] as const).map((m) => (
            <button key={m} onClick={() => setViewMode(m)}
              className={`px-3 py-1 rounded-md text-[10px] font-mono font-bold tracking-wider transition-all ${
                viewMode === m ? 'bg-surface border-border text-done shadow-card' : 'text-dim hover:text-mid'
              }`}>
              {m === 'stage' ? '▤ Stages' : '▬ Schedule'}
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          {filters.map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded text-[10px] font-mono font-bold tracking-wider transition-all ${
                filter === f
                  ? 'bg-done/12 border border-done/35 text-done'
                  : 'border border-border/60 text-dim hover:text-mid hover:border-mid/30'
              }`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {/* ── Gantt / Schedule view ── */}
        {viewMode === 'gantt' && (
          <GanttView harnesses={filteredHarnesses} onEditClick={setEditH} />
        )}

        {/* ── Stage grid view ── */}
        {viewMode === 'stage' && <table className="w-full text-xs border-collapse min-w-[960px]">
          <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur-sm">
            <tr>
              <th className="text-left px-4 py-2.5 font-mono text-[10px] uppercase tracking-widest text-dim font-normal border-b border-r border-border w-48">
                Harness / ID
              </th>
              {STAGES.map((stage) => (
                <th key={stage} className="px-2 py-2.5 text-center font-mono text-[10px] uppercase tracking-wider text-dim font-normal border-b border-r border-border last:border-r-0">
                  {stage}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {totalFiltered === 0 ? (
              <tr>
                <td colSpan={STAGES.length + 2} className="px-4 py-12 text-center text-xs text-dim font-mono">
                  No harnesses match the current filters.
                </td>
              </tr>
            ) : (
              pageByProject.map(({ proj, rows }) => [
                <tr key={`hdr-${proj}`}>
                  <td
                    colSpan={STAGES.length + 2}
                    className={`px-4 py-1 border-b border-border font-mono text-[10px] font-bold tracking-widest border-l-2 ${projHdr(projIndex[proj] ?? 0)}`}
                  >
                    {proj} <span className="text-dim/50 font-normal">· {rows.length}</span>
                  </td>
                </tr>,
                ...rows.map((harness) => (
                  <HarnessRow
                    key={harness.id}
                    harness={harness}
                    onCellClick={handleCellClick}
                    onInfoClick={() => setSelected(harness)}
                    onNotesClick={() => setNotesH(harness)}
                    onEditClick={() => setEditH(harness)}
                    onDeleteClick={async () => {
                      if (!confirm(`Delete harness ${harness.id} — ${harness.name}? This cannot be undone.`)) return;
                      const res = await api.deleteHarness(harness.id);
                      if (!res.ok) { alert(res.error); return; }
                      onStateChange?.();
                    }}
                  />
                )),
              ])
            )}
          </tbody>
        </table>}
      </div>

      {viewMode === 'stage' && pageCount > 1 && (
        <div className="shrink-0 flex items-center justify-center gap-3 px-5 py-1.5 border-t border-border bg-surface/60 text-[10px] font-mono">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            className="px-2 py-1 rounded border border-border/60 text-dim hover:text-mid disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <span className="text-mid">
            Page {safePage + 1} / {pageCount}
            <span className="text-dim/60 ml-2">
              (rows {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, totalFiltered)})
            </span>
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
            className="px-2 py-1 rounded border border-border/60 text-dim hover:text-mid disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}

      {/* Legend */}
      <div className="shrink-0 flex items-center gap-4 px-5 py-1.5 border-t border-border text-[10px] text-dim bg-surface/80 font-mono">
        <span className="text-mid font-bold uppercase tracking-widest text-[9px]">Legend</span>
        <LegendDot color="bg-done/12 border-done/25"    label="IN PROGRESS" />
        <LegendDot color="bg-ok/8 border-ok/20"         label="→ ADVANCE" />
        <LegendDot color="bg-risk/8 border-risk/20"     label="← BACK" />
        <LegendDot color="bg-blocked/10 border-blocked/25" label="BLOCKED" />
        <span className="ml-auto text-[9px] text-dim/50">Click harness ID / name to manage blocks · 📝 to add notes</span>
      </div>

      {selectedHarness && (
        <BlockPanel harness={selectedHarness} onRegisterBlock={onRegisterBlock}
          onResolveBlock={onResolveBlock} onClose={() => setSelected(null)} />
      )}
      {moveTarget && (
        <StageMoveDialog harness={moveTarget.harness} direction={moveTarget.direction}
          onConfirm={confirmMove} onCancel={() => setMoveTarget(null)} />
      )}
      {notesHarness && (
        <HarnessNotes harness={notesHarness} currentUser={currentUser}
          onAddNote={onAddNote} onClose={() => setNotesH(null)} />
      )}
      {editHarness && (
        <EditHarnessModal harness={editHarness} onSave={() => onStateChange?.()} onClose={() => setEditH(null)} />
      )}
    </div>
  );
}

// ── Gantt / Schedule view ─────────────────────────────────────────────────────

function GanttView({ harnesses, onEditClick }: { harnesses: Harness[]; onEditClick: (h: Harness) => void }) {
  const todayDate = new Date(); todayDate.setHours(0,0,0,0);
  const todayStr  = isoDate(todayDate);

  // Determine smart initial view center from data
  const allIso = harnesses.flatMap((h) =>
    [h.plannedStart, h.plannedEnd, h.actualStart, h.actualEnd].filter(Boolean) as string[]);
  const dataStart = allIso.length ? new Date(allIso.reduce((a,b)=>a<b?a:b)) : todayDate;
  const dataEnd   = allIso.length ? new Date(allIso.reduce((a,b)=>a>b?a:b)) : addDays(todayDate, 60);

  const [zoom,      setZoom]  = useState<ZoomLevel>('quarter');
  const [viewStart, setVS]    = useState<Date>(() => {
    // Center the initial view on today or the data range
    const span = ZOOM_SPAN_DAYS['quarter'];
    const center = allIso.length ? new Date((dataStart.getTime() + dataEnd.getTime()) / 2) : todayDate;
    return addDays(center, -Math.floor(span / 2));
  });

  const spanDays = ZOOM_SPAN_DAYS[zoom];
  const viewEnd  = addDays(viewStart, spanDays);

  // Local convenience — wraps the imported datePct with captured viewStart/viewEnd
  const dp = (iso: string) => datePct(iso, viewStart, viewEnd);
  const todayPct = dp(todayStr);
  const todayVisible = new Date(todayStr) >= viewStart && new Date(todayStr) <= viewEnd;

  function pan(days: number) { setVS((v) => addDays(v, days)); }
  function goToday()         { setVS(addDays(todayDate, -Math.floor(spanDays / 2))); }
  function zoomIn()  { const i = ZOOM_ORDER.indexOf(zoom); if (i < ZOOM_ORDER.length-1) changeZoom(ZOOM_ORDER[i+1]); }
  function zoomOut() { const i = ZOOM_ORDER.indexOf(zoom); if (i > 0) changeZoom(ZOOM_ORDER[i-1]); }

  function changeZoom(nz: ZoomLevel) {
    const center = addDays(viewStart, Math.floor(spanDays / 2));
    setVS(addDays(center, -Math.floor(ZOOM_SPAN_DAYS[nz] / 2)));
    setZoom(nz);
  }

  function jumpToMonth(year: number, month: number) {
    // month = 0-based
    setVS(new Date(year, month, 1));
    if (zoom === 'year' || zoom === 'quarter') setZoom('month');
  }

  const ticks = buildTicks(zoom, viewStart, viewEnd);

  // ── Month quick-filter strip (visible at quarter/month/week zoom) ──
  const monthsInView: {label: string; year: number; month: number; pct: number}[] = [];
  if (zoom !== 'year') {
    let d = startOfMonth(viewStart);
    while (d <= viewEnd) {
      monthsInView.push({ label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
                          year: d.getFullYear(), month: d.getMonth(), pct: dp(isoDate(d)) });
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
  }

  const sorted = [...harnesses].sort((a, b) => {
    if (!a.plannedStart && !b.plannedStart) return 0;
    if (!a.plannedStart) return 1;
    if (!b.plannedStart) return -1;
    return a.plannedStart.localeCompare(b.plannedStart);
  });

  const BAR_H = 32; // px per row

  return (
    <div className="flex flex-col h-full">

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface2 shrink-0 flex-wrap">
        {/* Zoom controls */}
        <div className="flex items-center gap-1 border border-border rounded-lg p-0.5 bg-surface">
          <button onClick={zoomOut} disabled={zoom === 'year'}
            className="w-6 h-6 flex items-center justify-center rounded text-sm text-dim hover:text-text disabled:opacity-30">−</button>
          {ZOOM_ORDER.map((z) => (
            <button key={z} onClick={() => changeZoom(z)}
              className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-bold transition-all ${
                zoom === z ? 'bg-done/90 text-white' : 'text-dim hover:text-mid'
              }`}>{ZOOM_LABELS[z]}</button>
          ))}
          <button onClick={zoomIn} disabled={zoom === 'week'}
            className="w-6 h-6 flex items-center justify-center rounded text-sm text-dim hover:text-text disabled:opacity-30">+</button>
        </div>

        {/* Pan */}
        <div className="flex items-center gap-1">
          <button onClick={() => pan(-Math.ceil(spanDays/2))}
            className="px-2.5 py-1 rounded-lg border border-border text-xs text-dim hover:text-mid hover:bg-surface3 transition-colors">← Prev</button>
          <button onClick={goToday}
            className="px-2.5 py-1 rounded-lg border border-done/40 bg-done/8 text-done text-[11px] font-semibold hover:bg-done/15 transition-colors">Today</button>
          <button onClick={() => pan(Math.ceil(spanDays/2))}
            className="px-2.5 py-1 rounded-lg border border-border text-xs text-dim hover:text-mid hover:bg-surface3 transition-colors">Next →</button>
        </div>

        {/* Current range label */}
        <span className="text-[10px] font-mono text-dim px-1">
          {isoDate(viewStart)} → {isoDate(viewEnd)}
          {!todayVisible && <span className="ml-2 text-risk text-[9px]">(today fora da vista)</span>}
        </span>

        <span className="ml-auto text-[9px] text-dim/60 font-mono">
          Clique no mês para zoom · ✏ para definir datas
        </span>
      </div>

      {/* ── Month quick-filter (quarter/month/week only) ── */}
      {monthsInView.length > 0 && (
        <div className="flex gap-1 px-4 py-1.5 border-b border-border bg-surface/60 shrink-0 flex-wrap">
          <span className="text-[9px] font-mono text-dim uppercase tracking-wider mr-1 self-center">Mês:</span>
          {monthsInView.map((m) => (
            <button key={`${m.year}-${m.month}`} onClick={() => jumpToMonth(m.year, m.month)}
              className="px-2 py-0.5 rounded border border-border text-[10px] font-mono text-mid hover:bg-done/8 hover:border-done/35 hover:text-done transition-all">
              {m.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Chart area ── */}
      <div className="flex flex-1 overflow-auto">
        {/* Left frozen label column */}
        <div className="shrink-0 w-48 border-r border-border bg-surface z-10">
          {/* Axis header spacer */}
          <div className="border-b border-border h-10 bg-surface2" />
          {sorted.map((h) => (
            <div key={h.id} className="flex items-center gap-1.5 px-3 border-b border-border/40 hover:bg-surface2/50"
              style={{ height: BAR_H }}>
              {h.blocked && <span className="w-1.5 h-1.5 rounded-full bg-blocked animate-pulse shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[11px] font-semibold text-text truncate">{h.id}</div>
                <div className="text-[9px] text-dim truncate">{h.name}</div>
              </div>
              <button onClick={() => onEditClick(h)} title="Definir datas"
                className="shrink-0 w-5 h-5 flex items-center justify-center rounded border border-border text-[9px] text-dim hover:text-done hover:border-done/40 opacity-0 group-hover:opacity-100 transition-opacity">✏</button>
            </div>
          ))}
        </div>

        {/* Right scrollable chart */}
        <div className="flex-1 relative overflow-x-auto overflow-y-hidden">
          <div className="relative" style={{ minWidth: '100%' }}>

            {/* ── Date axis ── */}
            <div className="sticky top-0 z-10 h-10 bg-surface2 border-b border-border relative overflow-hidden">
              {ticks.map((t, i) => (
                <button
                  key={i}
                  onClick={() => t.year !== undefined && t.month !== undefined && jumpToMonth(t.year, t.month)}
                  title={`Jump to ${t.label}`}
                  className={`absolute top-0 bottom-0 flex flex-col items-start justify-center pl-1.5 text-left hover:bg-done/6 transition-colors ${
                    t.major ? 'border-l-2 border-done/40' : 'border-l border-border/60'
                  }`}
                  style={{ left: `${t.pct}%` }}
                >
                  <span className={`font-mono leading-tight ${
                    t.major ? 'text-[10px] font-bold text-text' : 'text-[9px] text-dim'
                  }`}>{t.label}</span>
                </button>
              ))}
              {/* Today marker in axis */}
              {todayVisible && (
                <div className="absolute top-0 bottom-0 w-0.5 bg-risk/70 z-10"
                  style={{ left: `${todayPct}%` }}>
                  <span className="absolute -top-0 left-1 text-[8px] font-mono font-bold text-risk whitespace-nowrap">▼ hoje</span>
                </div>
              )}
            </div>

            {/* ── Row bars ── */}
            <div className="relative">
              {sorted.map((h) => {
                const ps = h.plannedStart, pe = h.plannedEnd;
                const as = h.actualStart,  ae = h.actualEnd;
                const hasBar = ps && pe;
                const late   = pe && pe < todayStr && h.stage < 7;

                // How many days of the bar fall within viewport
                const barInView = hasBar && (
                  new Date(pe) >= viewStart && new Date(ps) <= viewEnd
                );

                return (
                  <div key={h.id} className="relative border-b border-border/30 hover:bg-surface2/30 group/row"
                    style={{ height: BAR_H }}>

                    {/* Month separator lines */}
                    {ticks.filter((t) => t.major).map((t, i) => (
                      <div key={i} className="absolute top-0 bottom-0 w-px bg-border/50 pointer-events-none"
                        style={{ left: `${t.pct}%` }} />
                    ))}

                    {/* Today line */}
                    {todayVisible && (
                      <div className="absolute top-0 bottom-0 w-px bg-risk/50 z-10 pointer-events-none"
                        style={{ left: `${todayPct}%` }} />
                    )}

                    {/* Planned bar */}
                    {hasBar && barInView && (() => {
                      const left  = dp(ps!);
                      const right = dp(pe!);
                      const w     = Math.max(0.3, right - left);
                      return (
                        <div className="absolute" style={{ top: 5, height: 22, left: `${left}%`, width: `${w}%` }}>
                          <div title={`Planned: ${ps} → ${pe}`}
                            className={`h-full rounded-md relative overflow-hidden ${
                              late ? 'bg-blocked/20 border border-blocked/40' : 'bg-done/18 border border-done/35'
                            }`}>
                            {/* ID label inside bar if wide enough */}
                            {w > 8 && (
                              <span className={`absolute inset-0 flex items-center px-1.5 font-mono text-[9px] font-bold truncate ${
                                late ? 'text-blocked' : 'text-done'
                              }`}>{h.id}</span>
                            )}
                            {/* Actual progress overlay */}
                            {as && (() => {
                              const aLeft  = Math.max(0, dp(as) - left) / w * 100;
                              const aRight = ae
                                ? Math.max(0, right - dp(ae)) / w * 100
                                : Math.max(0, right - todayPct) / w * 100;
                              return (
                                <div className="absolute inset-y-0 bg-ok/50 rounded-l-md"
                                  style={{ left: `${aLeft}%`, right: `${Math.max(0, aRight)}%` }} />
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })()}

                    {/* No-dates marker */}
                    {!hasBar && (
                      <div className="absolute inset-y-3 left-4 right-4 border-b border-dashed border-border/30 pointer-events-none" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="shrink-0 flex items-center gap-5 px-5 py-2 border-t border-border bg-surface text-[9px] font-mono text-dim">
        <span className="flex items-center gap-1.5"><span className="w-8 h-3 rounded bg-done/18 border border-done/35 inline-block" /> Planned</span>
        <span className="flex items-center gap-1.5"><span className="w-8 h-3 rounded bg-ok/50 inline-block" /> Actual progress</span>
        <span className="flex items-center gap-1.5"><span className="w-8 h-3 rounded bg-blocked/20 border border-blocked/40 inline-block" /> Late</span>
        <span className="flex items-center gap-1.5"><span className="w-px h-4 bg-risk/60 inline-block" /> Hoje</span>
        <span className="ml-auto text-dim/50">Zoom: use +/− ou clique numa etiqueta de mês na linha do tempo</span>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-block w-10 h-2.5 rounded-sm border ${color}`} />
      <span>{label}</span>
    </div>
  );
}

interface HarnessRowProps {
  harness: Harness;
  onCellClick: (h: Harness, idx: number) => void;
  onInfoClick: () => void;
  onNotesClick: () => void;
  onEditClick: () => void;
  onDeleteClick: () => void;
}

function HarnessRow({ harness, onCellClick, onInfoClick, onNotesClick, onEditClick, onDeleteClick }: HarnessRowProps) {
  const noteCount = harness.noteCount ?? harness.notes?.length ?? 0;

  return (
    <tr className="border-b border-border/40 hover:bg-surface2/60 group transition-colors">
      {/* Harness label col */}
      <td className="relative px-0 py-0 border-r border-border/60">
        <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${harness.blocked ? 'bg-blocked' : 'bg-transparent group-hover:bg-border/60'} transition-colors`} />
        <div className="flex items-center gap-1 pr-2">
          <button onClick={onInfoClick} className="text-left flex-1 px-4 py-2.5 block">
            <div className="flex items-center gap-1.5">
              {harness.blocked && <span className="w-1.5 h-1.5 rounded-full bg-blocked shrink-0 animate-pulse" />}
              <span className="font-mono text-xs text-text font-semibold group-hover:text-accent transition-colors">{harness.id}</span>
            </div>
            <div className="text-[11px] text-mid mt-0.5 truncate max-w-[120px]">{harness.name}</div>
            {harness.ecns.length > 0 && (
              <span className="inline-block mt-0.5 px-1.5 rounded text-[9px] font-mono bg-risk/8 text-risk border border-risk/20">
                ECN ×{harness.ecns.length}
              </span>
            )}
          </button>
          {/* Inline notes button */}
          <button
            onClick={onNotesClick}
            title={noteCount > 0 ? `${noteCount} note${noteCount !== 1 ? 's' : ''} — click to view` : 'Add note'}
            className={`shrink-0 flex flex-col items-center gap-0.5 px-1.5 py-1 rounded-md border transition-all ${
              noteCount > 0
                ? 'bg-accent/8 border-accent/30 text-accent hover:bg-accent/18'
                : 'border-border/40 text-dim/50 hover:text-accent hover:border-accent/35 hover:bg-accent/6'
            }`}
          >
            <span className="text-[11px] leading-none">📝</span>
            <span className="text-[8px] font-mono font-bold leading-none">
              {noteCount > 0 ? (noteCount > 99 ? '99+' : noteCount) : '+'}
            </span>
          </button>
          {/* Edit / Delete — visible on row hover */}
          <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <button onClick={onEditClick} title="Edit harness"
              className="w-5 h-5 flex items-center justify-center rounded border border-border text-[10px] text-dim hover:text-done hover:border-done/40 transition-colors">✏</button>
            <button onClick={onDeleteClick} title="Delete harness"
              className="w-5 h-5 flex items-center justify-center rounded border border-border text-[10px] text-dim hover:text-blocked hover:border-blocked/40 transition-colors">✕</button>
          </div>
        </div>
      </td>

      {/* Stage cells */}
      {STAGES.map((_, i) => {
        const isPast     = i < harness.stage;
        const isCurrent  = i === harness.stage;
        const isBlocked  = harness.blocked && isCurrent;
        const canAdvance = !harness.blocked && i === harness.stage + 1 && harness.stage < 7;
        const canBack    = !harness.blocked && i === harness.stage - 1 && harness.stage > 0;
        const clickable  = isBlocked || isCurrent || canAdvance || canBack;

        const base = 'border-r border-border/30 last:border-r-0 text-center align-middle transition-colors';
        const style = isBlocked  ? 'bg-blocked/10 border-l border-blocked/20 cursor-pointer hover:bg-blocked/16'
          : isCurrent            ? 'bg-done/10 border-l border-done/20 cursor-pointer hover:bg-done/15'
          : isPast               ? 'bg-done/4'
          : canAdvance           ? 'bg-ok/5 border-l border-ok/12 cursor-pointer hover:bg-ok/10 hover:border-ok/25'
          : canBack              ? 'bg-risk/5 border-l border-risk/12 cursor-pointer hover:bg-risk/10 hover:border-risk/25'
          : '';

        return (
          <td
            key={i}
            className={`${base} ${style}`}
            style={{ height: '52px', minWidth: '88px' }}
            onClick={() => clickable && onCellClick(harness, i)}
          >
            {isBlocked ? (
              <div className="flex flex-col items-center gap-0.5 px-2 py-1">
                <div className="flex items-center gap-1">
                  <span className="text-[8px] text-blocked" style={{ animation: 'pulse-slow 2s infinite' }}>●</span>
                  <span className="font-mono text-[9px] font-bold text-blocked tracking-widest">BLOCKED</span>
                </div>
                {harness.blockReason && (
                  <span className="text-[8px] text-blocked/50 leading-tight text-center line-clamp-2 max-w-[80px]">
                    {harness.blockReason}
                  </span>
                )}
              </div>
            ) : isCurrent ? (
              <div className="flex items-center justify-center gap-1">
                <span className="text-[9px] text-done/60">⟲</span>
                <span className="font-mono text-[9px] font-bold text-done tracking-widest">IN PROGRESS</span>
              </div>
            ) : isPast ? (
              <span className="font-mono text-[10px] text-done/25">✓</span>
            ) : canAdvance ? (
              <div className="flex items-center justify-center gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
                <span className="text-[9px] text-ok">→</span>
                <span className="font-mono text-[9px] font-bold text-ok tracking-widest">ADVANCE</span>
              </div>
            ) : canBack ? (
              <div className="flex items-center justify-center gap-1 opacity-35 group-hover:opacity-100 transition-opacity">
                <span className="text-[9px] text-risk">←</span>
                <span className="font-mono text-[9px] font-bold text-risk tracking-widest">BACK</span>
              </div>
            ) : (
              <span className="text-[10px] text-dim/12">·</span>
            )}
          </td>
        );
      })}

    </tr>
  );
}
