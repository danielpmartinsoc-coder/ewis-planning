import type { Milestone, MilestoneStatus } from '../../types';

const CHIP: Record<MilestoneStatus, string> = {
  done:    'bg-ok/8 border-ok/20 text-ok',
  risk:    'bg-risk/8 border-risk/20 text-risk',
  blocked: 'bg-blocked/8 border-blocked/20 text-blocked',
  open:    'bg-transparent border-border/50 text-dim',
};
const ICON: Record<MilestoneStatus, string> = { done: '✓', risk: '▲', blocked: '✕', open: '○' };
const PROJ: Record<string, string> = {
  FALCON:    'border-l-done text-done',
  ALPHA:     'border-l-ok text-ok',
  'PROJ-001':'border-l-risk text-risk',
};

interface Props { project: string; milestones: Milestone[] }

export function MilestoneRow({ project, milestones }: Props) {
  const phases = ['F2', 'F3', 'F4', 'F5', 'F6'] as const;
  const accent = PROJ[project] ?? 'border-l-border text-mid';

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 border-b border-border/50 bg-surface/60">
      <span className={`w-20 shrink-0 font-mono text-[10px] font-bold tracking-widest border-l-2 pl-2 ${accent}`}>
        {project}
      </span>
      <div className="flex items-center gap-1.5 flex-1 flex-wrap min-w-0">
        {phases.map((phase) => {
          const ms = milestones.find((m) => m.phase === phase);
          if (!ms) return null;
          const late = ms.actual && ms.actual > ms.planned;
          return (
            <div key={phase} className={`flex items-center gap-1.5 px-2 py-0.5 rounded border font-mono text-[9px] ${CHIP[ms.status]}`}>
              <span className="font-bold">{phase}</span>
              <span className="opacity-30">│</span>
              <span className="text-mid/70 max-w-[84px] truncate">{ms.label}</span>
              <span className="text-dim/50">P:{ms.planned.slice(5)}</span>
              {ms.actual
                ? <span className={late ? 'text-risk font-semibold' : 'text-ok'}>A:{ms.actual.slice(5)}</span>
                : ms.status !== 'open' && <span className="text-dim/40 italic">pend.</span>
              }
              <span className="font-bold">{ICON[ms.status]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
