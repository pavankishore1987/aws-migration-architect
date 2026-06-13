---
name: migrate
description: Run the full AWS account-to-account migration pipeline end-to-end (Discover → Generate → Cutover). Halts at the cutover checklist; human runs the actual cutover, then invokes /aws-migration-architect:audit.
---

# /aws-migration-architect:migrate

Run the deterministic AWS migration orchestrator.

## Argument hint

`[--source-profile <name>] [--target-profile <name>] [--run-id <id>] [--force]`

## Prerequisites

Set two env vars (or pass via args), then authenticate:

```bash
export MIGRATION_SOURCE_PROFILE=migration-source
export MIGRATION_TARGET_PROFILE=migration-target
aws sso login --profile $MIGRATION_SOURCE_PROFILE
aws sso login --profile $MIGRATION_TARGET_PROFILE
```

Verify both profiles authenticate:
```bash
aws sts get-caller-identity --profile $MIGRATION_SOURCE_PROFILE
aws sts get-caller-identity --profile $MIGRATION_TARGET_PROFILE
```

## What this command does

Invoke the `aws-migration-architect:migrate` workflow with parsed arguments. The workflow runs four phases sequentially:

1. **Discover** — `inventory-explorer` + `dependency-mapper` sub-agents
2. **Generate** — `terraform-builder` and `migration-planner` sub-agents in parallel
3. **DataPlan** — `data-migration-planner` sub-agent (sizing, transfer tool selection, time + cost estimate, freeze windows; halts on `blocker` warnings unless `--force`)
4. **Cutover** — `cutover-control-plane-builder` and `cutover-data-plane-builder` sub-agents in parallel (two separately-approved runbooks)

After Phase 4 the orchestrator pauses for human sign-off. The operator reads `cutover-checklist-control-plane.md`, `cutover-checklist-data-plane.md`, and `data-migration-plan.md` together, adds an `APPROVED BY: <name> ON: <date>` line near the top of EACH checklist (control plane and data plane signed separately), then invokes `/aws-migration-architect:execute --run-id <id>` to walk both checklists resource-by-resource with per-step approval (control plane first, then data plane). After execution: `/aws-migration-architect:audit --run-id <id>` verifies source/target parity.

## Procedure

1. Parse the user's arguments. Extract `source-profile`, `target-profile`, `run-id`, `force` flags. Fall back to env vars (`MIGRATION_SOURCE_PROFILE`, `MIGRATION_TARGET_PROFILE`) when not provided.

2. If both profiles are unset (neither args nor env), prompt the user with `AskUserQuestion` to provide them — do not proceed without both.

3. Verify both profiles authenticate via `aws sts get-caller-identity --profile <name>`. If either fails, surface the auth error and stop.

4. Invoke the Workflow tool:
   ```
   Workflow({
     name: "aws-migration-architect:migrate",
     args: { sourceProfile, targetProfile, runId, force }
   })
   ```

5. When the workflow completes (or halts), surface the returned summary to the user.

6. If `halted === "low_readiness"`, tell the user the readiness score, where to find the blocker list, and how to re-run with `--force` if they want to proceed anyway.
   If `halted === "data_plan_blockers"`, tell the user how many blockers, point them at `data-migration-plan.md`, and explain the common causes (external KMS, RPO=0 with bulk-mode strategy).

7. If the workflow completes through Cutover, remind the user to:
   - Read `cutover-checklist.md` end-to-end
   - Add an `APPROVED BY: <name> ON: <YYYY-MM-DD>` line near the top of `cutover-checklist.md` (the executor refuses to run without this)
   - Run `/aws-migration-architect:execute --run-id <id>` to actually apply the checklist (per-step approval, halts and offers rollback on failure)
   - Run `/aws-migration-architect:audit --run-id <id>` after execute completes

## Important

- This command does NOT mutate AWS. It produces the checklist; `/aws-migration-architect:execute` is the command that mutates the target account.
- The `--force` flag only overrides the readiness-score halt. It does NOT skip the human-sign-off gate on the checklist — that gate is enforced by the executor's pre-flight.
- For a faster scope-check before committing to a full migration, use `/aws-migration-architect:discover`.
