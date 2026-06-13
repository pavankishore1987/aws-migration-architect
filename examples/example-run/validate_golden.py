#!/usr/bin/env python3
"""Validate example-run golden artifacts + all source/target fixtures.

- Validates each golden/*.json against its schema in ../../schemas/.
- Confirms every source/ and target/ fixture is syntactically valid JSON.

Usage: python3 validate_golden.py
Requires: pip install jsonschema
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCHEMAS = HERE.parent.parent / "schemas"

try:
    from jsonschema import Draft202012Validator
except ImportError:
    print("ERROR: pip install jsonschema", file=sys.stderr)
    sys.exit(2)

# golden file -> schema file
GOLDEN_TO_SCHEMA = {
    "inventory.json": "inventory.schema.json",
    "resource-ownership.json": "resource-ownership.schema.json",
    "dependency-graph.json": "dependency-graph.schema.json",
    "hardcoded-values.json": "hardcoded-values.schema.json",
    "risk-scores.json": "risk-scores.schema.json",
    "cost-baseline.json": "cost-baseline.schema.json",
    "readiness-score.json": "readiness-score.schema.json",
    "migration-plan.json": "migration-plan.schema.json",
    "data-migration-plan.json": "data-migration-plan.schema.json",
    "cutover-checklist-control-plane.json": "cutover-checklist-control-plane.schema.json",
    "cutover-checklist-data-plane.json": "cutover-checklist-data-plane.schema.json",
    "audit-diff.json": "audit-diff.schema.json",
}


def load(p: Path):
    with p.open() as f:
        return json.load(f)


def main() -> int:
    failures = 0

    # 1. Schema-validate golden artifacts
    for golden_name, schema_name in GOLDEN_TO_SCHEMA.items():
        gpath = HERE / "golden" / golden_name
        spath = SCHEMAS / schema_name
        if not gpath.exists():
            print(f"MISSING golden: {golden_name}")
            failures += 1
            continue
        validator = Draft202012Validator(load(spath))
        errors = sorted(validator.iter_errors(load(gpath)), key=lambda e: e.path)
        if errors:
            failures += 1
            print(f"FAIL  {golden_name}")
            for e in errors[:10]:
                loc = "/".join(str(x) for x in e.path) or "(root)"
                print(f"      - {loc}: {e.message}")
        else:
            print(f"OK    {golden_name}  ({schema_name})")

    # 2. JSON-syntax-check every source/ and target/ fixture
    for sub in ("source", "target"):
        for jf in sorted((HERE / sub).glob("*.json")):
            try:
                load(jf)
                print(f"OK    {sub}/{jf.name}  (valid JSON)")
            except json.JSONDecodeError as ex:
                failures += 1
                print(f"FAIL  {sub}/{jf.name}: {ex}")

    print()
    print("ALL GREEN" if failures == 0 else f"{failures} FAILURE(S)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
