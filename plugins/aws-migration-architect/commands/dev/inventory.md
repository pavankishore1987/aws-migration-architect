---
name: inventory
description: "[DEV] Run the inventory skill in isolation. Requires AWS_MIGRATION_DEV=true."
---

# /aws-migration-architect:dev:inventory

**Development only.** Refused unless `AWS_MIGRATION_DEV=true`.

## Argument hint

`[--source-profile <name>] [--target-profile <name>] [--run-id <id>] [--regions <r1,r2>] [--services <s1,s2>]`

## Procedure

1. If `AWS_MIGRATION_DEV` is not `true`, halt. Point to `Use the inventory skill` or `/aws-migration-architect:discover`.
2. Parse args; fall back to env vars. `target-profile` defaults to `discover-only` for run-dir labeling.
3. `aws sts get-caller-identity --profile <source>`.
4. Run **inventory** per `skills/inventory/SKILL.md`. Delegate deep pass to sub-agent `aws-migration-architect:inventory-explorer`.
5. Validate `inventory.json` and `resource-ownership.json`. Print run directory and resource count.
