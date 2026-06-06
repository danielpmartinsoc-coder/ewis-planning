import { useState, useEffect } from 'react';
import * as api from '../../api';
import type { AIStatus } from '../../api';

interface Props {
  onClose: () => void;
}

const PRESETS = [
  {
    id: 'ollama',
    label: 'Ollama (local)',
    provider: 'openai_compatible',
    base_url: 'http://localhost:11434/v1',
    needs_key: false,
    placeholder_model: 'llama3.2',
    hint: 'Run models locally — no API key required',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    provider: 'openai_compatible',
    base_url: 'https://api.openai.com/v1',
    needs_key: true,
    placeholder_model: 'gpt-4o-mini',
    hint: 'OpenAI GPT models — requires API key from platform.openai.com',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    provider: 'anthropic',
    base_url: 'https://api.anthropic.com/v1',
    needs_key: true,
    placeholder_model: 'claude-sonnet-4-6',
    hint: 'Claude models — requires API key from console.anthropic.com',
  },
  {
    id: 'custom',
    label: 'Custom endpoint',
    provider: 'openai_compatible',
    base_url: '',
    needs_key: false,
    placeholder_model: '',
    hint: 'Any OpenAI-compatible endpoint (LM Studio, Groq, Together, vLLM…)',
  },
] as const;

type PresetId = typeof PRESETS[number]['id'];

function detectPreset(status: AIStatus): PresetId {
  if (status.provider === 'anthropic') return 'anthropic';
  if (status.base_url.includes('openai.com')) return 'openai';
  if (status.base_url.includes('11434') || status.base_url.includes('ollama')) return 'ollama';
  if (status.base_url) return 'custom';
  return 'ollama';
}

export function AIConfigModal({ onClose }: Props) {
  const [preset, setPreset]       = useState<PresetId>('ollama');
  const [baseUrl, setBaseUrl]     = useState('http://localhost:11434/v1');
  const [model, setModel]         = useState('');
  const [apiKey, setApiKey]       = useState('');
  const [temperature, setTemp]    = useState(0.2);
  const [models, setModels]       = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [pingState, setPingState] = useState<'idle' | 'pinging' | 'ok' | 'error'>('idle');
  const [pingMsg, setPingMsg]     = useState('');
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);

  // Load current config on open
  useEffect(() => {
    api.getAIStatus().then((s) => {
      const p = detectPreset(s);
      setPreset(p);
      setBaseUrl(s.base_url || PRESETS.find(x => x.id === p)?.base_url || '');
      setModel(s.model || '');
      setTemp(0.2);
      if (p === 'ollama') fetchModels(s.base_url || 'http://localhost:11434/v1');
    }).catch(() => {});
  }, []);

  async function fetchModels(_url?: string) {
    setLoadingModels(true);
    setModels([]);
    try {
      const r = await fetch('/api/ai/models');
      const data = await r.json() as { ok: boolean; models: string[]; error?: string };
      if (data.ok) setModels(data.models);
    } catch { /* ignore */ } finally {
      setLoadingModels(false);
    }
  }

  function applyPreset(id: PresetId) {
    setPreset(id);
    const p = PRESETS.find(x => x.id === id)!;
    if (id !== 'custom') setBaseUrl(p.base_url);
    setModels([]);
    setPingState('idle');
    if (id === 'ollama') setTimeout(() => fetchModels(), 100);
  }

  async function ping() {
    setPingState('pinging');
    setPingMsg('');
    // Save current values first so the server pings with these settings
    await api.saveAIConfig({
      provider: PRESETS.find(x => x.id === preset)?.provider ?? 'openai_compatible',
      base_url: baseUrl,
      model,
      api_key: apiKey || undefined,
    } as Parameters<typeof api.saveAIConfig>[0]);
    try {
      const r = await api.pingAI();
      if (r.ok) {
        setPingState('ok');
        setPingMsg(`${(r as { latency_ms?: number }).latency_ms ?? '?'}ms — ${r.reply?.slice(0, 60) ?? 'OK'}`);
      } else {
        setPingState('error');
        setPingMsg(r.error ?? 'No response');
      }
    } catch {
      setPingState('error');
      setPingMsg('Network error');
    }
  }

  async function save() {
    setSaving(true);
    try {
      await api.saveAIConfig({
        provider: PRESETS.find(x => x.id === preset)?.provider ?? 'openai_compatible',
        base_url: baseUrl,
        model,
        api_key: apiKey || undefined,
        temperature,
      } as Parameters<typeof api.saveAIConfig>[0]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  const currentPreset = PRESETS.find(x => x.id === preset)!;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[520px] bg-surface border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-text text-sm">AI Configuration</h2>
            <p className="text-xs text-dim mt-0.5">LLM provider for the planning agent</p>
          </div>
          <button onClick={onClose} className="text-dim hover:text-text text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-5">
          {/* Provider selector */}
          <div>
            <label className="block text-xs font-semibold text-mid mb-2">Provider</label>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p.id)}
                  className={`text-left px-3 py-2.5 rounded border transition-colors ${
                    preset === p.id
                      ? 'bg-done/10 border-done/50 text-text'
                      : 'bg-surface2 border-border text-mid hover:border-mid/50 hover:text-text'
                  }`}
                >
                  <div className="text-xs font-semibold">{p.label}</div>
                  <div className="text-[10px] text-dim mt-0.5 leading-tight">{p.hint}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-xs font-semibold text-mid mb-1.5">Base URL</label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://…"
              className="w-full font-mono text-xs px-3 py-2 rounded bg-surface2 border border-border text-text placeholder-dim focus:outline-none focus:border-mid"
            />
          </div>

          {/* Model */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-mid">Model</label>
              {preset === 'ollama' && (
                <button
                  onClick={() => fetchModels()}
                  disabled={loadingModels}
                  className="text-[10px] text-dim hover:text-mid transition-colors disabled:opacity-50"
                >
                  {loadingModels ? 'Loading…' : '↻ Fetch models'}
                </button>
              )}
            </div>
            {models.length > 0 ? (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full font-mono text-xs px-3 py-2 rounded bg-surface2 border border-border text-text focus:outline-none focus:border-mid"
              >
                <option value="">— select a model —</option>
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={currentPreset.placeholder_model}
                className="w-full font-mono text-xs px-3 py-2 rounded bg-surface2 border border-border text-text placeholder-dim focus:outline-none focus:border-mid"
              />
            )}
            {loadingModels && models.length === 0 && (
              <p className="text-[10px] text-dim mt-1">Fetching models from Ollama…</p>
            )}
          </div>

          {/* API Key */}
          {currentPreset.needs_key && (
            <div>
              <label className="block text-xs font-semibold text-mid mb-1.5">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-…"
                autoComplete="off"
                className="w-full font-mono text-xs px-3 py-2 rounded bg-surface2 border border-border text-text placeholder-dim focus:outline-none focus:border-mid"
              />
            </div>
          )}

          {/* Temperature */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-mid">Temperature</label>
              <span className="font-mono text-xs text-text">{temperature.toFixed(1)}</span>
            </div>
            <input
              type="range" min="0" max="1" step="0.1"
              value={temperature}
              onChange={(e) => setTemp(parseFloat(e.target.value))}
              className="w-full accent-done"
            />
            <div className="flex justify-between text-[10px] text-dim mt-0.5">
              <span>0.0 — precise</span>
              <span>1.0 — creative</span>
            </div>
          </div>

          {/* Ping */}
          <div className="flex items-center gap-3 pt-1 border-t border-border">
            <button
              onClick={ping}
              disabled={pingState === 'pinging' || !model}
              className="px-3 py-1.5 rounded border border-border text-dim text-xs hover:text-mid hover:border-mid/50 transition-colors disabled:opacity-40"
            >
              {pingState === 'pinging' ? 'Testing…' : 'Test connection'}
            </button>
            {pingState === 'ok' && (
              <span className="text-xs text-ok font-mono">✓ {pingMsg}</span>
            )}
            {pingState === 'error' && (
              <span className="text-xs text-blocked font-mono">✕ {pingMsg}</span>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-surface2">
          <p className="text-[10px] text-dim">
            Config saved to <span className="font-mono">ewis_config.json</span>
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded border border-border text-dim text-xs hover:text-mid transition-colors">
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || !model}
              className="px-4 py-1.5 rounded bg-done/10 border border-done/40 text-done text-xs font-semibold hover:bg-done/20 transition-colors disabled:opacity-40"
            >
              {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
