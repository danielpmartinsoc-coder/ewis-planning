/**
 * DelayEventsBar — external impediment tracker overlaid on pipelines.
 *
 * Events represent external dependencies that were expected by a date but
 * arrived/resolved later — machines, tools, payments, materials, contracts…
 *
 * Visual:
 *   expectedBy  → dashed indigo line  (◇ label at top)
 *   resolvedAt  → solid line, red if late / green if on time  (+Xd badge)
 *   Shading between the two lines shows the delay window.
 *   Lines extend full height of the parent `position: relative` container.
 */

import { useState, useEffect } from 'react';
import type { DelayEvent, DelayEventType } from '../../types';
import * as api from '../../api';

// ── helpers ───────────────────────────────────────────────────────────────────

function isoToDate(iso: string) { return new Date(iso + 'T00:00:00'); }
function isoDate(d: Date)       { return d.toISOString().slice(0, 10); }

function pct(iso: string, start: Date, end: Date) {
  const t = isoToDate(iso).getTime();
  const s = start.getTime();
  const e = end.getTime();
  return Math.max(0, Math.min(100, ((t - s) / (e - s)) * 100));
}

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function buildMonthTicks(start: Date, end: Date) {
  const ticks: { label: string; pct: number }[] = [];
  let d = new Date(start.getFullYear(), start.getMonth(), 1);
  while (d <= end) {
    ticks.push({ label: `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`, pct: pct(isoDate(d), start, end) });
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  return ticks;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EVENT_TYPES: DelayEventType[] = ['Machine', 'Tool', 'Payment', 'Material', 'Contract', 'Permit', 'Other'];

const TYPE_ICON: Record<DelayEventType, string> = {
  Machine:  '⚙',
  Tool:     '🔧',
  Payment:  '💳',
  Material: '📦',
  Contract: '📄',
  Permit:   '🗂',
  Other:    '◈',
};

const TYPE_COLOR: Record<DelayEventType, string> = {
  Machine:  'text-blue-400  border-blue-400/30  bg-blue-400/8',
  Tool:     'text-cyan-400  border-cyan-400/30  bg-cyan-400/8',
  Payment:  'text-amber-400 border-amber-400/30 bg-amber-400/8',
  Material: 'text-purple-400 border-purple-400/30 bg-purple-400/8',
  Contract: 'text-teal-400  border-teal-400/30  bg-teal-400/8',
  Permit:   'text-orange-400 border-orange-400/30 bg-orange-400/8',
  Other:    'text-dim       border-border        bg-surface2',
};

// ── Event form modal ──────────────────────────────────────────────────────────

interface FormProps {
  initial?: DelayEvent;
  onSave: (data: Omit<DelayEvent, 'id'>) => Promise<void>;
  onDelete?: () => void;
  onClose: () => void;
}

function EventForm({ initial, onSave, onDelete, onClose }: FormProps) {
  const [title,       setTitle]       = useState(initial?.title       ?? '');
  const [type,        setType]        = useState<DelayEventType>(initial?.type ?? 'Other');
  const [expectedBy,  setExpected]    = useState(initial?.expectedBy  ?? isoDate(new Date()));
  const [resolvedAt,  setResolved]    = useState(initial?.resolvedAt  ?? isoDate(new Date()));
  const [description, setDescription] = useState(initial?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError('Description is required'); return; }
    setSaving(true); setError('');
    try {
      await onSave({ title: title.trim(), type, expectedBy, resolvedAt, description: description.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const delayDays = Math.round((isoToDate(resolvedAt).getTime() - isoToDate(expectedBy).getTime()) / 86400000);
  const isLate = delayDays > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[480px] bg-surface rounded-2xl border border-border shadow-card-md p-6"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-semibold text-sm text-text">{initial ? 'Edit Impediment' : 'Register Impediment'}</h2>
            <p className="text-[10px] text-dim mt-0.5">External dependency that caused a delay</p>
          </div>
          <button onClick={onClose} className="text-dim hover:text-text text-xl leading-none">×</button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">

          {/* Type */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider">Type</label>
            <div className="flex flex-wrap gap-1.5">
              {EVENT_TYPES.map((t) => (
                <button key={t} type="button" onClick={() => setType(t)}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-mono font-semibold transition-all ${
                    type === t ? TYPE_COLOR[t] + ' ring-1 ring-inset ring-current/30' : 'border-border text-dim hover:text-mid'
                  }`}>
                  {TYPE_ICON[t]} {t}
                </button>
              ))}
            </div>
          </div>

          {/* What was expected */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider">What was expected</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder={
                type === 'Machine'  ? 'e.g. Crimping machine from Komax' :
                type === 'Tool'     ? 'e.g. Torque wrenches set' :
                type === 'Payment'  ? 'e.g. PO-0042 approval from finance' :
                type === 'Material' ? 'e.g. D38999 connectors batch' :
                type === 'Contract' ? 'e.g. Subcontract signature with TechWire' :
                type === 'Permit'   ? 'e.g. Factory access permit' :
                'e.g. External dependency description'
              }
              className="px-3 py-1.5 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60" />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider">Expected by</label>
              <input type="date" value={expectedBy} onChange={(e) => setExpected(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider">Actually received / resolved</label>
              <input type="date" value={resolvedAt} onChange={(e) => setResolved(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60" />
            </div>
          </div>

          {/* Delay pill */}
          {expectedBy && resolvedAt && (
            <div className={`text-[11px] font-mono px-3 py-1.5 rounded-lg border ${
              isLate ? 'bg-blocked/8 border-blocked/30 text-blocked' : 'bg-ok/8 border-ok/25 text-ok'
            }`}>
              {isLate
                ? `⚠ Arrived ${delayDays}d late`
                : delayDays === 0 ? '✓ Arrived on time'
                : `✓ Arrived ${Math.abs(delayDays)}d early`}
            </div>
          )}

          {/* Root cause / notes */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider">Root cause / impact (optional)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Supplier delay, customs hold, budget freeze…"
              className="px-3 py-1.5 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60 resize-none" />
          </div>

          {error && <p className="text-xs text-blocked">{error}</p>}

          <div className="flex items-center justify-between pt-1">
            {onDelete ? (
              <button type="button" onClick={onDelete}
                className="px-3 py-1.5 rounded-lg border border-blocked/30 text-[11px] text-blocked/70 hover:bg-blocked/8 transition-colors">
                Delete
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button type="button" onClick={onClose}
                className="px-4 py-2 rounded-lg border border-border text-sm text-dim hover:text-mid">Cancel</button>
              <button type="submit" disabled={saving}
                className="px-4 py-2 rounded-lg bg-done/90 text-white text-sm font-semibold hover:bg-done disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main overlay component ────────────────────────────────────────────────────

interface Props {
  events: DelayEvent[];
  viewStart: Date;
  viewEnd: Date;
  projects?: string[];   // kept for API compat, unused
  onRefresh: () => void;
  readonly?: boolean;
}

export function DelayEventsBar({ events, viewStart, viewEnd, onRefresh, readonly }: Props) {
  const [addOpen,  setAddOpen]  = useState(false);
  const [editEvt,  setEditEvt]  = useState<DelayEvent | null>(null);
  const [hovered,  setHovered]  = useState<string | null>(null);

  const todayStr    = isoDate(new Date());
  const todayPct    = pct(todayStr, viewStart, viewEnd);
  const todayVisible = todayStr >= isoDate(viewStart) && todayStr <= isoDate(viewEnd);
  const ticks       = buildMonthTicks(viewStart, viewEnd);

  // Only events that overlap the current view window
  const visible = events.filter((ev) => {
    const a = ev.expectedBy < ev.resolvedAt ? ev.expectedBy : ev.resolvedAt;
    const b = ev.expectedBy > ev.resolvedAt ? ev.expectedBy : ev.resolvedAt;
    return a <= isoDate(viewEnd) && b >= isoDate(viewStart);
  });

  async function handleCreate(data: Omit<DelayEvent, 'id'>) {
    await api.createEvent(data);
    onRefresh();
    setAddOpen(false);
  }

  async function handleUpdate(data: Omit<DelayEvent, 'id'>) {
    if (!editEvt) return;
    await api.updateEvent(editEvt.id, data);
    onRefresh();
    setEditEvt(null);
  }

  async function handleDelete() {
    if (!editEvt || !confirm(`Delete "${editEvt.title}"?`)) return;
    await api.deleteEvent(editEvt.id);
    onRefresh();
    setEditEvt(null);
  }

  return (
    <>
      {/* ── Band ── */}
      <div className="relative w-full bg-surface2/80 border-b border-border/50 select-none shrink-0" style={{ height: 52 }}>

        {/* Month tick marks */}
        {ticks.map((t) => (
          <div key={t.label} className="absolute top-0 h-full pointer-events-none"
            style={{ left: `${t.pct}%` }}>
            <div className="absolute top-0 h-full w-px bg-border/30" />
            <span className="absolute top-1 left-1 text-[8px] font-mono text-dim/50 whitespace-nowrap">{t.label}</span>
          </div>
        ))}

        {/* Today reference */}
        {todayVisible && (
          <div className="absolute top-0 h-full pointer-events-none" style={{ left: `${todayPct}%` }}>
            <div className="absolute top-0 h-full w-px bg-ok/40" />
            <span className="absolute bottom-1 left-1 text-[7px] font-mono text-ok/60">TODAY</span>
          </div>
        )}

        {/* Event markers in the band */}
        {visible.map((ev) => {
          const ep    = pct(ev.expectedBy, viewStart, viewEnd);
          const rp    = pct(ev.resolvedAt, viewStart, viewEnd);
          const isLate = ev.resolvedAt > ev.expectedBy;
          const delay = Math.round((isoToDate(ev.resolvedAt).getTime() - isoToDate(ev.expectedBy).getTime()) / 86400000);
          const icon  = TYPE_ICON[ev.type ?? 'Other'];

          return (
            <div key={ev.id}>
              {/* Expected-by pin (top) */}
              <div className="absolute top-0 flex flex-col items-center pointer-events-none z-10"
                style={{ left: `${ep}%`, transform: 'translateX(-50%)' }}>
                <div className="w-px h-1.5 bg-indigo-400/60" />
                <div className="text-[7px] font-mono font-bold whitespace-nowrap px-1 py-0.5 rounded
                  bg-surface border border-indigo-400/25 text-indigo-300/80 shadow-sm max-w-[100px] truncate">
                  {icon} {ev.title}
                </div>
              </div>

              {/* Resolved-at badge (bottom) */}
              <div className="absolute bottom-0 flex flex-col items-center pointer-events-none z-10"
                style={{ left: `${rp}%`, transform: 'translateX(-50%)' }}>
                <div className={`text-[7px] font-mono font-bold whitespace-nowrap px-1 py-0.5 rounded mb-0.5
                  shadow-sm border ${isLate
                    ? 'bg-surface border-blocked/30 text-blocked/80'
                    : 'bg-surface border-ok/30 text-ok/80'}`}>
                  {isLate ? `+${delay}d` : delay === 0 ? 'on time' : `-${Math.abs(delay)}d`}
                </div>
                <div className={`w-px h-1.5 ${isLate ? 'bg-blocked/60' : 'bg-ok/60'}`} />
              </div>

              {/* Delay shading */}
              {Math.abs(rp - ep) > 0.3 && (
                <div className={`absolute top-0 h-full opacity-[0.07] pointer-events-none ${isLate ? 'bg-blocked' : 'bg-ok'}`}
                  style={{ left: `${Math.min(ep, rp)}%`, width: `${Math.abs(rp - ep)}%` }} />
              )}

              {/* Clickable hit zone */}
              <button
                onMouseEnter={() => setHovered(ev.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => !readonly && setEditEvt(ev)}
                disabled={readonly}
                title={`${ev.title} — ${isLate ? `${delay}d late` : 'on time'}`}
                className="absolute top-0 h-full z-20 cursor-pointer hover:bg-accent/5 transition-colors disabled:cursor-default"
                style={{
                  left:     `${Math.min(ep, rp) - 0.5}%`,
                  width:    `${Math.abs(rp - ep) + 1}%`,
                  minWidth: 12,
                }} />
            </div>
          );
        })}

        {/* Add button */}
        {!readonly && (
          <button onClick={() => setAddOpen(true)}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-30
              px-2 py-0.5 rounded border border-border/60 bg-surface
              text-[10px] font-mono text-dim hover:text-done hover:border-done/40 transition-colors">
            + Impediment
          </button>
        )}
      </div>

      {/* ── Full-height vertical lines (absolute in parent) ── */}
      {visible.map((ev) => {
        const ep    = pct(ev.expectedBy, viewStart, viewEnd);
        const rp    = pct(ev.resolvedAt, viewStart, viewEnd);
        const isLate = ev.resolvedAt > ev.expectedBy;
        const isHov  = hovered === ev.id; // controls line opacity on hover

        return (
          <div key={`vlines-${ev.id}`} className="pointer-events-none">
            {/* Expected-by — dashed indigo */}
            <div className="absolute top-0 bottom-0 w-px transition-opacity"
              style={{
                left: `${ep}%`,
                background: 'repeating-linear-gradient(to bottom,#818cf8 0,#818cf8 4px,transparent 4px,transparent 8px)',
                opacity: isHov ? 0.9 : 0.4,
              }} />
            {/* Resolved-at — solid red/green */}
            <div className="absolute top-0 bottom-0 w-px transition-opacity"
              style={{
                left: `${rp}%`,
                backgroundColor: isLate ? 'rgb(239 68 68/.65)' : 'rgb(34 197 94/.65)',
                opacity: isHov ? 1 : 0.5,
              }} />
          </div>
        );
      })}

      {/* Today full-height line */}
      {todayVisible && (
        <div className="absolute top-0 bottom-0 w-px pointer-events-none"
          style={{ left: `${todayPct}%`, backgroundColor: 'rgb(34 197 94/.25)' }} />
      )}

      {/* Modals */}
      {addOpen  && <EventForm onSave={handleCreate} onClose={() => setAddOpen(false)} />}
      {editEvt  && (
        <EventForm
          initial={editEvt}
          onSave={handleUpdate}
          onDelete={handleDelete}
          onClose={() => setEditEvt(null)}
        />
      )}
    </>
  );
}

// ── Standalone Events management page ────────────────────────────────────────

export function EventsPage(_props: { projects: string[] }) {
  const [events,  setEvents]  = useState<DelayEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editEvt, setEditEvt] = useState<DelayEvent | null>(null);

  async function load() {
    setLoading(true);
    const d = await api.getEvents();
    setEvents(d.events ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(data: Omit<DelayEvent, 'id'>) {
    await api.createEvent(data);
    await load();
    setAddOpen(false);
  }

  async function handleUpdate(data: Omit<DelayEvent, 'id'>) {
    if (!editEvt) return;
    await api.updateEvent(editEvt.id, data);
    await load();
    setEditEvt(null);
  }

  async function handleDelete() {
    if (!editEvt || !confirm(`Delete "${editEvt.title}"?`)) return;
    await api.deleteEvent(editEvt.id);
    await load();
    setEditEvt(null);
  }

  const totalDelayDays = events.reduce((sum, ev) => {
    const d = Math.round((isoToDate(ev.resolvedAt).getTime() - isoToDate(ev.expectedBy).getTime()) / 86400000);
    return sum + Math.max(0, d);
  }, 0);

  return (
    <div className="px-8 py-6 flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text">Impediments &amp; Delays</h1>
          <p className="text-xs text-dim mt-0.5">
            External dependencies that were expected but arrived late —
            machines, tools, payments, materials…
          </p>
        </div>
        <button onClick={() => setAddOpen(true)}
          className="px-4 py-2 rounded-lg bg-done/90 text-white text-sm font-semibold hover:bg-done transition-colors">
          + Register Impediment
        </button>
      </div>

      {/* Summary cards */}
      {events.length > 0 && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Total impediments', value: events.length,    color: 'text-text' },
            { label: 'Total delay (days)', value: totalDelayDays,  color: totalDelayDays > 0 ? 'text-blocked' : 'text-ok' },
            { label: 'Late arrivals',      value: events.filter(e => e.resolvedAt > e.expectedBy).length, color: 'text-risk' },
            { label: 'On time / early',    value: events.filter(e => e.resolvedAt <= e.expectedBy).length, color: 'text-ok' },
          ].map((s) => (
            <div key={s.label} className="bg-surface border border-border rounded-xl px-4 py-3 shadow-card">
              <div className="text-[10px] font-mono uppercase tracking-widest text-dim">{s.label}</div>
              <div className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-dim text-xs font-mono">Loading…</p>
      ) : events.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl px-6 py-16 text-center">
          <div className="text-4xl mb-3">◈</div>
          <p className="text-sm text-mid font-medium">No impediments recorded yet</p>
          <p className="text-xs text-dim mt-1">Register external dependencies that caused delays to your production timeline.</p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden shadow-card">
          <table className="w-full text-[12px]">
            <thead className="bg-surface2 border-b border-border">
              <tr>
                {['Type', 'What was expected', 'Expected by', 'Received / Resolved', 'Delay', 'Notes', ''].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left font-mono text-[9px] uppercase tracking-wider text-dim font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {events.map((ev) => {
                const delay  = Math.round((isoToDate(ev.resolvedAt).getTime() - isoToDate(ev.expectedBy).getTime()) / 86400000);
                const isLate = delay > 0;
                return (
                  <tr key={ev.id} className="hover:bg-surface2/50 group">
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono font-semibold ${TYPE_COLOR[ev.type ?? 'Other']}`}>
                        {TYPE_ICON[ev.type ?? 'Other']} {ev.type ?? 'Other'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-text max-w-[220px] truncate" title={ev.title}>{ev.title}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-indigo-300/80">{ev.expectedBy}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px]">{ev.resolvedAt}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                        isLate ? 'bg-blocked/10 text-blocked' : 'bg-ok/10 text-ok'
                      }`}>
                        {isLate ? `+${delay}d` : delay === 0 ? 'On time' : `-${Math.abs(delay)}d`}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-dim max-w-[180px] truncate" title={ev.description}>{ev.description || '—'}</td>
                    <td className="px-4 py-2.5">
                      <button onClick={() => setEditEvt(ev)}
                        className="px-2 py-1 rounded border border-border text-[10px] text-mid hover:text-done hover:border-done/40 opacity-0 group-hover:opacity-100 transition-opacity">
                        ✏
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && <EventForm onSave={handleCreate} onClose={() => setAddOpen(false)} />}
      {editEvt  && <EventForm initial={editEvt} onSave={handleUpdate} onDelete={handleDelete} onClose={() => setEditEvt(null)} />}
    </div>
  );
}
