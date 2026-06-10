import { useState, useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LogEntry {
  action: string;
  timestamp: string;
  requested_by?: string;
  // agent_run fields
  message?: string;
  change_count?: number;
  tool_count?: number;
  stop_reason?: string;
  // tool_call fields
  tool?: string;
  args?: Record<string, unknown>;
  // ui_* fields
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ACTION_META: Record<string, { label: string; color: string; icon: string }> = {
  agent_run:        { label: 'AI Run',       color: 'text-accent border-accent/30 bg-accent/10',      icon: '🤖' },
  tool_call:        { label: 'Tool',         color: 'text-mid border-border bg-surface',              icon: '🔧' },
  ui_advance_stage: { label: 'Avança Stage', color: 'text-ok border-ok/30 bg-ok/10',                 icon: '→'  },
  ui_regress_stage: { label: 'Recua Stage',  color: 'text-risk border-risk/30 bg-risk/10',           icon: '←'  },
  ui_register_block:{ label: 'Bloqueio',     color: 'text-blocked border-blocked/30 bg-blocked/10',  icon: '🔒' },
  ui_resolve_block: { label: 'Desbloqueio',  color: 'text-ok border-ok/30 bg-ok/10',                 icon: '🔓' },
  ui_add_note:      { label: 'Nota',         color: 'text-mid border-border bg-surface',              icon: '📝' },
  create_harness:   { label: 'Nova Cablagem',color: 'text-ok border-ok/30 bg-ok/10',                 icon: '➕' },
  delete_harness:   { label: 'Remove Cabl.', color: 'text-blocked border-blocked/30 bg-blocked/10',  icon: '🗑' },
  create_project:   { label: 'Novo Projeto', color: 'text-ok border-ok/30 bg-ok/10',                 icon: '📁' },
  complete_harness: { label: 'Concluída',    color: 'text-ok border-ok/30 bg-ok/10',                 icon: '✓'  },
  create_ecn:       { label: 'ECN',          color: 'text-risk border-risk/30 bg-risk/10',           icon: '⚠' },
  edit_harness:     { label: 'Edita Cabl.',  color: 'text-mid border-border bg-surface',              icon: '✏' },
};

function actionMeta(action: string) {
  return ACTION_META[action] ?? { label: action, color: 'text-dim border-border bg-surface', icon: '·' };
}

function formatTs(ts: string) {
  // ts is like "2026-06-07 09:44:56"
  const [date, time] = ts.split(' ');
  return { date: date ?? ts, time: time ?? '' };
}

function entryTitle(e: LogEntry): string {
  if (e.action === 'agent_run' && e.message) return e.message;
  if (e.action === 'tool_call' && e.tool) {
    const args = e.args ?? {};
    const hid = args.harness_id as string | undefined;
    return hid ? `${e.tool}(${hid})` : e.tool;
  }
  const payload = e.payload ?? {};
  const hid = (payload.harness_id ?? payload.id) as string | undefined;
  const reason = payload.reason as string | undefined;
  const parts = [hid, reason].filter(Boolean);
  return parts.length ? parts.join(' — ') : e.action.replace(/_/g, ' ');
}

function entryDetail(e: LogEntry): string | null {
  if (e.action === 'agent_run') {
    const parts: string[] = [];
    if (e.tool_count) parts.push(`${e.tool_count} tool${e.tool_count !== 1 ? 's' : ''}`);
    if (e.change_count !== undefined) parts.push(`${e.change_count} alteraç${e.change_count !== 1 ? 'ões' : 'ão'}`);
    if (e.stop_reason && e.stop_reason !== 'ok') parts.push(`stop: ${e.stop_reason}`);
    return parts.length ? parts.join(' · ') : null;
  }
  if (e.action === 'tool_call' && e.args) {
    const { harness_id, ...rest } = e.args as Record<string, unknown>;
    void harness_id;
    const s = JSON.stringify(rest);
    return s.length > 2 ? s.slice(0, 120) : null;
  }
  return null;
}

// Deduplicate tool_calls that are children of agent_run entries — show them only in expanded view
function groupEntries(entries: LogEntry[]): LogEntry[][] {
  // Each group = [agent_run, ...its tool_calls] or [standalone entry]
  const groups: LogEntry[][] = [];
  let i = 0;
  while (i < entries.length) {
    const e = entries[i];
    if (e.action === 'agent_run') {
      // Collect tool_calls that immediately follow (same requested_by, before next agent_run)
      const group: LogEntry[] = [e];
      let j = i + 1;
      while (j < entries.length && entries[j].action === 'tool_call') {
        group.push(entries[j]);
        j++;
      }
      groups.push(group);
      i = j;
    } else {
      groups.push([e]);
      i++;
    }
  }
  return groups;
}

// ── Entry row ─────────────────────────────────────────────────────────────────

function EntryGroup({ group }: { group: LogEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const head = group[0];
  const tools = group.slice(1);
  const meta = actionMeta(head.action);
  const { date, time } = formatTs(head.timestamp);
  const detail = entryDetail(head);
  const title = entryTitle(head);

  return (
    <div className="border-b border-border/50 last:border-0">
      <button
        className="w-full text-left px-4 py-2.5 hover:bg-surface/60 transition-colors flex items-start gap-3"
        onClick={() => tools.length > 0 && setExpanded(e => !e)}
      >
        {/* Icon */}
        <span className="text-[13px] mt-0.5 w-5 shrink-0 text-center">{meta.icon}</span>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[9px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${meta.color}`}>
              {meta.label}
            </span>
            <span className="text-[11px] text-bright truncate flex-1">{title}</span>
          </div>
          {detail && <p className="text-[10px] text-dim mt-0.5 truncate">{detail}</p>}
        </div>

        {/* Meta */}
        <div className="text-right shrink-0 ml-2">
          <div className="text-[10px] text-mid">{head.requested_by ?? 'system'}</div>
          <div className="text-[9px] text-dim">{time}</div>
          <div className="text-[9px] text-dim">{date}</div>
        </div>

        {/* Expand chevron */}
        {tools.length > 0 && (
          <span className="text-[10px] text-dim mt-1 shrink-0">{expanded ? '▲' : '▼'}</span>
        )}
      </button>

      {/* Expanded tool calls */}
      {expanded && tools.map((t, i) => {
        const tm = actionMeta(t.action);
        const { time: tt } = formatTs(t.timestamp);
        return (
          <div key={i} className="pl-12 pr-4 py-1.5 border-t border-border/30 bg-bg/40 flex items-center gap-3">
            <span className="text-[11px] w-4 text-center">{tm.icon}</span>
            <span className="text-[10px] font-mono text-accent">{t.tool}</span>
            {t.args && (
              <span className="text-[10px] text-dim truncate flex-1">
                {JSON.stringify(t.args).slice(0, 100)}
              </span>
            )}
            <span className="text-[9px] text-dim shrink-0">{tt}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const ACTION_FILTERS = [
  { id: 'all',    label: 'Tudo' },
  { id: 'ai',     label: '🤖 AI' },
  { id: 'ui',     label: '👤 Manual' },
  { id: 'create', label: '➕ Criação' },
  { id: 'block',  label: '🔒 Bloqueios' },
];

export function ActivityLog() {
  const [entries,   setEntries]  = useState<LogEntry[]>([]);
  const [loading,   setLoading]  = useState(true);
  const [filter,    setFilter]   = useState('all');
  const [search,    setSearch]   = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/log?limit=500');
      const data = await res.json();
      setEntries(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 10s when enabled
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  const filtered = entries.filter(e => {
    // Filter by category
    if (filter === 'ai'     && e.action !== 'agent_run' && e.action !== 'tool_call') return false;
    if (filter === 'ui'     && !e.action.startsWith('ui_')) return false;
    if (filter === 'create' && !e.action.startsWith('create_') && !e.action.includes('create')) return false;
    if (filter === 'block'  && !e.action.includes('block')) return false;
    // Search
    if (search) {
      const q = search.toLowerCase();
      const hay = JSON.stringify(e).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const groups = groupEntries(filtered);

  // Stats
  const aiCount  = entries.filter(e => e.action === 'agent_run').length;
  const uiCount  = entries.filter(e => e.action.startsWith('ui_')).length;
  const today    = new Date().toISOString().slice(0, 10);
  const todayCount = entries.filter(e => e.timestamp.startsWith(today)).length;

  return (
    <div className="px-8 py-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text">Activity Log</h1>
          <p className="text-xs text-dim mt-0.5">
            Registo de todas as alterações — UI, AI e MCP
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-dim cursor-pointer select-none">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)}
              className="accent-accent" />
            Auto-refresh
          </label>
          <button onClick={load}
            className="px-3 py-1.5 border border-border rounded text-[11px] text-mid hover:text-bright transition-colors">
            ↺ Atualizar
          </button>
        </div>
      </div>

      {/* Stat strip */}
      <div className="flex gap-3">
        {[
          { label: 'Total',  value: entries.length,  color: 'text-bright' },
          { label: 'Hoje',   value: todayCount,       color: 'text-bright' },
          { label: 'AI',     value: aiCount,          color: 'text-accent' },
          { label: 'Manual', value: uiCount,          color: 'text-mid'    },
        ].map(s => (
          <div key={s.label} className="border border-border rounded-lg px-4 py-2 text-center min-w-[72px]">
            <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-[10px] text-dim">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters + Search */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1">
          {ACTION_FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`px-3 py-1 rounded text-[11px] transition-colors ${
                filter === f.id
                  ? 'bg-accent/20 border border-accent/40 text-accent'
                  : 'border border-border text-dim hover:text-mid'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
        <input type="text" placeholder="Pesquisar…"
          className="bg-bg border border-border rounded px-3 py-1.5 text-[11px] text-bright placeholder:text-dim w-48"
          value={search} onChange={e => setSearch(e.target.value)} />
        <span className="text-[10px] text-dim ml-auto">{groups.length} entradas</span>
      </div>

      {/* Log list */}
      <div className="border border-border rounded-xl overflow-hidden">
        {loading ? (
          <p className="text-[11px] text-dim text-center py-12">A carregar…</p>
        ) : groups.length === 0 ? (
          <p className="text-[11px] text-dim text-center py-12">Sem entradas{search ? ' para essa pesquisa' : ''}.</p>
        ) : (
          <div className="divide-y-0">
            {groups.map((g, i) => <EntryGroup key={i} group={g} />)}
          </div>
        )}
      </div>
    </div>
  );
}
