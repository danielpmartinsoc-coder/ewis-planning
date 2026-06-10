import { useState, useEffect, useMemo } from 'react';
import type { AppState, Harness, Responsible } from '../../types';
import * as api from '../../api';
import { ALL_REVISIONS, suggestNextRevision, revisionId } from '../../utils/revisions';

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
  initialProject?: string;
  harnesses?: Harness[];   // existing harnesses — used to detect revision siblings
  onCreated: (state: AppState) => void;
  onClose: () => void;
  currentUser: string;
}

export function CreateHarnessModal({ projects, initialProject, harnesses = [], onCreated, onClose, currentUser }: CreateHarnessProps) {
  const [project,           setProject]           = useState(initialProject ?? projects[0] ?? '');
  const [baseName,          setBaseName]          = useState('');   // harness name (display)
  const [designResponsible, setDesignResponsible] = useState('');
  const [responsible,       setResponsible]       = useState('');
  const [revision,          setRevision]          = useState('A');
  const [saving,            setSaving]            = useState(false);
  const [error,             setError]             = useState('');
  const [responsibles,      setResponsibles]      = useState<Responsible[]>([]);

  useEffect(() => {
    api.getResponsibles().then((d) => setResponsibles(d.responsibles ?? []));
  }, []);

  const active = responsibles.filter((r) => r.active);

  // ── Revision detection ────────────────────────────────────────────────────
  // Find all existing revisions of this (project, name) family
  const siblings = useMemo(() =>
    harnesses.filter(h => h.project === project && h.name.toUpperCase() === baseName.trim().toUpperCase()),
    [harnesses, project, baseName]
  );

  const isNewRevision = siblings.length > 0;

  // The root harness of the family (REV A or earliest)
  const rootHarness = useMemo(() => {
    if (siblings.length === 0) return null;
    return siblings.find(h => !h.baseId) ?? siblings[0];
  }, [siblings]);

  // Used revisions in this family
  const usedRevisions = useMemo(() => siblings.map(h => h.revision.toUpperCase()), [siblings]);

  // Suggested next revision
  const suggestedRev = useMemo(() => suggestNextRevision(usedRevisions), [usedRevisions]);

  // When the name changes and we detect siblings, auto-set revision to the suggestion
  useEffect(() => {
    if (isNewRevision) setRevision(suggestedRev);
    else setRevision('A');
  }, [isNewRevision, suggestedRev]);

  // The new harness ID: baseId-REV (e.g. LW6-B), or just the name for first revision
  const newId = useMemo(() => {
    const nameUp = baseName.trim().toUpperCase();
    if (!nameUp) return '';
    if (!isNewRevision) return nameUp;           // first harness — ID = name
    const base = rootHarness?.id ?? nameUp;
    return revisionId(base, revision);
  }, [baseName, isNewRevision, rootHarness, revision]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!baseName.trim() || !project) { setError('Programme and harness name are required.'); return; }
    if (!newId) { setError('Cannot compute harness ID.'); return; }
    // Check if revision already used
    if (usedRevisions.includes(revision.toUpperCase())) {
      setError(`REV ${revision} already exists for this harness. Choose another revision.`);
      return;
    }
    setSaving(true); setError('');
    const baseId = isNewRevision ? (rootHarness?.id ?? undefined) : undefined;
    const res = await api.createHarness(
      project, newId, baseName.trim(), responsible, currentUser, revision, designResponsible, baseId
    );
    setSaving(false);
    if (!res.ok) { setError(res.error ?? 'Failed'); return; }
    onCreated(res.state!);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[480px] bg-surface rounded-2xl shadow-card-md border border-border p-6"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-base text-text">
            {isNewRevision ? `New Revision — ${baseName.trim()}` : 'New Harness'}
          </h2>
          <button onClick={onClose} className="text-dim hover:text-text text-xl">×</button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">

          {/* Programme */}
          <div>
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Programme *</label>
            <select value={project} onChange={(e) => setProject(e.target.value)} required
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60">
              {projects.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>

          {/* Harness Name */}
          <div>
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Harness Name *</label>
            <input value={baseName} onChange={(e) => setBaseName(e.target.value)} required autoFocus
              placeholder="e.g. LW6, H-F09, Engine Bay Power"
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm font-mono font-bold text-text focus:outline-none focus:border-accent/60" />
          </div>

          {/* New-revision banner */}
          {isNewRevision && rootHarness && (
            <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2.5 text-[11px] space-y-1">
              <div className="text-accent font-semibold">↻ Nova Revisão detectada</div>
              <div className="text-dim">
                <span className="text-mid font-mono">{rootHarness.id}</span> já existe com as revisões:{' '}
                <span className="font-mono text-bright">{usedRevisions.join(', ')}</span>
              </div>
              <div className="text-dim">
                Será criado: <span className="font-mono text-bright">{newId}</span> REV <span className="font-mono text-bright">{revision}</span> — começa no stage BoM.
              </div>
            </div>
          )}

          {/* ID (computed, read-only) + Revision */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">
                Harness ID <span className="normal-case text-dim">(auto)</span>
              </label>
              <div className="w-full px-3 py-2 rounded-lg border border-border bg-bg/50 text-sm font-mono font-bold text-mid">
                {newId || <span className="text-border">—</span>}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Revision</label>
              <select value={revision} onChange={(e) => setRevision(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm font-mono text-text focus:outline-none focus:border-accent/60">
                {ALL_REVISIONS.map((r) => (
                  <option key={r} value={r} disabled={usedRevisions.includes(r)}>
                    {r}{usedRevisions.includes(r) ? ' (used)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* People */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Design Engineer</label>
              <select value={designResponsible} onChange={(e) => setDesignResponsible(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60">
                <option value="">— select —</option>
                {active.map((r) => <option key={r.id} value={r.name}>{r.name}{r.role ? ` · ${r.role}` : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Production Operator</label>
              <select value={responsible} onChange={(e) => setResponsible(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60">
                <option value="">— select —</option>
                {active.map((r) => <option key={r.id} value={r.name}>{r.name}{r.role ? ` · ${r.role}` : ''}</option>)}
              </select>
            </div>
          </div>

          {active.length === 0 && (
            <p className="text-[10px] text-risk font-mono">
              ⚠ No people registered — open People (header) to add engineers &amp; operators first.
            </p>
          )}
          {error && <p className="text-xs text-blocked">{error}</p>}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm text-dim hover:text-mid">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 rounded-lg bg-done/90 text-white text-sm font-semibold hover:bg-done disabled:opacity-50">
              {saving ? 'Creating…' : isNewRevision ? `Create REV ${revision}` : 'Create Harness'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
