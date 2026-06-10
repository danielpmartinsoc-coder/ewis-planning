# EWIS Forge — Operational Context

## What this system is
EWIS Forge is a wire harness production tracker.
- **Frontend**: React 18 + TypeScript + Vite + Tailwind — `npm run dev` (port 5173)
- **Backend local** (full access): Flask — `python server.py` → `127.0.0.1:5000`
- **Backend readonly** (Cloudflare): Flask `FORGE_READONLY=1` → `0.0.0.0:5001`
- **MCP server**: `mcp_server.py` — 55 tools, targets port 5000 (local full access)
- **Tunnel URL**: run `./tunnel_url.sh` to get the current `*.trycloudflare.com` URL

## Services (auto-start via launchd)
| Label | Port | Purpose |
|---|---|---|
| `com.forge.local` | 5000 | Full-access, localhost only, used by MCP |
| `com.forge.readonly` | 5001 | Read-only, all writes blocked |
| `com.forge.tunnel` | — | Cloudflare tunnel → :5001 |

Manage: `launchctl load/unload ~/Library/LaunchAgents/com.forge.*.plist`

## Stages (index 0–7)
| # | Name          |
|---|---------------|
| 0 | BoM           |
| 1 | Procurement   |
| 2 | Stocking      |
| 3 | Kit/Cut/Mark  |
| 4 | Ready         |
| 5 | In Execution  |
| 6 | Done          |
| 7 | Delivered     |

`completed = true` is a status flag on stage-7 harnesses. It is NOT a separate stage.

## Key data files
- `data/harnesses.json` — all harnesses + projects
- `data/procurement.json` — PR / PO / Quote / Invoice documents
- `data/inventory.json` — 382 items, EUR 156k total value
- `data/ecns.json` — engineering change notices
- `data/work_orders.json` — work orders

## MCP tools available (requires Flask running on :5000)
| Tool | Purpose |
|------|---------|
| `forge_summary` | Compact snapshot — call first |
| `harness_list` | Filter by project/stage/blocked/completed |
| `harness_detail` | Full detail for one harness |
| `harness_advance` | Next stage + log hours |
| `harness_back` | Regress one stage |
| `harness_block` / `harness_unblock` | Block management |
| `harness_complete` | Mark Delivered harness as ✓ COMPLETE |
| `harness_note` | Add a note/comment |
| `harness_create` | New harness in a project |
| `ecn_list` / `ecn_create` / `ecn_approve` / `ecn_reject` | ECN lifecycle |
| `inventory_query` | Search inventory |
| `inventory_adjust` | +/− stock (consume/receive) |
| `inventory_create` | New inventory item |
| `inventory_summary` | Value + category breakdown + alerts |
| `procurement_list` | Filter PR/PO/Quote/Invoice |
| `procurement_create` | New procurement document |
| `procurement_update_status` | pending → complete etc. |
| `procurement_summary` | Financial totals by status/type |
| `project_list` / `project_create` | Programme management |
| `work_order_list` / `work_order_create` | Work order management |

## Typical session workflow
1. `forge_summary` — understand current state
2. `harness_list(blocked=True)` — see what's stuck
3. Address items: advance, block/unblock, note, complete
4. `inventory_summary` — spot stock alerts
5. `procurement_list(status="pending")` — open orders

## Running locally
```bash
# Terminal 1 — backend
cd ~/tec/ewis-planning
python server.py

# Terminal 2 — frontend
cd ~/tec/ewis-planning
npm run dev
```
