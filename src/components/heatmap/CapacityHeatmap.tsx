import type { Person } from '../../types';

export function CapacityHeatmap(_props: { people: Person[] }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-6 px-8 py-16 text-center">
      <div className="text-7xl select-none">🚧</div>
      <div>
        <h2 className="text-xl font-bold text-text mb-2">Capacity Heatmap</h2>
        <p className="text-sm text-dim max-w-sm leading-relaxed">
          This module is currently under construction.<br />
          Resource capacity planning will be available in a future release.
        </p>
      </div>
      <span className="flex items-center gap-2 px-4 py-2 rounded-xl border border-risk/35 bg-risk/8 text-risk text-xs font-mono font-bold tracking-wider">
        🚧 UNDER CONSTRUCTION — STANDBY
      </span>
    </div>
  );
}
