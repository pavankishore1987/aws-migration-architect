---
name: cutover-executor
description: "[DEV] Run the cutover-executor skill in isolation. Requires AWS_MIGRATION_DEV=true."
---

# /aws-migration-architect:dev:cutover-executor

**Development only.** Refused unless `AWS_MIGRATION_DEV=true`. **Mutates AWS** — use only in sandbox accounts.

## Argument hint

`[--source-profile <name>] [--target-profile <name>] [--run-id <id>] [--run-dir <path>] [--resume]`

## Procedure

1. If `AWS_MIGRATION_DEV` is not `true`, halt. Point to `/aws-migration-architect:execute` for production-style runs.
2. Parse args; require both signed cutover checklists (`APPROVED BY:` in each `.md`).
3. Verify both profiles authenticate. Confirm user understands this mutates the target account.
4. Run **cutover-executor** per `skills/cutover-executor/SKILL.md`. Delegate to `aws-migration-architect:cutover-executor`.
5. Walk `execution-steps.json` with per-step approval. Append to `execution-log.jsonl`. Print execution report.
