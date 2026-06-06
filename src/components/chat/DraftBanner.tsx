import type { DraftStatus } from '../../api';

interface Props {
  draft: DraftStatus;
  userName: string;
  onAccept: () => void;
  onReject: () => void;
  accepting: boolean;
}

const OP_LABELS: Record<string, string> = {
  advance_stage:     'Stage advanced',
  register_block:    'Block registered',
  resolve_block:     'Block resolved',
  update_milestone:  'Milestone updated',
  update_ecn_status: 'ECN status updated',
  add_ecn:           'ECN added',
};

export function DraftBanner({ draft, userName, onAccept, onReject, accepting }: Props) {
  if (!draft.has_draft) return null;

  return (
    <div className="shrink-0 border-b border-risk/40 bg-risk/5">
      <div className="flex items-center gap-3 px-5 py-2">
        <span className="text-risk font-mono text-xs font-semibold shrink-0">● DRAFT PENDING</span>
        <div className="flex-1 min-w-0">
          <span className="text-xs text-mid">
            Requested by <span className="text-text font-semibold">{draft.requested_by}</span>
            {' · '}
            <span className="italic text-dim truncate">&ldquo;{draft.message}&rdquo;</span>
          </span>
          {(draft.changes ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {(draft.changes ?? []).map((c, i) => (
                <span key={i} className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface2 border border-border text-mid">
                  {OP_LABELS[c.op] ?? c.op}
                  {c.harness_id ? ` · ${c.harness_id}` : ''}
                  {c.project && c.phase ? ` · ${c.project}/${c.phase}` : ''}
                  {c.ecn_id ? ` · ${c.ecn_id}` : ''}
                  {c.status ? ` → ${c.status}` : ''}
                  {c.from && c.to ? ` ${c.from} → ${c.to}` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={onReject}
            disabled={accepting}
            className="px-3 py-1 rounded border border-border text-dim text-xs hover:text-text hover:border-mid transition-colors disabled:opacity-50"
          >
            Reject
          </button>
          <button
            onClick={onAccept}
            disabled={accepting}
            className="px-3 py-1 rounded bg-ok/10 border border-ok/50 text-ok text-xs font-semibold hover:bg-ok/20 transition-colors disabled:opacity-50"
          >
            {accepting ? 'Applying…' : `Accept (${userName})`}
          </button>
        </div>
      </div>
    </div>
  );
}
