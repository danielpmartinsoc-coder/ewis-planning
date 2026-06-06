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
import pathlib
import sys
import traceback
import uuid
from datetime import date

from flask import Flask, jsonify, request, send_from_directory

import agent_loop

_HERE    = pathlib.Path(__file__).parent
_DIST    = _HERE / "dist"
_CFG_PATH = _HERE / "ewis_config.json"
_INV_PATH    = _HERE / "data" / "inventory.json"
_DNOTES_PATH = _HERE / "data" / "design_notes.json"
_WO_PATH     = _HERE / "data" / "work_orders.json"
_PROC_PATH   = _HERE / "data" / "procurement.json"
_DOCS_DIR    = _HERE / "data" / "documents"


# ── Inventory helpers ─────────────────────────────────────────────────────────

def _load_inventory() -> dict:
    if _INV_PATH.exists():
        try:
            return json.loads(_INV_PATH.read_text("utf-8"))
        except Exception:
            pass
    return {"items": []}


def _save_inventory(data: dict) -> None:
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
    _PROC_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")

app = Flask(__name__, static_folder=None)
app.config["JSON_SORT_KEYS"] = False


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


# ── State ────────────────────────────────────────────────────────────────────

@app.route("/api/state", methods=["GET"])
def api_get_state():
    return jsonify(agent_loop.load_state())


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
        result = agent_loop._tool_advance_stage(state, payload.get("harness_id", ""), payload.get("reason", ""))
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
    limit = int(request.args.get("limit", 50))
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
    state = agent_loop.load_state()
    if any(h["id"] == hid for h in state["harnesses"]):
        return _err(f"Harness ID '{hid}' already exists")
    state["harnesses"].append({
        "id": hid,
        "project": project,
        "name": name,
        "stage": 0,
        "blocked": False,
        "responsible": body.get("responsible", ""),
        "revision": "A",
        "ecns": [],
        "noteCount": 0,
        "notes": [],
    })
    agent_loop.save_state(state)
    agent_loop.log_action("create_harness", body.get("by", "ui"), {"id": hid, "project": project})
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
    for k in ("name", "responsible", "revision",
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
        "id":               ecn_id,
        "description":      desc,
        "affectedHarnesses":body.get("affectedHarnesses", []),
        "affectedBOMItems": body.get("affectedBOMItems", []),
        "status":           body.get("status", "pending"),
        "raisedBy":         body.get("raisedBy", "Operator"),
        "raisedAt":         body.get("raisedAt", str(date.today())),
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
    for k in ("description", "status", "raisedBy", "raisedAt", "affectedHarnesses", "affectedBOMItems"):
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


@app.route("/api/inventory/<item_id>", methods=["PUT"])
def api_update_inventory_item(item_id: str):
    body = request.get_json(silent=True) or {}
    data = _load_inventory()
    item = next((i for i in data["items"] if i["id"] == item_id), None)
    if not item:
        return _err("Item not found", 404)
    for k in ("description", "category", "quantity", "reserved", "unit",
              "location", "unitCost", "leadTimeDays", "supplier", "minStock", "partNumber"):
        if k in body:
            item[k] = body[k]
    _save_inventory(data)
    return jsonify({"ok": True, "item": item})


@app.route("/api/inventory/<item_id>", methods=["DELETE"])
def api_delete_inventory_item(item_id: str):
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


@app.route("/api/procurement/<doc_id>", methods=["PUT"])
def api_update_procurement(doc_id: str):
    body = request.get_json(silent=True) or {}
    data = _load_procurement()
    doc = next((o for o in data["orders"] if o["id"] == doc_id), None)
    if not doc:
        return _err("Document not found", 404)
    for k in ("status", "description", "supplier", "project",
              "totalValue", "currency", "missingItems", "notes", "type"):
        if k in body:
            doc[k] = body[k]
    _save_procurement(data)
    return jsonify({"ok": True, "document": doc})


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
    pending_ecns = [e for e in state["ecns"] if e["status"] == "pending"]
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
        return send_from_directory(_DIST, path)
    return send_from_directory(_DIST, "index.html")


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

# ── Entry ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import threading
    import webbrowser

    # Seed state.json from template on first run, then migrate notes to files
    agent_loop.ensure_state_seeded()
    agent_loop.migrate_notes_to_files()

    cfg  = _load_cfg()
    host = cfg.get("server", {}).get("host", "0.0.0.0")
    port = int(cfg.get("server", {}).get("port", 8082))
    url  = f"http://localhost:{port}"

    no_browser = "--no-browser" in sys.argv
    debug      = "--debug" in sys.argv

    print(f"EWIS Planning server → {url}")

    if not no_browser and not debug:
        # In dev (no dist/), hint to use npm run dev; otherwise open Flask directly
        if not _DIST.exists():
            print(f"  No dist/ found — run 'npm run dev' and open http://localhost:5173")
        else:
            threading.Timer(1.2, lambda: webbrowser.open(url)).start()

    app.run(host=host, port=port, debug=debug)
