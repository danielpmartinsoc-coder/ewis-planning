export type MilestoneStatus = 'done' | 'risk' | 'blocked' | 'open';
export type ECNStatus = 'aberto_sem_disposicao' | 'aberto_com_disposicao' | 'fechado';
export type Phase = 'F2' | 'F3' | 'F4' | 'F5' | 'F6';
export type ViewId = 'overview' | 'design' | 'pipeline' | 'radar' | 'heatmap' | 'inventory' | 'workorders' | 'procurement' | 'events' | 'connectors' | 'activitylog';

export const STAGES = [
  'BoM',
  'Procurement',
  'Stocking',
  'Kit/Cut/Mark',
  'Ready',
  'In Execution',
  'Done',
  'Delivered',
] as const;

export type Stage = typeof STAGES[number];

export interface HarnessNote {
  id: string;
  timestamp: string;   // ISO
  author: string;
  text: string;
  stageAtTime?: number;
  moveDirection?: 'advance' | 'back' | 'block' | 'resolve';
  attachments: { name: string; type: string; size: number; data: string }[];
}

export type ECNDisposition = 'Modificar' | 'Descartar' | 'Aceitar como está' | '';

export interface ECN {
  id: string;
  description: string;
  affectedHarnesses: string[];
  status: ECNStatus;
  raisedBy: string;
  raisedAt: string;
  approver?: string;
  approvedAt?: string;
  disposition?: ECNDisposition;
  dispositionNotes?: string;   // Descrição da modificação registada no CCB
}

export interface Harness {
  id: string;
  project: string;
  name: string;
  stage: number;
  blocked: boolean;
  blockReason?: string;
  blockResolvedAt?: string;
  blockResolvedNote?: string;
  responsible?: string;       // production operator
  designResponsible?: string; // design engineer
  revision: string;
  baseId?: string;      // set on REV B+ — points to the original REV A harness ID
  ecns: ECN[];
  noteCount: number;
  notes: HarnessNote[];
  // Schedule (time dimension)
  plannedStart?: string;  // ISO date
  plannedEnd?: string;    // ISO date
  actualStart?: string;   // ISO date
  actualEnd?: string;     // ISO date
  // Completion
  completed?: boolean;
  completedAt?: string;   // ISO date
  completedBy?: string;
  // Hours tracking
  stageHistory?: StageHistoryEntry[];
}

export interface StageHistoryEntry {
  stage: number;          // stage index when hours were logged
  hours: number;
  reason: string;
  date: string;           // ISO date
  operator: string;
}

export interface Milestone {
  project: string;
  phase: Phase;
  label: string;
  planned: string;
  actual: string | null;
  status: MilestoneStatus;
  responsibleId?: string;
  dueDate?:       string | null;
}

export interface Allocation {
  harnessId: string;
  projectId: string;
  weekISO: string;
  estimatedHours: number;
}

export interface Person {
  id: string;
  name: string;
  role: string;
  allocations: Allocation[];
}

export interface AppState {
  harnesses: Harness[];
  milestones: Milestone[];
  ecns: ECN[];
  people: Person[];
}

// ── Inventory ─────────────────────────────────────────────────────────────────

export interface InventoryItem {
  id: string;
  partNumber: string;
  description: string;
  category: string;
  quantity: number;
  reserved: number;
  unit: string;
  location: string;
  unitCost: number;
  leadTimeDays: number;
  supplier: string;
  minStock: number;
  procRef?: string;   // PR/PO number that sourced this item
}

export type BomAnalysisStatus = 'in_stock' | 'partial' | 'out_of_stock' | 'not_found';

export interface BomAnalysisResult {
  partNumber: string;
  description: string;
  required: number;
  available: number;
  reserved: number;
  status: BomAnalysisStatus;
  shortfall: number;
  unitCost: number;
  subtotal: number;
  leadTimeDays: number | null;
  location: string | null;
  supplier?: string;
}

export interface BomAnalysisSummary {
  totalItems: number;
  inStock: number;
  partial: number;
  outOfStock: number;
  notFound: number;
  totalCost: number;
  maxLeadDays: number;
}

// ── Work Orders ───────────────────────────────────────────────────────────────

export type WOStatus = 'draft' | 'issued' | 'in_progress' | 'complete' | 'cancelled';

export interface WOBomItem {
  partNumber: string;
  description: string;
  quantity: number;
  unit: string;
  unitCost: number;
  subtotal: number;
}

export interface WorkOrder {
  id: string;
  number: string;
  project: string;
  harnessId: string;
  description: string;
  createdBy: string;
  createdAt: string;
  status: WOStatus;
  bomItems: WOBomItem[];
  totalCost: number;
  notes: string;
  expectedHours: number;
  actualHours:   number;
  steps:         WOStep[];
}

// ── Procurement (PR/PO) ───────────────────────────────────────────────────────

export type ProcDocType   = 'PO' | 'PR' | 'Quote' | 'Invoice';
export type ProcDocStatus = 'pending' | 'partial' | 'complete' | 'cancelled';

export interface ProcLineItem {
  id: string;
  partNumber: string;
  description: string;
  qty: number;
  unit: string;
  unitCost?: number;
}

export interface ProcDocument {
  id: string;
  number: string;
  type: ProcDocType;
  description: string;
  supplier: string;
  project: string;
  createdAt: string;
  createdBy: string;
  status: ProcDocStatus;
  totalValue: number;
  currency: string;
  missingItems: string;
  notes: string;
  fileName: string;
  fileRef: string | null;
  fileType: string;
  // Requisition line fields (from PR import)
  qty?: number;
  unit?: string;
  unitCost?: number;
  requestedDate?: string;
  // Traceability (single-item legacy fields kept for imported PRs)
  partNumber?: string;
  // Multi-item line entries (new PRs created in-system)
  lineItems?: ProcLineItem[];
}

// ── AI Insights ───────────────────────────────────────────────────────────────

export interface AIInsight {
  type: 'info' | 'warning' | 'risk';
  title: string;
  detail: string;
  source: 'rule' | 'llm';
}

// ── Responsibles ──────────────────────────────────────────────────────────────
export interface Responsible {
  id: string;
  name: string;
  role: string;
  active: boolean;
}

// ── Phase Items (deliverables within design phases) ───────────────────────────
export type PhaseItemType   = 'diagram' | 'spec' | 'document' | 'checklist' | 'task' | 'other';
export type PhaseItemStatus = 'open' | 'in_progress' | 'review' | 'done' | 'blocked';

export interface PhaseItemEntry {
  id: string;
  body: string;
  author: string;
  createdAt: string;
  agreedBy?: string;
  entryStatus?: 'pending' | 'agreed' | 'rejected';
}

export type DelayEventType = 'Machine' | 'Tool' | 'Payment' | 'Material' | 'Contract' | 'Permit' | 'Other';

export interface DelayEvent {
  id: string;
  title: string;          // what was expected — e.g. "Crimping machine delivery"
  type: DelayEventType;
  expectedBy: string;     // ISO date — when it was supposed to arrive/resolve
  resolvedAt: string;     // ISO date — when it actually arrived/resolved
  description?: string;   // root cause, impact, notes
}

export interface PhaseItem {
  id: string;
  project: string;
  phase: string;
  title: string;
  itemType: PhaseItemType;
  status: PhaseItemStatus;
  responsibleId: string;
  dueDate: string | null;
  notes: PhaseItemEntry[];
  comments: PhaseItemEntry[];
  agreements: PhaseItemEntry[];
  createdAt: string;
}

// ── Mate & Demate Log ─────────────────────────────────────────────────────────

export type MDOperation  = 'mate' | 'demate';
export type MDTargetType = 'harness' | 'equipment';

export interface MateDemateEntry {
  id: string;
  targetType: MDTargetType;
  targetId: string;   // harnessId OR free-text equipment name
  fin: string;        // Functional Identification Name — e.g. "J1", "P23", "CN-PWR-A"
  partNumber: string; // optional part number for reference
  operation: MDOperation;
  date: string;       // ISO date
  operator: string;
  notes?: string | null;
}

// ── Work Order Steps (time tracking per stage) ────────────────────────────────
export type WOStepStatus = 'pending' | 'in_progress' | 'done' | 'skipped';

export interface WOStep {
  id: string;
  stageName: string;
  status: WOStepStatus;
  expectedHours: number;
  actualHours: number;
  completedBy: string;
  completedAt: string | null;
  notes: string;
}
