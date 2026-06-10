"""
EWIS Planning Layer — Flask server

Port 8082 by default (configurable in ewis_config.json).
Serves the React SPA from dist/ in production, and the API at /api/*.

Endpoints:
  GET  /api/state              — active state
  POST /api/state/update       — direct UI update (no draft, logged)
  POST /api/agent/run          — LLM agent (writes to draft)
  GET  /api/draft/status       — current draft info
  POST /api/draft/accept       — promote draft to active state
  POST /api/draft/reject       — discard draft
  GET  /api/log                — audit log
  GET  /api/ai/status          — LLM config + reachability
  PATCH /api/ai/config         — update LLM config
  GET  /                       — serve React SPA
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import threading
import traceback
import uuid
from datetime import date

import base64
import hashlib
import hmac

from flask import Flask, jsonify, request, send_from_directory

# ── Readonly mode ─────────────────────────────────────────────────────────────
# FORGE_READONLY=1 → read-only public server for Cloudflare tunnel (port 5001).
# All mutating requests (POST/PUT/DELETE/PATCH) are blocked at before_request.
# FORGE_USER / FORGE_PASSWORD → HTTP Basic Auth credentials for readonly server.
READONLY          = os.environ.get("FORGE_READONLY", "0") == "1"
_BASIC_AUTH_USER  = os.environ.get("FORGE_USER", "forge")
_BASIC_AUTH_PASS  = os.environ.get("FORGE_PASSWORD", "")

import agent_loop

_HERE    = pathlib.Path(__file__).parent
_DIST    = _HERE / "dist"
_CFG_PATH    = _HERE / "ewis_config.json"
_INV_PATH    = _HERE / "data" / "inventory.json"
_inv_lock    = threading.Lock()   # serialises all inventory reads+writes
_DNOTES_PATH = _HERE / "data" / "design_notes.json"
_WO_PATH     = _HERE / "data" / "work_orders.json"
_PROC_PATH   = _HERE / "data" / "procurement.json"
_DOCS_DIR    = _HERE / "data" / "documents"
_BACKUP_DIR  = _HERE / "data" / "backups"
_MAX_BACKUPS = 10   # rolling snapshots kept per file


# ── Rolling backup (Layer 1) ──────────────────────────────────────────────────

def _backup(path: pathlib.Path) -> None:
    """Copy path → data/backups/<stem>.<YYYYMMDD_HHMMSS>.json, keep last 10."""
    if not path.exists():
        return
    from datetime import datetime as _dt
    _BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts  = _dt.now().strftime("%Y%m%d_%H%M%S")
    dst = _BACKUP_DIR / f"{path.stem}.{ts}.json"
    dst.write_bytes(path.read_bytes())
    # prune oldest beyond limit
    snapshots = sorted(_BACKUP_DIR.glob(f"{path.stem}.*.json"))
    for old in snapshots[:-_MAX_BACKUPS]:
        old.unlink(missing_ok=True)


# ── Inventory helpers ─────────────────────────────────────────────────────────

def _load_inventory() -> dict:
    if _INV_PATH.exists():
        try:
            return json.loads(_INV_PATH.read_text("utf-8"))
        except Exception:
            pass
    return {"items": []}


def _save_inventory(data: dict) -> None:
    _backup(_INV_PATH)
    _INV_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")


# ── Work-order helpers ────────────────────────────────────────────────────────

def _load_work_orders() -> dict:
    if _WO_PATH.exists():
        try:
            return json.loads(_WO_PATH.read_text("utf-8"))
        except Exception:
            pass
    return {"orders": []}


def _save_work_orders(data: dict) -> None:
    _backup(_WO_PATH)
    _WO_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")


# ── Procurement helpers ───────────────────────────────────────────────────────

def _load_procurement() -> dict:
    if _PROC_PATH.exists():
        try:
            return json.loads(_PROC_PATH.read_text("utf-8"))
        except Exception:
            pass
    return {"orders": []}


def _save_procurement(data: dict) -> None:
    _backup(_PROC_PATH)
    _PROC_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")

app = Flask(__name__, static_folder=None)
app.config["JSON_SORT_KEYS"] = False

@app.before_request
def _enforce_readonly():
    """Block writes and enforce Basic Auth when running in readonly mode."""
    if not READONLY:
        return  # full local server — no restrictions

    # Block all write operations
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        return jsonify({"ok": False, "error": "Server is in read-only mode"}), 405

    # Enforce HTTP Basic Auth if a password is configured
    if _BASIC_AUTH_PASS:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Basic "):
            try:
                decoded  = base64.b64decode(auth[6:]).decode("utf-8")
                user, pw = decoded.split(":", 1)
                user_ok  = hmac.compare_digest(user, _BASIC_AUTH_USER)
                pass_ok  = hmac.compare_digest(pw,   _BASIC_AUTH_PASS)
                if user_ok and pass_ok:
                    return  # authenticated
            except Exception:
                pass
        # Not authenticated — prompt browser login dialog
        return (
            "Authentication required",
            401,
            {"WWW-Authenticate": 'Basic realm="EWIS Forge"'},
        )

@app.after_request
def _readonly_header(response):
    response.headers["X-Forge-Readonly"] = "true" if READONLY else "false"
    return response


# ── Helpers ──────────────────────────────────────────────────────────────────

def _load_cfg() -> dict:
    if _CFG_PATH.exists():
        try:
            return json.loads(_CFG_PATH.read_text("utf-8"))
        except Exception:
            return {}
    return {}


def _save_cfg(cfg: dict) -> None:
    _CFG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), "utf-8")


def _err(msg: str, code: int = 400):
    return jsonify({"ok": False, "error": msg}), code


# ── Mode ─────────────────────────────────────────────────────────────────────

@app.route("/api/mode", methods=["GET"])
def api_mode():
    return jsonify({"readonly": READONLY})


# ── State ────────────────────────────────────────────────────────────────────

@app.route("/api/state", methods=["GET"])
def api_get_state():
    return jsonify(agent_loop.load_state())


@app.route("/api/state/version", methods=["GET"])
def api_state_version():
    """Lightweight version token — returns the mtime of state.json.
    Frontend polls this every few seconds; only fetches full state when it changes."""
    import os
    state_path = _HERE / "data" / "state.json"
    try:
        v = os.path.getmtime(state_path)
    except OSError:
        v = 0.0
    return jsonify({"version": v})


@app.route("/api/harness/<harness_id>", methods=["GET"])
def api_get_harness(harness_id: str):
    """Return a single harness with its full notes array (lazy-loaded by the UI)."""
    state = agent_loop.load_state()
    h = next((h for h in state["harnesses"] if h["id"] == harness_id), None)
    if not h:
        return _err("Harness not found", 404)
    notes = agent_loop.load_harness_notes(harness_id)
    return jsonify({**h, "notes": notes})


@app.route("/api/state/update", methods=["POST"])
def api_update_state():
    """Direct UI update — applied immediately (no draft, no LLM)."""
    body = request.get_json(silent=True) or {}
    action  = body.get("action")
    payload = body.get("payload", {})
    by      = body.get("by", "ui_direct")

    if not action:
        return _err("missing action")

    state = agent_loop.load_state()

    if action == "advance_stage":
        result = agent_loop._tool_advance_stage(state, payload.get("harness_id", ""), payload.get("reason", ""), payload.get("actualHours", 0))
    elif action == "regress_stage":
        result = agent_loop._tool_regress_stage(state, payload.get("harness_id", ""), payload.get("reason", ""))
    elif action == "register_block":
        result = agent_loop._tool_register_block(
            state, payload.get("harness_id", ""), payload.get("reason", ""), payload.get("responsible", ""))
    elif action == "resolve_block":
        result = agent_loop._tool_resolve_block(
            state, payload.get("harness_id", ""), payload.get("note", ""))
    elif action == "add_note":
        result = agent_loop._tool_add_note(state, payload.get("harness_id", ""), payload.get("note", {}))
    else:
        return _err(f"Unknown action: {action}")

    if not result.get("ok"):
        return _err(result.get("error", "action failed"))

    agent_loop.save_state(state)
    agent_loop.log_action(f"ui_{action}", by, {"payload": payload, "result": result})
    return jsonify({"ok": True, "state": state})


# ── Agent ────────────────────────────────────────────────────────────────────

@app.route("/api/agent/run", methods=["POST"])
def api_agent_run():
    body = request.get_json(silent=True) or {}
    messages     = body.get("messages", [])
    requested_by = body.get("requested_by", "Operator")
    context      = body.get("context")

    if not messages:
        return _err("messages required")

    cfg   = _load_cfg()
    state = agent_loop.load_state()

    try:
        result = agent_loop.run(
            messages=messages,
            config=cfg,
            state=state,
            requested_by=requested_by,
            context=context,
        )
    except Exception as exc:
        traceback.print_exc()
        return _err(f"Agent error: {exc}", 500)

    return jsonify({
        "ok":           True,
        "final_text":   result["final_text"],
        "tool_trace":   result["tool_trace"],
        "stop_reason":  result["stop_reason"],
        "draft_status": result["draft_status"],
    })


# ── Draft ────────────────────────────────────────────────────────────────────

@app.route("/api/draft/status", methods=["GET"])
def api_draft_status():
    return jsonify(agent_loop.draft_status())


@app.route("/api/draft/accept", methods=["POST"])
def api_draft_accept():
    body = request.get_json(silent=True) or {}
    approved_by = body.get("approved_by", "Operator")
    result = agent_loop.accept_draft(approved_by)
    if not result.get("ok"):
        return _err(result.get("error", "accept failed"))
    return jsonify(result)


@app.route("/api/draft/reject", methods=["POST"])
def api_draft_reject():
    body = request.get_json(silent=True) or {}
    rejected_by = body.get("rejected_by", "Operator")
    result = agent_loop.reject_draft(rejected_by)
    if not result.get("ok"):
        return _err(result.get("error", "reject failed"))
    return jsonify(result)


# ── Audit log ────────────────────────────────────────────────────────────────

@app.route("/api/log", methods=["GET"])
def api_log():
    limit = int(request.args.get("limit", 200))
    return jsonify(agent_loop.get_log(limit))


# ── AI config ────────────────────────────────────────────────────────────────

@app.route("/api/ai/status", methods=["GET"])
def api_ai_status():
    cfg = _load_cfg()
    ai = cfg.get("ai", {})
    return jsonify({
        "ok":       True,
        "provider": ai.get("provider", "openai_compatible"),
        "base_url": ai.get("base_url", ""),
        "model":    ai.get("model", ""),
        "has_key":  bool(ai.get("api_key")),
    })


@app.route("/api/ai/status", methods=["PATCH"])
@app.route("/api/ai/config",  methods=["PATCH"])
def api_ai_config():
    body = request.get_json(silent=True) or {}
    cfg = _load_cfg()
    ai  = cfg.setdefault("ai", {})
    for key in ("provider", "base_url", "model", "api_key", "temperature"):
        if key in body:
            ai[key] = body[key]
    _save_cfg(cfg)
    return jsonify({"ok": True})


@app.route("/api/ai/ping", methods=["GET"])
def api_ai_ping():
    import llm_provider as llm_mod
    import time
    cfg = _load_cfg()
    try:
        provider = llm_mod.from_config(cfg)
        t0 = time.time()
        resp = provider.chat([{"role": "user", "content": "PING — reply with PONG only"}],
                             tools=None)
        ms = int((time.time() - t0) * 1000)
        return jsonify({"ok": True, "reply": resp.get("text", ""), "latency_ms": ms})
    except llm_mod.LLMError as exc:
        return jsonify({"ok": False, "error": str(exc)})


@app.route("/api/ai/models", methods=["GET"])
def api_ai_models():
    """List available models from the configured provider."""
    import urllib.request, urllib.error
    cfg = _load_cfg()
    ai = cfg.get("ai", {})
    base_url = (ai.get("base_url") or "").rstrip("/")
    api_key  = ai.get("api_key") or ""
    provider = (ai.get("provider") or "openai_compatible").lower()

    models: list = []

    # Ollama: GET /api/tags (no /v1 prefix)
    ollama_base = base_url.replace("/v1", "").replace("/v1/", "")
    if "11434" in base_url or "ollama" in base_url.lower():
        try:
            req = urllib.request.Request(f"{ollama_base}/api/tags", method="GET")
            with urllib.request.urlopen(req, timeout=5) as r:
                data = json.loads(r.read())
            models = [m["name"] for m in data.get("models", [])]
            return jsonify({"ok": True, "models": models, "source": "ollama"})
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc), "models": []})

    # OpenAI-compatible: GET /models
    if provider == "openai_compatible":
        try:
            headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
            req = urllib.request.Request(f"{base_url}/models", headers=headers, method="GET")
            with urllib.request.urlopen(req, timeout=5) as r:
                data = json.loads(r.read())
            raw = data.get("data") or []
            models = sorted([m["id"] for m in raw if isinstance(m, dict) and "id" in m])
            return jsonify({"ok": True, "models": models, "source": "openai"})
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc), "models": []})

    # Anthropic: static list (API doesn't expose a models endpoint)
    if provider == "anthropic":
        return jsonify({"ok": True, "source": "static", "models": [
            "claude-opus-4-8",
            "claude-sonnet-4-6",
            "claude-haiku-4-5-20251001",
            "claude-3-5-sonnet-20241022",
            "claude-3-5-haiku-20241022",
            "claude-3-opus-20240229",
        ]})

    return jsonify({"ok": True, "models": [], "source": "unknown"})


# ── Project / Harness / Milestone CRUD ───────────────────────────────────────

@app.route("/api/projects", methods=["POST"])
def api_create_project():
    """Create a new project (programme) — adds placeholder milestones."""
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return _err("name required")
    state = agent_loop.load_state()
    if any(h["project"] == name for h in state["harnesses"]):
        return _err(f"Project '{name}' already exists")
    # Seed the 5 design milestones
    phases = [
        {"phase": "F2", "label": "Architecture Review"},
        {"phase": "F3", "label": "Topology Freeze"},
        {"phase": "F4", "label": "ICD Sign-off"},
        {"phase": "F5", "label": "Schematic Release"},
        {"phase": "F6", "label": "BoM Release"},
    ]
    for p in phases:
        state["milestones"].append({
            "project": name,
            "phase": p["phase"],
            "label": p["label"],
            "planned": body.get("plannedStart", str(date.today())),
            "actual": None,
            "status": "open",
        })
    agent_loop.save_state(state)
    agent_loop.log_action("create_project", body.get("by", "ui"), {"name": name})
    return jsonify({"ok": True, "state": state})


@app.route("/api/harnesses", methods=["POST"])
def api_create_harness():
    """Add a new harness to an existing project."""
    body = request.get_json(silent=True) or {}
    project = (body.get("project") or "").strip()
    name    = (body.get("name") or "").strip()
    hid     = (body.get("id") or "").strip().upper()
    if not project or not name or not hid:
        return _err("project, id and name required")
    revision = (body.get("revision") or "A").strip().upper() or "A"
    base_id  = (body.get("baseId") or "").strip() or None
    state = agent_loop.load_state()
    if any(h["id"] == hid for h in state["harnesses"]):
        return _err(f"Harness ID '{hid}' already exists")
    # Prevent duplicate (project, name, revision) combo
    if any(h["project"] == project and h["name"] == name and h.get("revision","A").upper() == revision
           for h in state["harnesses"]):
        return _err(f"Harness '{name}' REV {revision} already exists in {project}")
    entry = {
        "id": hid,
        "project": project,
        "name": name,
        "stage": 0,
        "blocked": False,
        "responsible": body.get("responsible", ""),
        "designResponsible": body.get("designResponsible", ""),
        "revision": revision,
        "ecns": [],
        "noteCount": 0,
        "notes": [],
    }
    if base_id:
        entry["baseId"] = base_id
    state["harnesses"].append(entry)
    agent_loop.save_state(state)
    agent_loop.log_action("create_harness", body.get("by", "ui"), {"id": hid, "project": project, "revision": revision})
    return jsonify({"ok": True, "state": state})


@app.route("/api/harnesses/<harness_id>", methods=["DELETE"])
def api_delete_harness(harness_id: str):
    state = agent_loop.load_state()
    before = len(state["harnesses"])
    state["harnesses"] = [h for h in state["harnesses"] if h["id"] != harness_id]
    if len(state["harnesses"]) == before:
        return _err("Harness not found", 404)
    agent_loop.save_state(state)
    agent_loop.log_action("delete_harness", "ui", {"id": harness_id})
    return jsonify({"ok": True, "state": state})


@app.route("/api/harnesses/<harness_id>/stage_history", methods=["POST"])
def api_update_stage_history(harness_id: str):
    """Replace the stageHistory array for a harness (apontamento edit)."""
    body  = request.get_json(silent=True) or {}
    state = agent_loop.load_state()
    h = next((h for h in state["harnesses"] if h["id"] == harness_id), None)
    if not h:
        return _err("Harness not found", 404)
    h["stageHistory"] = body.get("stageHistory", [])
    agent_loop.save_state(state)
    return jsonify({"ok": True, "state": state})


@app.route("/api/harnesses/<harness_id>/complete", methods=["POST"])
def api_complete_harness(harness_id: str):
    """Mark a Delivered harness as completed."""
    from datetime import date as _date
    body  = request.get_json(silent=True) or {}
    state = agent_loop.load_state()
    h = next((h for h in state["harnesses"] if h["id"] == harness_id), None)
    if not h:
        return _err("Harness not found", 404)
    if h.get("stage", 0) != 7:
        return _err("Harness must be at Delivered stage to complete")
    # Complete is a status flag on Delivered — stage stays at 7
    h["completed"]   = True
    h["completedAt"] = _date.today().isoformat()
    h["completedBy"] = body.get("by", "ui")
    agent_loop.save_state(state)
    agent_loop.log_action("complete_harness", h["completedBy"], {"id": harness_id})
    return jsonify({"ok": True, "state": state})


@app.route("/api/projects/<project_name>", methods=["PUT"])
def api_rename_project(project_name: str):
    """Rename a project — updates all harnesses and milestones."""
    body    = request.get_json(silent=True) or {}
    new_name = (body.get("name") or "").strip()
    if not new_name:
        return _err("name required")
    state = agent_loop.load_state()
    exists = any(h["project"] == project_name for h in state["harnesses"]) or \
             any(m["project"] == project_name for m in state["milestones"])
    if not exists:
        return _err(f"Project '{project_name}' not found", 404)
    if new_name != project_name and (
        any(h["project"] == new_name for h in state["harnesses"]) or
        any(m["project"] == new_name for m in state["milestones"])
    ):
        return _err(f"Project '{new_name}' already exists")
    for h in state["harnesses"]:
        if h["project"] == project_name:
            h["project"] = new_name
    for m in state["milestones"]:
        if m["project"] == project_name:
            m["project"] = new_name
    agent_loop.save_state(state)
    agent_loop.log_action("rename_project", body.get("by", "ui"), {"from": project_name, "to": new_name})
    return jsonify({"ok": True, "state": state})


@app.route("/api/projects/<project_name>", methods=["DELETE"])
def api_delete_project(project_name: str):
    """Delete a project and all its harnesses and milestones."""
    state = agent_loop.load_state()
    if not any(h["project"] == project_name for h in state["harnesses"]) and \
       not any(m["project"] == project_name for m in state["milestones"]):
        return _err(f"Project '{project_name}' not found", 404)
    state["harnesses"]  = [h for h in state["harnesses"]  if h["project"] != project_name]
    state["milestones"] = [m for m in state["milestones"]  if m["project"] != project_name]
    agent_loop.save_state(state)
    agent_loop.log_action("delete_project", "ui", {"project": project_name})
    return jsonify({"ok": True, "state": state})


@app.route("/api/harnesses/<harness_id>", methods=["PUT"])
def api_update_harness(harness_id: str):
    """Edit harness name, responsible, revision, and schedule dates."""
    body  = request.get_json(silent=True) or {}
    state = agent_loop.load_state()
    h = next((h for h in state["harnesses"] if h["id"] == harness_id), None)
    if not h:
        return _err("Harness not found", 404)
    for k in ("name", "responsible", "designResponsible", "revision",
              "plannedStart", "plannedEnd", "actualStart", "actualEnd"):
        if k in body:
            h[k] = body[k] if body[k] else None
    agent_loop.save_state(state)
    agent_loop.log_action("edit_harness", body.get("by", "ui"), {"id": harness_id})
    return jsonify({"ok": True, "state": state})


@app.route("/api/milestones", methods=["POST"])
def api_upsert_milestone():
    """Create or update a milestone."""
    body = request.get_json(silent=True) or {}
    project = (body.get("project") or "").strip()
    phase   = (body.get("phase") or "").strip()
    if not project or not phase:
        return _err("project and phase required")
    state = agent_loop.load_state()
    existing = next((m for m in state["milestones"] if m["project"] == project and m["phase"] == phase), None)
    if existing:
        existing.update({k: v for k, v in body.items() if k in ("label", "planned", "actual", "status")})
    else:
        state["milestones"].append({
            "project": project, "phase": phase,
            "label":   body.get("label", phase),
            "planned": body.get("planned", str(date.today())),
            "actual":  body.get("actual", None),
            "status":  body.get("status", "open"),
        })
    agent_loop.save_state(state)
    return jsonify({"ok": True, "state": state})


# ── Design notes (notes / comments / agreements per milestone) ────────────────

def _load_dnotes() -> dict:
    if _DNOTES_PATH.exists():
        try: return json.loads(_DNOTES_PATH.read_text("utf-8"))
        except Exception: pass
    return {}

def _save_dnotes(data: dict) -> None:
    _backup(_DNOTES_PATH)
    _DNOTES_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")

@app.route("/api/design-notes/<project>/<phase>", methods=["GET"])
def api_get_design_notes(project: str, phase: str):
    data = _load_dnotes()
    key  = f"{project}__{phase}"
    return jsonify({"ok": True, "notes": data.get(key, [])})

@app.route("/api/design-notes/<project>/<phase>", methods=["POST"])
def api_add_design_note(project: str, phase: str):
    body = request.get_json(silent=True) or {}
    note_type = body.get("type", "note")   # note | comment | agreement
    text      = (body.get("text") or "").strip()
    if not text:
        return _err("text required")
    data = _load_dnotes()
    key  = f"{project}__{phase}"
    data.setdefault(key, [])
    note = {
        "id":        str(uuid.uuid4())[:12],
        "type":      note_type,
        "author":    body.get("author", "Operator"),
        "text":      text,
        "timestamp": body.get("timestamp", str(date.today())),
        "status":    body.get("status", ""),  # for agreements: approved | rejected | pending
    }
    data[key].append(note)
    _save_dnotes(data)
    return jsonify({"ok": True, "note": note})

@app.route("/api/design-notes/<project>/<phase>/<note_id>", methods=["DELETE"])
def api_delete_design_note(project: str, phase: str, note_id: str):
    data = _load_dnotes()
    key  = f"{project}__{phase}"
    before = len(data.get(key, []))
    data[key] = [n for n in data.get(key, []) if n["id"] != note_id]
    if len(data[key]) == before:
        return _err("Note not found", 404)
    _save_dnotes(data)
    return jsonify({"ok": True})

@app.route("/api/design-notes/<project>/<phase>/<note_id>", methods=["PUT"])
def api_update_design_note(project: str, phase: str, note_id: str):
    body = request.get_json(silent=True) or {}
    data = _load_dnotes()
    key  = f"{project}__{phase}"
    note = next((n for n in data.get(key, []) if n["id"] == note_id), None)
    if not note:
        return _err("Note not found", 404)
    for k in ("text", "status", "type"):
        if k in body: note[k] = body[k]
    _save_dnotes(data)
    return jsonify({"ok": True, "note": note})


# ── ECN CRUD ─────────────────────────────────────────────────────────────────

@app.route("/api/ecns", methods=["POST"])
def api_create_ecn():
    body = request.get_json(silent=True) or {}
    desc = (body.get("description") or "").strip()
    if not desc:
        return _err("description required")
    state = agent_loop.load_state()
    ecn_id = f"ECN-{str(len(state.get('ecns', [])) + 1).zfill(5)}"
    # Avoid duplicate IDs
    existing_ids = {e["id"] for e in state.get("ecns", [])}
    counter = len(state.get("ecns", [])) + 1
    while ecn_id in existing_ids:
        counter += 1
        ecn_id = f"ECN-{str(counter).zfill(5)}"
    ecn = {
        "id":                ecn_id,
        "description":       desc,
        "affectedHarnesses": body.get("affectedHarnesses", []),
        "status":            body.get("status", "aberto_sem_disposicao"),
        "raisedBy":          body.get("raisedBy", "Operator"),
        "raisedAt":          body.get("raisedAt", str(date.today())),
        "approver":          body.get("approver", ""),
        "approvedAt":        body.get("approvedAt", ""),
        "disposition":       body.get("disposition", ""),
        "dispositionNotes":  body.get("dispositionNotes", ""),
    }
    state.setdefault("ecns", []).append(ecn)
    agent_loop.save_state(state)
    agent_loop.log_action("create_ecn", body.get("by", "ui"), {"id": ecn_id})
    return jsonify({"ok": True, "state": state})


@app.route("/api/ecns/<ecn_id>", methods=["PUT"])
def api_update_ecn(ecn_id: str):
    body  = request.get_json(silent=True) or {}
    state = agent_loop.load_state()
    ecn   = next((e for e in state.get("ecns", []) if e["id"] == ecn_id), None)
    if not ecn:
        return _err("ECN not found", 404)
    for k in ("description", "status", "raisedBy", "raisedAt", "affectedHarnesses",
              "approver", "approvedAt", "disposition", "dispositionNotes"):
        if k in body:
            ecn[k] = body[k]
    agent_loop.save_state(state)
    return jsonify({"ok": True, "state": state})


@app.route("/api/ecns/<ecn_id>", methods=["DELETE"])
def api_delete_ecn(ecn_id: str):
    state = agent_loop.load_state()
    before = len(state.get("ecns", []))
    state["ecns"] = [e for e in state.get("ecns", []) if e["id"] != ecn_id]
    if len(state["ecns"]) == before:
        return _err("ECN not found", 404)
    # Remove ECN reference from harnesses
    for h in state.get("harnesses", []):
        h["ecns"] = [e for e in h.get("ecns", []) if e["id"] != ecn_id]
    agent_loop.save_state(state)
    return jsonify({"ok": True, "state": state})


@app.route("/api/milestones/<project>/<phase>", methods=["DELETE"])
def api_delete_milestone(project: str, phase: str):
    state = agent_loop.load_state()
    before = len(state["milestones"])
    state["milestones"] = [m for m in state["milestones"]
                           if not (m["project"] == project and m["phase"] == phase)]
    if len(state["milestones"]) == before:
        return _err("Milestone not found", 404)
    agent_loop.save_state(state)
    return jsonify({"ok": True, "state": state})


# ── Inventory ─────────────────────────────────────────────────────────────────

@app.route("/api/inventory", methods=["GET"])
def api_get_inventory():
    return jsonify(_load_inventory())


@app.route("/api/inventory", methods=["POST"])
def api_create_inventory_item():
    body = request.get_json(silent=True) or {}
    pn = (body.get("partNumber") or "").strip()
    if not pn:
        return _err("partNumber required")
    data = _load_inventory()
    if any(i["partNumber"] == pn for i in data["items"]):
        return _err(f"Part number '{pn}' already exists")
    item = {
        "id":           f"INV-{uuid.uuid4().hex[:6].upper()}",
        "partNumber":   pn,
        "description":  body.get("description", ""),
        "category":     body.get("category", "General"),
        "quantity":     float(body.get("quantity", 0)),
        "reserved":     float(body.get("reserved", 0)),
        "unit":         body.get("unit", "pc"),
        "location":     body.get("location", ""),
        "unitCost":     float(body.get("unitCost", 0)),
        "leadTimeDays": int(body.get("leadTimeDays", 0)),
        "supplier":     body.get("supplier", ""),
        "minStock":     float(body.get("minStock", 0)),
    }
    data["items"].append(item)
    _save_inventory(data)
    return jsonify({"ok": True, "item": item})


_INV_ALLOWED_FIELDS = (
    "description", "category", "quantity", "reserved", "unit",
    "location", "unitCost", "leadTimeDays", "supplier", "minStock", "partNumber", "procRef",
)

@app.route("/api/inventory/<item_id>", methods=["PUT"])
def api_update_inventory_item(item_id: str):
    body = request.get_json(silent=True) or {}
    with _inv_lock:
        data = _load_inventory()
        item = next((i for i in data["items"] if i["id"] == item_id), None)
        if not item:
            return _err("Item not found", 404)
        for k in _INV_ALLOWED_FIELDS:
            if k in body:
                item[k] = body[k]
        _save_inventory(data)
    return jsonify({"ok": True, "item": item})


@app.route("/api/inventory/batch", methods=["PUT"])
def api_batch_update_inventory():
    """Apply multiple updates in a single load/save cycle — avoids race conditions."""
    body = request.get_json(silent=True) or {}
    updates_list = body.get("updates", [])   # [{id: str, updates: {field: value}}]
    if not isinstance(updates_list, list):
        return _err("updates must be a list")
    with _inv_lock:
        data = _load_inventory()
        index = {i["id"]: i for i in data["items"]}
        count = 0
        for u in updates_list:
            item = index.get(u.get("id", ""))
            if item is None:
                continue
            for k in _INV_ALLOWED_FIELDS:
                if k in u.get("updates", {}):
                    item[k] = u["updates"][k]
            count += 1
        _save_inventory(data)
    return jsonify({"ok": True, "updated": count})


@app.route("/api/inventory/<item_id>", methods=["DELETE"])
def api_delete_inventory_item(item_id: str):
    with _inv_lock:
        data = _load_inventory()
        before = len(data["items"])
        data["items"] = [i for i in data["items"] if i["id"] != item_id]
        if len(data["items"]) == before:
            return _err("Item not found", 404)
        _save_inventory(data)
    return jsonify({"ok": True})


@app.route("/api/inventory/bom-analysis", methods=["POST"])
def api_bom_analysis():
    """
    Analyse a list of BOM items against current inventory.
    Body: { items: [{partNumber, quantity, unit}] }
    Returns per-item availability, cost, lead time impact.
    """
    body = request.get_json(silent=True) or {}
    bom_items = body.get("items", [])
    if not bom_items:
        return _err("items required")

    inventory = {i["partNumber"]: i for i in _load_inventory()["items"]}
    results = []
    total_cost = 0.0
    max_lead_time = 0

    for bi in bom_items:
        pn  = bi.get("partNumber", "")
        qty = float(bi.get("quantity", 1))
        inv = inventory.get(pn)

        if not inv:
            results.append({
                "partNumber": pn,
                "description": bi.get("description", ""),
                "required": qty,
                "available": 0,
                "reserved": 0,
                "status": "not_found",
                "shortfall": qty,
                "unitCost": 0,
                "subtotal": 0,
                "leadTimeDays": None,
                "location": None,
            })
            continue

        available = inv["quantity"] - inv["reserved"]
        shortfall = max(0.0, qty - available)
        status = (
            "in_stock"      if shortfall == 0 else
            "partial"       if available > 0  else
            "out_of_stock"
        )
        subtotal = qty * inv["unitCost"]
        total_cost += subtotal
        if shortfall > 0 and inv["leadTimeDays"]:
            max_lead_time = max(max_lead_time, inv["leadTimeDays"])

        results.append({
            "partNumber":   pn,
            "description":  inv["description"],
            "required":     qty,
            "available":    available,
            "reserved":     inv["reserved"],
            "status":       status,
            "shortfall":    shortfall,
            "unitCost":     inv["unitCost"],
            "subtotal":     subtotal,
            "leadTimeDays": inv["leadTimeDays"],
            "location":     inv["location"],
            "supplier":     inv["supplier"],
        })

    return jsonify({
        "ok": True,
        "results": results,
        "summary": {
            "totalItems":    len(results),
            "inStock":       sum(1 for r in results if r["status"] == "in_stock"),
            "partial":       sum(1 for r in results if r["status"] == "partial"),
            "outOfStock":    sum(1 for r in results if r["status"] == "out_of_stock"),
            "notFound":      sum(1 for r in results if r["status"] == "not_found"),
            "totalCost":     round(total_cost, 2),
            "maxLeadDays":   max_lead_time,
        },
    })


# ── Work Orders ───────────────────────────────────────────────────────────────

@app.route("/api/work-orders", methods=["GET"])
def api_get_work_orders():
    return jsonify(_load_work_orders())


@app.route("/api/work-orders", methods=["POST"])
def api_create_work_order():
    body = request.get_json(silent=True) or {}
    number = (body.get("number") or "").strip()
    if not number:
        return _err("WO number required")
    data = _load_work_orders()
    if any(o["number"] == number for o in data["orders"]):
        return _err(f"Work Order '{number}' already exists")

    bom_items = body.get("bomItems", [])
    total = sum(float(b.get("subtotal", 0)) for b in bom_items)

    wo = {
        "id":          f"wo-{uuid.uuid4().hex[:8]}",
        "number":      number,
        "project":     body.get("project", ""),
        "harnessId":   body.get("harnessId", ""),
        "description": body.get("description", ""),
        "createdBy":   body.get("createdBy", "Operator"),
        "createdAt":   str(date.today()),
        "status":      "draft",
        "bomItems":    bom_items,
        "totalCost":   round(total, 2),
        "notes":       body.get("notes", ""),
    }
    data["orders"].append(wo)
    _save_work_orders(data)

    # Reserve inventory items
    inv_data = _load_inventory()
    inv_map  = {i["partNumber"]: i for i in inv_data["items"]}
    for bi in bom_items:
        pn = bi.get("partNumber", "")
        if pn in inv_map:
            inv_map[pn]["reserved"] = float(inv_map[pn]["reserved"]) + float(bi.get("quantity", 0))
    _save_inventory(inv_data)

    agent_loop.log_action("create_work_order", body.get("createdBy", "ui"), {"number": number})
    return jsonify({"ok": True, "workOrder": wo})


@app.route("/api/work-orders/<wo_id>", methods=["PUT"])
def api_update_work_order(wo_id: str):
    body = request.get_json(silent=True) or {}
    data = _load_work_orders()
    wo = next((o for o in data["orders"] if o["id"] == wo_id), None)
    if not wo:
        return _err("Work order not found", 404)
    for k in ("status", "description", "notes", "bomItems"):
        if k in body:
            wo[k] = body[k]
    if "bomItems" in body:
        wo["totalCost"] = round(sum(float(b.get("subtotal", 0)) for b in body["bomItems"]), 2)
    _save_work_orders(data)
    return jsonify({"ok": True, "workOrder": wo})


@app.route("/api/work-orders/<wo_id>", methods=["DELETE"])
def api_delete_work_order(wo_id: str):
    data = _load_work_orders()
    wo = next((o for o in data["orders"] if o["id"] == wo_id), None)
    if not wo:
        return _err("Work order not found", 404)
    # Release reserved inventory
    inv_data = _load_inventory()
    inv_map  = {i["partNumber"]: i for i in inv_data["items"]}
    for bi in wo.get("bomItems", []):
        pn = bi.get("partNumber", "")
        if pn in inv_map:
            inv_map[pn]["reserved"] = max(0.0, float(inv_map[pn]["reserved"]) - float(bi.get("quantity", 0)))
    _save_inventory(inv_data)
    data["orders"] = [o for o in data["orders"] if o["id"] != wo_id]
    _save_work_orders(data)
    return jsonify({"ok": True})


# ── Inventory import / export ────────────────────────────────────────────────

@app.route("/api/inventory/parse-numbers", methods=["POST"])
def api_parse_numbers():
    """Parse an Apple .numbers file and return rows + headers as JSON."""
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "No file provided"}), 400
    f = request.files["file"]
    if not f.filename.lower().endswith(".numbers"):
        return jsonify({"ok": False, "error": "Expected a .numbers file"}), 400
    try:
        import numbers_parser, tempfile, os
        tmp = tempfile.NamedTemporaryFile(suffix=".numbers", delete=False)
        try:
            f.save(tmp.name)
            doc = numbers_parser.Document(tmp.name)
            sheet = doc.sheets[0]
            table = sheet.tables[0]
            all_rows = [[str(cell.value) if cell.value is not None else "" for cell in row] for row in table.iter_rows()]
        finally:
            os.unlink(tmp.name)
        if len(all_rows) < 2:
            return jsonify({"ok": False, "error": "Sheet is empty or has no data rows"}), 400
        headers = all_rows[0]
        rows = [dict(zip(headers, r)) for r in all_rows[1:] if any(v.strip() for v in r)]
        return jsonify({"ok": True, "headers": headers, "rows": rows})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/api/inventory/import", methods=["POST"])
def api_inventory_import():
    """
    Import inventory items from a parsed row list.
    Body: { rows: [{partNumber, description, category, quantity, reserved,
                    unit, location, unitCost, leadTimeDays, supplier, minStock}],
            mode: "append" | "replace" }
    Returns summary of added/updated items.
    """
    body = request.get_json(silent=True) or {}
    rows = body.get("rows", [])
    mode = body.get("mode", "append")
    if not rows:
        return _err("rows required")

    data = _load_inventory() if mode == "append" else {"items": []}
    inv_map = {i["partNumber"]: i for i in data["items"]}

    added = updated = skipped = 0
    for row in rows:
        pn = str(row.get("partNumber") or row.get("part_number") or row.get("PN") or "").strip()
        if not pn:
            skipped += 1
            continue
        item = {
            "id":           inv_map[pn]["id"] if pn in inv_map else f"INV-{uuid.uuid4().hex[:6].upper()}",
            "partNumber":   pn,
            "description":  str(row.get("description") or row.get("Description") or ""),
            "category":     str(row.get("category") or row.get("Category") or "General"),
            "quantity":     float(row.get("quantity") or row.get("Quantity") or row.get("qty") or 0),
            "reserved":     float(row.get("reserved") or row.get("Reserved") or 0),
            "unit":         str(row.get("unit") or row.get("Unit") or "pc"),
            "location":     str(row.get("location") or row.get("Location") or ""),
            "unitCost":     float(row.get("unitCost") or row.get("unit_cost") or row.get("Unit Cost") or row.get("cost") or 0),
            "leadTimeDays": int(float(row.get("leadTimeDays") or row.get("lead_time") or row.get("Lead Time") or 0)),
            "supplier":     str(row.get("supplier") or row.get("Supplier") or ""),
            "minStock":     float(row.get("minStock") or row.get("min_stock") or row.get("Min Stock") or 0),
        }
        if pn in inv_map:
            inv_map[pn].update(item)
            updated += 1
        else:
            inv_map[pn] = item
            added += 1

    data["items"] = list(inv_map.values())
    _save_inventory(data)
    return jsonify({"ok": True, "added": added, "updated": updated, "skipped": skipped,
                    "total": len(data["items"])})


@app.route("/api/inventory/export", methods=["GET"])
def api_inventory_export():
    """Export all inventory items as JSON (frontend converts to CSV/XLSX)."""
    data = _load_inventory()
    return jsonify({"ok": True, "items": data["items"]})


# ── Procurement (PR/PO documents) ─────────────────────────────────────────────

@app.route("/api/procurement", methods=["GET"])
def api_get_procurement():
    return jsonify(_load_procurement())


@app.route("/api/procurement", methods=["POST"])
def api_create_procurement():
    """Create a new PR/PO record with optional attached file (base64)."""
    body = request.get_json(silent=True) or {}
    number = (body.get("number") or "").strip()
    if not number:
        return _err("number required")

    data = _load_procurement()
    if any(o["number"] == number for o in data["orders"]):
        return _err(f"Document '{number}' already exists")

    # Save attached file to disk if provided
    file_ref = None
    if body.get("fileData") and body.get("fileName"):
        import base64 as _b64
        _DOCS_DIR.mkdir(parents=True, exist_ok=True)
        safe_name = f"{uuid.uuid4().hex[:8]}_{body['fileName'].replace('/', '_')}"
        file_bytes = _b64.b64decode(body["fileData"])
        (_DOCS_DIR / safe_name).write_bytes(file_bytes)
        file_ref = safe_name

    doc = {
        "id":          f"proc-{uuid.uuid4().hex[:8]}",
        "number":      number,
        "type":        body.get("type", "PO"),        # PO | PR | Quote | Invoice
        "description": body.get("description", ""),
        "supplier":    body.get("supplier", ""),
        "project":     body.get("project", ""),
        "createdAt":   str(date.today()),
        "createdBy":   body.get("createdBy", "Operator"),
        "status":      "pending",                     # pending | partial | complete | cancelled
        "totalValue":  float(body.get("totalValue") or 0),
        "currency":    body.get("currency", "EUR"),
        "missingItems":body.get("missingItems", ""),  # free text from user
        "notes":       body.get("notes", ""),
        "fileName":    body.get("fileName", ""),
        "fileRef":     file_ref,
        "fileType":    body.get("fileType", ""),
    }
    data["orders"].append(doc)
    _save_procurement(data)
    agent_loop.log_action("create_procurement", body.get("createdBy", "ui"), {"number": number})
    return jsonify({"ok": True, "document": doc})


@app.route("/api/procurement/import", methods=["POST"])
def api_import_procurement():
    """
    Bulk-import procurement documents from parsed rows.
    Supports both full PO/PR rows (with 'number') and requisition-line rows
    (description + qty + unit + unitCost + requestedDate). For requisition lines,
    a PR number is auto-generated from the description.
    Body: { rows: [...], mode: 'append'|'replace' }
    """
    body = request.get_json(silent=True) or {}
    rows = body.get("rows", [])
    mode = body.get("mode", "append")
    data = _load_procurement() if mode == "append" else {"orders": []}
    existing_numbers = {o["number"] for o in data["orders"]}
    added = skipped = 0
    seq = 1  # for auto-numbering rows that have no number at all

    # Pre-count how many times each raw PR ID appears in this import batch
    # so we know whether to append a line suffix.
    from collections import Counter as _Counter
    raw_numbers = [str(r.get("number") or "").strip() for r in rows if str(r.get("description") or "").strip()]
    id_count = _Counter(raw_numbers)
    id_seen: dict = {}   # raw_id -> how many times we've already processed it

    for row in rows:
        description = str(row.get("description") or "").strip()
        if not description:
            skipped += 1
            continue

        raw_number = str(row.get("number") or "").strip()

        if not raw_number:
            # No PR ID at all — generate from description
            slug = description[:20].upper().replace(" ", "-").replace("/", "-")
            base = f"PR-{slug}-{seq:03d}"
            candidate = base
            c = 1
            while candidate in existing_numbers:
                candidate = f"{base}-{c}"; c += 1
            number = candidate
            seq += 1
        elif id_count[raw_number] > 1:
            # Same PR ID appears on multiple lines — append a line suffix
            line_idx = id_seen.get(raw_number, 0) + 1
            id_seen[raw_number] = line_idx
            number = f"{raw_number}-L{line_idx:02d}"
            # Ensure uniqueness against already-imported records
            candidate = number
            c = 1
            while candidate in existing_numbers:
                candidate = f"{number}-{c}"; c += 1
            number = candidate
        else:
            number = raw_number
            if number in existing_numbers:
                skipped += 1
                continue

        def _parse_number(v) -> float:
            """Parse a numeric value treating '.' as decimal separator.
            Commas are treated as thousands separators and stripped.
            Examples: '528.90' -> 528.9, '1,234.56' -> 1234.56, '52890' -> 52890.0
            """
            if v is None:
                return 0.0
            s = str(v).strip()
            # Remove thousands commas: '1,234.56' -> '1234.56'
            s = s.replace(",", "")
            # Remove any stray currency symbols or spaces
            s = s.replace("€", "").replace("$", "").replace(" ", "")
            try:
                return float(s) if s else 0.0
            except ValueError:
                return 0.0

        try:
            qty = _parse_number(row.get("qty") or row.get("quantity") or 1) or 1.0
        except (ValueError, TypeError):
            qty = 1.0

        # "estimated cost" from a PR export is the LINE TOTAL (not unit price).
        # Store it directly as totalValue; derive unitCost = total / qty.
        estimated_cost = _parse_number(row.get("estimatedCost") or row.get("cost") or 0)
        explicit_unit  = _parse_number(row.get("unitCost") or 0)
        explicit_total = _parse_number(row.get("totalValue") or row.get("value") or 0)

        if explicit_total:
            total_val = explicit_total
            unit_cost = explicit_unit or (round(total_val / qty, 6) if qty else 0.0)
        elif explicit_unit:
            unit_cost = explicit_unit
            total_val = round(unit_cost * qty, 4)
        elif estimated_cost:
            # estimated cost = line total
            total_val = estimated_cost
            unit_cost = round(total_val / qty, 6) if qty else 0.0
        else:
            total_val = 0.0
            unit_cost = 0.0

        doc = {
            "id":            f"proc-{uuid.uuid4().hex[:8]}",
            "number":        number,
            "type":          str(row.get("type") or "PR").strip(),
            "description":   description,
            "supplier":      str(row.get("supplier") or "").strip(),
            "project":       str(row.get("project") or "").strip(),
            "createdAt":     str(row.get("createdAt") or date.today()),
            "createdBy":     "import",
            "status":        str(row.get("status") or "pending").strip(),
            "totalValue":    total_val,
            "currency":      str(row.get("currency") or "EUR").strip(),
            "missingItems":  str(row.get("missingItems") or "").strip(),
            "notes":         str(row.get("notes") or "").strip(),
            "fileName":      "",
            "fileRef":       None,
            "fileType":      "",
            "qty":           qty,
            "unit":          str(row.get("unit") or row.get("uom") or "each").strip(),
            "unitCost":      unit_cost,
            "requestedDate": str(row.get("requestedDate") or row.get("requestDate") or "").strip(),
            "partNumber":    str(row.get("partNumber") or row.get("pn") or row.get("part_number") or "").strip(),
        }
        data["orders"].append(doc)
        existing_numbers.add(number)
        added += 1

    _save_procurement(data)
    return jsonify({"ok": True, "added": added, "skipped": skipped, "total": len(data["orders"])})


def _sync_one_inv_item(inv_data: dict, pn: str, qty: float, doc: dict, line: dict | None = None) -> str:
    """Sync a single PN into inventory. Returns 'created'|'updated'|'skipped'."""
    existing = next((i for i in inv_data["items"] if i["partNumber"] == pn), None)
    proc_ref = doc.get("number", "")
    desc = (line or {}).get("description") or doc.get("description", "")
    unit = (line or {}).get("unit") or doc.get("unit", "each")
    unit_cost = float((line or {}).get("unitCost") or doc.get("unitCost") or 0)
    if existing:
        existing["quantity"] = round(existing["quantity"] + qty, 4)
        if doc.get("supplier") and not existing.get("supplier"):
            existing["supplier"] = doc["supplier"]
        if proc_ref and not existing.get("procRef"):
            existing["procRef"] = proc_ref
        return "updated"
    else:
        inv_data["items"].append({
            "id":           f"INV-{uuid.uuid4().hex[:6].upper()}",
            "partNumber":   pn,
            "description":  desc,
            "category":     doc.get("notes", "General") or "General",
            "quantity":     qty,
            "reserved":     0.0,
            "unit":         unit,
            "location":     "",
            "unitCost":     unit_cost,
            "leadTimeDays": 0,
            "supplier":     doc.get("supplier", ""),
            "minStock":     0.0,
            "procRef":      proc_ref,
        })
        return "created"


def _sync_proc_to_inventory(doc: dict) -> dict:
    """
    Called when a procurement doc is marked complete.
    If doc has lineItems, syncs each line; otherwise falls back to single partNumber/qty.
    Returns {"created": N, "updated": N, "skipped": N}
    """
    inv_data = _load_inventory()
    results = {"created": 0, "updated": 0, "skipped": 0}

    line_items = doc.get("lineItems") or []
    if line_items:
        for line in line_items:
            pn = str(line.get("partNumber") or "").strip()
            if not pn:
                results["skipped"] += 1
                continue
            qty = float(line.get("qty") or 0)
            action = _sync_one_inv_item(inv_data, pn, qty, doc, line)
            results[action] += 1
    else:
        pn = (doc.get("partNumber") or "").strip()
        if not pn:
            results["skipped"] += 1
        else:
            qty = float(doc.get("qty") or 0)
            action = _sync_one_inv_item(inv_data, pn, qty, doc)
            results[action] += 1

    _save_inventory(inv_data)
    return results


@app.route("/api/procurement/bulk-complete", methods=["POST"])
def api_bulk_complete_procurement():
    """Mark all (or a list of) procurement docs as complete and sync to inventory."""
    body = request.get_json(silent=True) or {}
    ids = body.get("ids")   # optional list; if absent, marks all non-cancelled docs
    data = _load_procurement()
    updated = 0
    inv_results = []
    for doc in data["orders"]:
        if ids is not None and doc["id"] not in ids:
            continue
        if doc.get("status") == "cancelled":
            continue
        was_complete = doc.get("status") == "complete"
        doc["status"] = "complete"
        updated += 1
        if not was_complete:
            inv_results.append(_sync_proc_to_inventory(doc))
    _save_procurement(data)
    created = sum(r.get("created", 0) for r in inv_results)
    updated_inv = sum(r.get("updated", 0) for r in inv_results)
    return jsonify({"ok": True, "marked": updated,
                    "inventoryCreated": created, "inventoryUpdated": updated_inv})


@app.route("/api/procurement/<doc_id>", methods=["PUT"])
def api_update_procurement(doc_id: str):
    body = request.get_json(silent=True) or {}
    data = _load_procurement()
    doc = next((o for o in data["orders"] if o["id"] == doc_id), None)
    if not doc:
        return _err("Document not found", 404)
    prev_status = doc.get("status")
    for k in ("status", "description", "supplier", "project",
              "totalValue", "currency", "missingItems", "notes", "type",
              "partNumber", "qty", "unit", "unitCost", "requestedDate", "lineItems"):
        if k in body:
            doc[k] = body[k]
    # Sync inventory when transitioning to complete
    inv_result = None
    if body.get("status") == "complete" and prev_status != "complete":
        inv_result = _sync_proc_to_inventory(doc)
    _save_procurement(data)
    return jsonify({"ok": True, "document": doc, "inventorySync": inv_result})


@app.route("/api/procurement/<doc_id>", methods=["DELETE"])
def api_delete_procurement(doc_id: str):
    data = _load_procurement()
    doc = next((o for o in data["orders"] if o["id"] == doc_id), None)
    if not doc:
        return _err("Document not found", 404)
    # Remove physical file
    if doc.get("fileRef"):
        f = _DOCS_DIR / doc["fileRef"]
        if f.exists():
            f.unlink()
    data["orders"] = [o for o in data["orders"] if o["id"] != doc_id]
    _save_procurement(data)
    return jsonify({"ok": True})


@app.route("/api/procurement/<doc_id>/download", methods=["GET"])
def api_download_procurement(doc_id: str):
    data = _load_procurement()
    doc = next((o for o in data["orders"] if o["id"] == doc_id), None)
    if not doc or not doc.get("fileRef"):
        return _err("File not found", 404)
    from flask import send_file
    f = _DOCS_DIR / doc["fileRef"]
    if not f.exists():
        return _err("File missing on disk", 404)
    return send_file(f, as_attachment=True, download_name=doc.get("fileName", doc["fileRef"]))


# ── Background AI insights ────────────────────────────────────────────────────

@app.route("/api/ai/insights", methods=["GET"])
def api_ai_insights():
    """
    Return lightweight insights derived from notes + WO history.
    If an LLM is configured, run a quick analysis; else return rule-based hints.
    """
    state  = agent_loop.load_state()
    orders = _load_work_orders()["orders"]
    inv    = _load_inventory()["items"]

    blocked_harnesses = [h for h in state["harnesses"] if h["blocked"]]
    low_stock = [i for i in inv if (i["quantity"] - i["reserved"]) <= i.get("minStock", 0)]
    pending_ecns = [e for e in state["ecns"] if e["status"] in ("pending", "aberto_sem_disposicao", "aberto_com_disposicao")]
    completed_wos = [o for o in orders if o["status"] == "complete"]

    # Rule-based insights (always available, no LLM needed)
    insights = []

    if blocked_harnesses:
        insights.append({
            "type": "warning",
            "title": "Production blocked",
            "detail": f"{len(blocked_harnesses)} harness(es) are blocked. Review ECNs and supplier status.",
            "source": "rule",
        })

    if low_stock:
        insights.append({
            "type": "risk",
            "title": "Low stock alert",
            "detail": f"{len(low_stock)} item(s) at or below minimum stock: " +
                      ", ".join(i["partNumber"] for i in low_stock[:3]) +
                      ("…" if len(low_stock) > 3 else ""),
            "source": "rule",
        })

    if pending_ecns:
        insights.append({
            "type": "info",
            "title": "ECNs awaiting approval",
            "detail": f"{len(pending_ecns)} ECN(s) pending. Delays in approval impact production schedule.",
            "source": "rule",
        })

    if completed_wos:
        avg_cost = sum(o["totalCost"] for o in completed_wos) / len(completed_wos)
        insights.append({
            "type": "info",
            "title": "Avg completed WO cost",
            "detail": f"Based on {len(completed_wos)} completed order(s): avg €{avg_cost:,.2f} per work order.",
            "source": "rule",
        })

    return jsonify({"ok": True, "insights": insights, "generatedAt": str(date.today())})


# ── SPA serving ──────────────────────────────────────────────────────────────

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def spa(path: str):
    if not _DIST.exists():
        return ("No dist/ found. Run: cd ewis-planning && npm run build", 503)
    full = _DIST / path
    if path and full.exists() and full.is_file():
        resp = send_from_directory(_DIST, path)
        # Hashed assets (JS/CSS) are immutable — long cache.
        # index.html must never be cached so the browser always gets the latest bundle hash.
        if path == "index.html" or not path:
            resp.headers["Cache-Control"] = "no-store"
        return resp
    resp = send_from_directory(_DIST, "index.html")
    resp.headers["Cache-Control"] = "no-store"
    return resp


# ── Responsibles ──────────────────────────────────────────────────────────────

_RESP_PATH = _HERE / "data" / "responsibles.json"

def _load_responsibles() -> dict:
    if _RESP_PATH.exists():
        try:
            return json.loads(_RESP_PATH.read_text("utf-8"))
        except Exception:
            pass
    return {"responsibles": []}

def _save_responsibles(data: dict) -> None:
    _backup(_RESP_PATH)
    _RESP_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")

@app.route("/api/responsibles", methods=["GET"])
def api_get_responsibles():
    return jsonify(_load_responsibles())

@app.route("/api/responsibles", methods=["POST"])
def api_create_responsible():
    """Only callable by AI chat — enforced by convention, not auth."""
    d = request.get_json() or {}
    name = (d.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "name required"}), 400
    data = _load_responsibles()
    new_id = "R-" + str(uuid.uuid4())[:6].upper()
    data["responsibles"].append({
        "id": new_id,
        "name": name,
        "role": d.get("role", ""),
        "active": True,
    })
    _save_responsibles(data)
    return jsonify({"ok": True, "id": new_id})

@app.route("/api/responsibles/<rid>", methods=["PUT"])
def api_update_responsible(rid):
    d = request.get_json() or {}
    data = _load_responsibles()
    for r in data["responsibles"]:
        if r["id"] == rid:
            for k in ("name", "role", "active"):
                if k in d:
                    r[k] = d[k]
            break
    _save_responsibles(data)
    return jsonify({"ok": True})

@app.route("/api/responsibles/<rid>", methods=["DELETE"])
def api_delete_responsible(rid):
    data = _load_responsibles()
    for r in data["responsibles"]:
        if r["id"] == rid:
            r["active"] = False
            break
    _save_responsibles(data)
    return jsonify({"ok": True})

# ── Phase Items ───────────────────────────────────────────────────────────────

_PI_PATH = _HERE / "data" / "phase_items.json"

def _load_pi() -> dict:
    if _PI_PATH.exists():
        try:
            return json.loads(_PI_PATH.read_text("utf-8"))
        except Exception:
            pass
    return {"items": []}

def _save_pi(data: dict) -> None:
    _backup(_PI_PATH)
    _PI_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")

@app.route("/api/phase-items/<project>/<phase>", methods=["GET"])
def api_get_phase_items(project, phase):
    data = _load_pi()
    items = [i for i in data["items"] if i["project"] == project and i["phase"] == phase]
    return jsonify({"items": items})

@app.route("/api/phase-items/<project>/<phase>", methods=["POST"])
def api_create_phase_item(project, phase):
    d = request.get_json() or {}
    title = (d.get("title") or "").strip()
    if not title:
        return jsonify({"ok": False, "error": "title required"}), 400
    data = _load_pi()
    item = {
        "id": "PI-" + str(uuid.uuid4())[:8].upper(),
        "project": project,
        "phase": phase,
        "title": title,
        "itemType": d.get("itemType", "task"),
        "status": "open",
        "responsibleId": d.get("responsibleId", ""),
        "dueDate": d.get("dueDate"),
        "notes": [],
        "comments": [],
        "agreements": [],
        "createdAt": date.today().isoformat(),
    }
    data["items"].append(item)
    _save_pi(data)
    return jsonify({"ok": True, "item": item})

@app.route("/api/phase-items/<item_id>", methods=["PUT"])
def api_update_phase_item(item_id):
    d = request.get_json() or {}
    data = _load_pi()
    for item in data["items"]:
        if item["id"] == item_id:
            for k in ("title", "itemType", "status", "responsibleId", "dueDate"):
                if k in d:
                    item[k] = d[k]
            break
    _save_pi(data)
    return jsonify({"ok": True})

@app.route("/api/phase-items/<item_id>", methods=["DELETE"])
def api_delete_phase_item(item_id):
    data = _load_pi()
    data["items"] = [i for i in data["items"] if i["id"] != item_id]
    _save_pi(data)
    return jsonify({"ok": True})

@app.route("/api/phase-items/<item_id>/<entry_type>", methods=["POST"])
def api_add_phase_item_entry(item_id, entry_type):
    if entry_type not in ("notes", "comments", "agreements"):
        return jsonify({"ok": False, "error": "invalid entry_type"}), 400
    d = request.get_json() or {}
    body = (d.get("body") or "").strip()
    if not body:
        return jsonify({"ok": False, "error": "body required"}), 400
    data = _load_pi()
    entry = {
        "id": str(uuid.uuid4())[:8],
        "body": body,
        "author": d.get("author", ""),
        "createdAt": date.today().isoformat(),
    }
    if entry_type == "agreements":
        entry["agreedBy"] = d.get("agreedBy", "")
        entry["entryStatus"] = d.get("entryStatus", "agreed")
    for item in data["items"]:
        if item["id"] == item_id:
            item.setdefault(entry_type, []).append(entry)
            break
    _save_pi(data)
    return jsonify({"ok": True, "entry": entry})

@app.route("/api/phase-items/<item_id>/<entry_type>/<entry_id>", methods=["DELETE"])
def api_delete_phase_item_entry(item_id, entry_type, entry_id):
    if entry_type not in ("notes", "comments", "agreements"):
        return jsonify({"ok": False, "error": "invalid entry_type"}), 400
    data = _load_pi()
    for item in data["items"]:
        if item["id"] == item_id:
            item[entry_type] = [e for e in item.get(entry_type, []) if e["id"] != entry_id]
            break
    _save_pi(data)
    return jsonify({"ok": True})

# ── Work Order Steps (time tracking) ─────────────────────────────────────────

@app.route("/api/work-orders/<wo_id>/steps/<step_id>/complete", methods=["POST"])
def api_complete_wo_step(wo_id, step_id):
    d = request.get_json() or {}
    actual_hours = float(d.get("actualHours", 0))
    completed_by = d.get("completedBy", "")
    notes = d.get("notes", "")
    data = _load_work_orders()
    wo = next((o for o in data["orders"] if o["id"] == wo_id), None)
    if not wo:
        return jsonify({"ok": False, "error": "not found"}), 404
    for step in wo.get("steps", []):
        if step["id"] == step_id:
            step["status"] = "done"
            step["actualHours"] = actual_hours
            step["completedBy"] = completed_by
            step["completedAt"] = date.today().isoformat()
            step["notes"] = notes
            break
    # Recalculate total actual hours
    wo["actualHours"] = sum(s.get("actualHours", 0) for s in wo.get("steps", []))
    pending = [s for s in wo.get("steps", []) if s["status"] not in ("done", "skipped")]
    if not pending:
        wo["status"] = "complete"
    _save_work_orders(data)
    return jsonify({"ok": True, "actualHours": wo["actualHours"], "woStatus": wo["status"]})

# ── Delay Events ─────────────────────────────────────────────────────────────

_EVENTS_PATH = _HERE / "data" / "events.json"

def _load_events() -> dict:
    if _EVENTS_PATH.exists():
        try:
            return json.loads(_EVENTS_PATH.read_text("utf-8"))
        except Exception:
            pass
    return {"events": []}

def _save_events(data: dict) -> None:
    _backup(_EVENTS_PATH)
    _EVENTS_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")

@app.route("/api/events", methods=["GET"])
def api_get_events():
    return jsonify(_load_events())

_EVENT_TYPES = ("Machine", "Tool", "Payment", "Material", "Contract", "Permit", "Other")

@app.route("/api/events", methods=["POST"])
def api_create_event():
    body = request.get_json(silent=True) or {}
    title = (body.get("title") or "").strip()
    if not title:
        return _err("title required")
    expected_by  = (body.get("expectedBy")  or "").strip()
    resolved_at  = (body.get("resolvedAt")  or "").strip()
    if not expected_by or not resolved_at:
        return _err("expectedBy and resolvedAt required")
    event = {
        "id":          f"EV-{uuid.uuid4().hex[:6].upper()}",
        "title":       title,
        "type":        body.get("type", "Other") if body.get("type") in _EVENT_TYPES else "Other",
        "expectedBy":  expected_by,
        "resolvedAt":  resolved_at,
        "description": (body.get("description") or "").strip(),
    }
    data = _load_events()
    data["events"].append(event)
    _save_events(data)
    return jsonify({"ok": True, "event": event})

@app.route("/api/events/<event_id>", methods=["PUT"])
def api_update_event(event_id: str):
    body = request.get_json(silent=True) or {}
    data = _load_events()
    ev = next((e for e in data["events"] if e["id"] == event_id), None)
    if not ev:
        return _err("Event not found", 404)
    for k in ("title", "expectedBy", "resolvedAt", "description"):
        if k in body:
            ev[k] = body[k]
    if "type" in body and body["type"] in _EVENT_TYPES:
        ev["type"] = body["type"]
    _save_events(data)
    return jsonify({"ok": True, "event": ev})

@app.route("/api/events/<event_id>", methods=["DELETE"])
def api_delete_event(event_id: str):
    data = _load_events()
    before = len(data["events"])
    data["events"] = [e for e in data["events"] if e["id"] != event_id]
    if len(data["events"]) == before:
        return _err("Event not found", 404)
    _save_events(data)
    return jsonify({"ok": True})

# ── Mate & Demate Log ────────────────────────────────────────────────────────

_MD_PATH = _HERE / "data" / "mate_demate.json"

def _load_md() -> dict:
    if _MD_PATH.exists():
        try:
            return json.loads(_MD_PATH.read_text("utf-8"))
        except Exception:
            pass
    return {"entries": []}

def _save_md(data: dict) -> None:
    _backup(_MD_PATH)
    _MD_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")

@app.route("/api/mate-demate", methods=["GET"])
def api_get_md():
    return jsonify(_load_md())

@app.route("/api/mate-demate", methods=["POST"])
def api_create_md():
    body = request.get_json(silent=True) or {}
    target_type = (body.get("targetType") or "").strip()
    target_id   = (body.get("targetId") or "").strip()
    fin         = (body.get("fin") or "").strip()
    part_number = (body.get("partNumber") or "").strip()
    operation   = (body.get("operation") or "").strip()
    operator    = (body.get("operator") or "").strip()
    date        = (body.get("date") or "").strip()
    if not fin or operation not in ("mate", "demate") or not date:
        return _err("fin, operation (mate|demate), and date are required")
    if target_type not in ("harness", "equipment") or not target_id:
        return _err("targetType (harness|equipment) and targetId are required")
    data = _load_md()
    entry = {
        "id":         f"MD-{uuid.uuid4().hex[:6].upper()}",
        "targetType": target_type,
        "targetId":   target_id,
        "fin":        fin,
        "partNumber": part_number,
        "operation":  operation,
        "date":       date,
        "operator":   operator,
        "notes":      (body.get("notes") or "").strip() or None,
    }
    data["entries"].append(entry)
    _save_md(data)
    return jsonify({"ok": True, "entry": entry}), 201

@app.route("/api/mate-demate/<entry_id>", methods=["DELETE"])
def api_delete_md(entry_id: str):
    data = _load_md()
    before = len(data["entries"])
    data["entries"] = [e for e in data["entries"] if e["id"] != entry_id]
    if len(data["entries"]) == before:
        return _err("Entry not found", 404)
    _save_md(data)
    return jsonify({"ok": True})

# ── Entry ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import threading
    import webbrowser

    # Seed state.json from template on first run, then migrate notes to files
    agent_loop.ensure_state_seeded()
    agent_loop.migrate_notes_to_files()

    debug = "--debug" in sys.argv

    if READONLY:
        # Read-only public server — exposed via Cloudflare tunnel.
        # Bound to 0.0.0.0 so cloudflared can reach it; port 5001.
        port = int(os.environ.get("FORGE_PORT", "5001"))
        host = "0.0.0.0"
        print(f"EWIS Forge [READ-ONLY] → http://0.0.0.0:{port}")
        print("  All write operations are blocked.")
        print("  Point cloudflared at this port.")
    else:
        # Full-access local server — bound to localhost only.
        cfg  = _load_cfg()
        host = "127.0.0.1"
        port = int(os.environ.get("FORGE_PORT", cfg.get("server", {}).get("port", 5000)))
        url  = f"http://localhost:{port}"
        print(f"EWIS Forge [FULL] → {url}")
        if not _DIST.exists():
            print("  No dist/ — run 'npm run dev' and open http://localhost:5173")
        elif "--no-browser" not in sys.argv and not debug:
            threading.Timer(1.2, lambda: webbrowser.open(url)).start()

    app.run(host=host, port=port, debug=debug)
