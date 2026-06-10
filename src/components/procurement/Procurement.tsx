import { useState, useEffect, useRef, useCallback } from 'react';
import { useReadonly } from '../../context/ReadonlyContext';
import * as XLSX from 'xlsx';
import type { ProcDocument, ProcDocType, ProcDocStatus, ProcLineItem, InventoryItem } from '../../types';
import * as api from '../../api';

const DOC_TYPE_LABEL: Record<ProcDocType, string> = {
  PO: 'Purchase Order', PR: 'Purchase Requisition', Quote: 'Quotation', Invoice: 'Invoice',
};
const DOC_TYPES: ProcDocType[] = ['PO', 'PR', 'Quote', 'Invoice'];

const STATUS_STYLE: Record<ProcDocStatus, string> = {
  pending:   'bg-risk/10 border-risk/30 text-risk',
  partial:   'bg-done/10 border-done/30 text-done',
  complete:  'bg-ok/10 border-ok/30 text-ok',
  cancelled: 'bg-surface2 border-border text-dim',
};
const STATUS_LABEL: Record<ProcDocStatus, string> = {
  pending: 'Pending', partial: 'Partial', complete: 'Complete', cancelled: 'Cancelled',
};
const STATUS_LIST: ProcDocStatus[] = ['pending', 'partial', 'complete', 'cancelled'];

const FILE_ICONS: Record<string, string> = {
  pdf: '📕', xlsx: '📗', xls: '📗', csv: '📗', md: '📝', txt: '📄',
};
function fileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return FILE_ICONS[ext] ?? '📄';
}

// ── PN autocomplete input ─────────────────────────────────────────────────────
function PNInput({ value, onChange, inventory, placeholder, className }: {
  value: string;
  onChange: (v: string) => void;
  inventory: InventoryItem[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const matches = value.trim().length >= 1
    ? inventory.filter((i) =>
        i.partNumber.toLowerCase().includes(value.toLowerCase()) ||
        i.description.toLowerCase().includes(value.toLowerCase())
      ).slice(0, 8)
    : [];

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div ref={ref} className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder ?? 'Search or type PN…'}
        className={className}
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <div className="absolute z-50 left-0 right-0 top-full mt-0.5 bg-surface border border-border rounded-lg shadow-lg max-h-52 overflow-y-auto">
          {matches.map((item) => (
            <button key={item.id} type="button"
              className="w-full text-left px-3 py-2 hover:bg-surface2 flex items-baseline gap-2"
              onMouseDown={(e) => { e.preventDefault(); onChange(item.partNumber); setOpen(false); }}>
              <span className="font-mono text-[11px] text-done shrink-0">{item.partNumber}</span>
              <span className="text-[11px] text-mid truncate">{item.description}</span>
              <span className="text-[10px] text-dim/60 ml-auto shrink-0">{item.quantity} {item.unit}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Line items editor ─────────────────────────────────────────────────────────
function LineItemsEditor({ items, onChange, inventory }: {
  items: ProcLineItem[];
  onChange: (items: ProcLineItem[]) => void;
  inventory: InventoryItem[];
}) {
  function addRow() {
    onChange([...items, { id: crypto.randomUUID(), partNumber: '', description: '', qty: 1, unit: 'each' }]);
  }

  function update(id: string, patch: Partial<ProcLineItem>) {
    onChange(items.map((r) => r.id === id ? { ...r, ...patch } : r));
  }

  function remove(id: string) {
    onChange(items.filter((r) => r.id !== id));
  }

  function fillFromInventory(id: string, pn: string) {
    const inv = inventory.find((i) => i.partNumber === pn);
    if (inv) {
      onChange(items.map((r) => r.id === id
        ? { ...r, partNumber: pn, description: inv.description, unit: inv.unit, unitCost: inv.unitCost }
        : r));
    } else {
      update(id, { partNumber: pn });
    }
  }

  const inCls = 'w-full px-2 py-1 rounded border border-border bg-bg text-[11px] text-text focus:outline-none focus:border-accent/60 font-mono';

  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 && (
        <p className="text-[11px] text-dim italic text-center py-2">No items — click + Add item below</p>
      )}
      {items.map((row) => (
        <div key={row.id} className="grid gap-1.5 items-start" style={{ gridTemplateColumns: '1fr 2fr 70px 60px 24px' }}>
          {/* PN */}
          <PNInput
            value={row.partNumber}
            onChange={(v) => fillFromInventory(row.id, v)}
            inventory={inventory}
            placeholder="Part Number"
            className={inCls}
          />
          {/* Description */}
          <input value={row.description} onChange={(e) => update(row.id, { description: e.target.value })}
            placeholder="Description"
            className={`${inCls} font-sans`} />
          {/* Qty */}
          <input type="number" min="0" step="any" value={row.qty}
            onChange={(e) => update(row.id, { qty: parseFloat(e.target.value) || 0 })}
            placeholder="Qty"
            className={inCls} />
          {/* Unit */}
          <input value={row.unit} onChange={(e) => update(row.id, { unit: e.target.value })}
            placeholder="unit"
            className={inCls} />
          {/* Remove */}
          <button type="button" onClick={() => remove(row.id)}
            className="text-dim hover:text-blocked text-base leading-none pt-1">×</button>
        </div>
      ))}
      <button type="button" onClick={addRow}
        className="mt-1 self-start px-3 py-1 rounded-lg border border-dashed border-border text-[11px] text-dim hover:text-mid hover:border-accent/40 transition-colors">
        + Add item
      </button>
    </div>
  );
}

// ── Create / Edit modal ───────────────────────────────────────────────────────
interface FormProps {
  initial?: ProcDocument;
  projects: string[];
  inventory: InventoryItem[];
  onSave: () => void;
  onClose: () => void;
}

function ProcForm({ initial, projects, inventory, onSave, onClose }: FormProps) {
  const [number,    setNumber]   = useState(initial?.number      ?? '');
  const [type,      setType]     = useState<ProcDocType>(initial?.type ?? 'PR');
  const [desc,      setDesc]     = useState(initial?.description  ?? '');
  const [supplier,  setSupplier] = useState(initial?.supplier     ?? '');
  const [project,   setProject]  = useState(initial?.project      ?? '');
  const [value,     setValue]    = useState(String(initial?.totalValue ?? ''));
  const [currency,  setCurrency] = useState(initial?.currency     ?? 'EUR');
  const [notes,     setNotes]    = useState(initial?.notes        ?? '');
  const [missing,   setMissing]  = useState(initial?.missingItems ?? '');
  const [reqDate,   setReqDate]  = useState(initial?.requestedDate ?? '');
  // Single-item legacy fields (imported PRs)
  const [qty,       setQty]      = useState(String(initial?.qty ?? ''));
  const [unit,      setUnit]     = useState(initial?.unit ?? '');
  // Multi-item line entries
  const [lineItems, setLineItems] = useState<ProcLineItem[]>(initial?.lineItems ?? []);
  const [tab,       setTab]      = useState<'details' | 'items'>('details');

  const [file,  setFile]  = useState<{name:string;data:string;type:string}|null>(null);
  const [busy,  setBusy]  = useState(false);
  const [err,   setErr]   = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Auto-compute total value from line items
  const lineTotal = lineItems.reduce((s, r) => s + (r.qty * (r.unitCost ?? 0)), 0);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { setErr('File exceeds 10 MB limit.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = (reader.result as string).split(',')[1] ?? '';
      setFile({ name: f.name, data: b64, type: f.type });
    };
    reader.readAsDataURL(f);
    e.target.value = '';
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!number.trim()) { setErr('Document number is required.'); return; }
    setBusy(true); setErr('');
    const totalValue = lineItems.length > 0 ? lineTotal : (parseFloat(value) || 0);
    try {
      if (initial) {
        const res = await api.updateProcDocument(initial.id, {
          description: desc, supplier, project, type,
          totalValue, currency, notes, missingItems: missing,
          requestedDate: reqDate,
          qty: parseFloat(qty) || undefined,
          unit: unit || undefined,
          lineItems: lineItems.length > 0 ? lineItems : undefined,
        });
        if (!res.ok) throw new Error(res.error);
      } else {
        const res = await api.createProcDocument({
          number: number.trim(), type, description: desc, supplier, project,
          totalValue, currency, notes,
          ...(file ? { fileName: file.name, fileData: file.data, fileType: file.type } : {}),
        });
        // Save line items via update if we have them
        if (res.ok && res.document && lineItems.length > 0) {
          await api.updateProcDocument(res.document.id, { lineItems });
        }
        if (!res.ok) throw new Error(res.error);
      }
      onSave(); onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const inputCls = 'w-full px-3 py-1.5 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[680px] max-h-[92vh] flex flex-col bg-surface rounded-2xl border border-border shadow-card-md"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="font-semibold text-base text-text">{initial ? 'Edit Document' : 'New PR / PO'}</h2>
          <button onClick={onClose} className="text-dim hover:text-text text-xl">×</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-border shrink-0">
          {(['details', 'items'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                tab === t ? 'border-done text-done' : 'border-transparent text-dim hover:text-mid'
              }`}>
              {t === 'details' ? 'Details' : `Line Items${lineItems.length > 0 ? ` (${lineItems.length})` : ''}`}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
          {tab === 'details' && (<>
            {/* Document number */}
            <div>
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Document Number *</label>
              <input value={number} onChange={(e) => setNumber(e.target.value)} required readOnly={!!initial}
                placeholder="e.g. PR-2026-0042"
                className={`${inputCls} font-mono font-bold text-done ${initial ? 'opacity-70' : ''}`} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Type</label>
                <select value={type} onChange={(e) => setType(e.target.value as ProcDocType)} className={inputCls}>
                  {DOC_TYPES.map((t) => <option key={t} value={t}>{DOC_TYPE_LABEL[t]}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Programme</label>
                <select value={project} onChange={(e) => setProject(e.target.value)} className={inputCls}>
                  <option value="">— none —</option>
                  {projects.map((p) => <option key={p}>{p}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Description</label>
              <input value={desc} onChange={(e) => setDesc(e.target.value)} className={inputCls} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Supplier</label>
                <input value={supplier} onChange={(e) => setSupplier(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Requested Date</label>
                <input value={reqDate} onChange={(e) => setReqDate(e.target.value)}
                  placeholder="e.g. 2026-08-01" className={inputCls} />
              </div>
            </div>

            {/* Qty + unit — editable always (single-item or legacy correction) */}
            {(initial?.qty != null || !initial) && lineItems.length === 0 && (
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Quantity</label>
                  <input type="number" min="0" step="any" value={qty}
                    onChange={(e) => setQty(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Unit</label>
                  <input value={unit} onChange={(e) => setUnit(e.target.value)}
                    placeholder="each" className={inputCls} />
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">
                  Total Value {lineItems.length > 0 ? <span className="text-done/70">(auto from items: {lineTotal.toFixed(2)})</span> : ''}
                </label>
                <input type="number" value={lineItems.length > 0 ? lineTotal.toFixed(2) : value}
                  readOnly={lineItems.length > 0}
                  onChange={(e) => setValue(e.target.value)}
                  className={`${inputCls} ${lineItems.length > 0 ? 'opacity-60' : ''}`} />
              </div>
              <div className="w-24">
                <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Currency</label>
                <input value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls} />
              </div>
            </div>

            {/* File attachment — only on create */}
            {!initial && (
              <div>
                <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">
                  Attach Document (PDF, Excel, MD, CSV — max 10 MB)
                </label>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg border border-border bg-surface2 text-xs text-mid hover:bg-surface3 transition-colors">
                    📎 Choose file
                  </button>
                  {file ? (
                    <div className="flex items-center gap-1.5 text-xs text-done">
                      <span>{fileIcon(file.name)}</span>
                      <span className="font-mono">{file.name}</span>
                      <button type="button" onClick={() => setFile(null)} className="text-dim hover:text-blocked ml-1">×</button>
                    </div>
                  ) : (
                    <span className="text-xs text-dim">No file selected</span>
                  )}
                  <input ref={fileRef} type="file"
                    accept=".pdf,.xlsx,.xls,.csv,.md,.txt,.docx"
                    className="hidden" onChange={handleFile} />
                </div>
              </div>
            )}

            <div>
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                className={`${inputCls} resize-none`} />
            </div>

            <div>
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">
                Missing Items / Outstanding
              </label>
              <textarea value={missing} onChange={(e) => setMissing(e.target.value)} rows={3}
                placeholder="List items that are missing or still to be confirmed…"
                className={`${inputCls} resize-none`} />
            </div>
          </>)}

          {tab === 'items' && (
            <div>
              <p className="text-[10px] font-mono text-dim uppercase tracking-wider mb-3">
                Line Items — Part Number · Description · Qty · Unit
              </p>
              <div className="grid gap-1 mb-2 text-[9px] font-mono text-dim/60 uppercase tracking-wide px-0.5"
                style={{ gridTemplateColumns: '1fr 2fr 70px 60px 24px' }}>
                <span>Part Number</span><span>Description</span><span>Qty</span><span>Unit</span><span/>
              </div>
              <LineItemsEditor items={lineItems} onChange={setLineItems} inventory={inventory} />
              {lineItems.length > 0 && (
                <div className="mt-3 text-right text-xs text-mid">
                  {lineItems.length} items · total{' '}
                  <span className="font-semibold text-done">{currency} {lineTotal.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}

          {err && <p className="text-xs text-blocked">{err}</p>}
        </form>

        <div className="shrink-0 flex justify-end gap-3 px-6 py-3 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm text-dim hover:text-mid">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="px-5 py-2 rounded-lg bg-done/90 text-white text-sm font-semibold hover:bg-done disabled:opacity-50">
            {busy ? 'Saving…' : initial ? 'Save Changes' : 'Create Document'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Detail / status panel ─────────────────────────────────────────────────────
function ProcDetail({ doc, onClose, onStatusChange, onEdit, onMissingChange }: {
  doc: ProcDocument;
  onClose: () => void;
  onStatusChange: (id: string, status: ProcDocStatus) => void;
  onEdit: () => void;
  onMissingChange: (id: string, text: string) => void;
}) {
  const [missing, setMissing] = useState(doc.missingItems);
  const [saved,   setSaved]   = useState(false);

  async function saveMissing() {
    await api.updateProcDocument(doc.id, { missingItems: missing });
    onMissingChange(doc.id, missing);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[640px] max-h-[90vh] overflow-y-auto bg-surface rounded-2xl border border-border shadow-card-md p-6"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xl font-extrabold text-done">{doc.number}</span>
              <span className="text-xs text-dim font-mono">{DOC_TYPE_LABEL[doc.type]}</span>
            </div>
            <div className="text-sm text-mid mt-0.5">{doc.description}</div>
            <div className="text-xs text-dim mt-1">
              {doc.supplier && <span className="mr-3">Supplier: <span className="text-mid">{doc.supplier}</span></span>}
              {doc.project  && <span className="mr-3">Programme: <span className="text-mid">{doc.project}</span></span>}
              <span>Created {doc.createdAt} by {doc.createdBy}</span>
            </div>
            {doc.totalValue > 0 && (
              <div className="text-lg font-bold text-done mt-1">{doc.currency} {doc.totalValue.toLocaleString('en', {minimumFractionDigits:2})}</div>
            )}
          </div>
          <div className="flex gap-2 items-start ml-4 shrink-0">
            <button onClick={onEdit}
              className="px-3 py-1.5 rounded-lg border border-border text-xs text-mid hover:text-done hover:border-done/40">✏ Edit</button>
            <button onClick={onClose} className="text-dim hover:text-text text-xl ml-1">×</button>
          </div>
        </div>

        {/* Status selector */}
        <div className="mb-4">
          <p className="text-[10px] font-mono text-dim uppercase tracking-wider mb-2">Status</p>
          <div className="flex gap-2 flex-wrap">
            {STATUS_LIST.map((s) => (
              <button key={s} onClick={() => onStatusChange(doc.id, s)}
                className={`px-3 py-1.5 rounded-lg border text-[11px] font-mono font-bold transition-all ${
                  doc.status === s ? STATUS_STYLE[s] : 'border-border text-dim hover:text-mid'
                }`}>{STATUS_LABEL[s]}</button>
            ))}
          </div>
        </div>

        {/* Attached file */}
        {doc.fileRef && (
          <div className="mb-4 p-3 bg-surface2 rounded-xl border border-border flex items-center gap-3">
            <span className="text-2xl">{fileIcon(doc.fileName)}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text truncate">{doc.fileName}</div>
              <div className="text-xs text-dim">Attached document</div>
            </div>
            <a href={`/api/procurement/${doc.id}/download`} target="_blank" rel="noreferrer"
              className="px-3 py-1.5 rounded-lg border border-border bg-surface text-xs text-mid hover:text-done hover:border-done/40 transition-colors shrink-0">
              ↓ Download
            </a>
          </div>
        )}

        {/* Missing items */}
        <div className="mb-4">
          <p className="text-[10px] font-mono text-dim uppercase tracking-wider mb-1">Missing Items / Outstanding</p>
          <textarea value={missing} onChange={(e) => setMissing(e.target.value)} rows={4}
            placeholder="List what's still missing or pending confirmation…"
            className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60 resize-none" />
          <div className="flex justify-end mt-1.5">
            <button onClick={saveMissing}
              className="px-3 py-1 rounded-lg bg-done/10 border border-done/30 text-done text-xs font-semibold hover:bg-done/20 transition-colors">
              {saved ? '✓ Saved' : 'Save'}
            </button>
          </div>
        </div>

        {doc.notes && (
          <div className="p-3 bg-surface2 rounded-xl border border-border text-xs text-mid">{doc.notes}</div>
        )}
      </div>
    </div>
  );
}

// ── Procurement Import modal ─────────────────────────────────────────────────
type ParsedRow = Record<string, unknown>;

function ProcImportModal({ onImported, onClose }: { onImported: () => void; onClose: () => void }) {
  const fileRef  = useRef<HTMLInputElement>(null);
  const [allRows,  setAllRows]  = useState<ParsedRow[]>([]);
  const [fileNames,setFileNames]= useState<string[]>([]);
  const [mode,     setMode]     = useState<'append' | 'replace'>('append');
  const [result,   setResult]   = useState<{ added: number; skipped: number; total: number } | null>(null);
  const [err,      setErr]      = useState('');
  const [saving,   setSaving]   = useState(false);

  // Field aliases for auto-mapping
  const FIELDS: { key: string; aliases: string[] }[] = [
    { key: 'number',        aliases: ['number','no','num','doc','document','po','pr','ref','reference'] },
    { key: 'type',          aliases: ['type','doctype','doc_type','kind'] },
    { key: 'description',   aliases: ['description','desc','name','item','subject','title','product name','product'] },
    { key: 'qty',           aliases: ['qty','quantity','qtd','quantidade'] },
    { key: 'unit',          aliases: ['unit','uom','um','product uom','unit of measure','unidade'] },
    { key: 'estimatedCost', aliases: ['estimatedcost','estimated cost','unitcost','unit cost','unit_cost','cost','price','preco','custo'] },
    { key: 'requestedDate', aliases: ['requesteddate','requested date','request date','date','data','delivery date','need date'] },
    { key: 'supplier',      aliases: ['supplier','vendor','from','seller','fornecedor'] },
    { key: 'project',       aliases: ['project','programme','program','proj'] },
    { key: 'totalValue',    aliases: ['value','totalvalue','total_value','amount','total'] },
    { key: 'currency',      aliases: ['currency','cur','ccy','moeda'] },
    { key: 'status',        aliases: ['status','state','estado'] },
    { key: 'notes',         aliases: ['notes','note','comments','comment','obs','remarks'] },
  ];

  function mapHeaders(headers: string[]): Record<string, string> {
    const m: Record<string, string> = {};
    for (const f of FIELDS) {
      const found = headers.find((h) =>
        f.aliases.some((a) => h.toLowerCase().replace(/[\s_\-]/g, '').includes(a.replace(/[\s_\-]/g, '')))
      );
      if (found) m[f.key] = found;
    }
    return m;
  }

  function sheetToRows(headers: string[], rawRows: unknown[][]): ParsedRow[] {
    const mapping = mapHeaders(headers);
    return rawRows.map((r) => {
      const obj: ParsedRow = {};
      for (const [field, col] of Object.entries(mapping)) {
        const idx = headers.indexOf(col);
        obj[field] = idx >= 0 ? r[idx] : '';
      }
      return obj;
    }).filter((r) => r.number);
  }

  function parseFile(file: File): Promise<ParsedRow[]> {
    return new Promise((resolve, reject) => {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'csv' || ext === 'tsv') {
        const reader = new FileReader();
        reader.onload = (e) => {
          const text = e.target?.result as string;
          const sep = ext === 'tsv' ? '\t' : text.includes(';') ? ';' : ',';
          const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
          if (lines.length < 2) { resolve([]); return; }
          const headers = lines[0].split(sep).map((h) => h.trim().replace(/^"|"$/g, ''));
          const rows = lines.slice(1).map((l) =>
            l.split(sep).map((v) => v.trim().replace(/^"|"$/g, ''))
          );
          resolve(sheetToRows(headers, rows));
        };
        reader.onerror = reject;
        reader.readAsText(file);
      } else {
        const reader = new FileReader();
        reader.onload = (e) => {
          const wb = XLSX.read(e.target?.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
          if (data.length < 2) { resolve([]); return; }
          const headers = (data[0] as unknown[]).map(String);
          resolve(sheetToRows(headers, data.slice(1) as unknown[][]));
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
      }
    });
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setErr('');
    const results = await Promise.all(files.map(parseFile));
    const combined = results.flat();
    setAllRows(combined);
    setFileNames(files.map((f) => f.name));
  }

  async function submit() {
    if (!allRows.length) return;
    setSaving(true); setErr('');
    try {
      const res = await api.importProcurement(allRows, mode);
      if (!res.ok) { setErr(res.error ?? 'Server error'); return; }
      setResult({ added: res.added ?? 0, skipped: res.skipped ?? 0, total: res.total ?? 0 });
      onImported();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error — check server is running');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[520px] bg-surface rounded-2xl border border-border shadow-card-md flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-sm text-text">Import Procurement Documents</h2>
            <p className="text-[10px] text-dim font-mono mt-0.5">CSV / Excel — select one or more files at once</p>
          </div>
          <button onClick={onClose} className="text-dim hover:text-text text-xl">×</button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* File drop zone */}
          <div
            className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-accent/40 hover:bg-accent/4 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <div className="text-2xl mb-1">📂</div>
            <p className="text-xs font-medium text-mid">Click to select files</p>
            <p className="text-[10px] text-dim mt-0.5">CSV, TSV, XLSX, XLS · multiple files supported</p>
            {fileNames.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1 justify-center">
                {fileNames.map((n, i) => (
                  <span key={i} className="px-2 py-0.5 rounded bg-done/10 border border-done/25 text-[10px] font-mono text-done">{n}</span>
                ))}
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" multiple accept=".csv,.tsv,.xlsx,.xls" className="hidden" onChange={handleFiles} />

          {/* Summary */}
          {allRows.length > 0 && (
            <div className="px-3 py-2 rounded-lg bg-done/8 border border-done/20 flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-done">✓</span>
                <span className="text-xs text-done font-medium">{allRows.length} rows from {fileNames.length} file{fileNames.length !== 1 ? 's' : ''}</span>
              </div>
              {/* Preview first 3 rows */}
              <div className="mt-1 space-y-0.5">
                {allRows.slice(0, 3).map((r, i) => (
                  <div key={i} className="text-[10px] font-mono text-mid truncate">
                    {String(r.description || '—').slice(0, 40)}
                    {r.qty != null ? <span className="text-dim ml-2">× {String(r.qty)} {String(r.unit || '')}</span> : null}
                    {r.estimatedCost != null ? <span className="text-dim ml-2">total {String(r.estimatedCost)}</span> : null}
                    {r.requestedDate ? <span className="text-dim/60 ml-2">{String(r.requestedDate)}</span> : null}
                  </div>
                ))}
                {allRows.length > 3 && <div className="text-[10px] text-dim/50 font-mono">…and {allRows.length - 3} more</div>}
              </div>
            </div>
          )}

          {/* Mode */}
          <div className="flex gap-2">
            {(['append', 'replace'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={`flex-1 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                  mode === m ? 'border-done/40 bg-done/10 text-done' : 'border-border text-dim hover:text-mid'
                }`}>
                {m === 'append' ? 'Append (keep existing)' : 'Replace all'}
              </button>
            ))}
          </div>

          {/* Expected columns note */}
          <div className="px-3 py-2.5 rounded-lg bg-surface2 border border-border text-[10px] font-mono leading-relaxed">
            <p className="text-dim mb-1">Recognised columns (auto-detected by header name):</p>
            <p className="text-mid"><span className="text-done">description</span>, <span className="text-done">qty</span>, <span className="text-done">unit / product uom</span>, <span className="text-done">estimated cost</span>, <span className="text-done">requested date</span></p>
            <p className="text-dim/70 mt-0.5">Optional: number, type, supplier, project, currency, status, notes</p>
            <p className="text-dim/60 mt-1 text-[9px]">If "number" is absent, a PR number is generated automatically from the description. Total = qty × estimated cost.</p>
          </div>

          {result && (
            <div className="px-3 py-2 rounded-lg bg-ok/8 border border-ok/20 text-xs text-ok font-medium">
              ✓ Done — {result.added} added, {result.skipped} skipped · {result.total} total in database
            </div>
          )}
          {err && <p className="text-xs text-blocked">{err}</p>}
        </div>

        <div className="flex justify-end gap-3 px-5 py-4 border-t border-border">
          {result ? (
            <button onClick={onClose} className="px-4 py-2 rounded-lg bg-done/90 text-white text-sm font-semibold hover:bg-done">Close</button>
          ) : (
            <>
              <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm text-dim hover:text-mid">Cancel</button>
              <button onClick={submit} disabled={saving || allRows.length === 0}
                className="px-4 py-2 rounded-lg bg-done/90 text-white text-sm font-semibold hover:bg-done disabled:opacity-40">
                {saving ? 'Importing…' : `Import ${allRows.length > 0 ? allRows.length + ' rows' : ''}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Procurement view ─────────────────────────────────────────────────────
interface Props { projects: string[] }

export function Procurement({ projects }: Props) {
  const readonly = useReadonly();
  const [docs,      setDocs]      = useState<ProcDocument[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [showForm,   setShowForm]   = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editDoc,    setEditDoc]    = useState<ProcDocument | null>(null);
  const [detail,   setDetail]   = useState<ProcDocument | null>(null);
  const [typeF,    setTypeF]    = useState<ProcDocType | 'all'>('all');
  const [statusF,  setStatusF]  = useState<ProcDocStatus | 'all'>('all');
  const [bulkMsg,  setBulkMsg]  = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [procData, invData] = await Promise.all([api.getProcurement(), api.getInventory()]);
    setDocs(procData.orders);
    setInventory(invData.items);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = docs.filter((d) =>
    (typeF   === 'all' || d.type   === typeF) &&
    (statusF === 'all' || d.status === statusF)
  );

  const totalValue = filtered.reduce((s, d) => s + d.totalValue, 0);

  async function handleStatusChange(id: string, status: ProcDocStatus) {
    await api.updateProcDocument(id, { status });
    setDocs((prev) => prev.map((d) => d.id === id ? { ...d, status } : d));
    setDetail((prev) => prev?.id === id ? { ...prev, status } : prev);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this document and its attached file?')) return;
    await api.deleteProcDocument(id);
    setDocs((prev) => prev.filter((d) => d.id !== id));
    setDetail(null);
  }

  function handleMissingChange(id: string, text: string) {
    setDocs((prev) => prev.map((d) => d.id === id ? { ...d, missingItems: text } : d));
  }

  async function handleMarkAllComplete() {
    const pending = docs.filter((d) => d.status !== 'complete' && d.status !== 'cancelled');
    if (!confirm(`Mark all ${pending.length} non-complete documents as complete and sync inventory?`)) return;
    const res = await api.bulkCompleteProcurement();
    if (!res.ok) { setBulkMsg(`Error: ${res.error}`); return; }
    await load();
    const msg = `✓ ${res.marked} marked complete · ${res.inventoryCreated} inventory items created · ${res.inventoryUpdated} updated`;
    setBulkMsg(msg);
    setTimeout(() => setBulkMsg(null), 6000);
  }

  // Stats
  const byStatus = (s: ProcDocStatus) => docs.filter((d) => d.status === s).length;

  return (
    <div className="px-8 py-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text">Procurement</h1>
          <p className="text-xs text-dim mt-0.5">
            {docs.length} documents · {filtered.length} shown ·{' '}
            <span className="font-semibold text-text">
              EUR {totalValue.toLocaleString('en', { minimumFractionDigits: 2 })}
            </span>
          </p>
        </div>
        {!readonly && (
          <div className="flex gap-2">
            <button onClick={handleMarkAllComplete}
              className="px-4 py-2 rounded-lg border border-ok/35 bg-ok/8 text-sm text-ok font-medium hover:bg-ok/15 transition-colors">
              ✓ Mark all complete
            </button>
            <button onClick={() => setShowImport(true)}
              className="px-4 py-2 rounded-lg border border-border bg-surface2 text-sm text-mid font-medium hover:bg-surface3 transition-colors">
              ↑ Import
            </button>
            <button onClick={() => setShowForm(true)}
              className="px-4 py-2 rounded-lg bg-done/90 text-white text-sm font-semibold hover:bg-done transition-colors">
              + New Document
            </button>
          </div>
        )}
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-4 gap-4">
        {STATUS_LIST.map((s) => (
          <div key={s} className="bg-surface border border-border rounded-xl px-4 py-3 shadow-card">
            <div className={`inline-flex px-2 py-0.5 rounded border text-[10px] font-mono font-bold mb-1 ${STATUS_STYLE[s]}`}>
              {STATUS_LABEL[s]}
            </div>
            <div className="text-xl font-bold text-text">{byStatus(s)}</div>
            <div className="text-[10px] text-dim font-mono">
              EUR {docs.filter((d) => d.status === s).reduce((sum, d) => sum + d.totalValue, 0).toLocaleString('en', {minimumFractionDigits:2})}
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1">
          {(['all', ...DOC_TYPES] as const).map((t) => (
            <button key={t} onClick={() => setTypeF(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold border transition-all ${
                typeF === t ? 'bg-done/10 border-done/35 text-done' : 'border-border text-dim hover:text-mid'
              }`}>{t === 'all' ? 'All Types' : t}</button>
          ))}
        </div>
        <div className="w-px h-5 bg-border" />
        <div className="flex gap-1">
          {(['all', ...STATUS_LIST] as const).map((s) => (
            <button key={s} onClick={() => setStatusF(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold border transition-all ${
                statusF === s ? 'bg-done/10 border-done/35 text-done' : 'border-border text-dim hover:text-mid'
              }`}>{s === 'all' ? 'All Statuses' : STATUS_LABEL[s]}</button>
          ))}
        </div>
      </div>

      {/* Bulk-complete result */}
      {bulkMsg && (
        <div className="px-4 py-2.5 rounded-xl bg-ok/8 border border-ok/25 text-xs text-ok font-medium flex items-center justify-between">
          <span>{bulkMsg}</span>
          <button onClick={() => setBulkMsg(null)} className="text-ok/50 hover:text-ok ml-4">×</button>
        </div>
      )}

      {/* Table */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden shadow-card">
        <table className="w-full text-[12px]">
          <thead className="bg-surface2 border-b border-border">
            <tr>
              {['Number','Type','Description','Part No.','Qty','Supplier','Programme','Status','Value','Req. Date','File',''].map((h) => (
                <th key={h} className="px-3 py-2.5 text-left font-mono text-[9px] uppercase tracking-wider text-dim font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={12} className="px-4 py-12 text-center text-dim text-xs">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={12} className="px-4 py-12 text-center text-dim text-xs">
                No documents yet. Upload your first PR or PO to get started.
              </td></tr>
            ) : filtered.map((doc) => (
              <tr key={doc.id}
                className="border-b border-border/40 hover:bg-surface2/50 cursor-pointer group"
                onClick={() => setDetail(doc)}>
                <td className="px-3 py-2.5 font-mono font-bold text-done">{doc.number}</td>
                <td className="px-3 py-2.5 font-mono text-dim">{doc.type}</td>
                <td className="px-3 py-2.5 text-mid max-w-[180px] truncate">{doc.description || '—'}</td>
                <td className="px-3 py-2.5 font-mono text-[11px] text-done/80 max-w-[120px] truncate" title={doc.partNumber}>
                  {doc.partNumber || <span className="text-border">—</span>}
                </td>
                <td className="px-3 py-2.5 font-mono text-dim whitespace-nowrap">
                  {doc.qty != null ? <>{doc.qty} <span className="text-dim/50 text-[10px]">{doc.unit || ''}</span></> : <span className="text-border">—</span>}
                </td>
                <td className="px-3 py-2.5 text-dim truncate max-w-[120px]">{doc.supplier || '—'}</td>
                <td className="px-3 py-2.5 font-mono text-dim">{doc.project || '—'}</td>
                <td className="px-3 py-2.5">
                  <span className={`px-2 py-0.5 rounded border text-[10px] font-bold font-mono ${STATUS_STYLE[doc.status]}`}>
                    {STATUS_LABEL[doc.status]}
                  </span>
                </td>
                <td className="px-3 py-2.5 font-mono text-right text-done font-semibold whitespace-nowrap">
                  {doc.totalValue > 0 ? `${doc.currency} ${doc.totalValue.toLocaleString('en',{minimumFractionDigits:2})}` : '—'}
                </td>
                <td className="px-3 py-2.5 font-mono text-dim">{doc.requestedDate || doc.createdAt}</td>
                <td className="px-3 py-2.5">
                  {doc.fileRef
                    ? <span title={doc.fileName}>{fileIcon(doc.fileName)} <span className="font-mono text-[10px] text-dim truncate max-w-[80px]">{doc.fileName.slice(0,18)}</span></span>
                    : <span className="text-dim/30 text-[10px]">—</span>}
                </td>
                <td className="px-3 py-2.5">
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(doc.id); }}
                    className="opacity-0 group-hover:opacity-100 px-2 py-1 rounded border border-border text-[10px] text-dim hover:text-blocked hover:border-blocked/40 transition-all">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Missing items alert */}
      {docs.some((d) => d.missingItems?.trim() && d.status !== 'complete' && d.status !== 'cancelled') && (
        <div className="bg-risk/6 border border-risk/25 rounded-xl p-4">
          <p className="text-xs font-semibold text-risk mb-2">⚠ Outstanding items in open documents:</p>
          {docs.filter((d) => d.missingItems?.trim() && d.status !== 'complete' && d.status !== 'cancelled').map((d) => (
            <div key={d.id} className="flex gap-2 text-xs mb-1">
              <span className="font-mono text-done shrink-0">{d.number}</span>
              <span className="text-mid">{d.missingItems}</span>
            </div>
          ))}
        </div>
      )}

      {showImport && <ProcImportModal onImported={load} onClose={() => setShowImport(false)} />}
      {showForm && <ProcForm projects={projects} inventory={inventory} onSave={load} onClose={() => setShowForm(false)} />}
      {editDoc   && <ProcForm initial={editDoc} projects={projects} inventory={inventory} onSave={load} onClose={() => setEditDoc(null)} />}
      {detail && (
        <ProcDetail
          doc={detail}
          onClose={() => setDetail(null)}
          onStatusChange={handleStatusChange}
          onEdit={() => { setEditDoc(detail); setDetail(null); }}
          onMissingChange={handleMissingChange}
        />
      )}
    </div>
  );
}
