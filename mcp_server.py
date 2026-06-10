"""
EWIS Forge — MCP Server
Exposes all Forge operations as MCP tools so Claude can operate the system via chat.
Run via: .venv/bin/python mcp_server.py  (stdio transport, registered in ~/.claude/mcp.json)
The Flask API must be running on http://localhost:5000.
"""

from __future__ import annotations
from collections import defaultdict
from datetime import date
from typing import Any, Optional
import httpx
from mcp.server.fastmcp import FastMCP

BASE = "http://localhost:5000/api"
mcp  = FastMCP("ewis-forge")

STAGES = ["BoM", "Procurement", "Stocking", "Kit/Cut/Mark",
          "Ready", "In Execution", "Done", "Delivered"]


# ── HTTP helpers ───────────────────────────────────────────────────────────────

def _get(path: str) -> Any:
    r = httpx.get(f"{BASE}{path}", timeout=10)
    r.raise_for_status()
    return r.json()

def _post(path: str, body: dict) -> Any:
    r = httpx.post(f"{BASE}{path}", json=body, timeout=10)
    r.raise_for_status()
    return r.json()

def _put(path: str, body: dict) -> Any:
    r = httpx.put(f"{BASE}{path}", json=body, timeout=10)
    r.raise_for_status()
    return r.json()

def _delete(path: str) -> Any:
    r = httpx.delete(f"{BASE}{path}", timeout=10)
    r.raise_for_status()
    return r.json()

def _ok(msg: str, extra: dict | None = None) -> str:
    parts = [f"✓ {msg}"]
    if extra:
        for k, v in extra.items():
            parts.append(f"  {k}: {v}")
    return "\n".join(parts)

def _stage_name(idx: int) -> str:
    return STAGES[idx] if 0 <= idx < len(STAGES) else str(idx)

def _fmt_harness(h: dict) -> str:
    sn = _stage_name(h["stage"])
    status = "BLOCKED" if h.get("blocked") else ("COMPLETE" if h.get("completed") else sn.upper())
    line = f"{h['id']} [{h['project']}]  stage={sn}  status={status}"
    if h.get("blocked"):
        line += f"  reason={h.get('blockReason','')}"
    if h.get("responsible"):
        line += f"  responsible={h['responsible']}"
    return line


# ══════════════════════════════════════════════════════════════════════════════
# OVERVIEW
# ══════════════════════════════════════════════════════════════════════════════

@mcp.tool()
def forge_summary() -> str:
    """
    Compact snapshot of the entire Forge: harness counts by stage, blocked list,
    ECN summary. Always call this first to understand current state.
    """
    state     = _get("/state")
    harnesses = state.get("harnesses", [])
    ecns      = state.get("ecns", [])

    blocked   = [h for h in harnesses if h.get("blocked")]
    completed = [h for h in harnesses if h.get("completed")]
    by_stage: dict[str, int] = {}
    for h in harnesses:
        s = _stage_name(h["stage"])
        by_stage[s] = by_stage.get(s, 0) + 1

    lines = [
        "=== EWIS FORGE SNAPSHOT ===",
        f"Total harnesses : {len(harnesses)}",
        f"Completed       : {len(completed)}",
        f"Blocked         : {len(blocked)}",
        f"ECNs pending    : {sum(1 for e in ecns if e['status'] == 'pending')}",
        f"ECNs approved   : {sum(1 for e in ecns if e['status'] == 'approved')}",
        "",
        "Stage distribution:",
    ]
    for s in STAGES:
        cnt = by_stage.get(s, 0)
        if cnt:
            lines.append(f"  {s:<18} {cnt:>3}")
    if blocked:
        lines += ["", "BLOCKED harnesses:"]
        for h in blocked:
            lines.append(f"  {h['id']} ({h['project']}) — {h.get('blockReason','')}")
    pending_ecns = [e for e in ecns if e["status"] == "pending"]
    if pending_ecns:
        lines += ["", "Pending ECNs:"]
        for e in pending_ecns:
            lines.append(f"  {e['id']} — {e['description'][:60]}")
    return "\n".join(lines)


# ══════════════════════════════════════════════════════════════════════════════
# HARNESSES — READ
# ══════════════════════════════════════════════════════════════════════════════

@mcp.tool()
def harness_list(
    project: Optional[str] = None,
    stage: Optional[str] = None,
    blocked: Optional[bool] = None,
    completed: Optional[bool] = None,
) -> str:
    """
    List harnesses with optional filters.
    - project: partial match on project name
    - stage: stage name, e.g. "Delivered", "In Execution"
    - blocked: True = only blocked
    - completed: True = only completed
    """
    state     = _get("/state")
    harnesses = state.get("harnesses", [])

    if project:
        harnesses = [h for h in harnesses if project.lower() in h.get("project", "").lower()]
    if stage:
        idx = next((i for i, s in enumerate(STAGES) if stage.lower() in s.lower()), None)
        if idx is not None:
            harnesses = [h for h in harnesses if h["stage"] == idx]
    if blocked is not None:
        harnesses = [h for h in harnesses if bool(h.get("blocked")) == blocked]
    if completed is not None:
        harnesses = [h for h in harnesses if bool(h.get("completed")) == completed]

    if not harnesses:
        return "No harnesses match the given filters."
    lines = [f"Found {len(harnesses)} harness(es):"]
    for h in harnesses:
        lines.append("  " + _fmt_harness(h))
    return "\n".join(lines)


@mcp.tool()
def harness_detail(harness_id: str) -> str:
    """Full detail for a single harness: stage, ECNs, schedule, hours log."""
    h = _get(f"/harness/{harness_id}")
    lines = [
        f"Harness: {h['id']}",
        f"  Project          : {h.get('project','')}",
        f"  Name             : {h.get('name','')}",
        f"  Stage            : {_stage_name(h['stage'])} (#{h['stage']})",
        f"  Blocked          : {h.get('blocked', False)}",
        f"  Completed        : {h.get('completed', False)}",
        f"  Responsible      : {h.get('responsible','')}",
        f"  Design resp.     : {h.get('designResponsible','')}",
        f"  Revision         : {h.get('revision','')}",
        f"  Planned          : {h.get('plannedStart','')} → {h.get('plannedEnd','')}",
        f"  Actual           : {h.get('actualStart','')} → {h.get('actualEnd','')}",
    ]
    if h.get("blockReason"):
        lines.append(f"  Block reason     : {h['blockReason']}")
    if h.get("ecns"):
        lines.append(f"  ECNs ({len(h['ecns'])}):")
        for e in h["ecns"]:
            lines.append(f"    {e['id']} [{e['status']}] {e['description'][:50]}")
    if h.get("stageHistory"):
        total_h = sum(e.get("hours", 0) for e in h["stageHistory"])
        lines.append(f"  Hours logged     : {total_h}h across {len(h['stageHistory'])} entries")
    return "\n".join(lines)


# ══════════════════════════════════════════════════════════════════════════════
# HARNESSES — WRITE
# ══════════════════════════════════════════════════════════════════════════════

@mcp.tool()
def harness_create(
    project: str,
    harness_id: str,
    name: str,
    responsible: str,
    revision: str = "A",
    design_responsible: str = "",
    planned_start: str = "",
    planned_end: str = "",
) -> str:
    """
    Create a new harness in an existing project.
    - harness_id: unique ID, e.g. "ARN-005-H01"
    - planned_start / planned_end: ISO dates, optional
    """
    res = _post("/harnesses", {
        "project": project,
        "id": harness_id,
        "name": name,
        "responsible": responsible,
        "by": "claude",
        "revision": revision,
        "designResponsible": design_responsible,
        "plannedStart": planned_start or None,
        "plannedEnd": planned_end or None,
    })
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"Harness {harness_id} created in {project}")


@mcp.tool()
def harness_update(
    harness_id: str,
    name: Optional[str] = None,
    responsible: Optional[str] = None,
    design_responsible: Optional[str] = None,
    revision: Optional[str] = None,
    planned_start: Optional[str] = None,
    planned_end: Optional[str] = None,
    actual_start: Optional[str] = None,
    actual_end: Optional[str] = None,
) -> str:
    """
    Edit harness metadata (name, responsible, revision, schedule dates).
    Only the fields you provide will be updated.
    """
    body: dict[str, Any] = {"by": "claude"}
    if name is not None:               body["name"] = name
    if responsible is not None:        body["responsible"] = responsible
    if design_responsible is not None: body["designResponsible"] = design_responsible
    if revision is not None:           body["revision"] = revision
    if planned_start is not None:      body["plannedStart"] = planned_start
    if planned_end is not None:        body["plannedEnd"] = planned_end
    if actual_start is not None:       body["actualStart"] = actual_start
    if actual_end is not None:         body["actualEnd"] = actual_end

    res = _put(f"/harnesses/{harness_id}", body)
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"Harness {harness_id} updated", {k: v for k, v in body.items() if k != "by"})


@mcp.tool()
def harness_delete(harness_id: str) -> str:
    """
    Permanently delete a harness. Cannot be undone.
    """
    res = _delete(f"/harnesses/{harness_id}")
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"Harness {harness_id} deleted")


@mcp.tool()
def harness_advance(harness_id: str, reason: str, actual_hours: float = 0.0) -> str:
    """
    Advance a harness to the next stage.
    - reason: what was accomplished
    - actual_hours: hours spent (for time tracking)
    """
    res = _post("/state/update", {
        "action": "advance_stage",
        "payload": {"harness_id": harness_id, "reason": reason, "actualHours": actual_hours},
        "by": "claude",
    })
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    hs = res.get("state", {}).get("harnesses", [])
    h  = next((x for x in hs if x["id"] == harness_id), None)
    sn = _stage_name(h["stage"]) if h else "?"
    return _ok(f"{harness_id} advanced → {sn}" + (f" | {actual_hours}h logged" if actual_hours else ""))


@mcp.tool()
def harness_back(harness_id: str, reason: str) -> str:
    """Move a harness back one stage."""
    res = _post("/state/update", {
        "action": "regress_stage",
        "payload": {"harness_id": harness_id, "reason": reason},
        "by": "claude",
    })
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"{harness_id} moved back one stage. Reason: {reason}")


@mcp.tool()
def harness_block(harness_id: str, reason: str, responsible: str = "") -> str:
    """Block a harness. Stops progress until resolved."""
    res = _post("/state/update", {
        "action": "register_block",
        "payload": {"harness_id": harness_id, "reason": reason, "responsible": responsible},
        "by": "claude",
    })
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"{harness_id} BLOCKED", {"Reason": reason, "Responsible": responsible or "—"})


@mcp.tool()
def harness_unblock(harness_id: str, note: str = "") -> str:
    """Resolve a block on a harness."""
    res = _post("/state/update", {
        "action": "resolve_block",
        "payload": {"harness_id": harness_id, "note": note},
        "by": "claude",
    })
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"{harness_id} unblocked", {"Note": note or "—"})


@mcp.tool()
def harness_complete(harness_id: str) -> str:
    """
    Mark a Delivered (stage 7) harness as Complete (final status flag).
    """
    res = _post(f"/harnesses/{harness_id}/complete", {"by": "claude"})
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"{harness_id} marked COMPLETE")


@mcp.tool()
def harness_note(harness_id: str, text: str, author: str = "claude") -> str:
    """Add a note/comment to a harness."""
    res = _post("/state/update", {
        "action": "add_note",
        "payload": {"harness_id": harness_id, "note": {"text": text, "author": author}},
        "by": "claude",
    })
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"Note added to {harness_id}")


@mcp.tool()
def harness_log_hours(harness_id: str, stage_history: list[dict]) -> str:
    """
    Replace the stage history (apontamento / hours log) for a harness.
    Each entry: {"stage": int, "hours": float, "date": "YYYY-MM-DD", "by": "name", "note": ""}
    Use harness_detail first to read the current stageHistory before overwriting.
    """
    res = _post(f"/harnesses/{harness_id}/stage_history", {"stageHistory": stage_history})
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    total = sum(e.get("hours", 0) for e in stage_history)
    return _ok(f"Stage history updated for {harness_id}", {"Entries": len(stage_history), "Total hours": total})


# ══════════════════════════════════════════════════════════════════════════════
# PROJECTS
# ══════════════════════════════════════════════════════════════════════════════

@mcp.tool()
def project_list() -> str:
    """List all projects with harness counts."""
    state     = _get("/state")
    harnesses = state.get("harnesses", [])
    projects  = sorted({h["project"] for h in harnesses})
    if not projects:
        return "No projects found."
    lines = [f"Projects ({len(projects)}):"]
    for proj in projects:
        hs = [h for h in harnesses if h["project"] == proj]
        blocked   = sum(1 for h in hs if h.get("blocked"))
        completed = sum(1 for h in hs if h.get("completed"))
        lines.append(f"  {proj}  — {len(hs)} harnesses  | blocked={blocked}  completed={completed}")
    return "\n".join(lines)


@mcp.tool()
def project_create(name: str, planned_start: str) -> str:
    """
    Create a new project/programme.
    - planned_start: ISO date, e.g. "2026-09-01"
    """
    res = _post("/projects", {"name": name, "plannedStart": planned_start, "by": "claude"})
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"Project '{name}' created", {"Planned start": planned_start})


@mcp.tool()
def project_rename(current_name: str, new_name: str) -> str:
    """
    Rename a project. Updates all harnesses and milestones that reference it.
    """
    res = _put(f"/projects/{current_name}", {"name": new_name, "by": "claude"})
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"Project renamed: '{current_name}' → '{new_name}'")


@mcp.tool()
def project_delete(project_name: str) -> str:
    """
    Delete a project and ALL its harnesses and milestones. Cannot be undone.
    """
    res = _delete(f"/projects/{project_name}")
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"Project '{project_name}' and all its harnesses deleted")


# ══════════════════════════════════════════════════════════════════════════════
# MILESTONES
# ══════════════════════════════════════════════════════════════════════════════

@mcp.tool()
def milestone_upsert(
    project: str,
    phase: str,
    label: str = "",
    planned: str = "",
    actual: str = "",
    status: str = "open",
) -> str:
    """
    Create or update a milestone for a project phase.
    - phase: milestone key, e.g. "Procurement", "Stocking"
    - status: 'open', 'done', 'delayed'
    """
    res = _post("/milestones", {
        "project": project,
        "phase": phase,
        "label": label or phase,
        "planned": planned or date.today().isoformat(),
        "actual": actual or None,
        "status": status,
    })
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"Milestone {project}/{phase} saved", {"Status": status, "Planned": planned})


@mcp.tool()
def milestone_delete(project: str, phase: str) -> str:
    """Delete a milestone."""
    res = _delete(f"/milestones/{project}/{phase}")
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"Milestone {project}/{phase} deleted")


# ══════════════════════════════════════════════════════════════════════════════
# ECN
# ══════════════════════════════════════════════════════════════════════════════

@mcp.tool()
def ecn_list(status: Optional[str] = None) -> str:
    """
    List ECNs. status: 'pending', 'approved', 'rejected' (omit for all).
    """
    ecns = _get("/state").get("ecns", [])
    if status:
        ecns = [e for e in ecns if e["status"] == status]
    if not ecns:
        return "No ECNs found."
    lines = [f"Found {len(ecns)} ECN(s):"]
    for e in ecns:
        lines.append(
            f"  {e['id']} [{e['status'].upper()}] {e['description'][:60]}"
            f"\n    Harnesses: {', '.join(e.get('affectedHarnesses', []))}"
            f"  BOM: {', '.join(e.get('affectedBOMItems', []))}"
        )
    return "\n".join(lines)


@mcp.tool()
def ecn_create(
    description: str,
    affected_harnesses: list[str],
    affected_bom_items: list[str],
    raised_by: str = "claude",
) -> str:
    """
    Create a new Engineering Change Notice.
    - affected_harnesses: list of harness IDs
    - affected_bom_items: list of part numbers
    """
    res = _post("/ecns", {
        "description": description,
        "affectedHarnesses": affected_harnesses,
        "affectedBOMItems": affected_bom_items,
        "status": "pending",
        "raisedBy": raised_by,
        "raisedAt": date.today().isoformat(),
    })
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    ecn = res.get("state", {}).get("ecns", [{}])[-1]
    return _ok(f"ECN created: {ecn.get('id', '?')}", {"Description": description[:60]})


@mcp.tool()
def ecn_approve(ecn_id: str) -> str:
    """Approve a pending ECN."""
    res = _put(f"/ecns/{ecn_id}", {"status": "approved"})
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"ECN {ecn_id} approved")


@mcp.tool()
def ecn_reject(ecn_id: str) -> str:
    """Reject a pending ECN."""
    res = _put(f"/ecns/{ecn_id}", {"status": "rejected"})
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"ECN {ecn_id} rejected")


@mcp.tool()
def ecn_delete(ecn_id: str) -> str:
    """
    Delete an ECN and remove its reference from all harnesses.
    """
    res = _delete(f"/ecns/{ecn_id}")
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"ECN {ecn_id} deleted")


# ══════════════════════════════════════════════════════════════════════════════
# INVENTORY
# ══════════════════════════════════════════════════════════════════════════════

@mcp.tool()
def inventory_query(
    part_number: Optional[str] = None,
    description: Optional[str] = None,
    category: Optional[str] = None,
    low_stock_only: bool = False,
) -> str:
    """
    Query inventory items (up to 30 results).
    - part_number: partial match
    - description: partial match
    - category: Wire, Cable, Connector, Backshell, Pin, Accessory, Tools, Consumable, Equipment, Other
    - low_stock_only: only items at or below minStock
    """
    items = _get("/inventory").get("items", [])
    if part_number:
        items = [i for i in items if part_number.upper() in i["partNumber"].upper()]
    if description:
        items = [i for i in items if description.lower() in i["description"].lower()]
    if category:
        items = [i for i in items if i["category"].lower() == category.lower()]
    if low_stock_only:
        items = [i for i in items if (i["quantity"] - i["reserved"]) <= i["minStock"]]
    if not items:
        return "No inventory items match."
    items = items[:30]
    lines = [f"Found {len(items)} item(s) (up to 30):"]
    for i in items:
        avail = i["quantity"] - i["reserved"]
        flag  = " ✗OUT" if avail <= 0 else (" ⚠LOW" if avail <= i["minStock"] else "")
        lines.append(
            f"  {i['partNumber']:<30}  qty={i['quantity']:>8} {i['unit']:<6}"
            f"  avail={avail:>8}{flag}  €{i['unitCost']:.2f}/unit"
            f"  [{i['category']}]  {i['description'][:40]}"
        )
    total = sum(i["unitCost"] * i["quantity"] for i in items)
    lines.append(f"\nTotal value (shown): EUR {total:,.2f}")
    return "\n".join(lines)


@mcp.tool()
def inventory_summary() -> str:
    """Total inventory value, breakdown by category, low/out-of-stock alerts."""
    items = _get("/inventory").get("items", [])
    by_cat: dict[str, dict] = defaultdict(lambda: {"count": 0, "value": 0.0})
    low_stock, out_stock = [], []
    for i in items:
        cat = i.get("category", "Other")
        by_cat[cat]["count"] += 1
        by_cat[cat]["value"] += i.get("unitCost", 0) * i.get("quantity", 0)
        avail = i["quantity"] - i.get("reserved", 0)
        if avail <= 0:
            out_stock.append(i["partNumber"])
        elif avail <= i.get("minStock", 0):
            low_stock.append(i["partNumber"])
    total_val = sum(i.get("unitCost", 0) * i.get("quantity", 0) for i in items)
    lines = [
        "=== INVENTORY SUMMARY ===",
        f"Total items : {len(items)}",
        f"Total value : EUR {total_val:,.2f}",
        "",
        f"{'Category':<16}  {'Items':>5}  {'Value (EUR)':>14}",
        "-" * 40,
    ]
    for cat, d in sorted(by_cat.items(), key=lambda x: -x[1]["value"]):
        lines.append(f"  {cat:<14}  {d['count']:>5}  {d['value']:>14,.2f}")
    if out_stock:
        lines += ["", f"✗ OUT OF STOCK ({len(out_stock)}): " + ", ".join(out_stock[:10])]
    if low_stock:
        lines += [f"⚠ LOW STOCK ({len(low_stock)}): " + ", ".join(low_stock[:10])]
    return "\n".join(lines)


@mcp.tool()
def inventory_create(
    part_number: str,
    description: str,
    category: str,
    quantity: float,
    unit: str,
    unit_cost: float = 0.0,
    supplier: str = "",
    location: str = "",
    min_stock: float = 0.0,
) -> str:
    """
    Create a new inventory item.
    - category: Wire, Cable, Connector, Backshell, Pin, Accessory, Tools, Consumable, Equipment, Other
    - unit: each, m, roll, pack, etc.
    """
    res = _post("/inventory", {
        "partNumber":   part_number,
        "description":  description,
        "category":     category,
        "quantity":     quantity,
        "reserved":     0.0,
        "unit":         unit,
        "location":     location,
        "unitCost":     unit_cost,
        "leadTimeDays": 0,
        "supplier":     supplier,
        "minStock":     min_stock,
    })
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"Inventory item created: {part_number}", {
        "Category": category, "Qty": f"{quantity} {unit}", "Unit cost": f"€{unit_cost}"
    })


@mcp.tool()
def inventory_adjust(part_number: str, qty_delta: float, reason: str) -> str:
    """
    Adjust stock quantity (positive = receive, negative = consume/issue).
    - part_number: exact part number
    - qty_delta: e.g. -5 to consume 5 units
    """
    items = _get("/inventory").get("items", [])
    item  = next((i for i in items if i["partNumber"].upper() == part_number.upper()), None)
    if not item:
        return f"✗ Part number '{part_number}' not found in inventory."
    new_qty = round(item["quantity"] + qty_delta, 4)
    if new_qty < 0:
        return f"✗ Cannot reduce below 0 (current: {item['quantity']}, delta: {qty_delta})"
    res = _put(f"/inventory/{item['id']}", {"quantity": new_qty})
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    action = "added" if qty_delta > 0 else "consumed"
    return _ok(f"{part_number}: {action} {abs(qty_delta)} {item['unit']}", {
        "Previous qty": item["quantity"], "New qty": new_qty, "Reason": reason
    })


@mcp.tool()
def inventory_update(
    part_number: str,
    description: Optional[str] = None,
    category: Optional[str] = None,
    unit_cost: Optional[float] = None,
    min_stock: Optional[float] = None,
    supplier: Optional[str] = None,
    location: Optional[str] = None,
    lead_time_days: Optional[int] = None,
) -> str:
    """
    Update metadata of an existing inventory item (not quantity — use inventory_adjust for that).
    Only fields you provide will be updated.
    """
    items = _get("/inventory").get("items", [])
    item  = next((i for i in items if i["partNumber"].upper() == part_number.upper()), None)
    if not item:
        return f"✗ Part number '{part_number}' not found."
    body: dict[str, Any] = {}
    if description is not None:    body["description"] = description
    if category is not None:       body["category"] = category
    if unit_cost is not None:      body["unitCost"] = unit_cost
    if min_stock is not None:      body["minStock"] = min_stock
    if supplier is not None:       body["supplier"] = supplier
    if location is not None:       body["location"] = location
    if lead_time_days is not None: body["leadTimeDays"] = lead_time_days
    if not body:
        return "✗ No fields provided to update."
    res = _put(f"/inventory/{item['id']}", body)
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"{part_number} updated", body)


@mcp.tool()
def inventory_delete(part_number: str) -> str:
    """
    Delete an inventory item by part number. Cannot be undone.
    """
    items = _get("/inventory").get("items", [])
    item  = next((i for i in items if i["partNumber"].upper() == part_number.upper()), None)
    if not item:
        return f"✗ Part number '{part_number}' not found."
    res = _delete(f"/inventory/{item['id']}")
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"Inventory item {part_number} deleted")


@mcp.tool()
def inventory_bom_analysis(bom_items: list[dict]) -> str:
    """
    Check availability and cost for a list of BOM items against current stock.
    Each item: {"partNumber": "...", "quantity": 5, "unit": "each"}
    Returns per-item: available qty, shortfall, unit cost, estimated lead time impact.
    """
    res = _post("/inventory/bom-analysis", {"items": bom_items})
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    results = res.get("results", [])
    total_cost = res.get("totalCost", 0)
    short = [r for r in results if r.get("shortfall", 0) > 0]
    ok_items = [r for r in results if not r.get("shortfall", 0)]
    lines = [
        f"BOM Analysis — {len(bom_items)} items | Total cost: EUR {total_cost:,.2f}",
        f"  Available: {len(ok_items)}   Shortfall: {len(short)}",
        "",
    ]
    for r in results:
        flag = " ✗ SHORTAGE" if r.get("shortfall", 0) > 0 else " ✓"
        lines.append(
            f"  {r.get('partNumber','?'):<30}  need={r.get('quantity',0)}  avail={r.get('available',0)}"
            f"  shortfall={r.get('shortfall',0)}  cost=€{r.get('cost',0):.2f}{flag}"
        )
    return "\n".join(lines)


# ══════════════════════════════════════════════════════════════════════════════
# PROCUREMENT
# ══════════════════════════════════════════════════════════════════════════════

@mcp.tool()
def procurement_list(
    status: Optional[str] = None,
    project: Optional[str] = None,
    doc_type: Optional[str] = None,
) -> str:
    """
    List procurement documents (up to 40).
    - status: 'pending', 'partial', 'complete', 'cancelled'
    - doc_type: 'PR', 'PO', 'Quote', 'Invoice'
    """
    docs = _get("/procurement").get("orders", [])
    if status:
        docs = [d for d in docs if d["status"] == status]
    if project:
        docs = [d for d in docs if project.lower() in d.get("project", "").lower()]
    if doc_type:
        docs = [d for d in docs if d["type"] == doc_type]
    if not docs:
        return "No procurement documents match."
    docs = docs[:40]
    total = sum(d.get("totalValue", 0) for d in docs)
    lines = [f"Found {len(docs)} doc(s) (up to 40) | Total: EUR {total:,.2f}"]
    for d in docs:
        lines.append(
            f"  {d.get('id',''):<8} {d['number']:<22} [{d['type']}] [{d['status'].upper():<9}]"
            f"  EUR {d.get('totalValue', 0):>10,.2f}  {d.get('description', '')[:40]}"
        )
    return "\n".join(lines)


@mcp.tool()
def procurement_summary() -> str:
    """Financial summary of all procurement: totals by status and type."""
    docs = _get("/procurement").get("orders", [])
    by_status: dict[str, dict] = defaultdict(lambda: {"count": 0, "value": 0.0})
    by_type:   dict[str, dict] = defaultdict(lambda: {"count": 0, "value": 0.0})
    for d in docs:
        s, t, v = d.get("status", "?"), d.get("type", "?"), d.get("totalValue", 0)
        by_status[s]["count"] += 1; by_status[s]["value"] += v
        by_type[t]["count"]   += 1; by_type[t]["value"]   += v
    total = sum(d.get("totalValue", 0) for d in docs)
    lines = [
        "=== PROCUREMENT SUMMARY ===",
        f"Total documents : {len(docs)}",
        f"Total value     : EUR {total:,.2f}",
        "", "By status:",
    ]
    for s, d in sorted(by_status.items()):
        lines.append(f"  {s:<12}  {d['count']:>4} docs  EUR {d['value']:>12,.2f}")
    lines.append("\nBy type:")
    for t, d in sorted(by_type.items()):
        lines.append(f"  {t:<8}  {d['count']:>4} docs  EUR {d['value']:>12,.2f}")
    return "\n".join(lines)


@mcp.tool()
def procurement_create(
    number: str,
    description: str,
    doc_type: str = "PR",
    supplier: str = "",
    project: str = "",
    total_value: float = 0.0,
    currency: str = "EUR",
    notes: str = "",
) -> str:
    """
    Create a new procurement document.
    - doc_type: 'PR' (default), 'PO', 'Quote', 'Invoice'
    """
    res = _post("/procurement", {
        "number": number, "type": doc_type, "description": description,
        "supplier": supplier, "project": project,
        "totalValue": total_value, "currency": currency,
        "notes": notes, "createdBy": "claude",
    })
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    doc = res.get("document", {})
    return _ok(f"Document created: {doc.get('id', '?')} [{number}]", {
        "Type": doc_type, "Value": f"{currency} {total_value:,.2f}", "Supplier": supplier or "—"
    })


@mcp.tool()
def procurement_update(doc_id: str, status: Optional[str] = None, notes: Optional[str] = None,
                       total_value: Optional[float] = None, supplier: Optional[str] = None) -> str:
    """
    Update a procurement document.
    - doc_id: document ID (from procurement_list)
    - status: 'pending', 'partial', 'complete', 'cancelled'
    Setting status to 'complete' auto-syncs inventory if a partNumber is linked.
    """
    body: dict[str, Any] = {}
    if status is not None:      body["status"] = status
    if notes is not None:       body["notes"] = notes
    if total_value is not None: body["totalValue"] = total_value
    if supplier is not None:    body["supplier"] = supplier
    if not body:
        return "✗ No fields provided."
    res = _put(f"/procurement/{doc_id}", body)
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    inv = res.get("inventorySync")
    extra = {k: v for k, v in body.items()}
    if inv:
        extra["inventorySync"] = f"{inv.get('action', '?')} {inv.get('partNumber', '')}"
    return _ok(f"Document {doc_id} updated", extra)


@mcp.tool()
def procurement_delete(doc_id: str) -> str:
    """
    Delete a procurement document (and its attached file if any). Cannot be undone.
    """
    res = _delete(f"/procurement/{doc_id}")
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"Procurement document {doc_id} deleted")


# ══════════════════════════════════════════════════════════════════════════════
# WORK ORDERS
# ══════════════════════════════════════════════════════════════════════════════

@mcp.tool()
def work_order_list(status: Optional[str] = None, project: Optional[str] = None) -> str:
    """
    List work orders.
    - status: 'draft', 'issued', 'in_progress', 'complete', 'cancelled'
    """
    orders = _get("/work-orders").get("orders", [])
    if status:
        orders = [o for o in orders if o["status"] == status]
    if project:
        orders = [o for o in orders if project.lower() in o.get("project", "").lower()]
    if not orders:
        return "No work orders match."
    lines = [f"Found {len(orders)} work order(s):"]
    for o in orders:
        lines.append(
            f"  {o.get('id',''):<8} {o['number']:<16}  [{o['status'].upper():<11}]"
            f"  {o.get('project','')}  {o.get('description','')[:35]}"
            f"  EUR {o.get('totalCost', 0):>8,.2f}"
        )
    return "\n".join(lines)


@mcp.tool()
def work_order_create(
    number: str,
    project: str,
    harness_id: str,
    description: str,
    expected_hours: float = 0.0,
    notes: str = "",
) -> str:
    """
    Create a new work order for a harness.
    - number: WO number, e.g. "WO-2026-001"
    """
    res = _post("/work-orders", {
        "number": number, "project": project, "harnessId": harness_id,
        "description": description, "createdBy": "claude",
        "expectedHours": expected_hours, "notes": notes,
        "bomItems": [], "totalCost": 0.0,
    })
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    wo = res.get("workOrder", {})
    return _ok(f"Work order created: {wo.get('id', '?')} [{number}]", {
        "Harness": harness_id, "Project": project
    })


@mcp.tool()
def work_order_update(
    wo_id: str,
    status: Optional[str] = None,
    description: Optional[str] = None,
    notes: Optional[str] = None,
    bom_items: Optional[list[dict]] = None,
) -> str:
    """
    Update a work order.
    - wo_id: work order ID
    - status: 'draft', 'issued', 'in_progress', 'complete', 'cancelled'
    - bom_items: list of BOM entries; each {"partNumber","description","quantity","unit","unitCost","subtotal"}
    """
    body: dict[str, Any] = {}
    if status is not None:      body["status"] = status
    if description is not None: body["description"] = description
    if notes is not None:       body["notes"] = notes
    if bom_items is not None:   body["bomItems"] = bom_items
    if not body:
        return "✗ No fields provided."
    res = _put(f"/work-orders/{wo_id}", body)
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    wo = res.get("workOrder", {})
    return _ok(f"Work order {wo_id} updated", {
        "Status": wo.get("status", "?"), "Total cost": f"EUR {wo.get('totalCost', 0):,.2f}"
    })


@mcp.tool()
def work_order_delete(wo_id: str) -> str:
    """
    Delete a work order and release its reserved inventory. Cannot be undone.
    """
    res = _delete(f"/work-orders/{wo_id}")
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"Work order {wo_id} deleted and inventory reservations released")


@mcp.tool()
def work_order_complete_step(wo_id: str, step_id: str, actual_hours: float = 0.0,
                              completed_by: str = "claude", notes: str = "") -> str:
    """
    Mark a step inside a work order as complete.
    - wo_id: work order ID
    - step_id: step ID (from work_order_list detail)
    - actual_hours: hours taken for this step
    """
    res = _post(f"/work-orders/{wo_id}/steps/{step_id}/complete", {
        "actualHours": actual_hours,
        "completedBy": completed_by,
        "notes": notes,
    })
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"WO {wo_id} step {step_id} completed", {
        "Hours": actual_hours, "By": completed_by
    })


# ══════════════════════════════════════════════════════════════════════════════
# RESPONSIBLES (operators / team members)
# ══════════════════════════════════════════════════════════════════════════════

@mcp.tool()
def responsible_list() -> str:
    """List all registered operators/team members."""
    data = _get("/responsibles")
    people = data.get("responsibles", [])
    if not people:
        return "No responsibles registered."
    lines = [f"Responsibles ({len(people)}):"]
    for p in people:
        active = "✓" if p.get("active", True) else "✗"
        lines.append(f"  [{active}] {p['id']}  {p['name']:<20}  {p.get('role','')}")
    return "\n".join(lines)


@mcp.tool()
def responsible_create(name: str, role: str = "") -> str:
    """
    Register a new operator/team member.
    - name: full name
    - role: e.g. "Production", "Design", "QA"
    """
    res = _post("/responsibles", {"name": name, "role": role})
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"Responsible '{name}' created", {"ID": res.get("id", "?"), "Role": role or "—"})


@mcp.tool()
def responsible_update(responsible_id: str, name: Optional[str] = None,
                        role: Optional[str] = None, active: Optional[bool] = None) -> str:
    """
    Update a responsible's name, role, or active status.
    - responsible_id: e.g. "R-A1B2C3"
    """
    body: dict[str, Any] = {}
    if name is not None:   body["name"] = name
    if role is not None:   body["role"] = role
    if active is not None: body["active"] = active
    if not body:
        return "✗ No fields provided."
    res = _put(f"/responsibles/{responsible_id}", body)
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"Responsible {responsible_id} updated", body)


@mcp.tool()
def responsible_deactivate(responsible_id: str) -> str:
    """
    Deactivate (soft-delete) a responsible. They remain in history but are hidden from active lists.
    """
    res = _delete(f"/responsibles/{responsible_id}")
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"Responsible {responsible_id} deactivated")


# ══════════════════════════════════════════════════════════════════════════════
# PHASE ITEMS (checklist / tasks per project phase)
# ══════════════════════════════════════════════════════════════════════════════

@mcp.tool()
def phase_item_list(project: str, phase: str) -> str:
    """
    List phase items (tasks/checklist) for a project phase.
    - phase: e.g. "Procurement", "Stocking"
    """
    items = _get(f"/phase-items/{project}/{phase}").get("items", [])
    if not items:
        return f"No phase items for {project}/{phase}."
    lines = [f"Phase items for {project}/{phase} ({len(items)}):"]
    for i in items:
        notes_ct = len(i.get("notes", [])) + len(i.get("comments", [])) + len(i.get("agreements", []))
        lines.append(
            f"  {i['id']}  [{i['status'].upper():<8}]  [{i.get('itemType','task')}]"
            f"  {i['title'][:50]}"
            f"  due={i.get('dueDate','—')}  entries={notes_ct}"
        )
    return "\n".join(lines)


@mcp.tool()
def phase_item_create(
    project: str,
    phase: str,
    title: str,
    item_type: str = "task",
    responsible_id: str = "",
    due_date: str = "",
) -> str:
    """
    Create a phase item (task, note, agreement) for a project phase.
    - item_type: 'task', 'note', 'agreement'
    - due_date: ISO date, optional
    """
    res = _post(f"/phase-items/{project}/{phase}", {
        "title": title,
        "itemType": item_type,
        "responsibleId": responsible_id,
        "dueDate": due_date or None,
    })
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    item = res.get("item", {})
    return _ok(f"Phase item created: {item.get('id', '?')}", {
        "Title": title, "Type": item_type, "Phase": f"{project}/{phase}"
    })


@mcp.tool()
def phase_item_update(
    item_id: str,
    title: Optional[str] = None,
    status: Optional[str] = None,
    item_type: Optional[str] = None,
    responsible_id: Optional[str] = None,
    due_date: Optional[str] = None,
) -> str:
    """
    Update a phase item.
    - status: 'open', 'in_progress', 'done', 'cancelled'
    """
    body: dict[str, Any] = {}
    if title is not None:          body["title"] = title
    if status is not None:         body["status"] = status
    if item_type is not None:      body["itemType"] = item_type
    if responsible_id is not None: body["responsibleId"] = responsible_id
    if due_date is not None:       body["dueDate"] = due_date
    if not body:
        return "✗ No fields provided."
    res = _put(f"/phase-items/{item_id}", body)
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"Phase item {item_id} updated", body)


@mcp.tool()
def phase_item_delete(item_id: str) -> str:
    """Delete a phase item."""
    res = _delete(f"/phase-items/{item_id}")
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"Phase item {item_id} deleted")


@mcp.tool()
def phase_item_add_entry(item_id: str, entry_type: str, body: str,
                          author: str = "claude", agreed_by: str = "") -> str:
    """
    Add a note, comment, or agreement to a phase item.
    - item_id: phase item ID
    - entry_type: 'notes', 'comments', or 'agreements'
    - body: text content
    - agreed_by: required for agreements — name of the person who agreed
    """
    if entry_type not in ("notes", "comments", "agreements"):
        return "✗ entry_type must be 'notes', 'comments', or 'agreements'"
    payload: dict[str, Any] = {"body": body, "author": author}
    if entry_type == "agreements":
        payload["agreedBy"] = agreed_by
        payload["entryStatus"] = "agreed"
    res = _post(f"/phase-items/{item_id}/{entry_type}", payload)
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    entry = res.get("entry", {})
    return _ok(f"Entry added to {item_id}", {"ID": entry.get("id", "?"), "Type": entry_type})


@mcp.tool()
def phase_item_delete_entry(item_id: str, entry_type: str, entry_id: str) -> str:
    """
    Delete a note, comment, or agreement from a phase item.
    - entry_type: 'notes', 'comments', or 'agreements'
    """
    if entry_type not in ("notes", "comments", "agreements"):
        return "✗ entry_type must be 'notes', 'comments', or 'agreements'"
    res = _delete(f"/phase-items/{item_id}/{entry_type}/{entry_id}")
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"Entry {entry_id} removed from {item_id}")


# ══════════════════════════════════════════════════════════════════════════════
# DESIGN NOTES (notes / comments / agreements per milestone)
# ══════════════════════════════════════════════════════════════════════════════

@mcp.tool()
def design_note_list(project: str, phase: str) -> str:
    """
    List design notes for a project/phase milestone.
    - phase: e.g. "Procurement", "Stocking"
    """
    notes = _get(f"/design-notes/{project}/{phase}").get("notes", [])
    if not notes:
        return f"No design notes for {project}/{phase}."
    lines = [f"Design notes for {project}/{phase} ({len(notes)}):"]
    for n in notes:
        lines.append(
            f"  {n['id']}  [{n.get('type','note').upper():<10}]"
            f"  {n.get('author','?')}  {n.get('timestamp','')}"
            + (f"  [{n['status']}]" if n.get("status") else "")
            + f"\n    {n['text'][:80]}"
        )
    return "\n".join(lines)


@mcp.tool()
def design_note_add(project: str, phase: str, text: str,
                     note_type: str = "note", author: str = "claude",
                     status: str = "") -> str:
    """
    Add a design note to a milestone.
    - note_type: 'note', 'comment', or 'agreement'
    - status: for agreements — 'pending', 'approved', 'rejected'
    """
    res = _post(f"/design-notes/{project}/{phase}", {
        "text": text, "type": note_type, "author": author,
        "timestamp": date.today().isoformat(),
        "status": status,
    })
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    note = res.get("note", {})
    return _ok(f"Design note added to {project}/{phase}", {"ID": note.get("id", "?"), "Type": note_type})


@mcp.tool()
def design_note_update(project: str, phase: str, note_id: str,
                        text: Optional[str] = None, status: Optional[str] = None,
                        note_type: Optional[str] = None) -> str:
    """Update text, status, or type of a design note."""
    body: dict[str, Any] = {}
    if text is not None:      body["text"] = text
    if status is not None:    body["status"] = status
    if note_type is not None: body["type"] = note_type
    if not body:
        return "✗ No fields provided."
    res = _put(f"/design-notes/{project}/{phase}/{note_id}", body)
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"Design note {note_id} updated", body)


@mcp.tool()
def design_note_delete(project: str, phase: str, note_id: str) -> str:
    """Delete a design note."""
    res = _delete(f"/design-notes/{project}/{phase}/{note_id}")
    if not res.get("ok"):
        return f"✗ {res.get('error', 'Unknown error')}"
    return _ok(f"Design note {note_id} deleted from {project}/{phase}")


# ══════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    mcp.run(transport="stdio")
