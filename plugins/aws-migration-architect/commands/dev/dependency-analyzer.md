---
name: dependency-analyzer
description: "[DEV] Run the dependency-analyzer skill in isolation. Requires AWS_MIGRATION_DEV=true."
---

# /aws-migration-architect:dev:dependency-analyzer

**Development only.** Refused unless `AWS_MIGRATION_DEV=true`.

## Argument hint

`[--source-profile <name>] [--run-dir <path>]`

## Procedure

1. If `AWS_MIGRATION_DEV` is not `true`, halt. Point to `Use the dependency-analyzer skill` or `/aws-migration-architect:discover`.
2. Parse args; require `inventory.json` in `--run-dir` (or latest run).
3. `aws sts get-caller-identity --profile <source>`.
4. Run **dependency-analyzer** per `skills/dependency-analyzer/SKILL.md`. Delegate to `aws-migration-architect:dependency-mapper`.
5. Validate `dependency-graph.json`, `risk-scores.json`, `hardcoded-values.json`. Print diagram paths.
