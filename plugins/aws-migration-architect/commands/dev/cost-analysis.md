---
name: cost-analysis
description: "[DEV] Run the cost-analysis skill in isolation. Requires AWS_MIGRATION_DEV=true."
---

# /aws-migration-architect:dev:cost-analysis

**Development only.** Refused unless `AWS_MIGRATION_DEV=true`.

## Argument hint

`[--source-profile <name>] [--run-dir <path>] [--trend-months <n>]`

## Procedure

1. If `AWS_MIGRATION_DEV` is not `true`, halt. Point to `Use the cost-analysis skill`.
2. Parse args; fall back to `MIGRATION_SOURCE_PROFILE`, `MIGRATION_COST_TREND_MONTHS` (default 12).
3. `aws sts get-caller-identity --profile <source>`.
4. Run **cost-analysis** per `skills/cost-analysis/SKILL.md` (inline — no sub-agent).
5. Validate `cost-analysis.json`. Print drivers, commitments, trend tables.
