---
name: execute
description: Execute an already-approved cutover-checklist.md against the target account, one resource at a time, with mandatory per-step human approval and resumable journal. Halts and offers rollback on failure. Polls long-running data-plane jobs.
---

# /aws-migration-architect:execute

Actually run the cutover. This command mutates the target AWS account.

## Argument hint

`--run-id <id> [--source-profile <name>] [--target-profile <name>] [--resume]`

## Prerequisites

A prior `/aws-migration-architect:migrate` (or manual run of the discovery/generate/cutover skills) must have produced these files in the run directory:

- `cutover-checklist.json` and `cutover-checklist.md`
- `migration-plan.json` (rollback steps come from here)
- `dependency-graph.json`, `hardcoded-values.json`, `resource-ownership.json`
- `terraform/` modules with `terraform validate` clean

The human must have **read and approved** `cutover-checklist.md` by adding an approval line near the top:

```
APPROVED BY: <name> ON: <YYYY-MM-DD>
```

The executor refuses to run without this line.

Target IAM:
- `examples/iam/target-cutover-control-plane.json` attached to the role/user the target profile assumes
- For Phase 2/3/5, also attach `examples/iam/target-cutover-data-plane.json`

Both profiles authenticated:
```bash
aws sso login --profile $MIGRATION_SOURCE_PROFILE
aws sso login --profile $MIGRATION_TARGET_PROFILE
```

## What this command does

Invokes the `aws-migration-architect:execute` workflow, which calls the `cutover-executor` sub-agent. The executor:

1. **Pre-flight** — verifies both profiles, IAM, terraform-validate, and the approval line in `cutover-checklist.md`
2. **Compile** — reads the checklist + plan + graph, emits `execution-steps.json` (one step per resource/action, with preview/execute/verify/rollback/poll commands)
3. **Confirm** — prints the per-phase plan and asks for go/no-go
4. **Walk** — for each step in dependency order: preview → ask **approve/skip/abort** → execute → poll if long-running → verify
5. **Halt on failure** — surfaces the failed step, exit code, and `rollback_cmd` from the plan, then asks **retry / rollback / abort**
6. **Resume** — on `--resume`, reads the prior `execution-log.jsonl`, re-verifies any in-flight step against AWS, and continues from the next pending step
7. **Report** — writes `execution-summary.json` and `execution-report.md`

Per-step human approval is mandatory and not configurable. Every mutating command prompts.

## Procedure

1. Parse args. `--run-id` is **required**. Fall back to env vars for profiles. If `--resume` is set, the executor reads the prior journal; otherwise it starts a new one and errors if the journal already exists.

2. Verify both profiles authenticate:
   ```bash
   aws sts get-caller-identity --profile $MIGRATION_SOURCE_PROFILE
   aws sts get-caller-identity --profile $MIGRATION_TARGET_PROFILE
   ```
   If either fails, surface the auth error and stop. Do NOT invoke the workflow with a stale session.

3. Resolve the run directory: `${AWS_MIGRATION_ROOT:-~/.aws-migration}/runs/<source>-to-<target>-<run-id>`. Verify that `cutover-checklist.json`, `cutover-checklist.md`, and `migration-plan.json` exist. If any are missing, surface a clear message and stop — point the operator at `/aws-migration-architect:migrate` to regenerate.

4. Read the first 20 lines of `cutover-checklist.md` and confirm the `APPROVED BY: ... ON: ...` line is present. If absent, **do not invoke the workflow**. Tell the operator exactly what line to add, and ask them to re-run.

5. Invoke the Workflow tool:
   ```
   Workflow({
     name: "aws-migration-architect:execute",
     args: { sourceProfile, targetProfile, runId, resume: !!resumeFlag }
   })
   ```

6. When the workflow returns, surface the verdict (`completed | halted | aborted | failed`), counts, and the path to `execution-report.md`.

7. If verdict is `completed`, remind the operator to run `/aws-migration-architect:audit` next.

8. If verdict is `halted` or `failed`, point them at `execution-report.md` (failed step + stderr.log path) and tell them how to resume: `/aws-migration-architect:execute --run-id <id> --resume`.

## Important

- This command mutates the target AWS account. Treat it like a real cutover window.
- Every step prompts for approval. Plan for human attendance throughout — for long-running jobs (DataSync, DMS, S3 Batch) the executor polls without holding an approval open, but the next step after the job completes will still prompt.
- The journal (`execution-log.jsonl`) is append-only. Never edit it. If something is wrong with execution state, the safe move is to abort and resume.
- Rollback is offered automatically on failure, but rollback is not the same as undo. Some AWS state changes (DNS propagation, deleted snapshots) cannot be fully reversed. The rollback dialog flags irreversibility per step.
- For `--resume`, the executor re-verifies any in-flight step against AWS. If the prior session crashed mid-execute, the executor finds out what actually happened in AWS before re-prompting.

## See also

- `/aws-migration-architect:migrate` — full pipeline ending in Execute (recommended for end-to-end runs)
- `/aws-migration-architect:audit` — runs after a successful execution to verify source/target parity
