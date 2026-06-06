"""
LLM provider abstraction — speaks OpenAI-compatible by default, with an
Anthropic adapter for direct Claude API access.

Configured by ``elecdesign_config.json["ai"]``. The same code path covers:
  - Local Ollama (qwen, llama3.1, mistral, ...)        provider=openai_compatible
  - OpenAI gpt-* / o-*                                  provider=openai_compatible
  - Groq, Together, OpenRouter, Anyscale, vLLM, LM Studio  (idem)
  - Anthropic Claude API                                provider=anthropic

Every provider implements ``chat(messages, tools=None, **opts)`` and returns
the same shape: ``{text, tool_calls, raw}``.
``tool_calls`` is a list of ``{id, name, args}`` where ``args`` is a dict.
"""

from __future__ import annotations

import json
import pathlib
import urllib.error
import urllib.request
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class LLMError(Exception):
    """Raised when the LLM call fails (HTTP error, malformed response, etc.)."""


class LLMProvider(ABC):
    """Common interface — provider-agnostic chat with optional tool use."""

    @abstractmethod
    def chat(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        **opts: Any,
    ) -> Dict[str, Any]:
        ...


# ── OpenAI-compatible (Ollama, OpenAI, Groq, Together, ...) ────────────────

class OpenAICompatibleProvider(LLMProvider):
    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        temperature: float = 0.2,
        **_: Any,
    ):
        self.base_url = (base_url or "").rstrip("/")
        self.api_key = api_key or ""
        self.model = model
        self.temperature = temperature

    def chat(self, messages, tools=None, **opts):
        payload: Dict[str, Any] = {
            "model": opts.get("model", self.model),
            "messages": messages,
            "temperature": opts.get("temperature", self.temperature),
        }
        if tools:
            payload["tools"] = [
                {"type": "function", "function": {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "parameters": t.get("parameters") or {"type": "object", "properties": {}},
                }}
                for t in tools
            ]
            payload["tool_choice"] = opts.get("tool_choice", "auto")
        if "max_tokens" in opts:
            payload["max_tokens"] = opts["max_tokens"]
        # Keep Ollama from cold-loading the model on every call.
        payload["keep_alive"] = opts.get("keep_alive", "10m")

        req = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}" if self.api_key else "Bearer none",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=opts.get("timeout", 300)) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = exc.read().decode("utf-8")[:500]
            except Exception:  # noqa: BLE001
                pass
            raise LLMError(f"HTTP {exc.code}: {exc.reason} {detail}")
        except urllib.error.URLError as exc:
            raise LLMError(f"unreachable {self.base_url}: {exc.reason}")
        except json.JSONDecodeError as exc:
            raise LLMError(f"non-JSON response: {exc}")

        choices = body.get("choices") or []
        if not choices:
            raise LLMError(f"no choices in response: {str(body)[:300]}")
        msg = choices[0].get("message", {}) or {}
        text = msg.get("content") or ""
        raw_calls = msg.get("tool_calls") or []
        tool_calls: List[Dict[str, Any]] = []
        for tc in raw_calls:
            fn = tc.get("function") or {}
            args_raw = fn.get("arguments")
            if isinstance(args_raw, dict):
                args = args_raw
            else:
                try:
                    args = json.loads(args_raw or "{}")
                except json.JSONDecodeError:
                    args = {}
            tool_calls.append({
                "id": tc.get("id", ""),
                "name": fn.get("name", ""),
                "args": args,
            })
        return {"text": text, "tool_calls": tool_calls, "raw": body}


# ── Anthropic (Claude direct) ──────────────────────────────────────────────

class AnthropicProvider(LLMProvider):
    """Speaks api.anthropic.com /v1/messages.

    Translates the unified message shape into Anthropic's conventions:
      - system role pulled out into top-level ``system`` field
      - tool results carried in user messages with ``tool_result`` blocks
      - tool schemas use ``input_schema`` instead of ``parameters``
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        temperature: float = 0.2,
        **_: Any,
    ):
        self.base_url = (base_url or "https://api.anthropic.com/v1").rstrip("/")
        self.api_key = api_key or ""
        self.model = model
        self.temperature = temperature

    def chat(self, messages, tools=None, **opts):
        system_chunks: List[str] = []
        msgs: List[Dict[str, Any]] = []
        for m in messages:
            role = m.get("role")
            if role == "system":
                if m.get("content"):
                    system_chunks.append(str(m["content"]))
                continue
            if role == "tool":
                msgs.append({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": m.get("tool_call_id", ""),
                        "content": m.get("content", ""),
                    }],
                })
                continue
            msgs.append({"role": role, "content": m.get("content", "")})

        payload: Dict[str, Any] = {
            "model": opts.get("model", self.model),
            "messages": msgs,
            "max_tokens": opts.get("max_tokens", 4096),
            "temperature": opts.get("temperature", self.temperature),
        }
        if system_chunks:
            payload["system"] = "\n\n".join(system_chunks)
        if tools:
            payload["tools"] = [{
                "name": t["name"],
                "description": t.get("description", ""),
                "input_schema": t.get("parameters") or {"type": "object", "properties": {}},
            } for t in tools]

        req = urllib.request.Request(
            f"{self.base_url}/messages",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=opts.get("timeout", 300)) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = exc.read().decode("utf-8")[:500]
            except Exception:  # noqa: BLE001
                pass
            raise LLMError(f"HTTP {exc.code}: {exc.reason} {detail}")
        except urllib.error.URLError as exc:
            raise LLMError(f"unreachable {self.base_url}: {exc.reason}")
        except json.JSONDecodeError as exc:
            raise LLMError(f"non-JSON response: {exc}")

        text_parts: List[str] = []
        tool_calls: List[Dict[str, Any]] = []
        for block in body.get("content", []):
            btype = block.get("type")
            if btype == "text":
                text_parts.append(block.get("text", ""))
            elif btype == "tool_use":
                tool_calls.append({
                    "id": block.get("id", ""),
                    "name": block.get("name", ""),
                    "args": block.get("input") or {},
                })
        return {"text": "".join(text_parts), "tool_calls": tool_calls, "raw": body}


# ── Factory ────────────────────────────────────────────────────────────────

_DEFAULT_CONFIG_PATH = pathlib.Path(__file__).parent / "ewis_config.json"


def from_config(config: Optional[Dict[str, Any]] = None) -> LLMProvider:
    """Build the right provider from app config."""
    if config is None:
        if _DEFAULT_CONFIG_PATH.exists():
            try:
                config = json.loads(_DEFAULT_CONFIG_PATH.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001
                config = {}
        else:
            config = {}
    ai = (config or {}).get("ai", {}) or {}
    provider = (ai.get("provider") or "openai_compatible").lower()
    base_url = ai.get("base_url") or "http://localhost:11434/v1"
    api_key = ai.get("api_key") or ""
    model = ai.get("model") or "qwen2.5:32b-instruct"
    temperature = float(ai.get("temperature", 0.2))
    if provider == "anthropic":
        return AnthropicProvider(base_url, api_key, model, temperature=temperature)
    return OpenAICompatibleProvider(base_url, api_key, model, temperature=temperature)
