export type MilestoneStatus = 'done' | 'risk' | 'blocked' | 'open';
export type ECNStatus = 'pending' | 'approved' | 'rejected';
export type Phase = 'F2' | 'F3' | 'F4' | 'F5' | 'F6';
export type ViewId = 'overview' | 'design' | 'pipeline' | 'radar' | 'heatmap' | 'inventory' | 'workorders' | 'procurement';

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

export interface ECN {
  id: string;
  description: string;
  affectedHarnesses: string[];
  affectedBOMItems: string[];
  status: ECNStatus;
  raisedBy: string;
  raisedAt: string;
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
  responsible?: string;
  revision: string;
  ecns: ECN[];
  noteCount: number;
  notes: HarnessNote[];
  // Schedule (time dimension)
  plannedStart?: string;  // ISO date
  plannedEnd?: string;    // ISO date
  actualStart?: string;   // ISO date
  actualEnd?: string;     // ISO date
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
