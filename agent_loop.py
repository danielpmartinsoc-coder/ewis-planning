"""
EWIS Planning Layer — Agent Loop

Same pattern as ElecDesign's agent_loop.py:
  messages → LLM (tool calling) → execute tools against draft → final_text

Write tools go to draft.json (equivalent of ElecDesign's shadow rev).
The draft is a full copy of the proposed state + a change log documenting
who requested what. The user must accept or reject the draft explicitly.

Public API:
    run(messages, config, state, requested_by, context) → {final_text, tool_trace, draft_status, ...}
"""

from __future__ import annotations

import copy
import datetime
import json
import pathlib
import uuid
from typing import Any, Dict, List, Optional

import llm_provider as llm_mod

_HERE        = pathlib.Path(__file__).parent
_DATA_DIR    = _HERE / "data"
_STATE_PATH  = _DATA_DIR / "state.json"
_DRAFT_PATH  = _DATA_DIR / "draft.json"
_LOG_PATH    = _DATA_DIR / "audit_log.json"
_CFG_PATH    = _HERE / "ewis_config.json"
_NOTES_DIR   = _DATA_DIR / "notes"

_DEFAULT_MAX_ITERS = 10
_RESULT_CHAR_BUDGET = 6000


# ── Per-harness notes (separate files so state.json stays small) ─────────────

def load_harness_notes(harness_id: str) -> list:
    path = _NOTES_DIR / f"{harness_id}.json"
    if path.exists():
        try:
            return json.loads(path.read_text("utf-8"))
        except Exception:
            return []
    return []


def save_harness_notes(harness_id: str, notes: list) -> None:
    _NOTES_DIR.mkdir(exist_ok=True)
    path = _NOTES_DIR / f"{harness_id}.json"
    path.write_text(json.dumps(notes, indent=2, ensure_ascii=False), "utf-8")


def migrate_notes_to_files() -> None:
    """One-time migration: move notes arrays out of state.json into per-harness files."""
    if not _STATE_PATH.exists():
        return
    state = json.loads(_STATE_PATH.read_text("utf-8"))
    changed = False
    for h in state.get("harnesses", []):
        if "notes" in h:
            existing = load_harness_notes(h["id"])
            # merge: avoid duplicating if already migrated
            if h["notes"] and not existing:
                save_harness_notes(h["id"], h["notes"])
            h["noteCount"] = len(h["notes"]) if not existing else len(existing)
            del h["notes"]
            changed = True
        elif "noteCount" not in h:
            h["noteCount"] = len(load_harness_notes(h["id"]))
            changed = True
    if changed:
        _STATE_PATH.write_text(json.dumps(state, indent=2, ensure_ascii=False), "utf-8")

STAGES = ["BoM", "Procurement", "Stocking", "Kit/Cut/Mark",
          "Ready", "In Execution", "Done", "Delivered"]

# ── Audit log ────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _load_log() -> List[dict]:
    if _LOG_PATH.exists():
        try:
            return json.loads(_LOG_PATH.read_text("utf-8"))
        except Exception:
            return []
    return []


def _save_log(entries: List[dict]) -> None:
    cfg = _load_cfg()
    max_e = int(cfg.get("audit_log", {}).get("max_entries", 10000))
    if len(entries) > max_e:
        entries = entries[-max_e:]
    _DATA_DIR.mkdir(exist_ok=True)
    _LOG_PATH.write_text(json.dumps(entries, indent=2, ensure_ascii=False), "utf-8")


def log_action(action: str, requested_by: str, details: dict) -> None:
    cfg = _load_cfg()
    if not cfg.get("audit_log", {}).get("enabled", True):
        return
    entries = _load_log()
    entries.append({"timestamp": _now(), "action": action,
                    "requested_by": requested_by, **details})
    _save_log(entries)


def get_log(limit: int = 100) -> List[dict]:
    entries = _load_log()
    return list(reversed(entries[-limit:]))


# ── Config ───────────────────────────────────────────────────────────────────

def _load_cfg() -> dict:
    if _CFG_PATH.exists():
        try:
            return json.loads(_CFG_PATH.read_text("utf-8"))
        except Exception:
            return {}
    return {}


# ── State I/O ────────────────────────────────────────────────────────────────

def ensure_state_seeded() -> None:
    """On first run, seed state.json from the committed template (state.seed.json).

    state.json is runtime data (gitignored). The seed is the versioned starting
    point so a fresh clone has demo data without state.json ever conflicting on pull.
    """
    if _STATE_PATH.exists():
        return
    seed = _DATA_DIR / "state.seed.json"
    _DATA_DIR.mkdir(exist_ok=True)
    if seed.exists():
        _STATE_PATH.write_text(seed.read_text("utf-8"), "utf-8")
    else:
        _STATE_PATH.write_text(
            json.dumps({"harnesses": [], "milestones": [], "ecns": [], "people": []},
                       indent=2, ensure_ascii=False), "utf-8")


def load_state() -> dict:
    if not _STATE_PATH.exists():
        ensure_state_seeded()
    if _STATE_PATH.exists():
        return json.loads(_STATE_PATH.read_text("utf-8"))
    return {"harnesses": [], "milestones": [], "ecns": [], "people": []}


def save_state(state: dict) -> None:
    _DATA_DIR.mkdir(exist_ok=True)
    _STATE_PATH.write_text(json.dumps(state, indent=2, ensure_ascii=False), "utf-8")


# ── Draft (shadow equivalent) ────────────────────────────────────────────────

def draft_status() -> dict:
    if not _DRAFT_PATH.exists():
        return {"has_draft": False}
    try:
        d = json.loads(_DRAFT_PATH.read_text("utf-8"))
        return {
            "has_draft": True,
            "draft_id":    d.get("id"),
            "started_at":  d.get("started_at"),
            "requested_by": d.get("requested_by"),
            "message":     d.get("message"),
            "change_count": len(d.get("changes", [])),
            "changes":     d.get("changes", []),
        }
    except Exception:
        return {"has_draft": False}


def _start_draft(state: dict, requested_by: str, message: str) -> dict:
    """Create a draft copy of state — like shadow.start() in ElecDesign."""
    draft = {
        "id":           str(uuid.uuid4())[:8],
        "started_at":   _now(),
        "requested_by": requested_by,
        "message":      message,
        "state":        copy.deepcopy(state),
        "changes":      [],
    }
    _DRAFT_PATH.write_text(json.dumps(draft, indent=2, ensure_ascii=False), "utf-8")
    return draft


def _load_draft() -> Optional[dict]:
    if not _DRAFT_PATH.exists():
        return None
    try:
        return json.loads(_DRAFT_PATH.read_text("utf-8"))
    except Exception:
        return None


def _save_draft(draft: dict) -> None:
    _DRAFT_PATH.write_text(json.dumps(draft, indent=2, ensure_ascii=False), "utf-8")


def accept_draft(approved_by: str) -> dict:
    """Promote draft to active state — like shadow.accept() in ElecDesign."""
    draft = _load_draft()
    if not draft:
        return {"ok": False, "error": "No draft to accept"}
    save_state(draft["state"])
    log_action("draft_accepted", approved_by, {
        "draft_id":     draft["id"],
        "requested_by": draft["requested_by"],
        "message":      draft["message"],
        "change_count": len(draft.get("changes", [])),
        "changes":      draft.get("changes", []),
    })
    _DRAFT_PATH.unlink(missing_ok=True)
    return {"ok": True, "state": draft["state"]}


def reject_draft(rejected_by: str) -> dict:
    """Discard draft without touching active state — like shadow.reject()."""
    draft = _load_draft()
    if not draft:
        return {"ok": False, "error": "No draft to reject"}
    log_action("draft_rejected", rejected_by, {
        "draft_id":     draft["id"],
        "requested_by": draft["requested_by"],
        "message":      draft["message"],
    })
    _DRAFT_PATH.unlink(missing_ok=True)
    return {"ok": True}


# ── Tool implementations (operate on a mutable state dict in memory) ─────────

def _tool_advance_stage(state: dict, harness_id: str, reason: str = "") -> dict:
    for h in state["harnesses"]:
        if h["id"] == harness_id:
            if h.get("blocked"):
                return {"ok": False, "error": f"{harness_id} is blocked — resolve block first"}
            if h["stage"] >= 7:
                return {"ok": False, "error": f"{harness_id} is already at final stage (Delivered)"}
            old = h["stage"]
            h["stage"] += 1
            if reason:
                _append_note(h, reason, move_direction="advance", stage_at_time=old)
            return {"ok": True, "harness_id": harness_id, "from": STAGES[old], "to": STAGES[h["stage"]]}
    return {"ok": False, "error": f"Harness {harness_id} not found"}


def _tool_regress_stage(state: dict, harness_id: str, reason: str = "") -> dict:
    for h in state["harnesses"]:
        if h["id"] == harness_id:
            if h.get("blocked"):
                return {"ok": False, "error": f"{harness_id} is blocked — resolve block first"}
            if h["stage"] <= 0:
                return {"ok": False, "error": f"{harness_id} is already at first stage (BoM)"}
            old = h["stage"]
            h["stage"] -= 1
            if reason:
                _append_note(h, reason, move_direction="back", stage_at_time=old)
            return {"ok": True, "harness_id": harness_id, "from": STAGES[old], "to": STAGES[h["stage"]]}
    return {"ok": False, "error": f"Harness {harness_id} not found"}


def _append_note(h: dict, text: str, move_direction: Optional[str] = None, stage_at_time: Optional[int] = None) -> None:
    """Append a system note to a harness notes file (used by move/block operations)."""
    import uuid as _uuid
    note: dict = {
        "id": str(_uuid.uuid4())[:13],
        "timestamp": datetime.datetime.now().isoformat(),
        "author": "system",
        "text": text,
        "attachments": [],
    }
    if move_direction:
        note["moveDirection"] = move_direction
    if stage_at_time is not None:
        note["stageAtTime"] = stage_at_time
    notes = load_harness_notes(h["id"])
    notes.append(note)
    save_harness_notes(h["id"], notes)
    h["noteCount"] = len(notes)
    h.pop("notes", None)


def _tool_add_note(state: dict, harness_id: str, note: dict) -> dict:
    for h in state["harnesses"]:
        if h["id"] == harness_id:
            notes = load_harness_notes(harness_id)
            notes.append(note)
            save_harness_notes(harness_id, notes)
            h["noteCount"] = len(notes)
            h.pop("notes", None)  # notes never live in state dict
            return {"ok": True, "harness_id": harness_id, "note_id": note.get("id", ""), "note_count": len(notes)}
    return {"ok": False, "error": f"Harness {harness_id} not found"}


def _tool_register_block(state: dict, harness_id: str, reason: str, responsible: str = "") -> dict:
    for h in state["harnesses"]:
        if h["id"] == harness_id:
            h["blocked"] = True
            h["blockReason"] = reason
            if responsible:
                h["responsible"] = responsible
            return {"ok": True, "harness_id": harness_id, "reason": reason}
    return {"ok": False, "error": f"Harness {harness_id} not found"}


def _tool_resolve_block(state: dict, harness_id: str, note: str = "") -> dict:
    for h in state["harnesses"]:
        if h["id"] == harness_id:
            if not h.get("blocked"):
                return {"ok": False, "error": f"{harness_id} is not blocked"}
            h["blocked"] = False
            h.pop("blockReason", None)
            h["blockResolvedAt"]   = _now()[:10]
            h["blockResolvedNote"] = note
            return {"ok": True, "harness_id": harness_id}
    return {"ok": False, "error": f"Harness {harness_id} not found"}


def _tool_update_milestone(state: dict, project: str, phase: str,
                           status: str, actual_date: Optional[str] = None) -> dict:
    for ms in state["milestones"]:
        if ms["project"] == project and ms["phase"] == phase:
            ms["status"] = status
            if actual_date is not None:
                ms["actual"] = actual_date or None
            return {"ok": True, "project": project, "phase": phase, "status": status}
    return {"ok": False, "error": f"Milestone {project}/{phase} not found"}


def _tool_update_ecn_status(state: dict, ecn_id: str, status: str) -> dict:
    for ecn in state["ecns"]:
        if ecn["id"] == ecn_id:
            ecn["status"] = status
            return {"ok": True, "ecn_id": ecn_id, "status": status}
    return {"ok": False, "error": f"ECN {ecn_id} not found"}


def _tool_add_ecn(state: dict, description: str, affected_harnesses: List[str],
                  raised_by: str, affected_bom_items: Optional[List[str]] = None,
                  status: str = "pending") -> dict:
    existing_ids = [e["id"] for e in state["ecns"]]
    n = len(existing_ids) + 1
    while f"ECN-{n:03d}" in existing_ids:
        n += 1
    ecn_id = f"ECN-{n:03d}"
    new_ecn = {
        "id":                 ecn_id,
        "description":        description,
        "affectedHarnesses":  affected_harnesses,
        "affectedBOMItems":   affected_bom_items or [],
        "status":             status,
        "raisedBy":           raised_by,
        "raisedAt":           _now()[:10],
    }
    state["ecns"].append(new_ecn)
    return {"ok": True, "ecn_id": ecn_id}


def _tool_read_state(state: dict, filter_project: Optional[str] = None,
                     include: Optional[List[str]] = None) -> dict:
    inc = set(include or ["harnesses", "milestones", "ecns"])
    result: dict = {}
    if "harnesses" in inc:
        h_list = state["harnesses"]
        if filter_project:
            h_list = [h for h in h_list if h["project"] == filter_project]
        result["harnesses"] = h_list
    if "milestones" in inc:
        ms_list = state["milestones"]
        if filter_project:
            ms_list = [m for m in ms_list if m["project"] == filter_project]
        result["milestones"] = ms_list
    if "ecns" in inc:
        result["ecns"] = state["ecns"]
    return result


# ── Extra tool implementations ────────────────────────────────────────────────

def _tool_create_project(state: dict, name: str, planned_start: str = "") -> dict:
    name = name.strip()
    if not name:
        return {"ok": False, "error": "name required"}
    if any(h["project"] == name for h in state["harnesses"]) or \
       any(m["project"] == name for m in state["milestones"]):
        return {"ok": False, "error": f"Project '{name}' already exists"}
    today = datetime.date.today().isoformat()
    for ph, label in [("F2","Architecture Review"),("F3","Topology Freeze"),
                      ("F4","ICD Sign-off"),("F5","Schematic Release"),("F6","BoM Release")]:
        state["milestones"].append({
            "project": name, "phase": ph, "label": label,
            "planned": planned_start or today, "actual": None, "status": "open",
        })
    return {"ok": True, "project": name}


def _tool_create_harness(state: dict, project: str, harness_id: str, name: str,
                          responsible: str = "", planned_start: str = "",
                          planned_end: str = "") -> dict:
    harness_id = harness_id.strip().upper()
    if not harness_id or not name or not project:
        return {"ok": False, "error": "project, id and name required"}
    if any(h["id"] == harness_id for h in state["harnesses"]):
        return {"ok": False, "error": f"Harness ID '{harness_id}' already exists"}
    state["harnesses"].append({
        "id": harness_id, "project": project, "name": name.strip(),
        "stage": 0, "blocked": False, "responsible": responsible,
        "revision": "A", "ecns": [], "noteCount": 0, "notes": [],
        "plannedStart": planned_start or None,
        "plannedEnd":   planned_end   or None,
        "actualStart":  None, "actualEnd": None,
    })
    return {"ok": True, "harness_id": harness_id}


def _tool_set_schedule(state: dict, harness_id: str, planned_start: str = "",
                        planned_end: str = "", actual_start: str = "",
                        actual_end: str = "") -> dict:
    for h in state["harnesses"]:
        if h["id"] == harness_id:
            if planned_start is not None: h["plannedStart"] = planned_start or None
            if planned_end   is not None: h["plannedEnd"]   = planned_end   or None
            if actual_start  is not None: h["actualStart"]  = actual_start  or None
            if actual_end    is not None: h["actualEnd"]    = actual_end    or None
            return {"ok": True, "harness_id": harness_id}
    return {"ok": False, "error": f"Harness {harness_id} not found"}


def _tool_update_harness(state: dict, harness_id: str, name: str = "",
                          responsible: str = "", revision: str = "") -> dict:
    for h in state["harnesses"]:
        if h["id"] == harness_id:
            if name:        h["name"]        = name.strip()
            if responsible: h["responsible"] = responsible.strip()
            if revision:    h["revision"]    = revision.strip()
            return {"ok": True, "harness_id": harness_id}
    return {"ok": False, "error": f"Harness {harness_id} not found"}


def _tool_delete_harness(state: dict, harness_id: str) -> dict:
    before = len(state["harnesses"])
    state["harnesses"] = [h for h in state["harnesses"] if h["id"] != harness_id]
    if len(state["harnesses"]) == before:
        return {"ok": False, "error": f"Harness {harness_id} not found"}
    return {"ok": True, "harness_id": harness_id}


def _tool_update_ecn(state: dict, ecn_id: str, description: str = "",
                     status: str = "", raised_by: str = "",
                     affected_harnesses: Optional[List[str]] = None,
                     affected_bom_items: Optional[List[str]] = None) -> dict:
    for e in state.get("ecns", []):
        if e["id"] == ecn_id:
            if description:          e["description"]      = description
            if status:               e["status"]           = status
            if raised_by:            e["raisedBy"]         = raised_by
            if affected_harnesses is not None: e["affectedHarnesses"] = affected_harnesses
            if affected_bom_items  is not None: e["affectedBOMItems"]  = affected_bom_items
            return {"ok": True, "ecn_id": ecn_id}
    return {"ok": False, "error": f"ECN {ecn_id} not found"}


def _tool_delete_ecn(state: dict, ecn_id: str) -> dict:
    before = len(state.get("ecns", []))
    state["ecns"] = [e for e in state.get("ecns", []) if e["id"] != ecn_id]
    if len(state["ecns"]) == before:
        return {"ok": False, "error": f"ECN {ecn_id} not found"}
    for h in state["harnesses"]:
        h["ecns"] = [e for e in h.get("ecns", []) if e.get("id") != ecn_id]
    return {"ok": True, "ecn_id": ecn_id}


def _tool_read_inventory() -> dict:
    inv_path = _HERE / "data" / "inventory.json"
    if inv_path.exists():
        try:
            return json.loads(inv_path.read_text("utf-8"))
        except Exception:
            pass
    return {"items": []}


def _tool_update_stock(part_number: str, quantity_delta: float, reason: str = "") -> dict:
    inv_path = _HERE / "data" / "inventory.json"
    data = json.loads(inv_path.read_text("utf-8")) if inv_path.exists() else {"items": []}
    item = next((i for i in data["items"] if i["partNumber"] == part_number), None)
    if not item:
        return {"ok": False, "error": f"Part '{part_number}' not found in inventory"}
    item["quantity"] = max(0.0, float(item["quantity"]) + quantity_delta)
    inv_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")
    return {"ok": True, "partNumber": part_number, "newQuantity": item["quantity"]}


# ── Tool dispatch ─────────────────────────────────────────────────────────────

_WRITE_TOOLS = {
    "advance_stage", "regress_stage", "register_block", "resolve_block",
    "update_milestone", "update_ecn_status", "add_ecn", "update_ecn", "delete_ecn",
    "add_note", "create_project", "create_harness", "update_harness", "delete_harness",
    "set_schedule", "update_stock",
}

_TOOL_SCHEMAS = [
    {
        "name": "advance_stage",
        "description": "Advance a harness to the next F7 execution stage. Fails if the harness is blocked.",
        "parameters": {
            "type": "object",
            "properties": {
                "harness_id": {"type": "string", "description": "e.g. H-F01"},
                "reason":     {"type": "string", "description": "Reason for advancing (saved as a note)"}
            },
            "required": ["harness_id"]
        }
    },
    {
        "name": "regress_stage",
        "description": "Move a harness back to the previous F7 execution stage. Fails if the harness is blocked or already at first stage.",
        "parameters": {
            "type": "object",
            "properties": {
                "harness_id": {"type": "string", "description": "e.g. H-F01"},
                "reason":     {"type": "string", "description": "Reason for moving back (saved as a note)"}
            },
            "required": ["harness_id"]
        }
    },
    {
        "name": "add_note",
        "description": "Add a text note (with optional metadata) to a harness. Use for observations, updates, or documentation.",
        "parameters": {
            "type": "object",
            "properties": {
                "harness_id": {"type": "string"},
                "author":     {"type": "string", "description": "Name of the person adding the note"},
                "text":       {"type": "string", "description": "Note content"},
            },
            "required": ["harness_id", "author", "text"]
        }
    },
    {
        "name": "register_block",
        "description": "Register a block on a harness, preventing stage advancement until resolved.",
        "parameters": {
            "type": "object",
            "properties": {
                "harness_id":  {"type": "string"},
                "reason":      {"type": "string", "description": "What is causing the block"},
                "responsible": {"type": "string", "description": "Engineer responsible for resolution"}
            },
            "required": ["harness_id", "reason"]
        }
    },
    {
        "name": "resolve_block",
        "description": "Clear an active block on a harness, allowing stage advancement to resume.",
        "parameters": {
            "type": "object",
            "properties": {
                "harness_id": {"type": "string"},
                "note":       {"type": "string", "description": "How the block was resolved"}
            },
            "required": ["harness_id"]
        }
    },
    {
        "name": "update_milestone",
        "description": "Update a project phase milestone status or actual completion date.",
        "parameters": {
            "type": "object",
            "properties": {
                "project":     {"type": "string", "description": "FALCON, ALPHA, or PROJ-001"},
                "phase":       {"type": "string", "enum": ["F2", "F3", "F4", "F5", "F6"]},
                "status":      {"type": "string", "enum": ["done", "risk", "blocked", "open"]},
                "actual_date": {"type": "string", "description": "ISO date YYYY-MM-DD or null to clear"}
            },
            "required": ["project", "phase", "status"]
        }
    },
    {
        "name": "update_ecn_status",
        "description": "Update the status of an existing ECN (approve or reject it).",
        "parameters": {
            "type": "object",
            "properties": {
                "ecn_id": {"type": "string"},
                "status": {"type": "string", "enum": ["pending", "approved", "rejected"]}
            },
            "required": ["ecn_id", "status"]
        }
    },
    {
        "name": "add_ecn",
        "description": "Register a new Engineering Change Notice.",
        "parameters": {
            "type": "object",
            "properties": {
                "description":         {"type": "string"},
                "affected_harnesses":  {"type": "array", "items": {"type": "string"}},
                "affected_bom_items":  {"type": "array", "items": {"type": "string"}},
                "raised_by":           {"type": "string"},
                "status":              {"type": "string", "enum": ["pending", "approved", "rejected"]}
            },
            "required": ["description", "affected_harnesses", "raised_by"]
        }
    },
    {
        "name": "create_project",
        "description": "Create a new programme with auto-seeded F2–F6 milestones.",
        "parameters": {
            "type": "object",
            "properties": {
                "name":          {"type": "string", "description": "Programme name, e.g. FALCON-2"},
                "planned_start": {"type": "string", "description": "ISO date YYYY-MM-DD"}
            },
            "required": ["name"]
        }
    },
    {
        "name": "create_harness",
        "description": "Add a new harness to an existing programme at stage 0 (BoM).",
        "parameters": {
            "type": "object",
            "properties": {
                "project":       {"type": "string"},
                "harness_id":    {"type": "string", "description": "Unique ID, e.g. H-F09"},
                "name":          {"type": "string"},
                "responsible":   {"type": "string"},
                "planned_start": {"type": "string", "description": "ISO date YYYY-MM-DD"},
                "planned_end":   {"type": "string", "description": "ISO date YYYY-MM-DD"}
            },
            "required": ["project", "harness_id", "name"]
        }
    },
    {
        "name": "update_harness",
        "description": "Rename a harness or change its responsible engineer / revision.",
        "parameters": {
            "type": "object",
            "properties": {
                "harness_id":  {"type": "string"},
                "name":        {"type": "string"},
                "responsible": {"type": "string"},
                "revision":    {"type": "string"}
            },
            "required": ["harness_id"]
        }
    },
    {
        "name": "delete_harness",
        "description": "Permanently delete a harness from the programme.",
        "parameters": {
            "type": "object",
            "properties": {"harness_id": {"type": "string"}},
            "required": ["harness_id"]
        }
    },
    {
        "name": "set_schedule",
        "description": "Set planned or actual start/end dates on a harness for production scheduling.",
        "parameters": {
            "type": "object",
            "properties": {
                "harness_id":    {"type": "string"},
                "planned_start": {"type": "string", "description": "ISO date YYYY-MM-DD"},
                "planned_end":   {"type": "string", "description": "ISO date YYYY-MM-DD"},
                "actual_start":  {"type": "string", "description": "ISO date YYYY-MM-DD"},
                "actual_end":    {"type": "string", "description": "ISO date YYYY-MM-DD"}
            },
            "required": ["harness_id"]
        }
    },
    {
        "name": "update_ecn",
        "description": "Edit an existing ECN — description, status, affected harnesses or BOM items.",
        "parameters": {
            "type": "object",
            "properties": {
                "ecn_id":              {"type": "string"},
                "description":         {"type": "string"},
                "status":              {"type": "string", "enum": ["pending", "approved", "rejected"]},
                "raised_by":           {"type": "string"},
                "affected_harnesses":  {"type": "array", "items": {"type": "string"}},
                "affected_bom_items":  {"type": "array", "items": {"type": "string"}}
            },
            "required": ["ecn_id"]
        }
    },
    {
        "name": "delete_ecn",
        "description": "Delete an ECN and remove it from all affected harnesses.",
        "parameters": {
            "type": "object",
            "properties": {"ecn_id": {"type": "string"}},
            "required": ["ecn_id"]
        }
    },
    {
        "name": "read_inventory",
        "description": "Read current inventory stock levels to check availability before planning.",
        "parameters": {"type": "object", "properties": {}}
    },
    {
        "name": "update_stock",
        "description": "Adjust inventory quantity for a part (positive = add stock, negative = consume).",
        "parameters": {
            "type": "object",
            "properties": {
                "part_number":    {"type": "string"},
                "quantity_delta": {"type": "number", "description": "Amount to add (positive) or remove (negative)"},
                "reason":         {"type": "string"}
            },
            "required": ["part_number", "quantity_delta"]
        }
    },
    {
        "name": "read_state",
        "description": ("Read current programme state — harnesses, milestones, ECNs. "
                        "Use this to check current values before making changes."),
        "parameters": {
            "type": "object",
            "properties": {
                "filter_project": {"type": "string",
                                   "description": "Optional project name to filter, or omit for all"},
                "include": {"type": "array", "items": {"type": "string"},
                            "description": "Subset: harnesses, milestones, ecns"}
            }
        }
    },
]


def _call_tool(name: str, args: dict, draft_state: dict, changes: list) -> Any:
    if name == "advance_stage":
        result = _tool_advance_stage(draft_state, args["harness_id"], args.get("reason", ""))
        if result.get("ok"):
            changes.append({"op": "advance_stage", **result})
    elif name == "regress_stage":
        result = _tool_regress_stage(draft_state, args["harness_id"], args.get("reason", ""))
        if result.get("ok"):
            changes.append({"op": "regress_stage", **result})
    elif name == "add_note":
        import uuid as _uuid2, datetime as _dt2
        note = {
            "id": str(_uuid2.uuid4())[:13],
            "timestamp": _dt2.datetime.now().isoformat(),
            "author": args.get("author", "system"),
            "text": args.get("text", ""),
            "attachments": [],
        }
        result = _tool_add_note(draft_state, args["harness_id"], note)
        if result.get("ok"):
            changes.append({"op": "add_note", "harness_id": args["harness_id"]})
    elif name == "register_block":
        result = _tool_register_block(draft_state, args["harness_id"],
                                      args["reason"], args.get("responsible", ""))
        if result.get("ok"):
            changes.append({"op": "register_block", **result})
    elif name == "resolve_block":
        result = _tool_resolve_block(draft_state, args["harness_id"], args.get("note", ""))
        if result.get("ok"):
            changes.append({"op": "resolve_block", **result})
    elif name == "update_milestone":
        result = _tool_update_milestone(draft_state, args["project"], args["phase"],
                                        args["status"], args.get("actual_date"))
        if result.get("ok"):
            changes.append({"op": "update_milestone", **result})
    elif name == "update_ecn_status":
        result = _tool_update_ecn_status(draft_state, args["ecn_id"], args["status"])
        if result.get("ok"):
            changes.append({"op": "update_ecn_status", **result})
    elif name == "add_ecn":
        result = _tool_add_ecn(draft_state, args["description"],
                               args["affected_harnesses"], args["raised_by"],
                               args.get("affected_bom_items"), args.get("status", "pending"))
        if result.get("ok"):
            changes.append({"op": "add_ecn", **result})
    elif name == "create_project":
        result = _tool_create_project(draft_state, args["name"], args.get("planned_start", ""))
        if result.get("ok"):
            changes.append({"op": "create_project", "project": args["name"]})
    elif name == "create_harness":
        result = _tool_create_harness(
            draft_state, args["project"], args["harness_id"], args["name"],
            args.get("responsible", ""), args.get("planned_start", ""), args.get("planned_end", ""))
        if result.get("ok"):
            changes.append({"op": "create_harness", **result})
    elif name == "update_harness":
        result = _tool_update_harness(draft_state, args["harness_id"],
            args.get("name", ""), args.get("responsible", ""), args.get("revision", ""))
        if result.get("ok"):
            changes.append({"op": "update_harness", **result})
    elif name == "delete_harness":
        result = _tool_delete_harness(draft_state, args["harness_id"])
        if result.get("ok"):
            changes.append({"op": "delete_harness", **result})
    elif name == "set_schedule":
        result = _tool_set_schedule(
            draft_state, args["harness_id"],
            args.get("planned_start", ""), args.get("planned_end", ""),
            args.get("actual_start", ""), args.get("actual_end", ""))
        if result.get("ok"):
            changes.append({"op": "set_schedule", **result})
    elif name == "update_ecn":
        result = _tool_update_ecn(
            draft_state, args["ecn_id"],
            args.get("description", ""), args.get("status", ""), args.get("raised_by", ""),
            args.get("affected_harnesses"), args.get("affected_bom_items"))
        if result.get("ok"):
            changes.append({"op": "update_ecn", **result})
    elif name == "delete_ecn":
        result = _tool_delete_ecn(draft_state, args["ecn_id"])
        if result.get("ok"):
            changes.append({"op": "delete_ecn", **result})
    elif name == "read_inventory":
        result = _tool_read_inventory()
    elif name == "update_stock":
        result = _tool_update_stock(
            args["part_number"], float(args["quantity_delta"]), args.get("reason", ""))
        if result.get("ok"):
            changes.append({"op": "update_stock", **result})
    elif name == "read_state":
        result = _tool_read_state(draft_state, args.get("filter_project"), args.get("include"))
    else:
        result = {"error": f"Unknown tool: {name}"}
    return result


def _fmt(result: Any) -> str:
    s = json.dumps(result, default=str, ensure_ascii=False)
    return s[:_RESULT_CHAR_BUDGET] + "...[truncated]" if len(s) > _RESULT_CHAR_BUDGET else s


# ── System prompt ────────────────────────────────────────────────────────────

def _build_system_prompt(state: dict, requested_by: str, context: Optional[dict]) -> str:
    blocked = [h["id"] for h in state["harnesses"] if h.get("blocked")]
    pending_ecns = [e["id"] for e in state["ecns"] if e["status"] == "pending"]
    risk_ms = [f"{m['project']}/{m['phase']}" for m in state["milestones"] if m["status"] in ("risk", "blocked")]
    projects = sorted({h["project"] for h in state["harnesses"]})

    lines = [
        "You are an EWIS Planning Layer assistant for aerospace electrical wiring interconnection "
        "system programme management.",
        f"Today: {_now()[:10]}",
        f"Requested by: {requested_by}",
        "",
        "Programme summary:",
        f"  Projects: {', '.join(projects)}",
        f"  Total harnesses: {len(state['harnesses'])}",
        f"  Blocked harnesses: {', '.join(blocked) if blocked else 'none'}",
        f"  Pending ECNs: {', '.join(pending_ecns) if pending_ecns else 'none'}",
        f"  Milestones at risk/blocked: {', '.join(risk_ms) if risk_ms else 'none'}",
    ]

    if context:
        sel = context.get("selection")
        if sel:
            lines.append(f"  User is looking at: {sel}")
        recent = context.get("recent_actions") or []
        if recent:
            lines.append(f"  Recent actions: {' | '.join(str(a) for a in recent[-4:])}")

    lines += [
        "",
        "Rules:",
        "  - A blocked harness cannot advance stage — resolve block first",
        "  - F2–F6 are milestone events (planned date vs. actual date), no sub-stages",
        "  - F7 has 8 sequential stages per harness: " + " → ".join(STAGES),
        "  - Blocked is an overlay on any F7 stage, not a stage itself",
        "  - ECNs affect specific harnesses, not entire projects",
        "  - Multiple projects share the same engineer pool",
        "  - Use read_state or read_inventory before changes to verify current values",
        "  - set_schedule requires ISO dates YYYY-MM-DD; omit fields you are not changing",
        "",
        "Write operations apply IMMEDIATELY — no user approval step.",
        "Be precise: reference harness IDs and project names explicitly.",
        "At the end, summarise exactly what was changed.",
    ]
    return "\n".join(lines)


# ── Main entry point ─────────────────────────────────────────────────────────

def run(
    messages: List[Dict[str, Any]],
    config: Optional[Dict[str, Any]] = None,
    state: Optional[dict] = None,
    requested_by: str = "Operator",
    context: Optional[Dict[str, Any]] = None,
    max_iters: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Drive the tool-use loop. Write tools apply directly to live state with no
    user approval step — the AI has the same permissions as a direct UI action.

    Returns:
        final_text:   last LLM message
        tool_trace:   [{iteration, name, args, result?, error?}]
        messages:     full conversation with tool turns
        stop_reason:  "ok" | "max_iters" | "error"
        draft_status: always {has_draft: False} — drafts are disabled
    """
    if config is None:
        config = _load_cfg()
    if state is None:
        state = load_state()
    if max_iters is None:
        try:
            max_iters = int(config.get("ai", {}).get("max_tool_iters", _DEFAULT_MAX_ITERS))
        except (TypeError, ValueError):
            max_iters = _DEFAULT_MAX_ITERS

    provider = llm_mod.from_config(config)

    # Work on live state directly — no draft
    draft_state = copy.deepcopy(state)
    changes: list = []

    # Build conversation: system prompt + context + history
    sys_prompt = _build_system_prompt(state, requested_by, context)
    convo: List[Dict[str, Any]] = [{"role": "system", "content": sys_prompt}] + list(messages)

    trace: List[Dict[str, Any]] = []
    final_text = ""
    stop_reason = "ok"

    for i in range(max_iters):
        try:
            resp = provider.chat(convo, tools=_TOOL_SCHEMAS)
        except llm_mod.LLMError as exc:
            stop_reason = "error"
            final_text = f"[LLM error: {exc}]"
            break

        text = resp.get("text") or ""
        tool_calls = resp.get("tool_calls") or []

        assistant_msg: Dict[str, Any] = {"role": "assistant", "content": text}
        if tool_calls:
            assistant_msg["tool_calls"] = [
                {"id": tc["id"], "type": "function",
                 "function": {"name": tc["name"], "arguments": json.dumps(tc["args"])}}
                for tc in tool_calls
            ]
        convo.append(assistant_msg)

        if not tool_calls:
            final_text = text
            break

        for tc in tool_calls:
            name = tc["name"]
            args = dict(tc.get("args") or {})
            try:
                result = _call_tool(name, args, draft_state, changes)
                trace.append({"iteration": i, "name": name, "args": args, "result": result})
                payload = _fmt(result)
            except Exception as exc:
                trace.append({"iteration": i, "name": name, "args": args, "error": str(exc)})
                payload = json.dumps({"error": str(exc)})

            convo.append({"role": "tool", "tool_call_id": tc.get("id", ""),
                          "name": name, "content": payload})

            # After every write tool call, persist live state immediately
            if name in _WRITE_TOOLS and result.get("ok"):
                save_state(draft_state)
            log_action("tool_call", requested_by, {"tool": name, "args": args})
    else:
        stop_reason = "max_iters"
        final_text = "[Tool-use loop hit iteration cap — stopping.]"

    # Final persist (catches last write if loop exited cleanly)
    if changes:
        save_state(draft_state)

    # Log the overall agent run
    log_action("agent_run", requested_by, {
        "message":     next((m["content"] for m in reversed(messages) if m.get("role") == "user"), ""),
        "tool_count":  len(trace),
        "change_count": len(changes),
        "stop_reason": stop_reason,
    })

    return {
        "final_text":   final_text,
        "tool_trace":   trace,
        "messages":     convo,
        "stop_reason":  stop_reason,
        "draft_status": {"has_draft": False},
    }
