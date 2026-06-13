---
name: cutover-data-plane
description: "[DEV] Run the cutover-data-plane skill in isolation. Requires AWS_MIGRATION_DEV=true."
---

# /aws-migration-architect:dev:cutover-data-plane

**Development only.** Refused unless `AWS_MIGRATION_DEV=true`.

## Argument hint

`[--run-dir <path>]`

## Procedure

1. If `AWS_MIGRATION_DEV` is not `true`, halt. Point to `Use the cutover-data-plane skill` or `/aws-migration-architect:migrate`.
2. Parse args; require `data-migration-plan.json`, `migration-plan.json`, `cutover-checklist-control-plane.json`, plus ownership/dependency/hardcoded artifacts.
3. Run **cutover-data-plane** per `skills/cutover-data-plane/SKILL.md`. Delegate to `aws-migration-architect:cutover-data-plane-builder`.
4. Validate `cutover-checklist-data-plane.json`. Print checklist path and aggregated `freeze_windows[]`.
