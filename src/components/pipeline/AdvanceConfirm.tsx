import type { Harness } from '../../types';
import { STAGES } from '../../types';

interface Props {
  harness: Harness;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AdvanceConfirm({ harness, onConfirm, onCancel }: Props) {
  const from = STAGES[harness.stage];
  const to = STAGES[harness.stage + 1];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="w-[400px] bg-surface border border-border rounded-lg shadow-2xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold text-text">Advance Stage</h2>
        <p className="text-sm text-mid">
          Move <span className="font-mono text-text">{harness.id}</span>{' '}
          <span className="text-dim">{harness.name}</span>
        </p>
        <div className="flex items-center gap-3 text-sm">
          <span className="px-2 py-0.5 rounded bg-surface2 border border-border font-mono text-mid">{from}</span>
          <span className="text-dim">→</span>
          <span className="px-2 py-0.5 rounded bg-ok/10 border border-ok/40 font-mono text-ok">{to}</span>
        </div>
        <p className="text-xs text-dim">This action will be saved immediately.</p>
        <div className="flex gap-3 pt-1">
          <button onClick={onCancel} className="flex-1 py-2 rounded border border-border text-mid text-sm hover:text-text transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} className="flex-1 py-2 rounded bg-ok/10 border border-ok/40 text-ok text-sm font-semibold hover:bg-ok/20 transition-colors">
            Confirm Advance
          </button>
        </div>
      </div>
    </div>
  );
}
