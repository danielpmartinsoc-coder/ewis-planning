import { useState, useEffect, useRef } from 'react';
import type { ProcDocument, ProcDocType, ProcDocStatus } from '../../types';
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

// ── Create / Edit modal ───────────────────────────────────────────────────────
interface FormProps {
  initial?: ProcDocument;
  projects: string[];
  onSave: () => void;
  onClose: () => void;
}

function ProcForm({ initial, projects, onSave, onClose }: FormProps) {
  const [number,  setNumber]  = useState(initial?.number      ?? '');
  const [type,    setType]    = useState<ProcDocType>(initial?.type ?? 'PO');
  const [desc,    setDesc]    = useState(initial?.description  ?? '');
  const [supplier,setSupplier]= useState(initial?.supplier     ?? '');
  const [project, setProject] = useState(initial?.project      ?? '');
  const [value,   setValue]   = useState(String(initial?.totalValue ?? ''));
  const [currency,setCurrency]= useState(initial?.currency     ?? 'EUR');
  const [notes,   setNotes]   = useState(initial?.notes        ?? '');
  const [missing, setMissing] = useState(initial?.missingItems ?? '');
  const [file,    setFile]    = useState<{name:string;data:string;type:string}|null>(null);
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

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
    try {
      if (initial) {
        const res = await api.updateProcDocument(initial.id, {
          description: desc, supplier, project, type,
          totalValue: parseFloat(value) || 0, currency, notes, missingItems: missing,
        });
        if (!res.ok) throw new Error(res.error);
      } else {
        const res = await api.createProcDocument({
          number: number.trim(), type, description: desc, supplier, project,
          totalValue: parseFloat(value) || 0, currency, notes,
          ...(file ? { fileName: file.name, fileData: file.data, fileType: file.type } : {}),
        });
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
      <div className="w-[600px] max-h-[92vh] flex flex-col bg-surface rounded-2xl border border-border shadow-card-md"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="font-semibold text-base text-text">{initial ? 'Edit Document' : 'New PR / PO'}</h2>
          <button onClick={onClose} className="text-dim hover:text-text text-xl">×</button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
          {/* Document number — key field */}
          <div>
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Document Number *</label>
            <input value={number} onChange={(e) => setNumber(e.target.value)} required readOnly={!!initial}
              placeholder="e.g. PO-2026-0042"
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
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Total Value</label>
                <input type="number" value={value} onChange={(e) => setValue(e.target.value)} className={inputCls} />
              </div>
              <div className="w-20">
                <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Currency</label>
                <input value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls} />
              </div>
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

// ── Main Procurement view ─────────────────────────────────────────────────────
interface Props { projects: string[] }

export function Procurement({ projects }: Props) {
  const [docs,     setDocs]     = useState<ProcDocument[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editDoc,  setEditDoc]  = useState<ProcDocument | null>(null);
  const [detail,   setDetail]   = useState<ProcDocument | null>(null);
  const [typeF,    setTypeF]    = useState<ProcDocType | 'all'>('all');
  const [statusF,  setStatusF]  = useState<ProcDocStatus | 'all'>('all');

  async function load() {
    setLoading(true);
    const data = await api.getProcurement();
    setDocs(data.orders);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

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
        <button onClick={() => setShowForm(true)}
          className="px-4 py-2 rounded-lg bg-done/90 text-white text-sm font-semibold hover:bg-done transition-colors">
          + New Document
        </button>
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

      {/* Table */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden shadow-card">
        <table className="w-full text-[12px]">
          <thead className="bg-surface2 border-b border-border">
            <tr>
              {['Number','Type','Description','Supplier','Programme','Status','Value','File','Date',''].map((h) => (
                <th key={h} className="px-3 py-2.5 text-left font-mono text-[9px] uppercase tracking-wider text-dim font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="px-4 py-12 text-center text-dim text-xs">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-12 text-center text-dim text-xs">
                No documents yet. Upload your first PR or PO to get started.
              </td></tr>
            ) : filtered.map((doc) => (
              <tr key={doc.id}
                className="border-b border-border/40 hover:bg-surface2/50 cursor-pointer group"
                onClick={() => setDetail(doc)}>
                <td className="px-3 py-2.5 font-mono font-bold text-done">{doc.number}</td>
                <td className="px-3 py-2.5 font-mono text-dim">{doc.type}</td>
                <td className="px-3 py-2.5 text-mid max-w-[180px] truncate">{doc.description || '—'}</td>
                <td className="px-3 py-2.5 text-dim truncate max-w-[120px]">{doc.supplier || '—'}</td>
                <td className="px-3 py-2.5 font-mono text-dim">{doc.project || '—'}</td>
                <td className="px-3 py-2.5">
                  <span className={`px-2 py-0.5 rounded border text-[10px] font-bold font-mono ${STATUS_STYLE[doc.status]}`}>
                    {STATUS_LABEL[doc.status]}
                  </span>
                </td>
                <td className="px-3 py-2.5 font-mono text-right text-done font-semibold">
                  {doc.totalValue > 0 ? `${doc.currency} ${doc.totalValue.toLocaleString('en',{minimumFractionDigits:2})}` : '—'}
                </td>
                <td className="px-3 py-2.5">
                  {doc.fileRef
                    ? <span title={doc.fileName}>{fileIcon(doc.fileName)} <span className="font-mono text-[10px] text-dim truncate max-w-[80px]">{doc.fileName.slice(0,18)}</span></span>
                    : <span className="text-dim/30 text-[10px]">—</span>}
                </td>
                <td className="px-3 py-2.5 font-mono text-dim">{doc.createdAt}</td>
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

      {showForm && <ProcForm projects={projects} onSave={load} onClose={() => setShowForm(false)} />}
      {editDoc   && <ProcForm initial={editDoc} projects={projects} onSave={load} onClose={() => setEditDoc(null)} />}
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
