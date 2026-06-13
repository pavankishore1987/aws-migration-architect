---
name: cutover-control-plane
description: "[DEV] Run the cutover-control-plane skill in isolation. Requires AWS_MIGRATION_DEV=true."
---

# /aws-migration-architect:dev:cutover-control-plane

**Development only.** Refused unless `AWS_MIGRATION_DEV=true`.

## Argument hint

`[--run-dir <path>]`

## Procedure

1. If `AWS_MIGRATION_DEV` is not `true`, halt. Point to `Use the cutover-control-plane skill` or `/aws-migration-architect:migrate`.
2. Parse args; require `migration-plan.json`, `resource-ownership.json`, `dependency-graph.json`, `hardcoded-values.json`, `data-migration-plan.json`.
3. Run **cutover-control-plane** per `skills/cutover-control-plane/SKILL.md`. Delegate to `aws-migration-architect:cutover-control-plane-builder`.
4. Validate `cutover-checklist-control-plane.json`. Print checklist path and `handoff_to_data_plane.criteria[]`.
