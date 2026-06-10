import { useState, useEffect } from 'react';
import { useReadonly } from '../../context/ReadonlyContext';
import type { InventoryItem, BomAnalysisResult, BomAnalysisSummary, ProcDocument } from '../../types';
import * as api from '../../api';
import { ImportModal, ExportButton } from './ImportExport';

// ── Status badge ─────────────────────────────────────────────────────────────
function StockBadge({ item }: { item: InventoryItem }) {
  const avail = item.quantity - item.reserved;
  const low   = avail <= item.minStock;
  const out   = avail <= 0;
  if (out)  return <span className="inline-block whitespace-nowrap px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-blocked/10 border border-blocked/30 text-blocked">Out of stock</span>;
  if (low)  return <span className="inline-block whitespace-nowrap px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-risk/10 border border-risk/30 text-risk">Low stock</span>;
  return      <span className="inline-block whitespace-nowrap px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-ok/10 border border-ok/25 text-ok">In stock</span>;
}

const CATEGORIES = ['Wire', 'Cable', 'Connector', 'Backshell', 'Pin', 'Accessory', 'Tools', 'Consumable', 'Other'];

// ── Item form modal ───────────────────────────────────────────────────────────
interface ItemFormProps {
  initial?: Partial<InventoryItem>;
  procDocs: ProcDocument[];
  onSave: (data: Omit<InventoryItem, 'id'>) => Promise<void>;
  onClose: () => void;
}

function ItemForm({ initial, procDocs, onSave, onClose }: ItemFormProps) {
  const [form, setForm] = useState({
    partNumber:   initial?.partNumber   ?? '',
    description:  initial?.description  ?? '',
    category:     initial?.category     ?? 'Wire',
    quantity:     String(initial?.quantity   ?? 0),
    reserved:     String(initial?.reserved   ?? 0),
    unit:         initial?.unit         ?? 'pc',
    location:     initial?.location     ?? '',
    unitCost:     String(initial?.unitCost   ?? 0),
    leadTimeDays: String(initial?.leadTimeDays ?? 0),
    supplier:     initial?.supplier     ?? '',
    minStock:     String(initial?.minStock   ?? 0),
    procRef:      initial?.procRef      ?? '',
  });
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [docQ,    setDocQ]    = useState('');
  const [docOpen, setDocOpen] = useState(false);

  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      await onSave({
        partNumber:   form.partNumber.trim(),
        description:  form.description.trim(),
        category:     form.category.trim(),
        quantity:     parseFloat(form.quantity) || 0,
        reserved:     parseFloat(form.reserved) || 0,
        unit:         form.unit.trim() || 'pc',
        location:     form.location.trim(),
        unitCost:     parseFloat(form.unitCost) || 0,
        leadTimeDays: parseInt(form.leadTimeDays) || 0,
        supplier:     form.supplier.trim(),
        minStock:     parseFloat(form.minStock) || 0,
        procRef:      form.procRef.trim() || undefined,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const F = ({ label, k, type = 'text', half = false }: { label: string; k: string; type?: string; half?: boolean }) => (
    <div className={half ? 'flex flex-col gap-1' : 'flex flex-col gap-1 col-span-2'}>
      <label className="text-[10px] font-mono text-dim uppercase tracking-wider">{label}</label>
      <input
        type={type}
        value={(form as Record<string, string>)[k]}
        onChange={(e) => set(k, e.target.value)}
        className="px-3 py-1.5 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[560px] max-h-[90vh] overflow-y-auto bg-surface rounded-2xl shadow-card-md border border-border p-6"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-base text-text">{initial ? 'Edit Item' : 'Add Inventory Item'}</h2>
          <button onClick={onClose} className="text-dim hover:text-text text-xl">×</button>
        </div>
        <form onSubmit={submit} className="grid grid-cols-2 gap-4">
          <F label="Part Number" k="partNumber" />
          <F label="Description" k="description" />
          {/* Category */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider">Category</label>
            <select value={form.category} onChange={(e) => set('category', e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60 cursor-pointer">
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <F label="Unit (pc, m, roll…)" k="unit" half />
          <F label="Quantity in stock" k="quantity" type="number" half />
          <F label="Reserved" k="reserved" type="number" half />
          <F label="Min stock (reorder point)" k="minStock" type="number" half />
          <F label="Unit cost (€)" k="unitCost" type="number" half />
          <F label="Lead time (days)" k="leadTimeDays" type="number" half />
          <F label="Supplier" k="supplier" half />
          <F label="Location (shelf/bin)" k="location" />
          {/* Linked procurement document */}
          <div className="col-span-2 flex flex-col gap-1 relative">
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider">Linked PR / PO</label>
            <div className="flex gap-2 items-center">
              <input
                value={docQ || form.procRef}
                onChange={(e) => { setDocQ(e.target.value); setDocOpen(true); }}
                onFocus={() => setDocOpen(true)}
                placeholder="Search by number or description…"
                autoComplete="off"
                className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-bg text-sm font-mono text-done focus:outline-none focus:border-accent/60"
              />
              {form.procRef && (
                <button type="button" onClick={() => { set('procRef', ''); setDocQ(''); }}
                  className="text-dim hover:text-blocked text-lg leading-none">×</button>
              )}
            </div>
            {docOpen && (docQ.length >= 1) && (() => {
              const q = docQ.toLowerCase();
              const matches = procDocs.filter((d) =>
                d.number.toLowerCase().includes(q) ||
                d.description.toLowerCase().includes(q)
              ).slice(0, 8);
              return matches.length > 0 ? (
                <div className="absolute z-50 left-0 right-8 top-full mt-0.5 bg-surface border border-border rounded-lg shadow-lg max-h-52 overflow-y-auto">
                  {matches.map((d) => (
                    <button key={d.id} type="button"
                      className="w-full text-left px-3 py-2 hover:bg-surface2 flex items-baseline gap-2"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        set('procRef', d.number);
                        setDocQ('');
                        setDocOpen(false);
                      }}>
                      <span className="font-mono text-[11px] text-done shrink-0">{d.number}</span>
                      <span className="text-[11px] text-mid truncate">{d.description}</span>
                      <span className={`ml-auto text-[10px] shrink-0 px-1.5 py-0.5 rounded font-mono
                        ${d.status === 'complete' ? 'text-ok bg-ok/10' : d.status === 'partial' ? 'text-done bg-done/10' : 'text-dim bg-surface2'}`}>
                        {d.status}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null;
            })()}
          </div>

          {error && <p className="col-span-2 text-xs text-blocked">{error}</p>}
          <div className="col-span-2 flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm text-dim hover:text-mid">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-done/90 text-white text-sm font-semibold hover:bg-done disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── BOM analysis panel ────────────────────────────────────────────────────────
function BomAnalysis({ onClose }: { onClose: () => void }) {
  const [text,    setText]    = useState('');
  const [results, setResults] = useState<BomAnalysisResult[]>([]);
  const [summary, setSummary] = useState<BomAnalysisSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  // Parse "PART-NUMBER   qty  unit" lines (tab or comma separated)
  function parseBom(raw: string) {
    return raw.trim().split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/[\t,;]+/).map((s) => s.trim());
        return { partNumber: parts[0] ?? '', quantity: parseFloat(parts[1] ?? '1') || 1, unit: parts[2] ?? 'pc', description: parts[3] ?? '' };
      })
      .filter((r) => r.partNumber);
  }

  async function analyse() {
    const items = parseBom(text);
    if (!items.length) { setError('No valid items parsed.'); return; }
    setLoading(true); setError('');
    const res = await api.runBomAnalysis(items);
    setLoading(false);
    if (!res.ok) { setError(res.error ?? 'Analysis failed'); return; }
    setResults(res.results);
    setSummary(res.summary);
  }

  const statusStyle: Record<string, string> = {
    in_stock:    'bg-ok/10 text-ok border-ok/25',
    partial:     'bg-risk/10 text-risk border-risk/25',
    out_of_stock:'bg-blocked/10 text-blocked border-blocked/25',
    not_found:   'bg-surface2 text-dim border-border',
  };
  const statusLabel: Record<string, string> = {
    in_stock: 'In Stock', partial: 'Partial', out_of_stock: 'Out of Stock', not_found: 'Not Found',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[800px] max-h-[90vh] flex flex-col bg-surface rounded-2xl shadow-card-md border border-border"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-semibold text-base text-text">BOM Analysis</h2>
            <p className="text-xs text-dim">Paste BOM items — one per line: PartNumber  Qty  Unit</p>
          </div>
          <button onClick={onClose} className="text-dim hover:text-text text-xl">×</button>
        </div>

        <div className="flex gap-4 p-4 shrink-0">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"WIRE-AWG18-RED\t10\tm\nCONN-D38999-24P\t2\tpc"}
            rows={5}
            className="flex-1 px-3 py-2 rounded-lg border border-border bg-bg font-mono text-xs text-text focus:outline-none focus:border-accent/60 resize-none"
          />
          <div className="flex flex-col gap-2 justify-end">
            <button onClick={analyse} disabled={loading || !text.trim()}
              className="px-5 py-2 rounded-lg bg-done/90 text-white text-sm font-semibold hover:bg-done disabled:opacity-50">
              {loading ? 'Checking…' : 'Analyse'}
            </button>
            {error && <p className="text-xs text-blocked max-w-[140px]">{error}</p>}
          </div>
        </div>

        {summary && (
          <div className="flex gap-3 px-4 pb-3 shrink-0">
            {[
              { label: 'In Stock',     count: summary.inStock,    color: 'text-ok' },
              { label: 'Partial',      count: summary.partial,    color: 'text-risk' },
              { label: 'Out of Stock', count: summary.outOfStock, color: 'text-blocked' },
              { label: 'Not Found',    count: summary.notFound,   color: 'text-dim' },
              { label: 'Total Cost',   count: `€${summary.totalCost.toFixed(2)}`, color: 'text-done' },
              { label: 'Max Lead',     count: summary.maxLeadDays ? `${summary.maxLeadDays}d` : '—', color: 'text-text' },
            ].map((s) => (
              <div key={s.label} className="flex-1 bg-surface2 rounded-lg px-3 py-2 border border-border/60 text-center">
                <div className={`font-bold text-sm ${s.color}`}>{s.count}</div>
                <div className="text-[9px] text-dim font-mono uppercase">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto border-t border-border">
          {results.length > 0 && (
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-surface2 border-b border-border">
                <tr>
                  {['Part Number','Description','Required','Available','Shortfall','Status','Unit Cost','Subtotal','Lead','Location'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-mono text-[9px] text-dim font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.partNumber} className="border-b border-border/30 hover:bg-surface2/60">
                    <td className="px-3 py-2 font-mono text-[10px] font-semibold text-text">{r.partNumber}</td>
                    <td className="px-3 py-2 text-dim max-w-[160px] truncate" title={r.description}>{r.description || '—'}</td>
                    <td className="px-3 py-2 text-center font-mono">{r.required}</td>
                    <td className="px-3 py-2 text-center font-mono">{r.available}</td>
                    <td className={`px-3 py-2 text-center font-mono font-bold ${r.shortfall > 0 ? 'text-blocked' : 'text-dim/40'}`}>
                      {r.shortfall > 0 ? r.shortfall : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold font-mono ${statusStyle[r.status]}`}>
                        {statusLabel[r.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-right">{r.unitCost ? `€${r.unitCost.toFixed(2)}` : '—'}</td>
                    <td className="px-3 py-2 font-mono text-right font-semibold">{r.subtotal ? `€${r.subtotal.toFixed(2)}` : '—'}</td>
                    <td className="px-3 py-2 text-center font-mono text-dim">{r.leadTimeDays ? `${r.leadTimeDays}d` : '—'}</td>
                    <td className="px-3 py-2 font-mono text-dim">{r.location ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Batch edit toolbar ────────────────────────────────────────────────────────
// CATEGORIES defined at top of file

function BatchToolbar({ selected, onDone, onClear }: {
  selected: Set<string>;
  onDone: () => void;
  onClear: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState({
    category: '', supplier: '', location: '', unitCost: '', leadTimeDays: '', minStock: '',
  });

  function set(k: string, v: string) { setFields((f) => ({ ...f, [k]: v })); }

  async function apply() {
    const patch: Partial<InventoryItem> = {};
    if (fields.category)     patch.category     = fields.category;
    if (fields.supplier)     patch.supplier     = fields.supplier;
    if (fields.location)     patch.location     = fields.location;
    if (fields.unitCost)     patch.unitCost     = parseFloat(fields.unitCost);
    if (fields.leadTimeDays) patch.leadTimeDays = parseInt(fields.leadTimeDays);
    if (fields.minStock)     patch.minStock     = parseFloat(fields.minStock);
    if (!Object.keys(patch).length) return;
    setSaving(true);
    await api.batchUpdateInventoryItems([...selected].map((id) => ({ id, updates: patch })));
    setSaving(false);
    onDone();
  }

  const count = selected.size;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-done/8 border border-done/25 rounded-xl text-xs flex-wrap">
      <span className="font-mono font-semibold text-done whitespace-nowrap">{count} selected</span>
      <div className="w-px h-4 bg-done/25" />

      <select value={fields.category} onChange={(e) => set('category', e.target.value)}
        className="px-2 py-1 rounded border border-border bg-surface text-text text-xs focus:outline-none focus:border-accent/60 cursor-pointer">
        <option value="">Category…</option>
        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
      </select>

      <input value={fields.supplier} onChange={(e) => set('supplier', e.target.value)}
        placeholder="Supplier…"
        className="w-32 px-2 py-1 rounded border border-border bg-surface text-text text-xs focus:outline-none focus:border-accent/60" />

      <input value={fields.location} onChange={(e) => set('location', e.target.value)}
        placeholder="Location…"
        className="w-24 px-2 py-1 rounded border border-border bg-surface text-text text-xs focus:outline-none focus:border-accent/60" />

      <input value={fields.unitCost} onChange={(e) => set('unitCost', e.target.value)}
        placeholder="Unit cost…" type="number" min="0" step="0.01"
        className="w-24 px-2 py-1 rounded border border-border bg-surface text-text text-xs focus:outline-none focus:border-accent/60" />

      <input value={fields.leadTimeDays} onChange={(e) => set('leadTimeDays', e.target.value)}
        placeholder="Lead (days)…" type="number" min="0"
        className="w-24 px-2 py-1 rounded border border-border bg-surface text-text text-xs focus:outline-none focus:border-accent/60" />

      <input value={fields.minStock} onChange={(e) => set('minStock', e.target.value)}
        placeholder="Min stock…" type="number" min="0"
        className="w-24 px-2 py-1 rounded border border-border bg-surface text-text text-xs focus:outline-none focus:border-accent/60" />

      <div className="flex gap-2 ml-auto">
        <button onClick={onClear} className="px-3 py-1 rounded border border-border text-dim hover:text-mid text-xs transition-colors">
          Clear
        </button>
        <button onClick={apply} disabled={saving}
          className="px-3 py-1 rounded bg-done/90 text-white font-semibold text-xs hover:bg-done disabled:opacity-50 transition-colors">
          {saving ? 'Saving…' : 'Apply to all'}
        </button>
      </div>
    </div>
  );
}

// ── Main Inventory view ───────────────────────────────────────────────────────
export function Inventory() {
  const readonly = useReadonly();
  const [items,       setItems]    = useState<InventoryItem[]>([]);
  const [procDocs,    setProcDocs] = useState<ProcDocument[]>([]);
  const [loading,     setLoading]  = useState(true);
  const [showForm,    setShowForm] = useState(false);
  const [editItem,    setEditItem] = useState<InventoryItem | null>(null);
  const [showBom,     setShowBom]  = useState(false);
  const [showImport,  setShowImport] = useState(false);
  const [search,      setSearch]   = useState('');
  const [catFilter,   setCat]      = useState('All');
  const [selected,    setSelected] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    const [invData, procData] = await Promise.all([api.getInventory(), api.getProcurement()]);
    setItems(invData.items);
    setProcDocs(procData.orders);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const categories = ['All', ...new Set(items.map((i) => i.category))];
  const filtered = items.filter((i) => {
    const q = search.toLowerCase();
    const matchesSearch = !q || i.partNumber.toLowerCase().includes(q) || i.description.toLowerCase().includes(q);
    const matchesCat    = catFilter === 'All' || i.category === catFilter;
    return matchesSearch && matchesCat;
  });

  async function handleCreate(data: Omit<InventoryItem, 'id'>) {
    const res = await api.createInventoryItem(data);
    if (!res.ok) throw new Error(res.error);
    await load();
    setShowForm(false);
  }

  async function handleEdit(data: Omit<InventoryItem, 'id'>) {
    if (!editItem) return;
    const res = await api.updateInventoryItem(editItem.id, data);
    if (!res.ok) throw new Error(res.error);
    await load();
    setEditItem(null);
  }

  async function handleDelete(item: InventoryItem) {
    if (!confirm(`Delete ${item.partNumber}?`)) return;
    await api.deleteInventoryItem(item.id);
    await load();
  }

  function toggleOne(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected((s) => s.size === filtered.length ? new Set() : new Set(filtered.map((i) => i.id)));
  }
  const allChecked = filtered.length > 0 && selected.size === filtered.length;
  const someChecked = selected.size > 0 && selected.size < filtered.length;

  const totalValue = filtered.reduce((s, i) => s + i.quantity * i.unitCost, 0);
  const lowCount   = items.filter((i) => (i.quantity - i.reserved) <= i.minStock).length;
  const outCount   = items.filter((i) => (i.quantity - i.reserved) <= 0).length;

  return (
    <div className="px-8 py-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text">Inventory</h1>
          <p className="text-xs text-dim mt-0.5">{items.length} items · Stock value: <span className="font-semibold text-text">€{totalValue.toLocaleString('en', { minimumFractionDigits: 2 })}</span></p>
        </div>
        <div className="flex gap-2 items-center">
          <ExportButton items={filtered} />
          {!readonly && (
            <>
              <button onClick={() => setShowImport(true)}
                className="px-4 py-2 rounded-lg border border-border bg-surface2 text-sm text-mid font-medium hover:bg-surface3 transition-colors">
                ↑ Import
              </button>
              <button onClick={() => setShowBom(true)}
                className="px-4 py-2 rounded-lg border border-border bg-surface2 text-sm text-mid font-medium hover:bg-surface3 transition-colors">
                📋 BOM Analysis
              </button>
              <button onClick={() => setShowForm(true)}
                className="px-4 py-2 rounded-lg bg-done/90 text-white text-sm font-semibold hover:bg-done transition-colors">
                + Add Item
              </button>
            </>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Items',  value: items.length,                  color: 'text-text' },
          { label: 'Low Stock',    value: lowCount,                       color: lowCount > 0 ? 'text-risk' : 'text-ok' },
          { label: 'Out of Stock', value: outCount,                       color: outCount > 0 ? 'text-blocked' : 'text-ok' },
          { label: 'Stock Value',  value: `€${totalValue.toLocaleString('en', { minimumFractionDigits: 2 })}`, color: 'text-done' },
        ].map((s) => (
          <div key={s.label} className="bg-surface border border-border rounded-xl px-4 py-3 shadow-card">
            <div className="text-[10px] font-mono uppercase tracking-widest text-dim">{s.label}</div>
            <div className={`text-xl font-bold mt-1 ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative w-72">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dim text-xs">⌕</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search part number or description…"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-text placeholder-dim focus:outline-none focus:border-accent/60" />
        </div>
        <div className="flex gap-1">
          {categories.map((c) => (
            <button key={c} onClick={() => setCat(c)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold border transition-all ${
                catFilter === c ? 'bg-done/10 border-done/35 text-done' : 'border-border text-dim hover:text-mid'
              }`}>{c}</button>
          ))}
        </div>
        <span className="ml-auto text-xs text-dim font-mono">{filtered.length} items shown</span>
      </div>

      {/* Batch toolbar */}
      {selected.size > 0 && (
        <BatchToolbar
          selected={selected}
          onDone={() => { setSelected(new Set()); load(); }}
          onClear={() => setSelected(new Set())}
        />
      )}

      {/* Table */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden shadow-card">
        <table className="w-full text-[12px]">
          <thead className="bg-surface2 border-b border-border">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <input type="checkbox" checked={allChecked} ref={(el) => { if (el) el.indeterminate = someChecked; }}
                  onChange={toggleAll}
                  className="w-3.5 h-3.5 rounded border-border accent-done cursor-pointer" />
              </th>
              {[
                { label: 'Part Number', cls: 'w-[160px]' },
                { label: 'Description', cls: 'min-w-[160px]' },
                { label: 'Category',    cls: 'w-[110px]' },
                { label: 'Available',   cls: 'w-[110px] text-center' },
                { label: 'Quantity',    cls: 'w-[100px] text-center' },
                { label: 'Location',    cls: 'w-[100px]' },
                { label: 'Reserved',    cls: 'w-[100px] text-center' },
                { label: 'Min Stock',   cls: 'w-[100px] text-center' },
                { label: 'Unit Cost',   cls: 'w-[90px] text-right' },
                { label: 'Lead',        cls: 'w-[70px] text-center' },
                { label: 'Supplier',    cls: 'min-w-[120px]' },
                { label: 'PR/PO Ref',  cls: 'w-[100px]' },
                { label: '',            cls: 'w-[64px]' },
              ].map((h) => (
                <th key={h.label} className={`px-3 py-2.5 font-mono text-[9px] uppercase tracking-wider text-dim font-normal text-left whitespace-nowrap ${h.cls}`}>{h.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {loading ? (
              <tr><td colSpan={14} className="px-4 py-12 text-center text-dim text-xs">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={14} className="px-4 py-12 text-center text-dim text-xs">No items found.</td></tr>
            ) : filtered.map((item) => {
              const avail = item.quantity - item.reserved;
              const isSelected = selected.has(item.id);
              return (
                <tr key={item.id} className={`hover:bg-surface2/50 group transition-colors ${isSelected ? 'bg-done/5' : ''}`}>
                  <td className="px-3 py-2.5">
                    <input type="checkbox" checked={isSelected} onChange={() => toggleOne(item.id)}
                      className="w-3.5 h-3.5 rounded border-border accent-done cursor-pointer" />
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] font-semibold text-text whitespace-nowrap">{item.partNumber}</td>
                  <td className="px-3 py-2.5 text-mid truncate max-w-[200px]" title={item.description}>{item.description}</td>
                  <td className="px-3 py-2.5">
                    <span className="px-2 py-0.5 rounded-full bg-surface2 border border-border text-[10px] font-mono text-dim">{item.category}</span>
                  </td>
                  <td className="px-3 py-2.5 text-center"><StockBadge item={item} /></td>
                  <td className="px-3 py-2.5 text-center font-mono text-text font-medium whitespace-nowrap">{avail} <span className="text-dim text-[10px]">{item.unit}</span></td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-mid whitespace-nowrap">{item.location || '—'}</td>
                  <td className="px-3 py-2.5 text-center font-mono text-dim whitespace-nowrap">{item.reserved > 0 ? <>{item.reserved} <span className="text-[10px]">{item.unit}</span></> : <span className="text-border">—</span>}</td>
                  <td className="px-3 py-2.5 text-center font-mono text-dim whitespace-nowrap">{item.minStock > 0 ? <>{item.minStock} <span className="text-[10px]">{item.unit}</span></> : <span className="text-border">—</span>}</td>
                  <td className="px-3 py-2.5 font-mono text-right text-text">€{item.unitCost.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-center font-mono text-dim">{item.leadTimeDays > 0 ? `${item.leadTimeDays}d` : '—'}</td>
                  <td className="px-3 py-2.5 text-mid truncate max-w-[140px]" title={item.supplier}>{item.supplier || '—'}</td>
                  <td className="px-3 py-2.5 font-mono text-[10px] text-done/70">{item.procRef || <span className="text-border">—</span>}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-center">
                      <button onClick={() => setEditItem(item)}
                        className="px-2 py-1 rounded border border-border text-[10px] text-mid hover:text-done hover:border-done/40 transition-colors">✏</button>
                      {selected.size === 0 && (
                        <button onClick={() => handleDelete(item)}
                          className="px-2 py-1 rounded border border-border text-[10px] text-mid hover:text-blocked hover:border-blocked/40 transition-colors">✕</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showForm && <ItemForm procDocs={procDocs} onSave={handleCreate} onClose={() => setShowForm(false)} />}
      {editItem  && <ItemForm initial={editItem} procDocs={procDocs} onSave={handleEdit} onClose={() => setEditItem(null)} />}
      {showBom    && <BomAnalysis onClose={() => setShowBom(false)} />}
      {showImport && <ImportModal onImported={load} onClose={() => setShowImport(false)} />}
    </div>
  );
}
