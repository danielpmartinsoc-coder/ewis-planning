import { useState } from 'react';
import type { Harness } from '../../types';
import { STAGES } from '../../types';

interface Props {
  harness: Harness;
  direction: 'advance' | 'back';
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

const ADVANCE_QUESTIONS = [
  'All items received and verified?',
  'Documentation complete and signed off?',
  'Quality check passed?',
  'Ready for next team to proceed?',
];

const BACK_QUESTIONS = [
  'What issue was found that requires going back?',
  'Was this stage completed incorrectly?',
  'Is there a rework or correction required?',
  'Has the responsible engineer been notified?',
];

export function StageMoveDialog({ harness, direction, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState('');
  const isAdvance = direction === 'advance';
  const fromIdx = isAdvance ? harness.stage     : harness.stage;
  const toIdx   = isAdvance ? harness.stage + 1 : harness.stage - 1;
  const from = STAGES[fromIdx];
  const to   = STAGES[toIdx];
  const questions = isAdvance ? ADVANCE_QUESTIONS : BACK_QUESTIONS;
  const canConfirm = reason.trim().length >= 5;

  function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!canConfirm) return;
    onConfirm(reason.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="w-[460px] bg-surface border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`px-5 py-4 border-b border-border ${isAdvance ? 'bg-ok/5' : 'bg-risk/5'}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-sm font-bold ${isAdvance ? 'text-ok' : 'text-risk'}`}>
              {isAdvance ? '→ Advance Stage' : '← Move Back'}
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="font-mono text-text">{harness.id}</span>
            <span className="text-dim">{harness.name}</span>
            <span className="text-dim font-mono text-xs">rev {harness.revision}</span>
          </div>
          <div className="flex items-center gap-2 mt-2 text-xs">
            <span className="px-2 py-0.5 rounded bg-surface2 border border-border font-mono text-mid">{from}</span>
            <span className={isAdvance ? 'text-ok' : 'text-risk'}>{isAdvance ? '→' : '←'}</span>
            <span className={`px-2 py-0.5 rounded border font-mono ${
              isAdvance ? 'bg-ok/10 border-ok/40 text-ok' : 'bg-risk/10 border-risk/40 text-risk'
            }`}>{to}</span>
          </div>
        </div>

        <form onSubmit={handleConfirm} className="p-5 space-y-4">
          {/* Checklist prompts */}
          <div className="space-y-1.5">
            <p className="text-xs text-dim font-semibold uppercase tracking-wider">Consider before proceeding</p>
            {questions.map((q, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-dim">
                <span className="text-border mt-0.5">○</span>
                <span>{q}</span>
              </div>
            ))}
          </div>

          {/* Reason field */}
          <div>
            <label className="block text-xs font-semibold text-mid mb-1.5">
              Reason <span className="text-blocked">*</span>
            </label>
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder={isAdvance
                ? 'Describe why this harness is ready to move forward…'
                : 'Describe what issue requires moving this stage back…'}
              className="w-full rounded border border-border bg-surface2 px-3 py-2 text-sm text-text placeholder-dim focus:outline-none focus:border-mid resize-none"
              required
            />
            <p className="text-[10px] text-dim mt-1">
              Minimum 5 characters · Will be saved as a note on this harness
            </p>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-2 rounded border border-border text-mid text-sm hover:text-text transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canConfirm}
              className={`flex-1 py-2 rounded border text-sm font-semibold transition-all disabled:opacity-40 ${
                isAdvance
                  ? 'bg-ok/10 border-ok/40 text-ok hover:bg-ok/20'
                  : 'bg-risk/10 border-risk/40 text-risk hover:bg-risk/20'
              }`}
            >
              {isAdvance ? 'Confirm Advance' : 'Confirm Move Back'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
