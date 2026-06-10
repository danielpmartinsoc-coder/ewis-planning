import { useState, useRef, useEffect } from 'react';
import type { AgentRunResult, DraftStatus, ToolCall } from '../../api';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_trace?: ToolCall[];
  stop_reason?: string;
}

interface Props {
  userName: string;
  onUserNameChange: (n: string) => void;
  onAgentResult: (draft: DraftStatus) => void;
  context?: Record<string, unknown>;
  onRunAgent: (messages: { role: string; content: string }[], requestedBy: string, context?: Record<string, unknown>) => Promise<AgentRunResult>;
  aiAvailable: boolean;
  open: boolean;
  onToggle: () => void;
}

const SUGGESTED_PROMPTS = [
  'What harnesses are currently blocked?',
  'Advance H-F02 to the next stage',
  'Register a block on H-F07 — waiting for tooling approval',
  'Approve ECN-001',
  'Mark FALCON F5 milestone as done today',
  'What is the status of all ALPHA harnesses?',
];

export function ChatPanel({ userName, onUserNameChange, onAgentResult, context, onRunAgent, aiAvailable, open, onToggle }: Props) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [apiMessages, setApiMessages] = useState<{ role: string; content: string }[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');

    const userMsg = { role: 'user' as const, content: text };
    const nextApi = [...apiMessages, userMsg];
    setApiMessages(nextApi);
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setLoading(true);

    try {
      const result = await onRunAgent(nextApi, userName, context);
      const assistantApiMsg = { role: 'assistant' as const, content: result.final_text };
      setApiMessages((prev) => [...prev, assistantApiMsg]);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: result.final_text,
          tool_trace: result.tool_trace,
          stop_reason: result.stop_reason,
        },
      ]);
      if (result.draft_status?.has_draft) {
        onAgentResult(result.draft_status);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'system', content: 'Error contacting agent — is the server running?' },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function clearHistory() {
    setMessages([]);
    setApiMessages([]);
  }

  return (
    <>
      {/* Panel */}
      {open && (
        <div className="fixed bottom-4 right-4 z-40 w-[420px] max-h-[600px] flex flex-col bg-surface border border-border rounded-xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-done">EWIS Agent</span>
              {!aiAvailable && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-risk/10 border border-risk/30 text-risk font-mono">
                  LLM offline
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                value={userName}
                onChange={(e) => onUserNameChange(e.target.value)}
                placeholder="Your name"
                className="w-28 text-xs px-2 py-1 rounded bg-surface2 border border-border text-mid placeholder-dim focus:outline-none focus:border-mid"
              />
              {messages.length > 0 && (
                <button onClick={clearHistory} className="text-dim hover:text-mid text-xs transition-colors">
                  Clear
                </button>
              )}
              <button onClick={onToggle} className="text-dim hover:text-mid text-sm leading-none transition-colors">✕</button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs text-dim text-center py-2">
                  Ask the agent to update programme state. Changes go to a draft pending your approval.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTED_PROMPTS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setInput(p)}
                      className="text-[10px] px-2 py-1 rounded bg-surface2 border border-border text-dim hover:text-mid hover:border-mid/50 transition-colors text-left"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                {msg.role === 'user' && (
                  <div className="max-w-[85%] px-3 py-2 rounded-lg bg-done/10 border border-done/20 text-xs text-text">
                    {msg.content}
                  </div>
                )}
                {msg.role === 'assistant' && (
                  <>
                    {(msg.tool_trace ?? []).length > 0 && (
                      <div className="w-full space-y-1 mb-1">
                        {(msg.tool_trace ?? []).map((tc, ti) => (
                          <ToolCallChip key={ti} tc={tc} />
                        ))}
                      </div>
                    )}
                    <div className="max-w-[90%] px-3 py-2 rounded-lg bg-surface2 border border-border text-xs text-text whitespace-pre-wrap">
                      {msg.content || <span className="text-dim italic">No text response</span>}
                    </div>
                  </>
                )}
                {msg.role === 'system' && (
                  <div className="w-full px-3 py-1.5 rounded bg-risk/10 border border-risk/30 text-xs text-risk">
                    {msg.content}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2 text-xs text-dim px-1">
                <span className="animate-pulse">●</span>
                <span>Agent running…</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-border p-3">
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Ask the agent… (Enter to send, Shift+Enter for newline)"
                rows={2}
                disabled={loading}
                className="flex-1 rounded bg-surface2 border border-border px-3 py-2 text-xs text-text placeholder-dim focus:outline-none focus:border-mid resize-none disabled:opacity-50"
              />
              <button
                onClick={send}
                disabled={loading || !input.trim()}
                className="px-3 py-2 rounded bg-done/10 border border-done/40 text-done text-xs font-semibold hover:bg-done/20 transition-colors disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ToolCallChip({ tc }: { tc: ToolCall }) {
  const isWrite = !['read_state'].includes(tc.name);
  const ok = tc.result?.ok !== false && !tc.error;
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-mono ${
      tc.error
        ? 'bg-blocked/10 border-blocked/30 text-blocked'
        : isWrite
        ? ok ? 'bg-ok/10 border-ok/30 text-ok' : 'bg-risk/10 border-risk/30 text-risk'
        : 'bg-surface border-border text-dim'
    }`}>
      <span>{tc.error ? '✕' : ok ? (isWrite ? '✓' : '○') : '!'}</span>
      <span className="font-semibold">{tc.name}</span>
      {tc.args['harness_id'] != null && <span className="text-mid">· {String(tc.args['harness_id'])}</span>}
      {tc.args['project'] != null && tc.args['phase'] != null && (
        <span className="text-mid">· {String(tc.args['project'])}/{String(tc.args['phase'])}</span>
      )}
      {tc.args['ecn_id'] != null && <span className="text-mid">· {String(tc.args['ecn_id'])}</span>}
      {tc.error != null && <span className="text-blocked">— {tc.error}</span>}
      {tc.result?.['error'] != null && <span className="text-risk">— {String(tc.result['error'])}</span>}
    </div>
  );
}
