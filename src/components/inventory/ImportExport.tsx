import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import type { InventoryItem } from '../../types';
import * as api from '../../api';

// ── Export ────────────────────────────────────────────────────────────────────
export function ExportButton({ items }: { items: InventoryItem[] }) {
  function exportCSV() {
    const headers = ['partNumber','description','category','quantity','reserved','unit',
                     'location','unitCost','leadTimeDays','supplier','minStock'];
    const rows = items.map((i) => headers.map((h) => ((i as unknown) as Record<string,unknown>)[h] ?? '').join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `inventory_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  }

  function exportXLSX() {
    const headers = ['partNumber','description','category','quantity','reserved','unit',
                     'location','unitCost','leadTimeDays','supplier','minStock'];
    const data = [
      headers,
      ...items.map((i) => headers.map((h) => ((i as unknown) as Record<string,unknown>)[h] ?? '')),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
    XLSX.writeFile(wb, `inventory_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  return (
    <div className="flex gap-2">
      <button onClick={exportCSV}
        className="px-3 py-1.5 rounded-lg border border-border bg-surface2 text-xs text-mid font-medium hover:bg-surface3 transition-colors">
        ↓ CSV
      </button>
      <button onClick={exportXLSX}
        className="px-3 py-1.5 rounded-lg border border-border bg-surface2 text-xs text-mid font-medium hover:bg-surface3 transition-colors">
        ↓ Excel
      </button>
    </div>
  );
}

// ── Import modal ──────────────────────────────────────────────────────────────
interface Props {
  onImported: () => void;
  onClose: () => void;
}

type ParsedRow = Record<string, unknown>;

export function ImportModal({ onImported, onClose }: Props) {
  const fileRef  = useRef<HTMLInputElement>(null);
  const [rows,   setRows]   = useState<ParsedRow[]>([]);
  const [cols,   setCols]   = useState<string[]>([]);
  const [mode,   setMode]   = useState<'append' | 'replace'>('append');
  const [step,   setStep]   = useState<'upload' | 'preview' | 'done'>('upload');
  const [result, setResult] = useState<{added:number;updated:number;skipped:number;total:number}|null>(null);
  const [err,    setErr]    = useState('');
  const [saving, setSaving] = useState(false);
  const [fileName, setFileName] = useState('');

  // Column mapping: canonical field → detected column header
  const FIELDS: {key: string; label: string; aliases: string[]}[] = [
    { key: 'partNumber',   label: 'Part Number *',  aliases: ['partnumber','part_number','pn','part no','reference','ref'] },
    { key: 'description',  label: 'Description',    aliases: ['description','desc','name','item'] },
    { key: 'category',     label: 'Category',       aliases: ['category','cat','type'] },
    { key: 'quantity',     label: 'Quantity',        aliases: ['quantity','qty','stock','qnty'] },
    { key: 'unit',         label: 'Unit',            aliases: ['unit','uom','um'] },
    { key: 'unitCost',     label: 'Unit Cost',       aliases: ['unitcost','unit_cost','cost','price','unit price'] },
    { key: 'leadTimeDays', label: 'Lead Time (days)',aliases: ['leadtimedays','lead_time','leadtime','lead time','lt'] },
    { key: 'supplier',     label: 'Supplier',        aliases: ['supplier','vendor','manufacturer'] },
    { key: 'location',     label: 'Location',        aliases: ['location','loc','bin','shelf'] },
    { key: 'minStock',     label: 'Min Stock',       aliases: ['minstock','min_stock','min stock','reorder'] },
  ];

  const [mapping, setMapping] = useState<Record<string,string>>({});

  function autoMap(headers: string[]): Record<string,string> {
    const m: Record<string,string> = {};
    for (const f of FIELDS) {
      const found = headers.find((h) =>
        f.aliases.some((a) => h.toLowerCase().replace(/[\s_-]/g,'').includes(a.replace(/[\s_-]/g,'')))
      );
      if (found) m[f.key] = found;
    }
    return m;
  }

  function parseFile(file: File) {
    setErr('');
    setFileName(file.name);
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'csv' || ext === 'tsv') {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const sep = ext === 'tsv' ? '\t' : text.includes(';') ? ';' : ',';
        const lines = text.split('\n').filter(Boolean);
        if (lines.length < 2) { setErr('File has no data rows.'); return; }
        const headers = lines[0].split(sep).map((h) => h.trim().replace(/^"|"$/g,''));
        const parsed = lines.slice(1).map((line) => {
          const vals = line.split(sep).map((v) => v.trim().replace(/^"|"$/g,''));
          return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
        });
        setCols(headers);
        setRows(parsed);
        setMapping(autoMap(headers));
        setStep('preview');
      };
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const wb = XLSX.read(e.target?.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string,unknown>>(ws, { defval: '' });
        if (!json.length) { setErr('Sheet is empty.'); return; }
        const headers = Object.keys(json[0]);
        setCols(headers);
        setRows(json);
        setMapping(autoMap(headers));
        setStep('preview');
      };
      reader.readAsArrayBuffer(file);
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) parseFile(f);
    e.target.value = '';
  }

  function applyMapping(row: ParsedRow): ParsedRow {
    const out: ParsedRow = {};
    for (const f of FIELDS) {
      const col = mapping[f.key];
      if (col) out[f.key] = row[col];
    }
    return out;
  }

  async function doImport() {
    setSaving(true); setErr('');
    const mapped = rows.map(applyMapping);
    const res = await api.importInventory(mapped, mode);
    setSaving(false);
    if (!res.ok) { setErr((res as {error?:string}).error ?? 'Import failed'); return; }
    setResult(res);
    setStep('done');
    onImported();
  }

  const previewRows = rows.slice(0, 5);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[820px] max-h-[90vh] flex flex-col bg-surface rounded-2xl border border-border shadow-card-md"
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-semibold text-base text-text">Import Inventory</h2>
            <p className="text-xs text-dim mt-0.5">Supports CSV, TSV, XLS, XLSX — auto-maps column headers</p>
          </div>
          <button onClick={onClose} className="text-dim hover:text-text text-xl">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">

          {step === 'upload' && (
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-border rounded-xl p-12 flex flex-col items-center gap-3 cursor-pointer hover:border-accent/50 hover:bg-accent/3 transition-colors">
              <span className="text-4xl">📂</span>
              <p className="text-sm font-medium text-text">Click to choose file or drag & drop</p>
              <p className="text-xs text-dim">CSV · TSV · XLS · XLSX</p>
              <input ref={fileRef} type="file" accept=".csv,.tsv,.xls,.xlsx" className="hidden" onChange={handleFile} />
              {err && <p className="text-xs text-blocked mt-2">{err}</p>}
            </div>
          )}

          {step === 'preview' && (
            <>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-text">📄 {fileName}</span>
                <span className="text-xs text-dim">{rows.length} rows · {cols.length} columns</span>
                <button onClick={() => { setStep('upload'); setRows([]); setCols([]); }}
                  className="ml-auto text-xs text-dim hover:text-mid border border-border px-2 py-1 rounded">
                  ← Re-upload
                </button>
              </div>

              {/* Column mapping */}
              <div className="bg-surface2 rounded-xl border border-border p-4">
                <p className="text-[10px] font-mono text-dim uppercase tracking-wider mb-3">Column Mapping</p>
                <div className="grid grid-cols-2 gap-3">
                  {FIELDS.map((f) => (
                    <div key={f.key} className="flex items-center gap-2">
                      <span className="text-xs text-mid w-36 shrink-0">{f.label}</span>
                      <select value={mapping[f.key] ?? ''}
                        onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                        className="flex-1 px-2 py-1 rounded-lg border border-border bg-bg text-xs text-text focus:outline-none focus:border-accent/60">
                        <option value="">— skip —</option>
                        {cols.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Data preview */}
              <div>
                <p className="text-[10px] font-mono text-dim uppercase tracking-wider mb-2">Preview (first 5 rows)</p>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="text-[11px] w-full">
                    <thead className="bg-surface2 border-b border-border">
                      <tr>
                        {FIELDS.filter((f) => mapping[f.key]).map((f) => (
                          <th key={f.key} className="px-3 py-1.5 text-left font-mono text-[9px] text-dim font-normal">{f.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => {
                        const m = applyMapping(row);
                        return (
                          <tr key={i} className="border-b border-border/30">
                            {FIELDS.filter((f) => mapping[f.key]).map((f) => (
                              <td key={f.key} className="px-3 py-1.5 text-text truncate max-w-[160px]">
                                {String(m[f.key] ?? '')}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {rows.length > 5 && <p className="text-[10px] text-dim mt-1">+{rows.length - 5} more rows</p>}
              </div>

              {/* Mode */}
              <div className="flex items-center gap-4">
                <p className="text-xs text-mid">Import mode:</p>
                {(['append','replace'] as const).map((m) => (
                  <label key={m} className="flex items-center gap-1.5 cursor-pointer text-xs text-text">
                    <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} className="accent-done" />
                    {m === 'append' ? 'Append / update existing' : 'Replace all (clear first)'}
                  </label>
                ))}
              </div>

              {err && <p className="text-xs text-blocked">{err}</p>}
            </>
          )}

          {step === 'done' && result && (
            <div className="flex flex-col items-center gap-4 py-8">
              <span className="text-5xl">✅</span>
              <h3 className="font-semibold text-text">Import complete</h3>
              <div className="flex gap-6 text-center">
                {[['Added', result.added, 'text-ok'],['Updated', result.updated, 'text-done'],
                  ['Skipped', result.skipped, 'text-dim'],['Total items', result.total, 'text-text']].map(([l,v,c]) => (
                  <div key={l as string}>
                    <div className={`text-2xl font-bold ${c}`}>{v}</div>
                    <div className="text-xs text-dim">{l}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-6 py-3 border-t border-border bg-surface/80">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm text-dim hover:text-mid">
            {step === 'done' ? 'Close' : 'Cancel'}
          </button>
          {step === 'preview' && (
            <button onClick={doImport} disabled={saving || !mapping['partNumber']}
              className="px-5 py-2 rounded-lg bg-done/90 text-white text-sm font-semibold hover:bg-done disabled:opacity-50">
              {saving ? 'Importing…' : `Import ${rows.length} rows`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
