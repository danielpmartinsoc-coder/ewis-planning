/**
 * Connector Cycles — Mate & Demate Log
 *
 * Organised by equipment or harness (cablagem).
 * Within each target, connectors are identified by their FIN
 * (Functional Identification Name, e.g. "J1", "P23", "CN-PWR-A").
 * Tracks mate/demate cycle counts per FIN to flag replacement thresholds.
 */
import { useState, useEffect, useCallback } from 'react';
import type { MateDemateEntry, MDOperation, MDTargetType } from '../../types';
import * as api from '../../api';

const CYCLE_LIMIT = 500;   // MIL-spec D38999 typical rating

// ── Domain helpers ────────────────────────────────────────────────────────────

interface FinCycles {
  fin: string;
  partNumber: string;
  mates: number;
  demates: number;
  total: number;
  lastDate: string;
}

interface TargetGroup {
  targetType: MDTargetType;
  targetId: string;
  displayName: string;  // resolved harness name, or equipment name
  project: string;
  fins: FinCycles[];
  totalCycles: number;
  lastDate: string;
}

function buildGroups(
  entries: MateDemateEntry[],
  harnesses: { id: string; name: string; project: string }[],
): TargetGroup[] {
  const hmap = new Map(harnesses.map(h => [h.id, h]));
  const map  = new Map<string, TargetGroup>();

  for (const e of entries) {
    const key = `${e.targetType}::${e.targetId}`;
    if (!map.has(key)) {
      const h = e.targetType === 'harness' ? hmap.get(e.targetId) : undefined;
      map.set(key, {
        targetType:  e.targetType,
        targetId:    e.targetId,
        displayName: h ? h.name : e.targetId,
        project:     h ? h.project : '',
        fins:        [],
        totalCycles: 0,
        lastDate:    '',
      });
    }
    const g = map.get(key)!;
    let fc = g.fins.find(f => f.fin === e.fin);
    if (!fc) {
      fc = { fin: e.fin, partNumber: e.partNumber, mates: 0, demates: 0, total: 0, lastDate: '' };
      g.fins.push(fc);
    }
    if (e.operation === 'mate') fc.mates++; else fc.demates++;
    fc.total++;
    if (e.date > fc.lastDate) fc.lastDate = e.date;
    g.totalCycles++;
    if (e.date > g.lastDate) g.lastDate = e.date;
  }

  return [...map.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}

function cycleColor(total: number) {
  const pct = total / CYCLE_LIMIT;
  if (pct >= 1)   return { bar: 'bg-blocked', badge: 'text-blocked border-blocked/40 bg-blocked/10' };
  if (pct >= 0.8) return { bar: 'bg-risk',    badge: 'text-risk    border-risk/40    bg-risk/10'    };
  return               { bar: 'bg-ok',     badge: 'text-ok     border-ok/40      bg-ok/10'      };
}

// ── Entry Form ────────────────────────────────────────────────────────────────

interface FormProps {
  harnesses: { id: string; name: string; project: string }[];
  preTarget?: { type: MDTargetType; id: string };
  onSave: () => void;
  onClose: () => void;
}

function EntryForm({ harnesses, preTarget, onSave, onClose }: FormProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [targetType, setTargetType] = useState<MDTargetType>(preTarget?.type ?? 'harness');
  const [targetId,   setTargetId]   = useState(preTarget?.id ?? '');
  const [fin,        setFin]        = useState('');
  const [partNumber, setPartNumber] = useState('');
  const [operation,  setOperation]  = useState<MDOperation>('mate');
  const [date,       setDate]       = useState(today);
  const [operator,   setOperator]   = useState('');
  const [notes,      setNotes]      = useState('');
  const [saving,     setSaving]     = useState(false);
  const [err,        setErr]        = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!targetId.trim()) { setErr('Seleciona ou indica o alvo'); return; }
    if (!fin.trim())      { setErr('FIN é obrigatório'); return; }
    if (!date)            { setErr('Data é obrigatória'); return; }
    setSaving(true);
    const res = await api.createMateDemateEntry({
      targetType,
      targetId:   targetId.trim(),
      fin:        fin.trim().toUpperCase(),
      partNumber: partNumber.trim(),
      operation,
      date,
      operator:   operator.trim(),
      notes:      notes.trim() || null,
    });
    setSaving(false);
    if (res.ok) { onSave(); onClose(); }
    else setErr(res.error ?? 'Erro ao gravar');
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form
        className="bg-surface border border-border rounded-xl p-6 w-full max-w-md space-y-4 shadow-2xl"
        onClick={e => e.stopPropagation()}
        onSubmit={submit}
      >
        <h3 className="text-sm font-semibold text-bright">Registar Mate / Demate</h3>
        {err && <p className="text-[11px] text-blocked">{err}</p>}

        {/* Operation */}
        <div className="flex gap-2">
          {(['mate', 'demate'] as MDOperation[]).map(op => (
            <button key={op} type="button" onClick={() => setOperation(op)}
              className={`flex-1 py-1.5 rounded text-[11px] font-semibold transition-colors ${
                operation === op
                  ? op === 'mate'
                    ? 'bg-ok/20 border border-ok/40 text-ok'
                    : 'bg-blocked/20 border border-blocked/40 text-blocked'
                  : 'bg-surface border border-border text-dim hover:text-mid'
              }`}>
              {op === 'mate' ? '⬆ Mate' : '⬇ Demate'}
            </button>
          ))}
        </div>

        {/* Target type — hidden when pre-filled */}
        {!preTarget && (
          <div className="flex gap-2">
            {(['harness', 'equipment'] as MDTargetType[]).map(t => (
              <button key={t} type="button"
                onClick={() => { setTargetType(t); setTargetId(''); }}
                className={`flex-1 py-1.5 rounded text-[11px] font-medium transition-colors ${
                  targetType === t
                    ? 'bg-accent/20 border border-accent/40 text-accent'
                    : 'bg-surface border border-border text-dim hover:text-mid'
                }`}>
                {t === 'harness' ? '🔌 Cablagem' : '🔧 Equipamento'}
              </button>
            ))}
          </div>
        )}

        {/* Target */}
        {!preTarget && (
          <div>
            <label className="block text-[10px] text-dim mb-1">
              {targetType === 'harness' ? 'Cablagem *' : 'Equipamento *'}
            </label>
            {targetType === 'harness' ? (
              <select
                className="w-full bg-bg border border-border rounded px-2 py-1.5 text-[11px] text-bright"
                value={targetId} onChange={e => setTargetId(e.target.value)}>
                <option value="">— selecionar cablagem —</option>
                {harnesses.map(h => (
                  <option key={h.id} value={h.id}>{h.project} / {h.name}</option>
                ))}
              </select>
            ) : (
              <input type="text" placeholder="Ex: GSE-01, TVAC Rack B, Umbilical Stand…"
                className="w-full bg-bg border border-border rounded px-2 py-1.5 text-[11px] text-bright placeholder:text-dim"
                value={targetId} onChange={e => setTargetId(e.target.value)} />
            )}
          </div>
        )}

        {/* FIN + Part Number */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-[10px] text-dim mb-1">FIN *
              <span className="ml-1 text-dim font-normal normal-case">Functional ID</span>
            </label>
            <input type="text" placeholder="Ex: J1, P23, CN-PWR-A"
              className="w-full bg-bg border border-border rounded px-2 py-1.5 text-[11px] text-bright placeholder:text-dim font-mono"
              value={fin} onChange={e => setFin(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="block text-[10px] text-dim mb-1">Part Number</label>
            <input type="text" placeholder="D38999/…"
              className="w-full bg-bg border border-border rounded px-2 py-1.5 text-[11px] text-bright placeholder:text-dim font-mono"
              value={partNumber} onChange={e => setPartNumber(e.target.value)} />
          </div>
        </div>

        {/* Date + Operator */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-[10px] text-dim mb-1">Data *</label>
            <input type="date"
              className="w-full bg-bg border border-border rounded px-2 py-1.5 text-[11px] text-bright"
              value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="block text-[10px] text-dim mb-1">Operador</label>
            <input type="text" placeholder="Nome / crachá"
              className="w-full bg-bg border border-border rounded px-2 py-1.5 text-[11px] text-bright placeholder:text-dim"
              value={operator} onChange={e => setOperator(e.target.value)} />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-[10px] text-dim mb-1">Notas</label>
          <textarea rows={2}
            className="w-full bg-bg border border-border rounded px-2 py-1.5 text-[11px] text-bright placeholder:text-dim resize-none"
            placeholder="Condição, observações, motivo…"
            value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-[11px] text-dim hover:text-mid">Cancelar</button>
          <button type="submit" disabled={saving}
            className="px-4 py-1.5 bg-accent text-bg text-[11px] font-semibold rounded hover:opacity-90 disabled:opacity-50">
            {saving ? 'A gravar…' : 'Registar'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Group detail panel ────────────────────────────────────────────────────────

interface GroupPanelProps {
  group: TargetGroup;
  entries: MateDemateEntry[];
  onDelete: (id: string) => void;
  onAddEntry: () => void;
  onBack: () => void;
}

function GroupPanel({ group, entries, onDelete, onAddEntry, onBack }: GroupPanelProps) {
  const rows = entries
    .filter(e => e.targetType === group.targetType && e.targetId === group.targetId)
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onBack} className="text-[11px] text-dim hover:text-mid">← Voltar</button>
        <span className="text-dim text-[11px]">/</span>
        {group.project && <span className="text-[11px] text-dim">{group.project} /</span>}
        <span className="text-[11px] text-bright font-medium">{group.displayName}</span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
          group.targetType === 'harness'
            ? 'border-accent/30 text-accent bg-accent/10'
            : 'border-risk/30 text-risk bg-risk/10'
        }`}>
          {group.targetType === 'harness' ? 'Cablagem' : 'Equipamento'}
        </span>
        <div className="flex-1" />
        <button onClick={onAddEntry}
          className="px-3 py-1.5 bg-accent text-bg text-[11px] font-semibold rounded hover:opacity-90">
          + Registar
        </button>
      </div>

      {/* FIN cycle cards */}
      <div>
        <h3 className="text-[10px] uppercase tracking-widest text-dim mb-2">Ciclos por FIN</h3>
        <div className="flex flex-wrap gap-3">
          {group.fins.sort((a, b) => b.total - a.total).map(fc => {
            const { bar, badge } = cycleColor(fc.total);
            const pct = Math.min(1, fc.total / CYCLE_LIMIT);
            return (
              <div key={fc.fin} className={`border rounded-lg px-3 py-2 text-[11px] min-w-[160px] ${badge}`}>
                <div className="font-mono font-bold text-[13px]">{fc.fin}</div>
                {fc.partNumber && <div className="text-[9px] text-dim font-mono mt-0.5">{fc.partNumber}</div>}
                <div className="text-[10px] mt-1">
                  <span>{fc.mates}↑ mate</span>
                  <span className="mx-1 text-dim">·</span>
                  <span>{fc.demates}↓ demate</span>
                </div>
                <div className="mt-1.5 h-1.5 bg-border rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct * 100}%` }} />
                </div>
                <div className="flex justify-between text-[9px] text-dim mt-0.5">
                  <span className="font-bold">{fc.total} / {CYCLE_LIMIT} ciclos</span>
                  {pct >= 1 && <span className="text-blocked font-bold">SUBSTITUIR</span>}
                  {pct >= 0.8 && pct < 1 && <span className="text-risk font-bold">ATENÇÃO</span>}
                </div>
                <div className="text-[9px] text-dim mt-0.5">Último: {fc.lastDate}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* History table */}
      <div>
        <h3 className="text-[10px] uppercase tracking-widest text-dim mb-2">Histórico</h3>
        {rows.length === 0 ? (
          <p className="text-[11px] text-dim py-6 text-center">Sem registos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border text-dim text-left">
                  <th className="py-1.5 pr-3 font-medium">Data</th>
                  <th className="py-1.5 pr-3 font-medium">Op</th>
                  <th className="py-1.5 pr-3 font-medium">FIN</th>
                  <th className="py-1.5 pr-3 font-medium">Part Number</th>
                  <th className="py-1.5 pr-3 font-medium">Operador</th>
                  <th className="py-1.5 pr-3 font-medium">Notas</th>
                  <th className="py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map(e => (
                  <tr key={e.id} className="border-b border-border/50 hover:bg-surface/60">
                    <td className="py-1.5 pr-3 font-mono text-dim">{e.date}</td>
                    <td className="py-1.5 pr-3">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        e.operation === 'mate'
                          ? 'bg-ok/10 text-ok border border-ok/30'
                          : 'bg-blocked/10 text-blocked border border-blocked/30'
                      }`}>
                        {e.operation === 'mate' ? '⬆ MATE' : '⬇ DEMATE'}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 font-mono font-bold text-bright">{e.fin}</td>
                    <td className="py-1.5 pr-3 font-mono text-dim text-[10px]">{e.partNumber || '—'}</td>
                    <td className="py-1.5 pr-3 text-mid">{e.operator || '—'}</td>
                    <td className="py-1.5 pr-3 text-dim max-w-[180px] truncate" title={e.notes ?? ''}>{e.notes || ''}</td>
                    <td className="py-1.5">
                      <button onClick={() => onDelete(e.id)}
                        className="text-dim hover:text-blocked text-[10px]" title="Apagar">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Group list (top-level) ────────────────────────────────────────────────────

interface GroupCardProps {
  group: TargetGroup;
  onClick: () => void;
}

function GroupCard({ group, onClick }: GroupCardProps) {
  const overLimit = group.fins.some(f => f.total >= CYCLE_LIMIT);
  const atRisk    = group.fins.some(f => f.total / CYCLE_LIMIT >= 0.8);

  return (
    <button onClick={onClick}
      className={`text-left border rounded-xl p-4 hover:border-accent/50 transition-colors bg-surface w-full ${
        overLimit ? 'border-blocked/50' : atRisk ? 'border-risk/50' : 'border-border'
      }`}>
      <div className="flex items-start justify-between mb-2">
        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${
          group.targetType === 'harness'
            ? 'border-accent/30 text-accent bg-accent/10'
            : 'border-risk/30 text-risk bg-risk/10'
        }`}>
          {group.targetType === 'harness' ? 'Cablagem' : 'Equipamento'}
        </span>
        {overLimit && <span className="text-[10px] text-blocked font-bold">⚠ SUBSTITUIR</span>}
        {!overLimit && atRisk && <span className="text-[10px] text-risk font-bold">⚠ Atenção</span>}
      </div>

      {group.project && <div className="text-[10px] text-dim">{group.project}</div>}
      <div className="text-[13px] font-semibold text-bright truncate">{group.displayName}</div>

      <div className="mt-2 flex gap-4 text-[11px] text-dim">
        <span><span className="text-bright font-semibold">{group.fins.length}</span> FIN</span>
        <span><span className="text-bright font-semibold">{group.totalCycles}</span> operações</span>
      </div>

      {/* FIN mini-list */}
      <div className="mt-2 space-y-1">
        {group.fins.slice(0, 4).map(fc => {
          const pct = Math.min(1, fc.total / CYCLE_LIMIT);
          const { bar } = cycleColor(fc.total);
          return (
            <div key={fc.fin} className="flex items-center gap-2">
              <div className="font-mono text-[9px] text-bright w-12 truncate">{fc.fin}</div>
              <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct * 100}%` }} />
              </div>
              <div className="text-[9px] text-dim w-10 text-right">{fc.total}/{CYCLE_LIMIT}</div>
            </div>
          );
        })}
        {group.fins.length > 4 && (
          <div className="text-[9px] text-dim">+{group.fins.length - 4} FIN mais…</div>
        )}
      </div>

      <div className="mt-2 text-[9px] text-dim">Último registo: {group.lastDate}</div>
    </button>
  );
}

// ── Page root ─────────────────────────────────────────────────────────────────

interface Props {
  harnesses: { id: string; name: string; project: string }[];
}

export function ConnectorCycles({ harnesses }: Props) {
  const [entries,       setEntries]       = useState<MateDemateEntry[]>([]);
  const [showForm,      setShowForm]      = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<TargetGroup | null>(null);
  const [preTarget,     setPreTarget]     = useState<{ type: MDTargetType; id: string } | undefined>();

  const load = useCallback(async () => {
    const res = await api.getMateDemateLog();
    setEntries(res.entries ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id: string) {
    if (!confirm('Apagar este registo?')) return;
    await api.deleteMateDemateEntry(id);
    await load();
    if (selectedGroup) {
      setSelectedGroup(prev => {
        if (!prev) return null;
        // rebuild group from updated entries after load — force re-render via load()
        return prev;
      });
    }
  }

  function openForm(group?: TargetGroup) {
    setPreTarget(group ? { type: group.targetType, id: group.targetId } : undefined);
    setShowForm(true);
  }

  const groups = buildGroups(entries, harnesses);

  // Sync selected group after entries update
  const liveGroup = selectedGroup
    ? groups.find(g => g.targetType === selectedGroup.targetType && g.targetId === selectedGroup.targetId) ?? null
    : null;

  const totalFins   = groups.reduce((n, g) => n + g.fins.length, 0);
  const alertCount  = groups.reduce((n, g) => n + g.fins.filter(f => f.total / CYCLE_LIMIT >= 0.8).length, 0);

  // ── Detail view ──────────────────────────────────────────────────────────
  if (liveGroup) {
    return (
      <div className="px-8 py-6">
        <GroupPanel
          group={liveGroup}
          entries={entries}
          onDelete={handleDelete}
          onAddEntry={() => openForm(liveGroup)}
          onBack={() => setSelectedGroup(null)}
        />
        {showForm && (
          <EntryForm harnesses={harnesses} preTarget={preTarget}
            onSave={load} onClose={() => setShowForm(false)} />
        )}
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────
  return (
    <div className="px-8 py-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text">Connector Cycles</h1>
          <p className="text-xs text-dim mt-0.5">
            Registo de mate/demate por FIN · {groups.length} alvos · {totalFins} FIN
            {alertCount > 0 && (
              <span className="ml-2 text-risk font-semibold">⚠ {alertCount} FIN próximo/acima do limite</span>
            )}
          </p>
        </div>
        <button onClick={() => openForm()}
          className="px-4 py-2 rounded-lg bg-done/90 text-white text-sm font-semibold hover:bg-done transition-colors">
          + Registar
        </button>
      </div>

      {/* Stat strip */}
      {groups.length > 0 && (
        <div className="flex gap-4">
          <div className="border border-border rounded-lg px-4 py-2 text-center min-w-[80px]">
            <div className="text-xl font-bold text-bright">{groups.length}</div>
            <div className="text-[10px] text-dim">Alvos</div>
          </div>
          <div className="border border-border rounded-lg px-4 py-2 text-center min-w-[80px]">
            <div className="text-xl font-bold text-bright">{totalFins}</div>
            <div className="text-[10px] text-dim">FIN únicos</div>
          </div>
          <div className="border border-border rounded-lg px-4 py-2 text-center min-w-[80px]">
            <div className="text-xl font-bold text-bright">{entries.length}</div>
            <div className="text-[10px] text-dim">Operações</div>
          </div>
          {alertCount > 0 && (
            <div className="border border-risk/40 bg-risk/10 rounded-lg px-4 py-2 text-center min-w-[80px]">
              <div className="text-xl font-bold text-risk">{alertCount}</div>
              <div className="text-[10px] text-risk">FIN em alerta</div>
            </div>
          )}
        </div>
      )}

      {/* Group cards */}
      {groups.length === 0 ? (
        <div className="text-center py-24 text-dim">
          <div className="text-5xl mb-4">🔌</div>
          <p className="text-[13px] font-medium text-mid">Sem registos de ciclos</p>
          <p className="text-[11px] mt-1">Clica "+ Registar" para começar a rastrear mate/demate por FIN.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map(g => (
            <GroupCard
              key={`${g.targetType}::${g.targetId}`}
              group={g}
              onClick={() => setSelectedGroup(g)}
            />
          ))}
        </div>
      )}

      {showForm && (
        <EntryForm harnesses={harnesses} preTarget={preTarget}
          onSave={load} onClose={() => setShowForm(false)} />
      )}
    </div>
  );
}
