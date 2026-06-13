---
name: cost-summary
description: "[DEV] Run the cost-summary skill in isolation. Requires AWS_MIGRATION_DEV=true."
---

# /aws-migration-architect:dev:cost-summary

**Development only.** Refused unless `AWS_MIGRATION_DEV=true`.

## Argument hint

`[--source-profile <name>] [--run-dir <path>]`

## Procedure

1. If `AWS_MIGRATION_DEV` is not `true`, halt. Point to `Use the cost-summary skill`.
2. Parse args; fall back to `MIGRATION_SOURCE_PROFILE` and latest run dir under `AWS_MIGRATION_ROOT`.
3. `aws sts get-caller-identity --profile <source>`.
4. Run **cost-summary** per `skills/cost-summary/SKILL.md` (inline — no sub-agent).
5. Validate `cost-summary.json`. Print box-format cost table and artifact path.
