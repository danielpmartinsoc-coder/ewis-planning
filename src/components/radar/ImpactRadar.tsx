import { useState, useMemo } from 'react';
import type { ECN, ECNStatus, Harness } from '../../types';
import * as api from '../../api';

interface Props {
  ecns: ECN[];
  harnesses: Harness[];
  onStateChange?: () => void;
}

// ── ECN Form modal (create + edit) ────────────────────────────────────────────
function ECNForm({ initial, harnesses, onSave, onClose }: {
  initial?: ECN;
  harnesses: Harness[];
  onSave: () => void;
  onClose: () => void;
}) {
  const [desc,     setDesc]     = useState(initial?.description ?? '');
  const [status,   setStatus]   = useState<ECNStatus>(initial?.status ?? 'pending');
  const [raisedBy, setRaisedBy] = useState(initial?.raisedBy ?? '');
  const [raisedAt, setRaisedAt] = useState(initial?.raisedAt ?? new Date().toISOString().slice(0,10));
  const [affH,     setAffH]     = useState<string[]>(initial?.affectedHarnesses ?? []);
  const [bomText,  setBomText]  = useState((initial?.affectedBOMItems ?? []).join('\n'));
  const [busy,     setBusy]     = useState(false);
  const [err,      setErr]      = useState('');

  function toggleHarness(id: string) {
    setAffH((prev) => prev.includes(id) ? prev.filter((h) => h !== id) : [...prev, id]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!desc.trim()) { setErr('Description required.'); return; }
    setBusy(true); setErr('');
    const bomItems = bomText.split('\n').map((s) => s.trim()).filter(Boolean);
    try {
      let res;
      if (initial) {
        res = await api.updateECN(initial.id, { description: desc, status, raisedBy, raisedAt, affectedHarnesses: affH, affectedBOMItems: bomItems });
      } else {
        res = await api.createECN({ description: desc, status, raisedBy, raisedAt, affectedHarnesses: affH, affectedBOMItems: bomItems });
      }
      if (!res.ok) { setErr(res.error ?? 'Failed'); return; }
      onSave(); onClose();
    } finally { setBusy(false); }
  }

  const statusOptions: ECNStatus[] = ['pending', 'approved', 'rejected'];
  const STATUS_BTN: Record<ECNStatus, string> = {
    pending:  'bg-risk/10 border-risk/30 text-risk',
    approved: 'bg-ok/10 border-ok/30 text-ok',
    rejected: 'bg-surface2 border-border text-dim',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25" onClick={onClose}>
      <div className="w-[560px] max-h-[90vh] overflow-y-auto bg-surface rounded-2xl border border-border shadow-card-md p-6"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm text-text">{initial ? `Edit ${initial.id}` : 'New ECN'}</h3>
          <button onClick={onClose} className="text-dim hover:text-text text-lg">×</button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Description *</label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} required autoFocus
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60 resize-none" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Raised by</label>
              <input value={raisedBy} onChange={(e) => setRaisedBy(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60" />
            </div>
            <div>
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Date</label>
              <input type="date" value={raisedAt} onChange={(e) => setRaisedAt(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60" />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Status</label>
            <div className="flex gap-2">
              {statusOptions.map((s) => (
                <button type="button" key={s} onClick={() => setStatus(s)}
                  className={`px-3 py-1 rounded-lg border text-[11px] font-mono font-bold transition-all ${
                    status === s ? STATUS_BTN[s] : 'border-border text-dim hover:text-mid'
                  }`}>{s.toUpperCase()}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-2">Affected Harnesses</label>
            <div className="grid grid-cols-3 gap-1.5 max-h-36 overflow-y-auto pr-1">
              {harnesses.map((h) => (
                <label key={h.id} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border cursor-pointer text-[11px] transition-all ${
                  affH.includes(h.id) ? 'bg-done/10 border-done/30 text-done' : 'border-border text-dim hover:text-mid hover:border-mid/30'
                }`}>
                  <input type="checkbox" className="hidden" checked={affH.includes(h.id)} onChange={() => toggleHarness(h.id)} />
                  <span className="font-mono font-bold">{h.id}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Affected BOM Items (one per line)</label>
            <textarea value={bomText} onChange={(e) => setBomText(e.target.value)} rows={3}
              placeholder="CONN-D38999-24P&#10;WIRE-AWG18-RED"
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm font-mono text-text focus:outline-none focus:border-accent/60 resize-none" />
          </div>

          {err && <p className="text-xs text-blocked">{err}</p>}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm text-dim hover:text-mid">Cancel</button>
            <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg bg-done/90 text-white text-sm font-semibold hover:bg-done disabled:opacity-50">
              {busy ? 'Saving…' : initial ? 'Save Changes' : 'Create ECN'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  pending:  '#F5A623',
  approved: '#00C896',
  rejected: '#5A6080',
};

const STATUS_BG: Record<string, string> = {
  pending:  'bg-risk/10 border-risk/40 text-risk',
  approved: 'bg-ok/10 border-ok/40 text-ok',
  rejected: 'bg-border border-dim/30 text-dim',
};

interface Node {
  id: string;
  label: string;
  type: 'ecn' | 'harness' | 'bom';
  x: number;
  y: number;
  color: string;
}

interface Edge {
  from: string;
  to: string;
}

export function ImpactRadar({ ecns, harnesses, onStateChange }: Props) {
  const [selectedECN, setSelectedECN] = useState<ECN | null>(null);
  const [showForm,    setShowForm]    = useState(false);
  const [editTarget,  setEditTarget]  = useState<ECN | null>(null);

  async function handleDelete(ecn: ECN) {
    if (!confirm(`Delete ${ecn.id}? This will remove it from all affected harnesses.`)) return;
    const res = await api.deleteECN(ecn.id);
    if (!res.ok) { alert(res.error); return; }
    if (selectedECN?.id === ecn.id) setSelectedECN(null);
    onStateChange?.();
  }

  const graph = useMemo(() => {
    if (!selectedECN) return { nodes: [], edges: [] };

    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const ecnColor = STATUS_COLORS[selectedECN.status] ?? '#4A7CFF';

    // Central ECN node
    nodes.push({ id: selectedECN.id, label: selectedECN.id, type: 'ecn', x: 0, y: 0, color: ecnColor });

    // Affected harnesses
    const harnessAngles = (2 * Math.PI) / Math.max(selectedECN.affectedHarnesses.length, 1);
    selectedECN.affectedHarnesses.forEach((hid, i) => {
      const angle = i * harnessAngles - Math.PI / 2;
      const r = 160;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      const harness = harnesses.find((h) => h.id === hid);
      nodes.push({
        id: hid,
        label: hid,
        type: 'harness',
        x,
        y,
        color: harness?.blocked ? '#E5383B' : '#4A7CFF',
      });
      edges.push({ from: selectedECN.id, to: hid });

      // BOM items linked to this harness via this ECN
      selectedECN.affectedBOMItems.forEach((bom, bi) => {
        const bomId = `${hid}-${bom}`;
        const bomAngle = angle + (bi - (selectedECN.affectedBOMItems.length - 1) / 2) * 0.4;
        const bomR = 290;
        nodes.push({
          id: bomId,
          label: bom,
          type: 'bom',
          x: Math.cos(bomAngle) * bomR,
          y: Math.sin(bomAngle) * bomR,
          color: '#8A90A8',
        });
        edges.push({ from: hid, to: bomId });
      });
    });

    return { nodes, edges };
  }, [selectedECN, harnesses]);

  const SVG_W = 700;
  const SVG_H = 500;
  const CX = SVG_W / 2;
  const CY = SVG_H / 2;

  function nodeX(n: Node) { return CX + n.x; }
  function nodeY(n: Node) { return CY + n.y; }

  function nodeRadius(n: Node) {
    if (n.type === 'ecn') return 30;
    if (n.type === 'harness') return 22;
    return 14;
  }

  function getNode(id: string) {
    return graph.nodes.find((n) => n.id === id);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface shrink-0">
        <div>
          <h1 className="font-semibold text-text text-sm">Impact Radar</h1>
          <p className="text-xs text-dim mt-0.5">Select an ECN to see its propagation graph</p>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ECN List */}
        <div className="w-72 shrink-0 border-r border-border flex flex-col bg-surface">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
            <span className="text-xs text-dim font-semibold uppercase tracking-wider">ECNs</span>
            <button onClick={() => setShowForm(true)}
              className="px-2.5 py-1 rounded-lg bg-done/90 text-white text-[11px] font-semibold hover:bg-done transition-colors">
              + New ECN
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {ecns.length === 0 && (
              <p className="px-4 py-8 text-xs text-dim text-center">No ECNs yet. Create one to track engineering changes.</p>
            )}
            {ecns.map((ecn) => (
              <div key={ecn.id}
                className={`border-b border-border/50 transition-colors group/ecn ${
                  selectedECN?.id === ecn.id ? 'bg-surface2' : 'hover:bg-surface2/60'
                }`}>
                <button
                  onClick={() => setSelectedECN(ecn === selectedECN ? null : ecn)}
                  className="w-full text-left px-4 py-3"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-xs font-semibold text-text">{ecn.id}</span>
                    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold font-mono ${STATUS_BG[ecn.status]}`}>
                      {ecn.status.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs text-mid line-clamp-2">{ecn.description}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-[10px] text-dim">
                    <span>{ecn.affectedHarnesses.length} harness{ecn.affectedHarnesses.length !== 1 ? 'es' : ''}</span>
                    <span>{ecn.affectedBOMItems.length} BoM</span>
                    <span className="ml-auto">{ecn.raisedAt}</span>
                  </div>
                </button>
                {/* Edit / Delete — visible on hover */}
                <div className="flex gap-1 px-4 pb-2 opacity-0 group-hover/ecn:opacity-100 transition-opacity">
                  <button onClick={() => setEditTarget(ecn)}
                    className="px-2 py-0.5 rounded border border-border text-[10px] text-dim hover:text-done hover:border-done/40 transition-colors">✏ Edit</button>
                  <button onClick={() => handleDelete(ecn)}
                    className="px-2 py-0.5 rounded border border-border text-[10px] text-dim hover:text-blocked hover:border-blocked/40 transition-colors">✕ Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Graph area */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {!selectedECN ? (
            <div className="flex-1 flex items-center justify-center text-dim text-sm">
              Select an ECN from the list to visualize impact propagation
            </div>
          ) : (
            <>
              <div className="px-5 py-3 border-b border-border bg-surface/60 shrink-0">
                <div className="flex items-start gap-3">
                  <div>
                    <span className="font-mono text-xs font-semibold text-mid">{selectedECN.id}</span>
                    <span className={`ml-2 px-1.5 py-0.5 rounded border text-[10px] font-semibold font-mono ${STATUS_BG[selectedECN.status]}`}>
                      {selectedECN.status.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-sm text-text flex-1">{selectedECN.description}</p>
                </div>
                <div className="flex items-center gap-4 mt-2 text-xs text-dim">
                  <span>Raised by <span className="text-mid">{selectedECN.raisedBy}</span></span>
                  <span>on <span className="text-mid">{selectedECN.raisedAt}</span></span>
                </div>
              </div>

              <div className="flex-1 overflow-hidden flex items-center justify-center p-4">
                <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full h-full max-w-2xl" style={{ maxHeight: 460 }}>
                  <defs>
                    <filter id="glow">
                      <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                      <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                  </defs>

                  {/* Edges */}
                  {graph.edges.map((edge, i) => {
                    const a = getNode(edge.from);
                    const b = getNode(edge.to);
                    if (!a || !b) return null;
                    return (
                      <line
                        key={i}
                        x1={nodeX(a)} y1={nodeY(a)}
                        x2={nodeX(b)} y2={nodeY(b)}
                        stroke="#252A38"
                        strokeWidth="1.5"
                        strokeDasharray={b.type === 'bom' ? '4 3' : '0'}
                      />
                    );
                  })}

                  {/* Nodes */}
                  {graph.nodes.map((node) => {
                    const r = nodeRadius(node);
                    const nx = nodeX(node);
                    const ny = nodeY(node);
                    const harness = node.type === 'harness' ? harnesses.find((h) => h.id === node.id) : null;
                    return (
                      <g key={node.id}>
                        <circle
                          cx={nx} cy={ny} r={r}
                          fill={`${node.color}22`}
                          stroke={node.color}
                          strokeWidth={node.type === 'ecn' ? 2 : 1.5}
                          filter={node.type === 'ecn' ? 'url(#glow)' : undefined}
                        />
                        {node.type === 'harness' && harness?.blocked && (
                          <circle cx={nx + r - 4} cy={ny - r + 4} r={5} fill="#E5383B" />
                        )}
                        <text
                          x={nx} y={ny}
                          textAnchor="middle" dominantBaseline="middle"
                          fill={node.color}
                          fontSize={node.type === 'ecn' ? 11 : node.type === 'harness' ? 9 : 8}
                          fontFamily="JetBrains Mono, monospace"
                          fontWeight="600"
                        >
                          {node.label.length > 12 ? node.label.slice(0, 10) + '…' : node.label}
                        </text>
                        {node.type === 'harness' && harness && (
                          <text
                            x={nx} y={ny + r + 10}
                            textAnchor="middle"
                            fill="#5A6080"
                            fontSize={8}
                            fontFamily="DM Sans, sans-serif"
                          >
                            {harness.name.length > 18 ? harness.name.slice(0, 16) + '…' : harness.name}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* Legend */}
              <div className="shrink-0 flex items-center gap-4 px-5 py-2 border-t border-border text-xs text-dim bg-surface">
                <GraphLegend color="#4A7CFF" label="Harness" />
                <GraphLegend color="#E5383B" label="Harness (blocked)" />
                <GraphLegend color="#8A90A8" label="BoM item" dashed />
                <span className="ml-auto text-[10px]">Red dot = currently blocked · Dashed = BoM link</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ECN create/edit modals */}
      {showForm && (
        <ECNForm harnesses={harnesses} onSave={() => onStateChange?.()} onClose={() => setShowForm(false)} />
      )}
      {editTarget && (
        <ECNForm initial={editTarget} harnesses={harnesses} onSave={() => { onStateChange?.(); setSelectedECN(null); }} onClose={() => setEditTarget(null)} />
      )}
    </div>
  );
}

function GraphLegend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <svg width="20" height="10">
        <line x1="0" y1="5" x2="20" y2="5" stroke={color} strokeWidth="1.5" strokeDasharray={dashed ? '4 3' : '0'} />
      </svg>
      <span>{label}</span>
    </div>
  );
}
