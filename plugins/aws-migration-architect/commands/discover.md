---
name: discover
description: Discover-only pass — inventory the source account + dependency analysis, but skip Terraform generation and migration planning. Use to understand what is in the source account before committing to a migration.
---

# /aws-migration-architect:discover

Run inventory + dependency analysis only.

## Argument hint

`[--source-profile <name>] [--run-id <id>]`

## Prerequisites

```bash
export MIGRATION_SOURCE_PROFILE=migration-source
aws sso login --profile $MIGRATION_SOURCE_PROFILE
aws sts get-caller-identity --profile $MIGRATION_SOURCE_PROFILE  # should succeed
```

Target profile is optional for discovery (used only to label the run directory).

## What this command does

Runs only the Discover phase of the migration pipeline:

1. **inventory-explorer** — produces `inventory.json`, `resource-ownership.json`, `unsupported-report.md`
2. **dependency-mapper** — produces `dependency-graph.json`, `hardcoded-values.json`, `risk-scores.json`, and 4 Mermaid architecture diagrams

Output goes to `$AWS_MIGRATION_ROOT/runs/<source>-to-discover-only-<run-id>/`.

## Procedure

1. Parse args; fall back to env vars.
2. Verify source profile authenticates.
3. Invoke `Workflow({ name: "aws-migration-architect:discover", args: { sourceProfile, targetProfile, runId } })`.
4. When done, point the user at:
   - `inventory.json` — what's in the account
   - `unsupported-report.md` — what won't migrate cleanly
   - `architecture/iam-trust-graph.mmd` — IAM trust issues to plan around
   - `risk-scores.json` — High-risk resource count

5. Mention `/aws-migration-architect:migrate` as the next step once they're satisfied with the scope.
