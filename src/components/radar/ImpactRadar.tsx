import { useState } from 'react';
import type { ECN, ECNDisposition, ECNStatus, Harness } from '../../types';
import * as api from '../../api';

interface Props {
  ecns: ECN[];
  harnesses: Harness[];
  onStateChange?: () => void;
}

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_LABEL: Record<ECNStatus, string> = {
  aberto_sem_disposicao: 'Aberto',
  aberto_com_disposicao: 'Com Disposição',
  fechado:               'Fechado',
};

const STATUS_BG: Record<ECNStatus, string> = {
  aberto_sem_disposicao: 'bg-risk/10 border-risk/40 text-risk',
  aberto_com_disposicao: 'bg-accent/10 border-accent/40 text-accent',
  fechado:               'bg-border border-dim/30 text-dim',
};

const STATUS_BTN: Record<ECNStatus, string> = {
  aberto_sem_disposicao: 'bg-risk/10 border-risk/30 text-risk',
  aberto_com_disposicao: 'bg-accent/10 border-accent/30 text-accent',
  fechado:               'bg-surface2 border-border text-dim',
};

// Normalise legacy status values that may already be in the data
function normStatus(s: string): ECNStatus {
  if (s === 'pending')  return 'aberto_sem_disposicao';
  if (s === 'approved') return 'aberto_com_disposicao';
  if (s === 'rejected') return 'fechado';
  return (s as ECNStatus) ?? 'aberto_sem_disposicao';
}

const DISPOSITION_OPTIONS: ECNDisposition[] = ['Modificar', 'Descartar', 'Aceitar como está'];

// ── CCB Inline Form ───────────────────────────────────────────────────────────
function CCBForm({ ecnId, onSave, onClose }: {
  ecnId: string;
  onSave: () => void;
  onClose: () => void;
}) {
  const [name,        setName]        = useState('');
  const [notes,       setNotes]       = useState('');
  const [disposition, setDisposition] = useState<ECNDisposition>('');
  const [busy,        setBusy]        = useState(false);
  const [err,         setErr]         = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim())  { setErr('Nome do responsável obrigatório.'); return; }
    if (!disposition)  { setErr('Selecione uma disposição.'); return; }
    if (!notes.trim()) { setErr('Descrição da modificação obrigatória.'); return; }
    setBusy(true); setErr('');
    const today = new Date().toISOString().slice(0, 10);
    const res = await api.updateECN(ecnId, {
      approver:         name.trim(),
      approvedAt:       today,
      disposition,
      dispositionNotes: notes.trim(),
      status:           'aberto_com_disposicao',
    });
    setBusy(false);
    if (!res.ok) { setErr(res.error ?? 'Erro ao salvar.'); return; }
    onSave(); onClose();
  }

  return (
    <div className="border border-accent/30 bg-accent/5 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-accent uppercase tracking-wider">Registar Decisão CCB</span>
        <button onClick={onClose} className="text-dim hover:text-text text-lg leading-none">×</button>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div>
          <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Seu nome *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
            placeholder="Nome do responsável CCB"
            className="w-full px-3 py-1.5 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60" />
        </div>

        <div>
          <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Disposição *</label>
          <div className="flex gap-2">
            {DISPOSITION_OPTIONS.map((d) => (
              <button
                key={d} type="button"
                onClick={() => setDisposition(d)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all flex-1 ${
                  disposition === d
                    ? d === 'Modificar'          ? 'bg-accent/15 border-accent/40 text-accent'
                    : d === 'Descartar'          ? 'bg-blocked/15 border-blocked/40 text-blocked'
                    :                              'bg-ok/15 border-ok/40 text-ok'
                    : 'border-border text-dim hover:text-mid'
                }`}
              >
                {d === 'Modificar' ? '✏ ' : d === 'Descartar' ? '✕ ' : '✓ '}
                {d}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Descrição da modificação *</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            placeholder="Descreva a alteração a ser realizada, critério de aceitação ou motivo de descarte…"
            className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60 resize-none" />
        </div>

        {err && <p className="text-xs text-blocked">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-border text-xs text-dim hover:text-mid">
            Cancelar
          </button>
          <button type="submit" disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/80 disabled:opacity-50">
            {busy ? 'Salvando…' : 'Registar CCB'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── ECN Form modal (create + edit) ────────────────────────────────────────────
function ECNForm({ initial, harnesses, onSave, onClose }: {
  initial?: ECN;
  harnesses: Harness[];
  onSave: () => void;
  onClose: () => void;
}) {
  const initStatus = initial ? normStatus(initial.status) : 'aberto_sem_disposicao';
  const [desc,        setDesc]        = useState(initial?.description ?? '');
  const [status,      setStatus]      = useState<ECNStatus>(initStatus);
  const [raisedBy,    setRaisedBy]    = useState(initial?.raisedBy ?? '');
  const [raisedAt,    setRaisedAt]    = useState(initial?.raisedAt ?? new Date().toISOString().slice(0,10));
  const [approver,    setApprover]    = useState(initial?.approver ?? '');
  const [approvedAt,  setApprovedAt]  = useState(initial?.approvedAt ?? '');
  const [disposition, setDisposition] = useState<ECNDisposition>(initial?.disposition ?? '');
  const [dispNotes,   setDispNotes]   = useState(initial?.dispositionNotes ?? '');
  const [affH,        setAffH]        = useState<string[]>(initial?.affectedHarnesses ?? []);
  const [busy,        setBusy]        = useState(false);
  const [err,         setErr]         = useState('');

  function toggleHarness(id: string) {
    setAffH((prev) => prev.includes(id) ? prev.filter((h) => h !== id) : [...prev, id]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!desc.trim()) { setErr('Descrição obrigatória.'); return; }
    setBusy(true); setErr('');
    try {
      let res;
      if (initial) {
        res = await api.updateECN(initial.id, {
          description: desc, status, raisedBy, raisedAt,
          approver, approvedAt, disposition, dispositionNotes: dispNotes,
          affectedHarnesses: affH,
        });
      } else {
        res = await api.createECN({
          description: desc, status, raisedBy, raisedAt,
          approver, approvedAt, disposition, affectedHarnesses: affH,
        });
      }
      if (!res.ok) { setErr(res.error ?? 'Erro ao salvar'); return; }
      onSave(); onClose();
    } finally { setBusy(false); }
  }

  const statusOptions: ECNStatus[] = ['aberto_sem_disposicao', 'aberto_com_disposicao', 'fechado'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25" onClick={onClose}>
      <div className="w-[580px] max-h-[90vh] overflow-y-auto bg-surface rounded-2xl border border-border shadow-card-md p-6"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm text-text">{initial ? `Editar ${initial.id}` : 'Nova ECN'}</h3>
          <button onClick={onClose} className="text-dim hover:text-text text-lg">×</button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">

          <div>
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Descrição *</label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} required autoFocus
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60 resize-none" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Emitido por</label>
              <input value={raisedBy} onChange={(e) => setRaisedBy(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60" />
            </div>
            <div>
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Data de emissão</label>
              <input type="date" value={raisedAt} onChange={(e) => setRaisedAt(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60" />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Status</label>
            <div className="flex gap-2">
              {statusOptions.map((s) => (
                <button type="button" key={s} onClick={() => setStatus(s)}
                  className={`px-3 py-1 rounded-lg border text-[11px] font-mono font-bold transition-all flex-1 ${
                    status === s ? STATUS_BTN[s] : 'border-border text-dim hover:text-mid'
                  }`}>{STATUS_LABEL[s]}</button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Aprovador CCB</label>
              <input value={approver} onChange={(e) => setApprover(e.target.value)}
                placeholder="Nome do aprovador"
                className="w-full px-3 py-1.5 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60" />
            </div>
            <div>
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Data de aprovação</label>
              <input type="date" value={approvedAt} onChange={(e) => setApprovedAt(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60" />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Disposição</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDisposition('')}
                className={`px-3 py-1 rounded-lg border text-[11px] transition-all ${!disposition ? 'border-border bg-surface2 text-mid' : 'border-border text-dim hover:text-mid'}`}>
                — Nenhuma
              </button>
              {DISPOSITION_OPTIONS.map((d) => (
                <button type="button" key={d} onClick={() => setDisposition(d)}
                  className={`px-3 py-1 rounded-lg border text-[11px] transition-all ${
                    disposition === d ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border text-dim hover:text-mid'
                  }`}>{d}</button>
              ))}
            </div>
          </div>

          {disposition && (
            <div>
              <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-1">Notas CCB</label>
              <textarea value={dispNotes} onChange={(e) => setDispNotes(e.target.value)} rows={2}
                placeholder="Descrição da modificação / critério de aceitação…"
                className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text focus:outline-none focus:border-accent/60 resize-none" />
            </div>
          )}

          <div>
            <label className="text-[10px] font-mono text-dim uppercase tracking-wider block mb-2">Cablagens Afetadas</label>
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

          {err && <p className="text-xs text-blocked">{err}</p>}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm text-dim hover:text-mid">Cancelar</button>
            <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg bg-done/90 text-white text-sm font-semibold hover:bg-done disabled:opacity-50">
              {busy ? 'Salvando…' : initial ? 'Salvar' : 'Criar ECN'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── ECN Document view ─────────────────────────────────────────────────────────
function ECNDocument({ ecn, harnesses, onEdit, onDelete, onSaved }: {
  ecn: ECN;
  harnesses: Harness[];
  onEdit: () => void;
  onDelete: () => void;
  onSaved: () => void;
}) {
  const [showCCB, setShowCCB] = useState(false);
  const status = normStatus(ecn.status);
  const affectedHarnesses = harnesses.filter((h) => ecn.affectedHarnesses.includes(h.id));

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <span className="font-mono text-lg font-bold text-text">{ecn.id}</span>
          <span className={`px-2 py-1 rounded border text-[11px] font-semibold font-mono ${STATUS_BG[status]}`}>
            {STATUS_LABEL[status]}
          </span>
        </div>
        <div className="flex gap-2">
          {status !== 'fechado' && (
            <button
              onClick={() => setShowCCB((v) => !v)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                showCCB
                  ? 'bg-accent text-white border-accent'
                  : 'border-accent/40 text-accent hover:bg-accent/10'
              }`}
            >
              CCB
            </button>
          )}
          <button onClick={onEdit}
            className="px-3 py-1.5 rounded-lg border border-border text-xs text-dim hover:text-done hover:border-done/40 transition-colors">
            ✏ Editar
          </button>
          <button onClick={onDelete}
            className="px-3 py-1.5 rounded-lg border border-border text-xs text-dim hover:text-blocked hover:border-blocked/40 transition-colors">
            ✕ Excluir
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-5">

        {/* CCB Form — inline, below header */}
        {showCCB && (
          <CCBForm
            ecnId={ecn.id}
            onSave={() => { onSaved(); setShowCCB(false); }}
            onClose={() => setShowCCB(false)}
          />
        )}

        {/* Description */}
        <section>
          <h4 className="text-[10px] font-mono text-dim uppercase tracking-wider mb-1.5">Descrição</h4>
          <p className="text-sm text-text leading-relaxed bg-surface2 rounded-lg px-4 py-3 border border-border/50">
            {ecn.description}
          </p>
        </section>

        {/* Metadata */}
        <section className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Emitido por" value={ecn.raisedBy} />
          <Field label="Data de emissão" value={ecn.raisedAt} />
          <Field label="Aprovador CCB" value={ecn.approver} />
          <Field label="Data de aprovação" value={ecn.approvedAt} />
        </section>

        {/* Disposition */}
        {(ecn.disposition || ecn.dispositionNotes) && (
          <section className="rounded-xl border border-border/50 bg-surface2 p-4">
            <h4 className="text-[10px] font-mono text-dim uppercase tracking-wider mb-3">Disposição / CCB</h4>
            {ecn.disposition && (
              <div className="mb-2">
                <span className={`inline-block px-3 py-1 rounded-lg border text-xs font-semibold ${
                  ecn.disposition === 'Modificar'          ? 'bg-accent/10 border-accent/30 text-accent'
                  : ecn.disposition === 'Descartar'        ? 'bg-blocked/10 border-blocked/30 text-blocked'
                  : /* Aceitar como está */                  'bg-ok/10 border-ok/30 text-ok'
                }`}>
                  {ecn.disposition === 'Modificar' ? '✏ ' : ecn.disposition === 'Descartar' ? '✕ ' : '✓ '}
                  {ecn.disposition}
                </span>
              </div>
            )}
            {ecn.dispositionNotes && (
              <p className="text-sm text-text leading-relaxed">{ecn.dispositionNotes}</p>
            )}
          </section>
        )}

        <hr className="border-border/40" />

        {/* Affected harnesses */}
        <section>
          <h4 className="text-[10px] font-mono text-dim uppercase tracking-wider mb-2">
            Cablagens Afetadas
            <span className="ml-2 text-dim normal-case font-sans">({ecn.affectedHarnesses.length})</span>
          </h4>
          {affectedHarnesses.length === 0 ? (
            <p className="text-xs text-dim italic">Nenhuma cablagem associada.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {affectedHarnesses.map((h) => (
                <div key={h.id} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs ${
                  h.blocked
                    ? 'bg-blocked/10 border-blocked/30 text-blocked'
                    : 'bg-done/10 border-done/30 text-done'
                }`}>
                  <span className="font-mono font-bold">{h.id}</span>
                  {h.name !== h.id && <span className="text-[10px] text-mid">{h.name}</span>}
                  {h.blocked && <span className="text-[10px] font-semibold">🔴</span>}
                </div>
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-[10px] font-mono text-dim uppercase tracking-wider mb-0.5">{label}</dt>
      <dd className="text-sm text-text">{value || <span className="text-dim">—</span>}</dd>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function ImpactRadar({ ecns, harnesses, onStateChange }: Props) {
  const [selectedECN, setSelectedECN] = useState<ECN | null>(null);
  const [showForm,    setShowForm]    = useState(false);
  const [editTarget,  setEditTarget]  = useState<ECN | null>(null);

  async function handleDelete(ecn: ECN) {
    if (!confirm(`Excluir ${ecn.id}? Esta ação removerá a ECN de todas as cablagens afetadas.`)) return;
    const res = await api.deleteECN(ecn.id);
    if (!res.ok) { alert(res.error); return; }
    if (selectedECN?.id === ecn.id) setSelectedECN(null);
    onStateChange?.();
  }

  const currentECN = selectedECN ? ecns.find((e) => e.id === selectedECN.id) ?? null : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface shrink-0">
        <div>
          <h1 className="font-semibold text-text text-sm">Impact Radar — ECNs</h1>
          <p className="text-xs text-dim mt-0.5">Registo de Engenharia de Alteração de Configuração</p>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ECN List */}
        <div className="w-72 shrink-0 border-r border-border flex flex-col bg-surface">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
            <span className="text-xs text-dim font-semibold uppercase tracking-wider">ECNs ({ecns.length})</span>
            <button onClick={() => setShowForm(true)}
              className="px-2.5 py-1 rounded-lg bg-done/90 text-white text-[11px] font-semibold hover:bg-done transition-colors">
              + Nova ECN
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {ecns.length === 0 && (
              <p className="px-4 py-8 text-xs text-dim text-center">Nenhuma ECN criada. Crie uma para rastrear alterações de engenharia.</p>
            )}
            {ecns.map((ecn) => {
              const st = normStatus(ecn.status);
              return (
                <div key={ecn.id}
                  className={`border-b border-border/50 transition-colors ${
                    currentECN?.id === ecn.id ? 'bg-surface2' : 'hover:bg-surface2/60'
                  }`}>
                  <button
                    onClick={() => setSelectedECN(ecn === currentECN ? null : ecn)}
                    className="w-full text-left px-4 py-3"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs font-semibold text-text">{ecn.id}</span>
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold font-mono ${STATUS_BG[st]}`}>
                        {STATUS_LABEL[st]}
                      </span>
                    </div>
                    <p className="text-xs text-mid line-clamp-2">{ecn.description}</p>
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-dim">
                      <span>{ecn.affectedHarnesses.length} cablagem{ecn.affectedHarnesses.length !== 1 ? 's' : ''}</span>
                      {ecn.disposition && (
                        <span className={`font-semibold ${
                          ecn.disposition === 'Modificar' ? 'text-accent'
                          : ecn.disposition === 'Descartar' ? 'text-blocked'
                          : 'text-ok'
                        }`}>{ecn.disposition}</span>
                      )}
                      <span className="ml-auto">{ecn.raisedAt}</span>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* ECN Document panel */}
        <div className="flex-1 overflow-hidden flex flex-col bg-bg">
          {!currentECN ? (
            <div className="flex-1 flex items-center justify-center text-dim text-sm">
              Selecione uma ECN para ver o documento completo
            </div>
          ) : (
            <ECNDocument
              ecn={currentECN}
              harnesses={harnesses}
              onEdit={() => setEditTarget(currentECN)}
              onDelete={() => handleDelete(currentECN)}
              onSaved={() => onStateChange?.()}
            />
          )}
        </div>
      </div>

      {showForm && (
        <ECNForm harnesses={harnesses} onSave={() => onStateChange?.()} onClose={() => setShowForm(false)} />
      )}
      {editTarget && (
        <ECNForm
          initial={editTarget}
          harnesses={harnesses}
          onSave={() => { onStateChange?.(); setSelectedECN(null); }}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  );
}
