import { useState } from 'react';
import type { Harness } from '../../types';

interface Props {
  harness: Harness;
  onRegisterBlock: (id: string, reason: string, responsible: string) => void;
  onResolveBlock: (id: string, note: string) => void;
  onClose: () => void;
}

export function BlockPanel({ harness, onRegisterBlock, onResolveBlock, onClose }: Props) {
  const [mode, setMode] = useState<'view' | 'register' | 'resolve'>('view');
  const [reason, setReason] = useState('');
  const [responsible, setResponsible] = useState(harness.responsible ?? '');
  const [note, setNote] = useState('');

  function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    onRegisterBlock(harness.id, reason.trim(), responsible.trim());
    onClose();
  }

  function handleResolve(e: React.FormEvent) {
    e.preventDefault();
    onResolveBlock(harness.id, note.trim());
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[480px] max-h-[90vh] overflow-y-auto bg-surface border border-border rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <span className="font-mono text-xs text-dim mr-2">{harness.id}</span>
            <span className="font-semibold text-text">{harness.name}</span>
          </div>
          <button onClick={onClose} className="text-dim hover:text-text text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-dim">Project:</span>
            <span className="font-mono text-mid">{harness.project}</span>
            <span className="text-dim ml-2">Rev:</span>
            <span className="font-mono text-mid">{harness.revision}</span>
            <span className="text-dim ml-2">Responsible:</span>
            <span className="text-mid">{harness.responsible ?? '—'}</span>
          </div>

          {harness.blocked && mode === 'view' && (
            <div className="rounded border border-blocked/40 bg-blocked/10 px-4 py-3 space-y-2">
              <div className="flex items-center gap-2 text-blocked font-semibold text-sm">
                <span>■</span> BLOCKED
              </div>
              <p className="text-text text-sm">{harness.blockReason}</p>
              <div className="flex gap-3 mt-3">
                <button
                  onClick={() => setMode('resolve')}
                  className="flex-1 py-2 rounded bg-ok/10 border border-ok/40 text-ok text-sm font-semibold hover:bg-ok/20 transition-colors"
                >
                  Mark as Resolved
                </button>
              </div>
            </div>
          )}

          {!harness.blocked && mode === 'view' && (
            <div className="rounded border border-border bg-surface2 px-4 py-3 text-sm text-mid">
              No active block on this harness.
            </div>
          )}

          {!harness.blocked && mode === 'view' && (
            <button
              onClick={() => setMode('register')}
              className="w-full py-2 rounded bg-blocked/10 border border-blocked/40 text-blocked text-sm font-semibold hover:bg-blocked/20 transition-colors"
            >
              Register Block
            </button>
          )}

          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3">
              <h3 className="text-sm font-semibold text-text">Register Block</h3>
              <div>
                <label className="block text-xs text-dim mb-1">Block Reason *</label>
                <textarea
                  autoFocus
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Describe what is blocking this harness…"
                  className="w-full rounded border border-border bg-surface2 px-3 py-2 text-sm text-text placeholder-dim focus:outline-none focus:border-blocked resize-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-dim mb-1">Responsible for resolution</label>
                <input
                  value={responsible}
                  onChange={(e) => setResponsible(e.target.value)}
                  placeholder="Engineer name"
                  className="w-full rounded border border-border bg-surface2 px-3 py-2 text-sm text-text placeholder-dim focus:outline-none focus:border-mid"
                />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setMode('view')} className="flex-1 py-2 rounded border border-border text-mid text-sm hover:text-text transition-colors">
                  Cancel
                </button>
                <button type="submit" className="flex-1 py-2 rounded bg-blocked border border-blocked text-white text-sm font-semibold hover:brightness-110 transition-all">
                  Confirm Block
                </button>
              </div>
            </form>
          )}

          {mode === 'resolve' && (
            <form onSubmit={handleResolve} className="space-y-3">
              <h3 className="text-sm font-semibold text-text">Resolve Block</h3>
              <div className="rounded border border-border bg-surface2 px-3 py-2 text-sm text-dim italic">
                "{harness.blockReason}"
              </div>
              <div>
                <label className="block text-xs text-dim mb-1">Resolution note (optional)</label>
                <textarea
                  autoFocus
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="How was this resolved?"
                  className="w-full rounded border border-border bg-surface2 px-3 py-2 text-sm text-text placeholder-dim focus:outline-none focus:border-ok resize-none"
                />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setMode('view')} className="flex-1 py-2 rounded border border-border text-mid text-sm hover:text-text transition-colors">
                  Cancel
                </button>
                <button type="submit" className="flex-1 py-2 rounded bg-ok border border-ok text-bg text-sm font-semibold hover:brightness-110 transition-all">
                  Confirm Resolution
                </button>
              </div>
            </form>
          )}

          {harness.blockResolvedAt && (
            <div className="text-xs text-dim border-t border-border pt-3">
              Last resolved: {harness.blockResolvedAt}
              {harness.blockResolvedNote && <span className="ml-2 italic">— {harness.blockResolvedNote}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
