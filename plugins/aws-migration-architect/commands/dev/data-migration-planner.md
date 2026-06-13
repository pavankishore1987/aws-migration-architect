---
name: data-migration-planner
description: "[DEV] Run the data-migration-planner skill in isolation. Requires AWS_MIGRATION_DEV=true."
---

# /aws-migration-architect:dev:data-migration-planner

**Development only.** Refused unless `AWS_MIGRATION_DEV=true`.

## Argument hint

`[--source-profile <name>] [--run-dir <path>] [--force]`

## Procedure

1. If `AWS_MIGRATION_DEV` is not `true`, halt. Point to `Use the data-migration-planner skill` or `/aws-migration-architect:migrate`.
2. Parse args; require `inventory.json`, `dependency-graph.json`, `cost-baseline.json`, `resource-ownership.json`, `hardcoded-values.json`.
3. `aws sts get-caller-identity --profile <source>`.
4. Run **data-migration-planner** per `skills/data-migration-planner/SKILL.md`. Delegate to `aws-migration-architect:data-migration-planner`.
5. Validate `data-migration-plan.json`. Halt on `blocker` warnings unless `--force`. Print plan path.
