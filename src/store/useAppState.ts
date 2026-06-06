import { useState, useCallback, useEffect } from 'react';
import type { AppState, Harness, HarnessNote } from '../types';
import { initialState } from '../data/mockData';
import * as api from '../api';
import type { DraftStatus } from '../api';

const STORAGE_KEY = 'ewis-planning-state';

function localLoad(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AppState;
  } catch { /* ignore */ }
  return initialState;
}

function localSave(s: AppState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function applyLocally<T extends { harnesses: AppState['harnesses'] }>(
  prev: T,
  harnessId: string,
  fn: (h: AppState['harnesses'][0]) => AppState['harnesses'][0],
): T {
  return { ...prev, harnesses: prev.harnesses.map((h) => h.id === harnessId ? fn(h) : h) };
}

export type BackendStatus = 'unknown' | 'online' | 'offline';

export function useAppState() {
  const [state, setState] = useState<AppState>(localLoad);
  const [draft, setDraft] = useState<DraftStatus>({ has_draft: false });
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('unknown');
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    api.getState()
      .then((s) => { setState(s); localSave(s); setBackendStatus('online'); })
      .catch(() => setBackendStatus('offline'));
    api.getDraftStatus().then(setDraft).catch(() => {});
  }, []);

  const refreshState = useCallback(() => {
    api.getState().then((s) => { setState(s); localSave(s); }).catch(() => {});
    api.getDraftStatus().then(setDraft).catch(() => {});
  }, []);

  // ── Direct UI actions ─────────────────────────────────────────────────────

  const advanceStage = useCallback(async (harnessId: string, reason: string) => {
    if (backendStatus === 'online') {
      const r = await api.directUpdate('advance_stage', { harness_id: harnessId, reason });
      if (r.ok && r.state) { setState(r.state); localSave(r.state); }
    } else {
      setState((prev) => {
        const next = applyLocally(prev, harnessId, (h) =>
          !h.blocked && h.stage < 7 ? { ...h, stage: h.stage + 1 } : h
        );
        localSave(next);
        return next;
      });
    }
  }, [backendStatus]);

  const regressStage = useCallback(async (harnessId: string, reason: string) => {
    if (backendStatus === 'online') {
      const r = await api.directUpdate('regress_stage', { harness_id: harnessId, reason });
      if (r.ok && r.state) { setState(r.state); localSave(r.state); }
    } else {
      setState((prev) => {
        const next = applyLocally(prev, harnessId, (h) =>
          !h.blocked && h.stage > 0 ? { ...h, stage: h.stage - 1 } : h
        );
        localSave(next);
        return next;
      });
    }
  }, [backendStatus]);

  const registerBlock = useCallback(async (harnessId: string, reason: string, responsible: string) => {
    if (backendStatus === 'online') {
      const r = await api.directUpdate('register_block', { harness_id: harnessId, reason, responsible });
      if (r.ok && r.state) { setState(r.state); localSave(r.state); }
    } else {
      setState((prev) => {
        const next = applyLocally(prev, harnessId, (h) => ({ ...h, blocked: true, blockReason: reason, responsible }));
        localSave(next);
        return next;
      });
    }
  }, [backendStatus]);

  const resolveBlock = useCallback(async (harnessId: string, note: string) => {
    if (backendStatus === 'online') {
      const r = await api.directUpdate('resolve_block', { harness_id: harnessId, note });
      if (r.ok && r.state) { setState(r.state); localSave(r.state); }
    } else {
      setState((prev) => {
        const next = applyLocally(prev, harnessId, (h) => ({
          ...h, blocked: false, blockReason: undefined,
          blockResolvedAt: new Date().toISOString().slice(0, 10),
          blockResolvedNote: note,
        }));
        localSave(next);
        return next;
      });
    }
  }, [backendStatus]);

  const addNote = useCallback(async (
    harnessId: string,
    author: string,
    text: string,
    attachments: HarnessNote['attachments'],
    opts?: { moveDirection?: HarnessNote['moveDirection']; stageAtTime?: number },
  ) => {
    const note: HarnessNote = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      author,
      text,
      attachments,
      ...opts,
    };

    if (backendStatus === 'online') {
      const r = await api.directUpdate('add_note', { harness_id: harnessId, note });
      if (r.ok && r.state) { setState(r.state); localSave(r.state); return; }
    }
    // offline fallback — keep notes inline AND bump noteCount
    setState((prev) => {
      const next = applyLocally(prev, harnessId, (h) => ({
        ...h,
        notes: [...(h.notes ?? []), note],
        noteCount: (h.noteCount ?? h.notes?.length ?? 0) + 1,
      }));
      localSave(next);
      return next;
    });
  }, [backendStatus]);

  const updateHarness = useCallback((harnessId: string, patch: Partial<Harness>) => {
    setState((prev) => {
      const next = applyLocally(prev, harnessId, (h) => ({ ...h, ...patch }));
      localSave(next);
      return next;
    });
  }, []);

  // ── Draft approval ────────────────────────────────────────────────────────

  const acceptDraft = useCallback(async (approvedBy: string) => {
    setAccepting(true);
    try {
      const r = await api.acceptDraft(approvedBy);
      if (r.ok && r.state) { setState(r.state); localSave(r.state); }
      setDraft({ has_draft: false });
    } finally {
      setAccepting(false);
    }
  }, []);

  const rejectDraft = useCallback(async (rejectedBy: string) => {
    await api.rejectDraft(rejectedBy);
    setDraft({ has_draft: false });
  }, []);

  const resetToMock = useCallback(() => {
    setState(initialState);
    localSave(initialState);
  }, []);

  return {
    state, draft, backendStatus, accepting,
    advanceStage, regressStage, registerBlock, resolveBlock, addNote, updateHarness,
    acceptDraft, rejectDraft,
    setDraft, refreshState, resetToMock,
  };
}
