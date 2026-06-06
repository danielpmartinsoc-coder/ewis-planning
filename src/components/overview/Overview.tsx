import type { AppState } from '../../types';
import { STAGES } from '../../types';

interface Props {
  state: AppState;
  onNavigate: (view: 'pipeline' | 'radar' | 'heatmap') => void;
}

// ── SVG donut chart ──────────────────────────────────────────────────────────
function DonutChart({ segments }: { segments: { value: number; color: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = 44, cx = 64, cy = 64;
  const circ = 2 * Math.PI * r;
  let cumulative = 0;
  return (
    <svg width="128" height="128" viewBox="0 0 128 128">
      {segments.map((seg, i) => {
        const pct = total > 0 ? seg.value / total : 0;
        const dash = pct * circ;
        const rot = (cumulative / Math.max(total, 1)) * 360 - 90;
        cumulative += seg.value;
        return (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={seg.color} strokeWidth="20"
            strokeDasharray={`${dash} ${circ - dash}`}
            transform={`rotate(${rot} ${cx} ${cy})`}
          />
        );
      })}
      {/* Inner white ring */}
      <circle cx={cx} cy={cy} r={24} fill="#EEF1F8" />
      <text x={cx} y={cy - 4} textAnchor="middle" fill="#1A2535" fontSize="16" fontWeight="700">{total}</text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="#7A8BA8" fontSize="8">Total</text>
    </svg>
  );
}

// ── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, sub, color = 'text-text', trend }:
  { icon: string; label: string; value: string | number; sub?: string; color?: string; trend?: string }) {
  return (
    <div className="bg-surface2 border border-border/60 rounded-xl px-4 py-3 flex items-start gap-3 min-w-0">
      <span className="text-2xl leading-none mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] font-mono uppercase tracking-widest text-dim truncate">{label}</div>
        <div className={`text-2xl font-bold leading-tight ${color}`}>{value}</div>
        {sub   && <div className="text-[10px] text-dim">{sub}</div>}
        {trend && <div className="text-[10px] text-ok">{trend}</div>}
      </div>
    </div>
  );
}

// ── Gantt pipeline mini-view ─────────────────────────────────────────────────
function GanttOverview({ harnesses, onNavigate }:
  { harnesses: AppState['harnesses']; onNavigate: (v: 'pipeline') => void }) {
  const projects = [...new Set(harnesses.map((h) => h.project))];

  return (
    <div className="bg-surface2 border border-border/60 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 shrink-0">
        <span className="font-semibold text-sm text-text">Production Pipeline Overview</span>
        <button onClick={() => onNavigate('pipeline')} className="text-[10px] text-accent hover:underline font-mono">
          View all →
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border-collapse min-w-[700px]">
          <thead>
            <tr className="border-b border-border/40">
              <th className="text-left px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-dim font-normal w-44">
                Programme / Project
              </th>
              {STAGES.map((s) => (
                <th key={s} className="px-1 py-1.5 text-center font-mono text-[9px] text-dim font-normal">
                  {s.toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {projects.map((proj) => {
              const rows = harnesses.filter((h) => h.project === proj);
              return [
                <tr key={`hdr-${proj}`}>
                  <td colSpan={STAGES.length + 1}
                    className="px-3 py-1 border-b border-t border-border/30 bg-surface/60">
                    <span className="font-mono text-[10px] font-bold tracking-widest text-mid">{proj}</span>
                    <span className="ml-1.5 text-[9px] text-dim/60">{rows.length} harnesses</span>
                  </td>
                </tr>,
                ...rows.map((h) => (
                  <tr key={h.id} className="border-b border-border/25 hover:bg-surface/40 group">
                    {/* Label col */}
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        {h.blocked && <span className="w-1.5 h-1.5 rounded-full bg-blocked shrink-0 animate-pulse" />}
                        <span className="font-mono text-[10px] text-text font-semibold">{h.id}</span>
                        {h.ecns.length > 0 && (
                          <span className="px-1 rounded text-[8px] font-mono bg-risk/10 text-risk border border-risk/20">
                            ECN
                          </span>
                        )}
                      </div>
                      <div className="text-[9px] text-dim truncate max-w-[140px] mt-0.5">{h.name}</div>
                    </td>
                    {/* Stage cells — horizontal bar effect */}
                    {STAGES.map((_, i) => {
                      const isPast    = i < h.stage;
                      const isCurrent = i === h.stage;
                      const isBlocked = h.blocked && isCurrent;
                      const isDone    = i === STAGES.length - 1 && h.stage >= STAGES.length - 1;
                      return (
                        <td key={i}
                          className={`px-0.5 py-1 text-center ${
                            isBlocked ? 'bg-blocked/20' :
                            isCurrent ? 'bg-done/30' :
                            isPast    ? 'bg-done/12' :
                            ''
                          }`}
                          style={{ height: '40px' }}
                        >
                          {isBlocked ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="text-[8px] font-bold text-blocked leading-none font-mono">● BLOCKED</span>
                              {h.blockReason && (
                                <span className="text-[7px] text-blocked/50 leading-tight text-center line-clamp-1 max-w-[70px]">
                                  {h.blockReason.slice(0, 28)}…
                                </span>
                              )}
                            </div>
                          ) : isCurrent ? (
                            <span className="text-[8px] font-bold text-done font-mono">⟲ IN PROGRESS</span>
                          ) : isDone ? (
                            <span className="text-[9px] text-done font-bold">✓</span>
                          ) : isPast ? (
                            <span className="text-[9px] text-done/30">─</span>
                          ) : (
                            <span className="text-[10px] text-dim/10">·</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
      {/* Legend */}
      <div className="px-3 py-1.5 border-t border-border/30 flex items-center gap-4 text-[9px] font-mono text-dim bg-surface/40">
        <span className="flex items-center gap-1"><span className="w-5 h-2 rounded-sm bg-done/25 inline-block" /> Complete</span>
        <span className="flex items-center gap-1"><span className="w-5 h-2 rounded-sm bg-done/50 inline-block" /> In Progress</span>
        <span className="flex items-center gap-1"><span className="w-5 h-2 rounded-sm bg-blocked/35 inline-block" /> Blocked</span>
        <span className="flex items-center gap-1"><span className="w-5 h-2 rounded-sm bg-surface inline-block border border-border/40" /> Not started</span>
      </div>
    </div>
  );
}

// ── Funnel (Engineering Release Flow) ───────────────────────────────────────
function ReleaseFunnel({ harnesses }: { harnesses: AppState['harnesses'] }) {
  const stages = [
    { label: 'Schematic Release', count: harnesses.filter((h) => h.stage >= 0).length },
    { label: 'ICD Sign-off',      count: harnesses.filter((h) => h.stage >= 1).length },
    { label: 'Schematic Released',count: harnesses.filter((h) => h.stage >= 2).length },
    { label: 'BoM Release',       count: harnesses.filter((h) => h.stage >= 3).length },
    { label: 'ECN Pending',       count: harnesses.filter((h) => h.ecns.some((e) => e.status === 'pending')).length },
    { label: 'Blocked',           count: harnesses.filter((h) => h.blocked).length },
  ];
  const max = Math.max(...stages.map((s) => s.count), 1);
  const colors = ['bg-cyan-600/60', 'bg-blue-500/60', 'bg-teal-500/60', 'bg-emerald-500/60', 'bg-amber-500/60', 'bg-red-500/60'];

  return (
    <div className="bg-surface2 border border-border/60 rounded-xl p-4 w-64 shrink-0">
      <span className="font-semibold text-sm text-text block mb-3">Engineering Release Flow</span>
      {stages.map((s, i) => {
        const pct = Math.round((s.count / max) * 100);
        return (
          <div key={s.label} className="flex items-center gap-2 mb-1.5">
            <span className="font-mono text-[9px] text-dim w-32 truncate text-right">{s.label}</span>
            <div className={`h-3.5 rounded-sm ${colors[i]}`} style={{ width: `${Math.max(pct, 4)}%`, maxWidth: '120px', minWidth: '8px' }} />
            <span className="font-mono text-[11px] text-mid w-4 text-right">{s.count}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── ECN Tracker ──────────────────────────────────────────────────────────────
function ECNTracker({ ecns }: { ecns: AppState['ecns'] }) {
  return (
    <div className="bg-surface2 border border-border/60 rounded-xl overflow-hidden flex-1 min-w-0">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60">
        <span className="font-semibold text-sm text-text">ECN Tracker</span>
        <span className="text-[10px] font-mono text-dim">{ecns.length} total</span>
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border/40">
            {['ECN ID', 'Project', 'Description', 'Status', 'Submitted'].map((h) => (
              <th key={h} className="text-left px-3 py-1.5 font-mono text-[9px] text-dim font-normal">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ecns.map((ecn) => (
            <tr key={ecn.id} className="border-b border-border/25 hover:bg-surface/50">
              <td className="px-3 py-2 font-mono text-[10px] text-mid whitespace-nowrap">{ecn.id}</td>
              <td className="px-3 py-2 font-mono text-[10px] text-dim">
                {ecn.affectedHarnesses[0] ?? '—'}
              </td>
              <td className="px-3 py-2 text-text max-w-[160px]">
                <div className="truncate text-[10px]" title={ecn.description}>{ecn.description}</div>
              </td>
              <td className="px-3 py-2">
                <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-bold whitespace-nowrap ${
                  ecn.status === 'pending'  ? 'bg-risk/10 text-risk border border-risk/25' :
                  ecn.status === 'approved' ? 'bg-ok/10 text-ok border border-ok/25' :
                  'bg-dim/10 text-dim border border-dim/25'
                }`}>
                  {ecn.status === 'pending' ? 'Pending' : ecn.status === 'approved' ? 'Approved' : 'Rejected'}
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-[10px] text-dim whitespace-nowrap">{ecn.raisedAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Impact Radar Top Risks ───────────────────────────────────────────────────
function TopRisks(_props: Pick<AppState, 'harnesses' | 'ecns'>) {
  const risks = [
    { risk: 'ECN backlog',       category: 'Engineering',   impact: 'High',   likelihood: 'High',   trend: '↑', mitigation: 'Increase ECN review capacity' },
    { risk: 'Supplier lead time',category: 'Supply Chain',  impact: 'High',   likelihood: 'Medium', trend: '↔', mitigation: 'Dual sourcing strategy' },
    { risk: 'Component shortage',category: 'Materials',     impact: 'Medium', likelihood: 'Medium', trend: '↑', mitigation: 'Safety stock & allocation' },
    { risk: 'Resource conflict', category: 'People',        impact: 'Medium', likelihood: 'Low',    trend: '↓', mitigation: 'Reallocate engineering resources' },
  ];
  const impactColor = (imp: string) =>
    imp === 'High' ? 'text-blocked' : imp === 'Medium' ? 'text-risk' : 'text-ok';

  return (
    <div className="bg-surface2 border border-border/60 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border/60">
        <span className="font-semibold text-sm text-text">Impact Radar — Top Risks</span>
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border/40">
            {['Risk','Category','Impact','Likelihood','Trend','Mitigation'].map((h) => (
              <th key={h} className="text-left px-3 py-1 font-mono text-[9px] text-dim font-normal">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {risks.map((r) => (
            <tr key={r.risk} className="border-b border-border/20 hover:bg-surface/40">
              <td className="px-3 py-1.5 text-text text-[10px] font-medium">{r.risk}</td>
              <td className="px-3 py-1.5 text-dim text-[10px]">{r.category}</td>
              <td className={`px-3 py-1.5 text-[10px] font-bold ${impactColor(r.impact)}`}>{r.impact}</td>
              <td className={`px-3 py-1.5 text-[10px] font-bold ${impactColor(r.likelihood)}`}>{r.likelihood}</td>
              <td className="px-3 py-1.5 text-[11px] text-mid font-bold">{r.trend}</td>
              <td className="px-3 py-1.5 text-[10px] text-dim">{r.mitigation}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Mini Capacity Heatmap ────────────────────────────────────────────────────
function MiniHeatmap({ onNavigate }: { onNavigate: (v: 'heatmap') => void }) {
  const rows = ['Engineering', 'Procurement', 'Manufacturing', 'Test', 'Quality'];
  const weeks = ['Wk 10\n10-16 Mar', 'Wk 11\n17-23 Mar', 'Wk 12\n24-30 Mar', 'Wk 13\n31Mar-6Apr', 'Wk 14\n7-13 Apr'];
  // Synthetic load data (0=low,1,2=medium,3,4=high)
  const data = [
    [1,2,3,4,3],[2,3,2,1,2],[3,4,4,3,2],[1,1,2,3,2],[2,2,1,1,0]
  ];
  const cellColor = (v: number) =>
    v === 0 ? 'bg-ok/15' : v === 1 ? 'bg-ok/35' : v === 2 ? 'bg-risk/30' : v === 3 ? 'bg-risk/55' : 'bg-blocked/55';

  return (
    <div className="bg-surface2 border border-border/60 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60">
        <div>
          <span className="font-semibold text-sm text-text">Capacity Heatmap</span>
          <span className="ml-2 text-[9px] text-dim font-mono">Next 30 Days</span>
        </div>
        <button onClick={() => onNavigate('heatmap')} className="text-[10px] text-accent hover:underline font-mono">View →</button>
      </div>
      <div className="p-3 overflow-x-auto">
        <table className="w-full text-[9px] border-collapse">
          <thead>
            <tr>
              <th className="w-24" />
              {weeks.map((w) => (
                <th key={w} className="px-1 pb-1 font-mono text-[8px] text-dim font-normal text-center whitespace-pre leading-tight">
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={row}>
                <td className="pr-2 py-1 font-mono text-[9px] text-dim text-right">{row}</td>
                {data[ri].map((v, ci) => (
                  <td key={ci} className="px-0.5 py-0.5 text-center">
                    <div className={`w-10 h-4 rounded-sm mx-auto ${cellColor(v)}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-1 mt-1.5 justify-end">
          <span className="text-[8px] text-dim font-mono mr-1">Low</span>
          {[0,1,2,3,4].map((v) => <div key={v} className={`w-3 h-2 rounded-sm ${cellColor(v)}`} />)}
          <span className="text-[8px] text-dim font-mono ml-1">High</span>
        </div>
      </div>
    </div>
  );
}

// ── Notifications ────────────────────────────────────────────────────────────
function Notifications({ harnesses, ecns }: Pick<AppState, 'harnesses' | 'ecns'>) {
  const items = [
    ...harnesses.filter((h) => h.blocked).map((h) => ({
      type: 'blocked' as const,
      text: `${h.id} is blocked`,
      detail: h.blockReason ?? '',
      age: '2 min ago',
    })),
    ...ecns.filter((e) => e.status === 'pending').map((e) => ({
      type: 'ecn' as const,
      text: `${e.id} aguarda aprovação`,
      detail: e.description,
      age: '5 min ago',
    })),
    ...harnesses.filter((h) => h.ecns.length > 0 && !h.blocked).slice(0, 1).map((h) => ({
      type: 'risk' as const,
      text: `${h.id} at risk`,
      detail: `${h.ecns.length} ECN activa`,
      age: '10 min ago',
    })),
  ].slice(0, 5);

  return (
    <div className="bg-surface2 border border-border/60 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border/60">
        <span className="font-semibold text-sm text-text">Notifications</span>
      </div>
      <div className="divide-y divide-border/30">
        {items.length === 0 ? (
          <p className="px-4 py-4 text-xs text-dim text-center">No notifications</p>
        ) : items.map((item, i) => (
          <div key={i} className="px-3 py-2 flex items-start gap-2.5">
            <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
              item.type === 'blocked' ? 'bg-blocked' :
              item.type === 'ecn'     ? 'bg-risk' :
              'bg-risk/60'
            }`} />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-text">{item.text}</div>
              <div className="text-[9px] text-dim truncate">{item.detail}</div>
            </div>
            <span className="text-[9px] text-dim shrink-0">{item.age}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Recent Activity ──────────────────────────────────────────────────────────
function RecentActivity({ state }: { state: AppState }) {
  const items = [
    ...state.harnesses.filter((h) => h.blocked).slice(0, 2).map((h) => ({
      color: 'bg-blocked',
      text: `${h.id} → BLOCKED`,
      detail: h.blockReason?.slice(0, 40) ?? '',
      age: '2 min ago',
    })),
    ...state.ecns.filter((e) => e.status === 'pending').slice(0, 1).map((e) => ({
      color: 'bg-risk',
      text: `${e.id} submitted for ${e.affectedHarnesses[0]}`,
      detail: '',
      age: '10 min ago',
    })),
    ...state.milestones.filter((m) => m.actual).slice(0, 3).map((m) => ({
      color: 'bg-ok',
      text: `${m.project} · ${m.label}`,
      detail: `completed on ${m.actual}`,
      age: '1h ago',
    })),
  ].slice(0, 5);

  return (
    <div className="bg-surface2 border border-border/60 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border/60">
        <span className="font-semibold text-sm text-text">Recent Activity</span>
      </div>
      <div className="divide-y divide-border/30">
        {items.map((item, i) => (
          <div key={i} className="px-3 py-2 flex items-start gap-2.5">
            <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${item.color}`} />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-text">{item.text}</div>
              {item.detail && <div className="text-[9px] text-dim">{item.detail}</div>}
            </div>
            <span className="text-[9px] text-dim shrink-0">{item.age}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Overview ────────────────────────────────────────────────────────────
export function Overview({ state, onNavigate }: Props) {
  const { harnesses, ecns } = state;

  const total     = harnesses.length;
  const blocked   = harnesses.filter((h) => h.blocked).length;
  const done      = harnesses.filter((h) => h.stage >= STAGES.length - 1).length;
  const atRisk    = harnesses.filter((h) => !h.blocked && h.ecns.length > 0).length;
  const onTrack   = Math.max(0, total - blocked - atRisk);
  const pctOT     = total > 0 ? Math.round((onTrack / total) * 100) : 0;
  const pendingEcn = ecns.filter((e) => e.status === 'pending').length;
  const approvedEcn = ecns.filter((e) => e.status === 'approved').length;

  const blockedAndRisk = [
    ...harnesses.filter((h) => h.blocked),
    ...harnesses.filter((h) => !h.blocked && h.ecns.length > 0).slice(0, 3),
  ];

  return (
    <div className="bg-bg px-8 py-6 flex flex-col gap-6">

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-7 gap-4 shrink-0">
        <StatCard icon="📋" label="Total Harnesses" value={total}     sub="All time"          color="text-text" />
        <StatCard icon="✅" label="On Track"        value={`${pctOT}%`} sub={`${onTrack}/${total}`} color="text-ok" trend="↑ stable" />
        <StatCard icon="⚠️" label="At Risk"         value={atRisk}    sub={`${total > 0 ? Math.round((atRisk/total)*100) : 0}%`} color="text-risk" />
        <StatCard icon="🔴" label="Blocked"         value={blocked}   sub={`${total > 0 ? Math.round((blocked/total)*100) : 0}%`} color="text-blocked" />
        <StatCard icon="✓"  label="Completed"       value={done}      sub="This period"       color="text-done" />
        <StatCard icon="⏱" label="ECN Pending"     value={pendingEcn} sub="Awaiting approval" color="text-risk" />
        <StatCard icon="📄" label="ECN Approved"    value={approvedEcn} sub="This period"     color="text-ok" />
      </div>

      {/* ── Body: left + right sidebar ── */}
      <div className="flex gap-6 items-start">

        {/* LEFT */}
        <div className="flex flex-col gap-6 flex-1 min-w-0">
          <GanttOverview harnesses={harnesses} onNavigate={onNavigate} />

          <div className="flex gap-6">
            <ReleaseFunnel harnesses={harnesses} />
            <ECNTracker ecns={ecns} />
          </div>

          <TopRisks harnesses={harnesses} ecns={ecns} />
        </div>

        {/* RIGHT SIDEBAR */}
        <div className="flex flex-col gap-6 w-80 shrink-0">

          {/* Status Distribution donut */}
          <div className="bg-surface2 border border-border/60 rounded-xl p-4">
            <span className="font-semibold text-sm text-text block mb-3">Status Distribution</span>
            <div className="flex items-center gap-4">
              <DonutChart segments={[
                { value: onTrack, color: '#22c55e' },
                { value: atRisk,  color: '#f59e0b' },
                { value: blocked, color: '#ef4444' },
              ]} />
              <div className="flex flex-col gap-2">
                {[
                  { label: 'On Track', count: onTrack,  color: 'bg-ok',      text: 'text-ok' },
                  { label: 'At Risk',  count: atRisk,   color: 'bg-risk',    text: 'text-risk' },
                  { label: 'Blocked',  count: blocked,  color: 'bg-blocked', text: 'text-blocked' },
                ].map(({ label, count, color, text }) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${color} shrink-0`} />
                    <span className="text-xs text-text flex-1 whitespace-nowrap">{label}</span>
                    <span className={`font-mono font-bold text-xs ${text}`}>{count}</span>
                    <span className="font-mono text-[9px] text-dim w-8 text-right">
                      ({total > 0 ? Math.round((count/total)*100) : 0}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Blocked & At Risk */}
          <div className="bg-surface2 border border-border/60 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border/60">
              <span className="font-semibold text-sm text-text">Blocked &amp; At Risk</span>
            </div>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="text-left px-3 py-1 font-mono text-[9px] text-dim font-normal">Harness</th>
                  <th className="text-left px-3 py-1 font-mono text-[9px] text-dim font-normal">Reason</th>
                  <th className="px-2 py-1 text-center font-mono text-[9px] text-dim font-normal">Impact</th>
                </tr>
              </thead>
              <tbody>
                {blockedAndRisk.slice(0, 5).map((h) => (
                  <tr key={h.id} className="border-b border-border/20 hover:bg-surface/40">
                    <td className="px-3 py-1.5">
                      <div className="font-mono text-[10px] text-text font-semibold">{h.id}</div>
                      <div className="text-[9px] text-dim truncate max-w-[70px]">{h.name}</div>
                    </td>
                    <td className="px-3 py-1.5 text-[9px] text-mid max-w-[90px]">
                      <div className="truncate">{h.blocked ? (h.blockReason ?? '—') : `ECN ×${h.ecns.length}`}</div>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {h.blocked
                        ? <span className="font-mono text-[9px] font-bold text-blocked px-1 py-0.5 rounded bg-blocked/10 border border-blocked/25">High</span>
                        : <span className="font-mono text-[9px] font-bold text-risk px-1 py-0.5 rounded bg-risk/10 border border-risk/25">Medium</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <MiniHeatmap onNavigate={onNavigate} />
          <Notifications harnesses={harnesses} ecns={ecns} />
          <RecentActivity state={state} />
        </div>
      </div>
    </div>
  );
}
