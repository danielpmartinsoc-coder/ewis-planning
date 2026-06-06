#!/usr/bin/env python3
"""
Generate a large synthetic state.json for load-testing the pipeline UI.

Usage:
    python3 scripts/gen_test_data.py 500          # 500 harnesses across the demo projects
    python3 scripts/gen_test_data.py 1000 --out data/state.json

The original state.json is backed up to state.json.bak the first time.
Notes are NOT generated inline — they live in data/notes/<id>.json, so the
state file stays small regardless of harness count.
"""
from __future__ import annotations

import json
import pathlib
import random
import sys

_HERE  = pathlib.Path(__file__).parent.parent
_DATA  = _HERE / "data"

PROJECTS = ["FALCON", "ALPHA", "PROJ-001"]
SUBSYS = ["Power", "Avionics", "Sensor", "Control", "Lighting", "Ground",
          "ECS", "FADEC", "Hydraulic", "Cabin", "Landing Gear", "Data Bus",
          "Cockpit", "Fuel", "Fire Det.", "De-Ice", "Comm", "Nav", "Radar"]
ZONES = ["FWD", "AFT", "MID", "LH", "RH", "UPR", "LWR"]
PEOPLE = ["M. Santos", "J. Ferreira", "C. Oliveira", "T. Ribeiro", "R. Alves",
          "A. Costa", "P. Souza", "L. Pereira", "F. Lima", "D. Rocha"]
REVS = ["A", "B", "C", "D"]
BLOCK_REASONS = [
    "ECN pending approval — awaiting CCB decision",
    "Procurement lead time exceeds plan",
    "Supplier delay on connector delivery",
    "Re-routing required in restricted zone",
    "Awaiting ICD sign-off from systems team",
    "Material non-conformance — pending MRB",
]


def gen(n: int) -> dict:
    prefix = {"FALCON": "H-F", "ALPHA": "H-A", "PROJ-001": "H-P"}
    counters = {p: 0 for p in PROJECTS}
    harnesses = []
    for _ in range(n):
        proj = random.choice(PROJECTS)
        counters[proj] += 1
        hid = f"{prefix[proj]}{counters[proj]:03d}"
        blocked = random.random() < 0.12
        h = {
            "id": hid,
            "project": proj,
            "name": f"{random.choice(SUBSYS)} {random.choice(ZONES)}",
            "stage": random.randint(0, 7),
            "blocked": blocked,
            "responsible": random.choice(PEOPLE),
            "revision": random.choice(REVS),
            "ecns": [],
            "noteCount": 0,
        }
        if blocked:
            h["blockReason"] = random.choice(BLOCK_REASONS)
        harnesses.append(h)

    # Reuse the existing milestones/ecns/people from the current state if present
    base = {}
    sp = _DATA / "state.json"
    if sp.exists():
        try:
            base = json.loads(sp.read_text("utf-8"))
        except Exception:
            base = {}

    return {
        "ecns":       base.get("ecns", []),
        "milestones": base.get("milestones", []),
        "harnesses":  harnesses,
        "people":     base.get("people", []),
    }


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    n = int(sys.argv[1])
    out = _DATA / "state.json"
    if "--out" in sys.argv:
        out = pathlib.Path(sys.argv[sys.argv.index("--out") + 1])

    if out.exists():
        bak = out.with_suffix(".json.bak")
        if not bak.exists():
            bak.write_text(out.read_text("utf-8"), "utf-8")
            print(f"Backed up original → {bak}")

    state = gen(n)
    out.write_text(json.dumps(state, indent=2, ensure_ascii=False), "utf-8")
    blocked = sum(1 for h in state["harnesses"] if h["blocked"])
    print(f"Wrote {len(state['harnesses'])} harnesses to {out} ({blocked} blocked)")


if __name__ == "__main__":
    main()
