import { useState, useRef, useEffect } from 'react';
import type { Harness, HarnessNote } from '../../types';
import * as api from '../../api';

interface Props {
  harness: Harness;
  currentUser: string;
  onAddNote: (harnessId: string, author: string, text: string, attachments: HarnessNote['attachments']) => void;
  onClose: () => void;
}

const MOVE_LABEL: Record<string, string> = {
  advance: '→ Stage advanced',
  back:    '← Stage moved back',
  block:   '■ Block registered',
  resolve: '✓ Block resolved',
};

function formatTs(ts: string) {
  try {
    const d = new Date(ts);
    return d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return ts;
  }
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB per file

export function HarnessNotes({ harness, currentUser, onAddNote, onClose }: Props) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<HarnessNote['attachments']>([]);
  const [fileError, setFileError] = useState('');
  const [loadedNotes, setLoadedNotes] = useState<HarnessNote[]>(harness.notes ?? []);
  const [notesLoading, setNotesLoading] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  // Lazy-load the full notes list from the per-harness endpoint
  useEffect(() => {
    setNotesLoading(true);
    api.getHarness(harness.id)
      .then((full) => setLoadedNotes(full.notes ?? []))
      .catch(() => setLoadedNotes(harness.notes ?? []))
      .finally(() => setNotesLoading(false));
  }, [harness.id]);

  const notes = [...loadedNotes].reverse();

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError('');
    const files = Array.from(e.target.files ?? []);
    const readers = files.map((file) => {
      if (file.size > MAX_FILE_BYTES) {
        setFileError(`${file.name} exceeds 2 MB limit`);
        return Promise.resolve(null);
      }
      return new Promise<HarnessNote['attachments'][0] | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const data = (reader.result as string).split(',')[1] ?? '';
          resolve({ name: file.name, type: file.type, size: file.size, data });
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
    });
    Promise.all(readers).then((results) => {
      const valid = results.filter((r): r is HarnessNote['attachments'][0] => r !== null);
      setAttachments((prev) => [...prev, ...valid]);
    });
    // reset input so same file can be re-added
    e.target.value = '';
  }

  function removeAttachment(name: string) {
    setAttachments((prev) => prev.filter((a) => a.name !== name));
  }

  function downloadAttachment(att: HarnessNote['attachments'][0]) {
    const a = document.createElement('a');
    a.href = `data:${att.type};base64,${att.data}`;
    a.download = att.name;
    a.click();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() && !attachments.length) return;
    // optimistic local append so the new note shows immediately
    const optimistic: HarnessNote = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      author: currentUser,
      text: text.trim(),
      attachments,
    };
    setLoadedNotes((prev) => [...prev, optimistic]);
    onAddNote(harness.id, currentUser, text.trim(), attachments);
    setText('');
    setAttachments([]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[520px] max-h-[80vh] flex flex-col bg-surface border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-dim">{harness.id}</span>
              <span className="font-semibold text-text text-sm">{harness.name}</span>
            </div>
            <p className="text-xs text-dim mt-0.5">
              Notes & Attachments · {loadedNotes.length} entr{loadedNotes.length === 1 ? 'y' : 'ies'}
            </p>
          </div>
          <button onClick={onClose} className="text-dim hover:text-text text-xl leading-none">×</button>
        </div>

        {/* Notes list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
          {notesLoading ? (
            <p className="text-xs text-dim text-center py-8 animate-pulse-slow">Loading notes…</p>
          ) : notes.length === 0 ? (
            <p className="text-xs text-dim text-center py-8">No notes yet. Add the first one below.</p>
          ) : (
            notes.map((note) => (
              <div key={note.id} className="rounded border border-border bg-surface2 p-3 space-y-2">
                {/* Note header */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-text">{note.author}</span>
                    {note.moveDirection && (
                      <span className={`font-mono px-1.5 py-0.5 rounded text-[10px] ${
                        note.moveDirection === 'advance' ? 'bg-ok/10 text-ok' :
                        note.moveDirection === 'back'    ? 'bg-risk/10 text-risk' :
                        note.moveDirection === 'block'   ? 'bg-blocked/10 text-blocked' :
                        'bg-ok/10 text-ok'
                      }`}>
                        {MOVE_LABEL[note.moveDirection]}
                      </span>
                    )}
                    {note.stageAtTime !== undefined && (
                      <span className="text-dim text-[10px] font-mono">stage {note.stageAtTime}</span>
                    )}
                  </div>
                  <span className="text-[10px] text-dim shrink-0">{formatTs(note.timestamp)}</span>
                </div>

                {/* Note text */}
                {note.text && (
                  <p className="text-sm text-text whitespace-pre-wrap">{note.text}</p>
                )}

                {/* Attachments */}
                {note.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {note.attachments.map((att, i) => (
                      <button
                        key={i}
                        onClick={() => downloadAttachment(att)}
                        className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface border border-border text-xs text-mid hover:text-text hover:border-mid/50 transition-colors"
                      >
                        <span className="text-[10px]">📎</span>
                        <span className="font-mono truncate max-w-[120px]">{att.name}</span>
                        <span className="text-dim text-[10px]">{fileSize(att.size)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Add note form */}
        <form onSubmit={submit} className="shrink-0 border-t border-border p-4 space-y-3 bg-surface">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add a note, observation, or update…"
            rows={3}
            className="w-full rounded border border-border bg-surface2 px-3 py-2 text-sm text-text placeholder-dim focus:outline-none focus:border-mid resize-none"
          />

          {/* Attachments preview */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((att) => (
                <div key={att.name} className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface2 border border-border text-xs text-mid">
                  <span className="text-[10px]">📎</span>
                  <span className="font-mono truncate max-w-[100px]">{att.name}</span>
                  <span className="text-dim text-[10px]">{fileSize(att.size)}</span>
                  <button type="button" onClick={() => removeAttachment(att.name)} className="text-dim hover:text-blocked ml-1">×</button>
                </div>
              ))}
            </div>
          )}

          {fileError && (
            <p className="text-xs text-blocked">{fileError}</p>
          )}

          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFile}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="px-3 py-1.5 rounded border border-border text-dim text-xs hover:text-mid hover:border-mid/50 transition-colors"
            >
              📎 Attach file
            </button>
            <span className="text-[10px] text-dim">Max 2 MB per file</span>
            <div className="flex-1" />
            <button
              type="submit"
              disabled={!text.trim() && !attachments.length}
              className="px-4 py-1.5 rounded bg-done/10 border border-done/40 text-done text-xs font-semibold hover:bg-done/20 transition-colors disabled:opacity-40"
            >
              Add Note
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
