---
name: post-migration-auditor
description: "[DEV] Run the post-migration-auditor skill in isolation. Requires AWS_MIGRATION_DEV=true."
---

# /aws-migration-architect:dev:post-migration-auditor

**Development only.** Refused unless `AWS_MIGRATION_DEV=true`.

## Argument hint

`[--source-profile <name>] [--target-profile <name>] [--run-dir <path>]`

## Procedure

1. If `AWS_MIGRATION_DEV` is not `true`, halt. Point to `/aws-migration-architect:audit` or `Use the post-migration-auditor skill`.
2. Parse args; require `inventory.json` in run dir as the expectation baseline.
3. Verify both profiles authenticate.
4. Run **post-migration-auditor** per `skills/post-migration-auditor/SKILL.md`. Delegate to `aws-migration-architect:post-migration-auditor`.
5. Validate `audit-diff.json`. Print drift summary by category.
