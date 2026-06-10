import { useState, useEffect } from 'react';
import type { Responsible } from '../../types';
import * as api from '../../api';

const ROLES = ['Design Engineer', 'Production Operator', 'Systems Engineer', 'Quality', 'Procurement', 'Management', 'Other'];

interface Props {
  onClose: () => void;
}

export function PeopleModal({ onClose }: Props) {
  const [people,  setPeople]  = useState<Responsible[]>([]);
  const [loading, setLoading] = useState(true);
  const [name,    setName]    = useState('');
  const [role,    setRole]    = useState('Design Engineer');
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState('');
  const [editId,  setEditId]  = useState<string | null>(null);
  const [editName,setEditName]= useState('');
  const [editRole,setEditRole]= useState('');

  async function load() {
    setLoading(true);
    const res = await api.getResponsibles();
    setPeople(res.responsibles ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true); setErr('');
    const res = await api.createResponsible({ name: name.trim(), role });
    setSaving(false);
    if (!res.ok) { setErr(res.error ?? 'Failed'); return; }
    setName(''); setRole('Design Engineer');
    load();
  }

  async function saveEdit(id: string) {
    await api.updateResponsible(id, { name: editName.trim(), role: editRole });
    setEditId(null);
    load();
  }

  async function toggleActive(r: Responsible) {
    await api.updateResponsible(r.id, { active: !r.active });
    load();
  }

  async function remove(id: string) {
    if (!confirm('Remove this person?')) return;
    await api.deleteResponsible(id);
    load();
  }

  const active   = people.filter((r) => r.active);
  const inactive = people.filter((r) => !r.active);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[520px] max-h-[80vh] flex flex-col bg-surface rounded-2xl border border-border shadow-card-md"
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-semibold text-sm text-text">People</h2>
            <p className="text-[10px] text-dim font-mono mt-0.5">Design engineers &amp; production operators available for selection</p>
          </div>
          <button onClick={onClose} className="text-dim hover:text-text text-xl">×</button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1">
          {loading ? (
            <p className="text-xs text-dim text-center py-8 animate-pulse">Loading…</p>
          ) : (
            <>
              {active.length === 0 && inactive.length === 0 && (
                <p className="text-xs text-dim italic text-center py-6">No people yet — add one below.</p>
              )}

              {active.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-surface2 group/row">
                  {editId === r.id ? (
                    <>
                      <input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus
                        className="flex-1 px-2 py-1 rounded border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60" />
                      <select value={editRole} onChange={(e) => setEditRole(e.target.value)}
                        className="px-2 py-1 rounded border border-border bg-bg text-xs text-text focus:outline-none">
                        {ROLES.map((ro) => <option key={ro}>{ro}</option>)}
                      </select>
                      <button onClick={() => saveEdit(r.id)}
                        className="px-2 py-1 rounded bg-done/90 text-white text-xs font-semibold">Save</button>
                      <button onClick={() => setEditId(null)}
                        className="px-2 py-1 rounded border border-border text-xs text-dim">Cancel</button>
                    </>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-text">{r.name}</div>
                        <div className="text-[10px] text-dim font-mono">{r.role || '—'}</div>
                      </div>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-ok/8 border border-ok/20 text-ok">active</span>
                      <div className="flex gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
                        <button onClick={() => { setEditId(r.id); setEditName(r.name); setEditRole(r.role); }}
                          title="Edit" className="w-6 h-6 flex items-center justify-center rounded border border-border text-[10px] text-dim hover:text-done hover:border-done/40">✏</button>
                        <button onClick={() => toggleActive(r)}
                          title="Deactivate" className="w-6 h-6 flex items-center justify-center rounded border border-border text-[10px] text-dim hover:text-risk hover:border-risk/40">⊘</button>
                        <button onClick={() => remove(r.id)}
                          title="Delete" className="w-6 h-6 flex items-center justify-center rounded border border-border text-[10px] text-dim hover:text-blocked hover:border-blocked/40">✕</button>
                      </div>
                    </>
                  )}
                </div>
              ))}

              {inactive.length > 0 && (
                <div className="pt-2">
                  <p className="text-[9px] font-mono text-dim uppercase tracking-widest px-1 mb-1">Inactive</p>
                  {inactive.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border/40 bg-surface opacity-60 group/row">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-mid line-through">{r.name}</div>
                        <div className="text-[10px] text-dim font-mono">{r.role || '—'}</div>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
                        <button onClick={() => toggleActive(r)}
                          title="Reactivate" className="px-2 py-0.5 rounded border border-border text-[10px] text-dim hover:text-ok hover:border-ok/40">↺ Activate</button>
                        <button onClick={() => remove(r.id)}
                          title="Delete" className="w-6 h-6 flex items-center justify-center rounded border border-border text-[10px] text-dim hover:text-blocked hover:border-blocked/40">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Add form */}
        <form onSubmit={add} className="shrink-0 border-t border-border p-4 bg-surface2">
          {err && <p className="text-xs text-blocked mb-2">{err}</p>}
          <div className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name…"
              className="flex-1 px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60" />
            <select value={role} onChange={(e) => setRole(e.target.value)}
              className="px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60">
              {ROLES.map((ro) => <option key={ro}>{ro}</option>)}
            </select>
            <button type="submit" disabled={saving || !name.trim()}
              className="px-4 py-2 rounded-lg bg-done/90 text-white text-sm font-semibold hover:bg-done disabled:opacity-40 whitespace-nowrap">
              {saving ? '…' : '+ Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
