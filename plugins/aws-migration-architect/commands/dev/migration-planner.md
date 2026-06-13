---
name: migration-planner
description: "[DEV] Run the migration-planner skill in isolation. Requires AWS_MIGRATION_DEV=true."
---

# /aws-migration-architect:dev:migration-planner

**Development only.** Refused unless `AWS_MIGRATION_DEV=true`.

## Argument hint

`[--source-profile <name>] [--target-profile <name>] [--run-dir <path>] [--force]`

## Procedure

1. If `AWS_MIGRATION_DEV` is not `true`, halt. Point to `Use the migration-planner skill` or `/aws-migration-architect:migrate`.
2. Parse args; require `inventory.json`, `dependency-graph.json`, `risk-scores.json` in run dir.
3. Verify both profiles authenticate.
4. Run **migration-planner** per `skills/migration-planner/SKILL.md`. Delegate to `aws-migration-architect:migration-planner`.
5. Emit and validate `cost-baseline.json`, `readiness-score.json`, `migration-plan.json` + `.md`. Surface readiness score and blockers.
