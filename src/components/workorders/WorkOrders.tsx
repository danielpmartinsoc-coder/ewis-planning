import { useState, useEffect } from 'react';
import type { WorkOrder, WOBomItem, WOStatus, InventoryItem, AppState } from '../../types';
import * as api from '../../api';

const STATUS_STYLE: Record<WOStatus, string> = {
  draft:       'bg-surface2 border-border text-dim',
  issued:      'bg-done/10 border-done/30 text-done',
  in_progress: 'bg-risk/10 border-risk/30 text-risk',
  complete:    'bg-ok/10 border-ok/30 text-ok',
  cancelled:   'bg-blocked/8 border-blocked/25 text-blocked',
};
const STATUS_LABEL: Record<WOStatus, string> = {
  draft: 'Draft', issued: 'Issued', in_progress: 'In Progress', complete: 'Complete', cancelled: 'Cancelled',
};

// ── WO creation / edit modal ──────────────────────────────────────────────────
interface WOFormProps {
  harnesses: AppState['harnesses'];
  initial?: WorkOrder;
  onSave: (wo: Omit<WorkOrder, 'id' | 'createdAt' | 'status'>) => Promise<void>;
  onClose: () => void;
}

function WOForm({ harnesses, initial, onSave, onClose }: WOFormProps) {
  const [number,  setNumber]  = useState(initial?.number      ?? '');
  const [project, setProject] = useState(initial?.project     ?? '');
  const [hid,     setHid]     = useState(initial?.harnessId   ?? '');
  const [desc,    setDesc]    = useState(initial?.description ?? '');
  const [notes,   setNotes]   = useState(initial?.notes       ?? '');
  const [bomText, setBomText] = useState(
    initial?.bomItems.map((b) => `${b.partNumber}\t${b.quantity}\t${b.unit}\t${b.description}`).join('\n') ?? ''
  );
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [analysed,  setAnalysed]  = useState<WOBomItem[]>(initial?.bomItems ?? []);
  const [checking,  setChecking]  = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');

  const projects = [...new Set(harnesses.map((h) => h.project))];

  useEffect(() => {
    api.getInventory().then((d) => setInventory(d.items));
  }, []);

  function parseBom(raw: string): { partNumber: string; quantity: number; unit: string; description: string }[] {
    return raw.trim().split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const parts = line.split(/[\t,;]+/).map((s) => s.trim());
      return { partNumber: parts[0] ?? '', quantity: parseFloat(parts[1] ?? '1') || 1, unit: parts[2] ?? 'pc', description: parts[3] ?? '' };
    }).filter((r) => r.partNumber);
  }

  async function checkInventory() {
    const items = parseBom(bomText);
    if (!items.length) { setError('No valid BOM items.'); return; }
    setChecking(true); setError('');
    const res = await api.runBomAnalysis(items);
    setChecking(false);
    if (!res.ok) { setError(res.error ?? 'Analysis failed'); return; }
    const invMap = Object.fromEntries(inventory.map((i) => [i.partNumber, i]));
    setAnalysed(items.map((item) => {
      const inv = invMap[item.partNumber];
      const unitCost = inv?.unitCost ?? 0;
      return { partNumber: item.partNumber, description: item.description || inv?.description || '', quantity: item.quantity, unit: item.unit, unitCost, subtotal: unitCost * item.quantity };
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!number.trim()) { setError('WO number is required.'); return; }
    setSaving(true); setError('');
    try {
      await onSave({ number: number.trim(), project, harnessId: hid, description: desc, bomItems: analysed, totalCost: analysed.reduce((s, b) => s + b.subtotal, 0), notes, createdBy: 'Operator' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const total = analysed.reduce((s, b) => s + b.subtotal, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[720px] max-h-[92vh] flex flex-col bg-surface rounded-2xl shadow-card-md border border-border"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="font-semibold text-base text-text">{initial ? 'Edit Work Order' : 'New Work Order'}</h2>
          <button onClick={onClose} className="text-dim hover:text-text text-xl">×</button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto">
          <div className="p-6 grid grid-cols-2 gap-4">
            {/* WO Number — the key field */}
            <div className="col-span-2">
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Work Order Number *</label>
              <input value={number} onChange={(e) => setNumber(e.target.value)} required
                placeholder="e.g. WO-2026-0001"
                className="w-full px-3 py-2 rounded-lg border border-done/50 bg-bg text-sm font-mono font-bold text-done focus:outline-none focus:border-done" />
              <p className="text-[10px] text-dim mt-1">This number will be used to charge all material in this order.</p>
            </div>

            <div>
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Programme</label>
              <select value={project} onChange={(e) => { setProject(e.target.value); setHid(''); }}
                className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none">
                <option value="">— select —</option>
                {projects.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Harness</label>
              <select value={hid} onChange={(e) => setHid(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none">
                <option value="">— select —</option>
                {harnesses.filter((h) => !project || h.project === project).map((h) => (
                  <option key={h.id} value={h.id}>{h.id} — {h.name}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Description</label>
              <input value={desc} onChange={(e) => setDesc(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none" />
            </div>

            {/* BOM section */}
            <div className="col-span-2">
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">
                BOM Items — one per line: PartNumber  Qty  Unit  Description
              </label>
              <textarea value={bomText} onChange={(e) => setBomText(e.target.value)} rows={5}
                placeholder={"WIRE-AWG18-RED\t10\tm\nCONN-D38999-24P\t2\tpc"}
                className="w-full px-3 py-2 rounded-lg border border-border bg-bg font-mono text-xs text-text focus:outline-none resize-none" />
              <button type="button" onClick={checkInventory} disabled={checking || !bomText.trim()}
                className="mt-2 px-4 py-1.5 rounded-lg border border-border bg-surface2 text-xs text-mid font-medium hover:bg-surface3 disabled:opacity-50">
                {checking ? 'Checking stock…' : '🔍 Check inventory & costs'}
              </button>
            </div>

            {/* Analysed BOM */}
            {analysed.length > 0 && (
              <div className="col-span-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono text-dim uppercase tracking-wider">Material List</span>
                  <span className="font-mono text-sm font-bold text-done">Total: €{total.toFixed(2)}</span>
                </div>
                <table className="w-full text-[11px] border border-border rounded-lg overflow-hidden">
                  <thead className="bg-surface2">
                    <tr>
                      {['Part Number','Description','Qty','Unit','Unit Cost','Subtotal'].map((h) => (
                        <th key={h} className="px-3 py-1.5 text-left font-mono text-[9px] text-dim font-normal">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analysed.map((b, i) => (
                      <tr key={i} className="border-t border-border/40">
                        <td className="px-3 py-1.5 font-mono font-semibold">{b.partNumber}</td>
                        <td className="px-3 py-1.5 text-dim truncate max-w-[160px]">{b.description}</td>
                        <td className="px-3 py-1.5 text-center font-mono">{b.quantity}</td>
                        <td className="px-3 py-1.5 font-mono text-dim">{b.unit}</td>
                        <td className="px-3 py-1.5 font-mono text-right">€{b.unitCost.toFixed(2)}</td>
                        <td className="px-3 py-1.5 font-mono text-right font-semibold text-done">€{b.subtotal.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="col-span-2">
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none resize-none" />
            </div>
          </div>

          <div className="sticky bottom-0 bg-surface border-t border-border px-6 py-3 flex items-center justify-between">
            {error && <p className="text-xs text-blocked">{error}</p>}
            <div className="flex gap-3 ml-auto">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm text-dim hover:text-mid">Cancel</button>
              <button type="submit" disabled={saving}
                className="px-5 py-2 rounded-lg bg-done/90 text-white text-sm font-semibold hover:bg-done disabled:opacity-50">
                {saving ? 'Saving…' : 'Create Work Order'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── WO detail modal ───────────────────────────────────────────────────────────
function WODetail({ wo, onClose, onStatusChange, onEdit }: { wo: WorkOrder; onClose: () => void; onStatusChange: (id: string, status: WOStatus) => void; onEdit: () => void }) {
  const statuses: WOStatus[] = ['draft', 'issued', 'in_progress', 'complete', 'cancelled'];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[680px] max-h-[90vh] overflow-y-auto bg-surface rounded-2xl shadow-card-md border border-border p-6"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="font-mono text-xl font-extrabold text-done">{wo.number}</div>
            <div className="text-sm text-mid mt-0.5">{wo.description}</div>
            <div className="text-xs text-dim mt-1">{wo.project} {wo.harnessId && `· ${wo.harnessId}`} · Created {wo.createdAt} by {wo.createdBy}</div>
          </div>
          <div className="flex gap-2 items-start">
            <button onClick={onEdit}
              className="px-3 py-1.5 rounded-lg border border-border text-xs text-mid hover:text-done hover:border-done/40 transition-colors">✏ Edit</button>
            <button onClick={onClose} className="text-dim hover:text-text text-xl ml-1">×</button>
          </div>
        </div>

        {/* Status control */}
        <div className="flex gap-2 mb-5">
          {statuses.map((s) => (
            <button key={s} onClick={() => onStatusChange(wo.id, s)}
              className={`px-3 py-1 rounded-lg border text-[11px] font-mono font-bold transition-all ${
                wo.status === s ? STATUS_STYLE[s] : 'border-border text-dim hover:text-mid'
              }`}>{STATUS_LABEL[s]}</button>
          ))}
        </div>

        {/* BOM */}
        <div className="bg-surface2 rounded-xl border border-border overflow-hidden mb-4">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
            <span className="text-sm font-semibold text-text">Material List</span>
            <span className="font-mono font-bold text-done text-sm">€{wo.totalCost.toFixed(2)}</span>
          </div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border/40">
                {['Part Number','Description','Qty','Unit','Unit Cost','Subtotal'].map((h) => (
                  <th key={h} className="px-3 py-1.5 text-left font-mono text-[9px] text-dim font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {wo.bomItems.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-dim">No BOM items.</td></tr>
              ) : wo.bomItems.map((b, i) => (
                <tr key={i} className="border-b border-border/30">
                  <td className="px-3 py-2 font-mono font-semibold">{b.partNumber}</td>
                  <td className="px-3 py-2 text-dim">{b.description}</td>
                  <td className="px-3 py-2 text-center font-mono">{b.quantity}</td>
                  <td className="px-3 py-2 font-mono text-dim">{b.unit}</td>
                  <td className="px-3 py-2 font-mono text-right">€{b.unitCost.toFixed(2)}</td>
                  <td className="px-3 py-2 font-mono text-right font-semibold text-done">€{b.subtotal.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {wo.notes && <p className="text-xs text-mid bg-surface2 rounded-lg px-4 py-3 border border-border">{wo.notes}</p>}
      </div>
    </div>
  );
}

// ── Main Work Orders view ─────────────────────────────────────────────────────
interface Props { harnesses: AppState['harnesses'] }

export function WorkOrders({ harnesses }: Props) {
  const [orders,    setOrders]   = useState<WorkOrder[]>([]);
  const [loading,   setLoading]  = useState(true);
  const [showForm,  setShowForm] = useState(false);
  const [editWO,    setEditWO]   = useState<WorkOrder | null>(null);
  const [detail,    setDetail]   = useState<WorkOrder | null>(null);
  const [filter,    setFilter]   = useState<WOStatus | 'all'>('all');

  async function load() {
    setLoading(true);
    const data = await api.getWorkOrders();
    setOrders(data.orders);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = filter === 'all' ? orders : orders.filter((o) => o.status === filter);
  const totalValue = orders.reduce((s, o) => s + o.totalCost, 0);

  async function handleCreate(wo: Omit<WorkOrder, 'id' | 'createdAt' | 'status'>) {
    const res = await api.createWorkOrder(wo);
    if (!res.ok) throw new Error(res.error);
    await load();
    setShowForm(false);
  }

  async function handleEditSave(wo: Omit<WorkOrder, 'id' | 'createdAt' | 'status'>) {
    if (!editWO) return;
    const res = await api.updateWorkOrder(editWO.id, { ...wo, bomItems: wo.bomItems, totalCost: wo.bomItems.reduce((s,b) => s + b.subtotal, 0) });
    if (!res.ok) throw new Error(res.error);
    await load();
    setEditWO(null);
    setDetail(null);
  }

  async function handleStatusChange(id: string, status: WOStatus) {
    await api.updateWorkOrder(id, { status });
    await load();
    setDetail((prev) => prev ? { ...prev, status } : null);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this work order and release reserved stock?')) return;
    await api.deleteWorkOrder(id);
    await load();
  }

  return (
    <div className="px-8 py-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text">Work Orders</h1>
          <p className="text-xs text-dim mt-0.5">{orders.length} orders · Total value: <span className="font-semibold text-text">€{totalValue.toLocaleString('en', { minimumFractionDigits: 2 })}</span></p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="px-4 py-2 rounded-lg bg-done/90 text-white text-sm font-semibold hover:bg-done transition-colors">
          + New Work Order
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-4">
        {(['draft','issued','in_progress','complete','cancelled'] as WOStatus[]).map((s) => {
          const count = orders.filter((o) => o.status === s).length;
          const val   = orders.filter((o) => o.status === s).reduce((sum, o) => sum + o.totalCost, 0);
          return (
            <div key={s} className="bg-surface border border-border rounded-xl px-4 py-3 shadow-card">
              <div className={`text-[10px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border self-start inline-block mb-1 ${STATUS_STYLE[s]}`}>
                {STATUS_LABEL[s]}
              </div>
              <div className="text-xl font-bold text-text">{count}</div>
              <div className="text-[10px] text-dim font-mono">€{val.toFixed(2)}</div>
            </div>
          );
        })}
      </div>

      {/* Filter */}
      <div className="flex gap-1">
        {(['all', 'draft', 'issued', 'in_progress', 'complete', 'cancelled'] as const).map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold border transition-all ${
              filter === s ? 'bg-done/10 border-done/35 text-done' : 'border-border text-dim hover:text-mid'
            }`}>{s === 'all' ? 'All' : STATUS_LABEL[s]}</button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden shadow-card">
        <table className="w-full text-[12px]">
          <thead className="bg-surface2 border-b border-border">
            <tr>
              {['WO Number','Programme','Harness','Description','Status','Items','Total Cost','Created',''].map((h) => (
                <th key={h} className="px-3 py-2.5 text-left font-mono text-[9px] uppercase tracking-wider text-dim font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-12 text-center text-dim text-xs">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-12 text-center text-dim text-xs">No work orders. Create one to get started.</td></tr>
            ) : filtered.map((wo) => (
              <tr key={wo.id} className="border-b border-border/40 hover:bg-surface2/50 cursor-pointer group"
                onClick={() => setDetail(wo)}>
                <td className="px-3 py-2.5 font-mono font-bold text-done">{wo.number}</td>
                <td className="px-3 py-2.5 text-mid">{wo.project}</td>
                <td className="px-3 py-2.5 font-mono text-dim">{wo.harnessId || '—'}</td>
                <td className="px-3 py-2.5 text-mid max-w-[200px] truncate">{wo.description || '—'}</td>
                <td className="px-3 py-2.5">
                  <span className={`px-2 py-0.5 rounded border text-[10px] font-bold font-mono ${STATUS_STYLE[wo.status]}`}>
                    {STATUS_LABEL[wo.status]}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-center font-mono text-dim">{wo.bomItems.length}</td>
                <td className="px-3 py-2.5 font-mono font-semibold text-right text-done">€{wo.totalCost.toFixed(2)}</td>
                <td className="px-3 py-2.5 font-mono text-dim">{wo.createdAt}</td>
                <td className="px-3 py-2.5">
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(wo.id); }}
                    className="opacity-0 group-hover:opacity-100 px-2 py-1 rounded border border-border text-[10px] text-dim hover:text-blocked hover:border-blocked/40 transition-all">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && <WOForm harnesses={harnesses} onSave={handleCreate} onClose={() => setShowForm(false)} />}
      {editWO   && <WOForm harnesses={harnesses} initial={editWO} onSave={handleEditSave} onClose={() => setEditWO(null)} />}
      {detail   && <WODetail wo={detail} onClose={() => setDetail(null)} onStatusChange={handleStatusChange}
                    onEdit={() => { setEditWO(detail); setDetail(null); }} />}
    </div>
  );
}
