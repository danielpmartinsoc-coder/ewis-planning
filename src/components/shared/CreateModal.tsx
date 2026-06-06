import { useState } from 'react';
import type { AppState } from '../../types';
import * as api from '../../api';

// ── Create Project ─────────────────────────────────────────────────────────────
interface CreateProjectProps {
  onCreated: (state: AppState) => void;
  onClose: () => void;
  currentUser: string;
}

export function CreateProjectModal({ onCreated, onClose, currentUser }: CreateProjectProps) {
  const [name,   setName]   = useState('');
  const [date,   setDate]   = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Project name required.'); return; }
    setSaving(true); setError('');
    const res = await api.createProject(name.trim(), date, currentUser);
    setSaving(false);
    if (!res.ok) { setError(res.error ?? 'Failed'); return; }
    onCreated(res.state!);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[440px] bg-surface rounded-2xl shadow-card-md border border-border p-6"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-base text-text">New Programme</h2>
          <button onClick={onClose} className="text-dim hover:text-text text-xl">×</button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Programme Name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus
              placeholder="e.g. FALCON, ALPHA, PROJ-002"
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm font-mono font-bold text-text focus:outline-none focus:border-accent/60" />
          </div>
          <div>
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Planned Start</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60" />
          </div>
          <p className="text-[10px] text-dim">Creates the programme and seeds the 5 design milestones (F2–F6).</p>
          {error && <p className="text-xs text-blocked">{error}</p>}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm text-dim hover:text-mid">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 rounded-lg bg-done/90 text-white text-sm font-semibold hover:bg-done disabled:opacity-50">
              {saving ? 'Creating…' : 'Create Programme'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Create Harness ─────────────────────────────────────────────────────────────
interface CreateHarnessProps {
  projects: string[];
  onCreated: (state: AppState) => void;
  onClose: () => void;
  currentUser: string;
}

export function CreateHarnessModal({ projects, onCreated, onClose, currentUser }: CreateHarnessProps) {
  const [project,     setProject]     = useState(projects[0] ?? '');
  const [hid,         setHid]         = useState('');
  const [name,        setName]        = useState('');
  const [responsible, setResponsible] = useState('');
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!hid.trim() || !name.trim() || !project) { setError('Programme, ID and name are required.'); return; }
    setSaving(true); setError('');
    const res = await api.createHarness(project, hid.trim().toUpperCase(), name.trim(), responsible.trim(), currentUser);
    setSaving(false);
    if (!res.ok) { setError(res.error ?? 'Failed'); return; }
    onCreated(res.state!);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[460px] bg-surface rounded-2xl shadow-card-md border border-border p-6"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-base text-text">New Harness</h2>
          <button onClick={onClose} className="text-dim hover:text-text text-xl">×</button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Programme *</label>
            <select value={project} onChange={(e) => setProject(e.target.value)} required
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60">
              {projects.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Harness ID *</label>
            <input value={hid} onChange={(e) => setHid(e.target.value)} required autoFocus
              placeholder="e.g. H-F09, H-A07"
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm font-mono font-bold text-text focus:outline-none focus:border-accent/60" />
          </div>
          <div>
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Harness Name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required
              placeholder="e.g. Engine Bay Power"
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60" />
          </div>
          <div>
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Responsible</label>
            <input value={responsible} onChange={(e) => setResponsible(e.target.value)}
              placeholder="Engineer name"
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60" />
          </div>
          {error && <p className="text-xs text-blocked">{error}</p>}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm text-dim hover:text-mid">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 rounded-lg bg-done/90 text-white text-sm font-semibold hover:bg-done disabled:opacity-50">
              {saving ? 'Creating…' : 'Create Harness'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
