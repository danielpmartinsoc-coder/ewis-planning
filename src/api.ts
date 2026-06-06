import type { AppState, InventoryItem, WorkOrder, BomAnalysisResult, BomAnalysisSummary, AIInsight } from './types';

const BASE = '/api';

async function _post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json() as Promise<T>;
}

async function _get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  return r.json() as Promise<T>;
}

async function _delete<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  return r.json() as Promise<T>;
}

async function _put<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json() as Promise<T>;
}

export interface DraftStatus {
  has_draft: boolean;
  draft_id?: string;
  started_at?: string;
  requested_by?: string;
  message?: string;
  change_count?: number;
  changes?: ChangeEntry[];
}

export interface ChangeEntry {
  op: string;
  harness_id?: string;
  project?: string;
  phase?: string;
  from?: string;
  to?: string;
  reason?: string;
  status?: string;
  ecn_id?: string;
}

export interface AgentRunResult {
  ok: boolean;
  final_text: string;
  tool_trace: ToolCall[];
  stop_reason: string;
  draft_status: DraftStatus;
}

export interface ToolCall {
  iteration: number;
  name: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
}

export interface AIStatus {
  ok: boolean;
  provider: string;
  base_url: string;
  model: string;
  has_key: boolean;
}

export async function getState(): Promise<AppState> {
  return _get<AppState>('/state');
}

export async function getHarness(id: string): Promise<import('./types').Harness> {
  return _get(`/harness/${encodeURIComponent(id)}`);
}

export async function directUpdate(
  action: string,
  payload: Record<string, unknown>,
  by = 'ui_direct',
): Promise<{ ok: boolean; state?: AppState; error?: string }> {
  return _post('/state/update', { action, payload, by });
}

export async function runAgent(
  messages: { role: string; content: string }[],
  requestedBy: string,
  context?: Record<string, unknown>,
): Promise<AgentRunResult> {
  return _post('/agent/run', { messages, requested_by: requestedBy, context });
}

export async function getDraftStatus(): Promise<DraftStatus> {
  return _get<DraftStatus>('/draft/status');
}

export async function acceptDraft(approvedBy: string): Promise<{ ok: boolean; state?: AppState }> {
  return _post('/draft/accept', { approved_by: approvedBy });
}

export async function rejectDraft(rejectedBy: string): Promise<{ ok: boolean }> {
  return _post('/draft/reject', { rejected_by: rejectedBy });
}

export async function getLog(limit = 50): Promise<unknown[]> {
  return _get(`/log?limit=${limit}`);
}

export async function getAIStatus(): Promise<AIStatus> {
  return _get<AIStatus>('/ai/status');
}

export async function saveAIConfig(
  cfg: Partial<{ provider: string; base_url: string; model: string; api_key: string; temperature: number }>
): Promise<{ ok: boolean }> {
  return _post('/ai/config', cfg);
}

export async function pingAI(): Promise<{ ok: boolean; reply?: string; error?: string; latency_ms?: number }> {
  return _get('/ai/ping');
}

export async function getAIModels(): Promise<{ ok: boolean; models: string[]; source?: string; error?: string }> {
  return _get('/ai/models');
}

// ── Projects / Harnesses ─────────────────────────────────────────────────────

export async function renameProject(
  oldName: string, newName: string, by: string
): Promise<{ ok: boolean; state?: AppState; error?: string }> {
  return _put(`/projects/${encodeURIComponent(oldName)}`, { name: newName, by });
}

export async function deleteProject(
  name: string
): Promise<{ ok: boolean; state?: AppState; error?: string }> {
  return _delete(`/projects/${encodeURIComponent(name)}`);
}

export async function updateHarness(
  id: string, updates: {
    name?: string; responsible?: string; revision?: string;
    plannedStart?: string; plannedEnd?: string;
    actualStart?: string;  actualEnd?: string;
  }
): Promise<{ ok: boolean; state?: AppState; error?: string }> {
  return _put(`/harnesses/${encodeURIComponent(id)}`, updates);
}

export async function createProject(
  name: string, plannedStart: string, by: string
): Promise<{ ok: boolean; state?: AppState; error?: string }> {
  return _post('/projects', { name, plannedStart, by });
}

export async function createHarness(
  project: string, id: string, name: string, responsible: string, by: string
): Promise<{ ok: boolean; state?: AppState; error?: string }> {
  return _post('/harnesses', { project, id, name, responsible, by });
}

export async function deleteHarness(
  harnessId: string
): Promise<{ ok: boolean; state?: AppState; error?: string }> {
  return _delete(`/harnesses/${encodeURIComponent(harnessId)}`);
}

export async function upsertMilestone(
  data: { project: string; phase: string; label: string; planned: string; status: string; actual?: string | null }
): Promise<{ ok: boolean; state?: AppState; error?: string }> {
  return _post('/milestones', data);
}

export async function deleteMilestone(
  project: string, phase: string
): Promise<{ ok: boolean; state?: AppState; error?: string }> {
  return _delete(`/milestones/${encodeURIComponent(project)}/${encodeURIComponent(phase)}`);
}

// ── Design notes ─────────────────────────────────────────────────────────────

export interface DesignNote {
  id: string;
  type: 'note' | 'comment' | 'agreement';
  author: string;
  text: string;
  timestamp: string;
  status: string; // '' | 'approved' | 'rejected' | 'pending'
}

export async function getDesignNotes(project: string, phase: string): Promise<{ notes: DesignNote[] }> {
  return _get(`/design-notes/${encodeURIComponent(project)}/${encodeURIComponent(phase)}`);
}

export async function addDesignNote(
  project: string, phase: string,
  data: { type: string; author: string; text: string; status?: string; timestamp?: string }
): Promise<{ ok: boolean; note?: DesignNote; error?: string }> {
  return _post(`/design-notes/${encodeURIComponent(project)}/${encodeURIComponent(phase)}`, data);
}

export async function deleteDesignNote(project: string, phase: string, noteId: string): Promise<{ ok: boolean }> {
  return _delete(`/design-notes/${encodeURIComponent(project)}/${encodeURIComponent(phase)}/${noteId}`);
}

export async function updateDesignNote(
  project: string, phase: string, noteId: string,
  updates: { text?: string; status?: string }
): Promise<{ ok: boolean; note?: DesignNote }> {
  return _put(`/design-notes/${encodeURIComponent(project)}/${encodeURIComponent(phase)}/${noteId}`, updates);
}

// ── ECN CRUD ──────────────────────────────────────────────────────────────────

export async function createECN(data: {
  description: string; affectedHarnesses: string[]; affectedBOMItems: string[];
  status: string; raisedBy: string; raisedAt: string;
}): Promise<{ ok: boolean; state?: AppState; error?: string }> {
  return _post('/ecns', data);
}

export async function updateECN(
  id: string,
  updates: { description?: string; status?: string; affectedHarnesses?: string[]; affectedBOMItems?: string[]; raisedBy?: string; raisedAt?: string }
): Promise<{ ok: boolean; state?: AppState; error?: string }> {
  return _put(`/ecns/${encodeURIComponent(id)}`, updates);
}

export async function deleteECN(id: string): Promise<{ ok: boolean; state?: AppState; error?: string }> {
  return _delete(`/ecns/${encodeURIComponent(id)}`);
}

// ── Inventory ─────────────────────────────────────────────────────────────────

export async function getInventory(): Promise<{ items: InventoryItem[] }> {
  return _get('/inventory');
}

export async function createInventoryItem(
  item: Omit<InventoryItem, 'id'>
): Promise<{ ok: boolean; item?: InventoryItem; error?: string }> {
  return _post('/inventory', item);
}

export async function updateInventoryItem(
  id: string, updates: Partial<InventoryItem>
): Promise<{ ok: boolean; item?: InventoryItem; error?: string }> {
  return _put(`/inventory/${id}`, updates);
}

export async function deleteInventoryItem(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  return _delete(`/inventory/${id}`);
}

export async function runBomAnalysis(
  items: { partNumber: string; quantity: number; unit?: string; description?: string }[]
): Promise<{ ok: boolean; results: BomAnalysisResult[]; summary: BomAnalysisSummary; error?: string }> {
  return _post('/inventory/bom-analysis', { items });
}

// ── Work Orders ───────────────────────────────────────────────────────────────

export async function getWorkOrders(): Promise<{ orders: WorkOrder[] }> {
  return _get('/work-orders');
}

export async function createWorkOrder(
  wo: Omit<WorkOrder, 'id' | 'createdAt' | 'status'>
): Promise<{ ok: boolean; workOrder?: WorkOrder; error?: string }> {
  return _post('/work-orders', wo);
}

export async function updateWorkOrder(
  id: string, updates: Partial<WorkOrder>
): Promise<{ ok: boolean; workOrder?: WorkOrder; error?: string }> {
  return _put(`/work-orders/${id}`, updates);
}

export async function deleteWorkOrder(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  return _delete(`/work-orders/${id}`);
}

// ── Inventory import / export ─────────────────────────────────────────────────

export async function importInventory(
  rows: Record<string, unknown>[],
  mode: 'append' | 'replace' = 'append'
): Promise<{ ok: boolean; added: number; updated: number; skipped: number; total: number; error?: string }> {
  return _post('/inventory/import', { rows, mode });
}

export async function exportInventory(): Promise<{ ok: boolean; items: InventoryItem[] }> {
  return _get('/inventory/export');
}

// ── Procurement ───────────────────────────────────────────────────────────────

export async function getProcurement(): Promise<{ orders: import('./types').ProcDocument[] }> {
  return _get('/procurement');
}

export async function createProcDocument(data: {
  number: string; type: string; description: string; supplier: string; project: string;
  totalValue: number; currency: string; notes: string;
  fileName?: string; fileData?: string; fileType?: string; createdBy?: string;
}): Promise<{ ok: boolean; document?: import('./types').ProcDocument; error?: string }> {
  return _post('/procurement', data);
}

export async function updateProcDocument(
  id: string,
  updates: { status?: string; description?: string; supplier?: string; project?: string;
             totalValue?: number; currency?: string; missingItems?: string; notes?: string; type?: string }
): Promise<{ ok: boolean; document?: import('./types').ProcDocument; error?: string }> {
  return _put(`/procurement/${id}`, updates);
}

export async function deleteProcDocument(id: string): Promise<{ ok: boolean; error?: string }> {
  return _delete(`/procurement/${id}`);
}

// ── AI Insights ───────────────────────────────────────────────────────────────

export async function getAIInsights(): Promise<{ ok: boolean; insights: AIInsight[]; generatedAt: string }> {
  return _get('/ai/insights');
}

// ── Responsibles ─────────────────────────────────────────────────────────────

export async function getResponsibles(): Promise<{ responsibles: import('./types').Responsible[] }> {
  return _get('/responsibles');
}

export async function createResponsible(
  data: { name: string; role: string }
): Promise<{ ok: boolean; id?: string; error?: string }> {
  return _post('/responsibles', data);
}

export async function updateResponsible(
  id: string, updates: Partial<{ name: string; role: string; active: boolean }>
): Promise<{ ok: boolean }> {
  return _put(`/responsibles/${id}`, updates);
}

export async function deleteResponsible(id: string): Promise<{ ok: boolean }> {
  return _delete(`/responsibles/${id}`);
}

// ── Phase Items ───────────────────────────────────────────────────────────────

export async function getPhaseItems(
  project: string, phase: string
): Promise<{ items: import('./types').PhaseItem[] }> {
  return _get(`/phase-items/${encodeURIComponent(project)}/${encodeURIComponent(phase)}`);
}

export async function createPhaseItem(
  project: string, phase: string,
  data: { title: string; itemType: string; responsibleId: string; dueDate?: string | null }
): Promise<{ ok: boolean; item?: import('./types').PhaseItem; error?: string }> {
  return _post(`/phase-items/${encodeURIComponent(project)}/${encodeURIComponent(phase)}`, data);
}

export async function updatePhaseItem(
  id: string,
  updates: Partial<{ title: string; itemType: string; status: string; responsibleId: string; dueDate: string | null }>
): Promise<{ ok: boolean }> {
  return _put(`/phase-items/${id}`, updates);
}

export async function deletePhaseItem(id: string): Promise<{ ok: boolean }> {
  return _delete(`/phase-items/${id}`);
}

export async function addPhaseItemEntry(
  itemId: string,
  entryType: 'notes' | 'comments' | 'agreements',
  data: { body: string; author: string; agreedBy?: string; entryStatus?: string }
): Promise<{ ok: boolean; entry?: import('./types').PhaseItemEntry }> {
  return _post(`/phase-items/${itemId}/${entryType}`, data);
}

export async function deletePhaseItemEntry(
  itemId: string,
  entryType: 'notes' | 'comments' | 'agreements',
  entryId: string
): Promise<{ ok: boolean }> {
  return _delete(`/phase-items/${itemId}/${entryType}/${entryId}`);
}

// ── WO Step completion ────────────────────────────────────────────────────────

export async function completeWOStep(
  woId: string, stepId: string,
  data: { actualHours: number; completedBy: string; notes?: string }
): Promise<{ ok: boolean; actualHours?: number; woStatus?: string; error?: string }> {
  return _post(`/work-orders/${woId}/steps/${stepId}/complete`, data);
}
