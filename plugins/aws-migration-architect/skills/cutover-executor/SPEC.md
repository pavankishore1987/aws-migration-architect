# Cutover Executor — Engineering Spec

Status: **draft v0.3** · Owner: aws-migration-architect plugin · Scope: the `cutover-executor` skill, sub-agent, schemas, command, workflow, and its interaction with the upstream split runbooks

The SKILL.md sibling is the operator-facing playbook. This file is the engineering contract: what the executor guarantees, what it refuses, what it never does, and which file formats slot together. If SKILL.md and SPEC.md disagree, SPEC.md is the source of truth.

**Changes since v0.2**: three guardrails moved from "open questions" to enforced contract — concurrent-run PID lock (§14), operator identity mandatory on approval-class events (§8), SSO mid-run probe at 15-minute cadence (new §22). The plugin-wide constitution at `plugins/aws-migration-architect/CLAUDE.md` now carries the cross-cutting "never / always / on failure" rules; this file remains the executor-specific engineering contract.

**Changes since v0.1**: the executor consumes TWO checklists (control plane and data plane) instead of one. The cutover-manager skill was split into `cutover-control-plane` and `cutover-data-plane`. The `data-migration-planner` skill was added upstream as the source of sizing, transfer strategy, freeze windows, and validation criteria. The executor models a mid-run IAM transition at the control-plane → data-plane handoff.

---

## 1. Purpose

Walk two approved cutover runbooks against a target AWS account, in strict order — **control plane first, data plane second** — one resource and one action at a time, with mandatory human approval per step, an append-only journal, and resumability after a halt. The executor is the only component in this plugin that mutates real AWS state.

Everything upstream (inventory, dependency-analyzer, terraform-generator, migration-planner, data-migration-planner, cutover-control-plane, cutover-data-plane) produces artifacts. The executor consumes those artifacts and produces *side effects in AWS*.

## 2. Goals

1. **Per-step approval on every mutating command.** No batch mode, no `--yes`, no "approve phase".
2. **Strict plane ordering.** All control-plane steps complete before any data-plane step runs. The handoff is itself an explicit, journaled step.
3. **Determinism on resume.** Same checklists + same journal → the executor reaches the same in-AWS state. Restarting after a halt does not skip work that wasn't durably completed.
4. **Halt-and-show on failure.** When a step fails, the operator sees the failed command, exit code, stderr tail, and the rollback steps from the plan. No retry happens without approval.
5. **Long-running data-plane jobs without held approvals.** DataSync, DMS, S3 Batch, DynamoDB export/import are kicked off, then polled. The operator approves the start once; the executor polls until terminal without re-prompting.
6. **Irreversibility surfaced loudly.** Data-plane Phase 4 steps marked `irreversible: true` in the data-plane checklist get a second confirmation prompt regardless of the operator's per-step approval.

## 3. Non-goals

- **No unattended execution.** Deliberate. There is no non-interactive mode.
- **No cross-cloud.** AWS-to-AWS only.
- **No multi-region within one account.**
- **No data-plane orchestration beyond what AWS offers natively.** The executor invokes DataSync / DMS / S3 Batch / DynamoDB export-import jobs. It does not implement custom transfer logic.
- **No automated remediation.** If `terraform validate` fails, if the IAM policy is wrong, if SSO has expired — the executor halts and surfaces the issue. It does not fix the issue itself.
- **No `terraform apply` at `-target=<resource>` granularity.** Module-level only. Control-plane checklist guarantees one Terraform-apply step per module, not per resource.
- **No undo of irreversible AWS state changes.** Rollback runs the plan's `rollback.steps[0]`; the operator runs the rest manually. Some state cannot be undone at all.

## 4. Inputs

All inputs are files in the run directory at `${AWS_MIGRATION_ROOT:-~/.aws-migration}/runs/<source>-to-<target>-<run-id>/`:

| File | Producer | Required | Used for |
|---|---|---|---|
| `cutover-checklist-control-plane.json` | `cutover-control-plane` | yes | Source of truth for control-plane steps (phases 0–6) |
| `cutover-checklist-control-plane.md` | `cutover-control-plane` | yes | Pre-flight sign-off check (`APPROVED BY:` line) |
| `cutover-checklist-data-plane.json` | `cutover-data-plane` | yes | Source of truth for data-plane steps (phases 1–5) |
| `cutover-checklist-data-plane.md` | `cutover-data-plane` | yes | Pre-flight sign-off check (second `APPROVED BY:` line, separate sign-off) |
| `data-migration-plan.json` | `data-migration-planner` | yes | Sizing, strategy, freeze windows, validation criteria (referenced by data-plane checklist; executor uses for poll-status parse rules and freeze-window enforcement) |
| `migration-plan.json` | `migration-planner` | yes | `phases[N].rollback.steps[]` (rollback_cmd source) |
| `dependency-graph.json` | `dependency-mapper` | yes | Placeholder expansion in command templates |
| `hardcoded-values.json` | `dependency-mapper` | yes | Forces `approval_required: true` on referenced resources |
| `resource-ownership.json` | `inventory-explorer` | yes | `owner_team` per step |
| `terraform/` directory | `terraform-builder` | yes | Terraform module applies during control-plane phases |
| `execution-log.jsonl` | self (prior run) | only on `--resume` | Reconstructs state |

Environment:

| Var | Required | Notes |
|---|---|---|
| `MIGRATION_SOURCE_PROFILE` | yes | Source AWS profile name (read-only role) |
| `MIGRATION_TARGET_PROFILE` | yes | Target AWS profile name |
| `AWS_MIGRATION_ROOT` | no | Defaults to `~/.aws-migration` |

Inputs the executor MUST NOT read:

- Any secret value (Secrets Manager value, SSM SecureString). Secret values are only ever passed via operator-supplied file paths at prompt time.
- Anything outside the run directory and `terraform/`.

## 5. Outputs

Written to the same run directory:

| File | Format | Lifetime |
|---|---|---|
| `execution-steps.json` | flat array of `execution-step` objects, ordered: control-plane → handoff step → data-plane | Written once at compile time; never modified after |
| `execution-log.jsonl` | one journal entry per line | Append-only; never rewrites prior lines |
| `execution/<step_id>.stdout.log` | raw stdout | Per executed step |
| `execution/<step_id>.stderr.log` | raw stderr | Per executed step |
| `execution-summary.json` | summary object from log schema | Written at end-of-run |
| `execution-report.md` | human-readable report | Written at end-of-run |

The journal-on-disk is JSONL (one entry object per line). The log *schema* describes `{ metadata, entries }` because that's the in-memory shape after reading — the metadata is written as the first line, then entries follow.

## 6. Step lifecycle

The lifecycle for one step is unchanged from v0.1:

```
COMPILED → STARTED → (preview_cmd run) → AWAITING_APPROVAL
   approve → EXECUTING → (long_running? → POLLING) → VERIFYING → SUCCEEDED / FAILED
   skip    → SKIPPED (terminal)
   abort   → ABORTED (whole run stops)

FAILED → rollback dialog → retry / rollback / abort
```

Each transition writes one journal entry. State is reconstructed by reading the journal, not held in memory.

## 7. Plane ordering and the handoff step

The compiled `execution-steps.json` is a single flat array. Ordering is strict and non-configurable:

```
[
  cp-phase0-001-...,         // Control-plane Phase 0: Globals (IAM, Route53, CloudFront, Backup)
  cp-phase1-001-...,         // Control-plane Phase 1: Networking
  ...
  cp-phase6-NNN-...,         // Control-plane Phase 6: Control Plane Validation
  cp-phase6-999-handoff-to-data-plane,   // <-- synthesized handoff step
  dp-phase1-001-...,         // Data-plane Phase 1: Pre-Staging
  ...
  dp-phase5-NNN-...,         // Data-plane Phase 5: Data Validation
]
```

The handoff step:
- `step_id`: `cp-phase6-999-handoff-to-data-plane`
- `action`: `manual-decision`
- `tool`: `human`
- `execute_cmd`: `true` (no-op)
- `verify_cmd`: `true`
- `approval_required`: true
- Approval prompt content:
  - All `handoff_to_data_plane.criteria[]` from control-plane checklist
  - Asks operator to confirm `target-cutover-data-plane.json` is now attached to the target profile
  - Refuses to advance until the operator approves explicitly

After approval of the handoff step, the executor expects `target-cutover-data-plane.json` to be attached AND `target-cutover-control-plane.json` to remain attached for the duration of data-plane execution (some data-plane Phase 4 steps still call control-plane APIs like Route53).

The handoff step CANNOT be skipped. Skipping it requires `abort`; there is no way to proceed to data-plane steps without the explicit handoff approval.

## 8. Approval contract

**Per-step approval is mandatory and not configurable.** This is the most important contract.

Rules:

1. Every step with `tool != "human"` requires an explicit operator response of `approve`, `skip`, or `abort` before `execute_cmd` runs.
2. The approval prompt MUST show: step description, resource ARN, action, risk level, the exact `execute_cmd`, and the preview output if `preview_cmd` was set.
3. Approvals do not carry across steps. Approving step N grants permission for step N's `execute_cmd` only.
4. Approving the start of a long-running step grants permission for the polling loop and the final `verify_cmd`. The next step still prompts.
5. **Operator identity is mandatory on approval-class events.** Every `approved`, `skipped`, `aborted`, `rollback-approved`, `rollback-skipped`, `lock-acquired`, and `lock-taken-over-from-stale` journal entry MUST carry an `operator` field. Resolved once at pre-flight: `$USER` → `git config --global user.email` → `"unknown"`. The schema describes this; the executor's responsibility is to set it on every emit. `"unknown"` is acceptable only when both `$USER` and git email are absent; surface this in the pre-flight banner so the operator knows the audit trail will not name them.
6. **Irreversibility re-confirmation.** Data-plane steps with `irreversible: true` (route53 traffic changes, DMS-promote, RDS-promote-read-replica) get a SECOND confirmation dialog after the initial approval. The dialog text spells out what cannot be undone (TTL propagation, replica writes promoted to primary). This is in addition to per-step approval, not a substitute.
7. A `retry` decision in the rollback dialog re-runs `execute_cmd` without re-prompting — the dialog itself is the approval.
8. On `skip`, the step is marked `skipped` and `requires[]` resolution treats it as not-succeeded — any step that lists this one in `requires[]` will block.

There is no override flag. No `--auto-approve`, no `--yes`, no `--skip-approval-for-low-risk`.

## 9. Resume contract

Resume is opt-in via `--resume`. Without `--resume`, the executor refuses to start if `execution-log.jsonl` already exists.

On resume:

1. Read the journal end-to-end. For each `step_id`, derive its current state from the latest event.
2. For each in-flight step, run its `verify_cmd` (or for long-running steps with a terminal poll recorded, the `poll_cmd` and check terminal state). Append `resume-reverified`.
   - If verify passes: append `resume-marked-done`, treat as if `step-succeeded`. Operator is NOT prompted.
   - If verify fails: append `resume-reprompted`, show the operator the situation, ask `retry / skip / abort`.
3. After in-flight reconciliation, walk normally from the next pending step in dependency order.
4. **Plane crossing on resume.** If the journal shows the handoff step was not yet approved, the resume re-presents the handoff prompt before any data-plane step runs. The data-plane IAM attachment check happens here, not at pre-flight.

The journal is the only state. There is no separate "in-flight" file.

## 10. Polling contract (long-running jobs)

Data-plane steps with `long_running: true` MUST set:

- `poll_cmd`: read-only, prints a single status line on stdout
- `poll_interval_seconds`: ≥ 10
- `poll_terminal_states`: array of strings; case-insensitive match against parsed status

Status parsing is per-action:

| Action | parse rule |
|---|---|
| `datasync-start` | `aws datasync describe-task-execution ... --query Status --output text` |
| `dms-start-replication-task` | `aws dms describe-replication-tasks ... --query 'ReplicationTasks[0].Status' --output text` |
| `s3-batch-replication-job` | `aws s3control describe-job ... --query 'Job.Status' --output text` |
| `dynamodb-export` | `aws dynamodb describe-export ... --query 'ExportDescription.ExportStatus' --output text` |
| `dynamodb-import` | `aws dynamodb describe-import ... --query 'ImportTableDescription.ImportStatus' --output text` |
| `snapshot-restore` (RDS) | `aws rds describe-db-instances ... --query 'DBInstances[0].DBInstanceStatus' --output text` |

If the parse rule yields nothing (empty stdout, API error), record `poll_state: "unknown"`. Three consecutive `unknown` states halt the poll and offer the operator a retry/abort dialog.

There is no max-iteration cap. DMS replication can run for days; polling for days is fine. The executor checkpoints state to the journal on every tick.

## 11. Failure handling & rollback dialog

A step is `FAILED` when:

- `execute_cmd` exits non-zero (after one transient-retry — see §13), OR
- `verify_cmd` exits non-zero, OR
- `verify_success_pattern` is set and `verify_cmd` stdout doesn't match, OR
- For long-running steps: `poll_terminal` state is a failure value.

Rollback dialog content:

- Step id, description, resource ARN, action, plane (cp/dp)
- Exit code (or terminal poll state)
- stderr tail
- The exact `rollback_cmd` (sourced from `migration-plan.phases[N].rollback.steps[0]`)
- Any additional rollback steps from `notes` (manual)
- The phase's `rollback_window_minutes` and elapsed time since `step-started`
- A flag if the step is `irreversible: true`

Operator choices (presented via `AskUserQuestion`):

| Choice | Effect |
|---|---|
| `Retry the step` | Re-run from EXECUTING. Same step_id, new entries. After 3 retries, removed from dialog. |
| `Run rollback and continue` | Append `rollback-approved`, run `rollback_cmd`, append `rollback-executed`. Then prompt: continue / abort. |
| `Run rollback and stop` | Run rollback, write summary `verdict: "halted"`, stop. |
| `Skip rollback and stop` | Append `rollback-skipped`, write summary `verdict: "halted"`, stop. |
| `Abort without rollback` | Write summary `verdict: "aborted"`, stop. |

Dialog is never skipped. Even for `risk: low` steps.

## 12. Freeze windows

Data-plane Phase 4 enforces write-freezes on tier-1/tier-2 datastores. The executor reads `freeze_windows[]` at the top of `cutover-checklist-data-plane.json` and:

- Records the freeze start in the journal (`event: "executed"` on the `freeze-writes` step)
- Tracks active freezes by `datastore_arn` (in memory; reconstructed from journal on resume)
- Refuses to start a NEW freeze on a datastore that already has an active freeze
- Surfaces a warning if elapsed > `duration_minutes` on the approval prompt of any subsequent step (so the operator knows the freeze window has been exceeded)
- Considers the freeze released when the matching `release_step_id` reaches `step-succeeded`

The executor does not auto-release freezes. The release is its own approved step in Phase 4 or Phase 5 (typically after validation passes).

## 13. Transient retries

The executor performs at most ONE automatic retry of `execute_cmd` without operator approval, only when the failure matches:

| Pattern (stderr) | Backoff |
|---|---|
| `Throttling`, `RequestLimitExceeded`, `TooManyRequestsException` | 30s |
| `RequestTimeoutException` | 10s |
| `ProvisionedThroughputExceededException` (DynamoDB) | 30s |

Retry is logged as `executed` with `notes: "transient retry after <pattern>"`. Any other failure goes straight to the rollback dialog.

## 14. Pre-flight checks (mandatory, before any compile work)

In order. Any failure halts; write one `step-failed` journal entry with the reason and stop. **No lock file is created unless every check passes** — clean exit on a pre-flight failure leaves no state to clean up.

1. **Concurrent-run lock acquisition.** Path: `<root>/RUNNING.lock`. Behavior:
   - If absent: proceed (lock will be written after all other checks pass).
   - If present AND PID is live (`kill -0 <pid>`): halt with `Another execute run is in progress (pid=<n>, started by <operator> on <host> at <ts>). Wait or abort it.`
   - If present AND PID is dead AND `--resume` was passed: write event `lock-taken-over-from-stale`, replace the lock contents with our PID at the end of pre-flight, continue.
   - If present AND PID is dead AND `--resume` was NOT passed: halt with `Stale lock from a prior crashed run. Re-run with --resume or rm <root>/RUNNING.lock to start fresh.`
2. `aws sts get-caller-identity --profile $MIGRATION_SOURCE_PROFILE` → exit 0
3. `aws sts get-caller-identity --profile $MIGRATION_TARGET_PROFILE` → exit 0
4. `cutover-checklist-control-plane.md` exists and contains `^APPROVED BY: .+ ON: \d{4}-\d{2}-\d{2}` within first 50 lines
5. `cutover-checklist-data-plane.md` exists and contains the same approval pattern (separate sign-off — both must be present)
6. `terraform/root/` exists. `terraform init` exits 0. `terraform validate` exits 0.
7. All required JSON files parse: `cutover-checklist-control-plane.json`, `cutover-checklist-data-plane.json`, `data-migration-plan.json`, `migration-plan.json`, `dependency-graph.json`, `hardcoded-values.json`, `resource-ownership.json`

After all checks pass: resolve operator identity (`$USER` → `git config --global user.email` → `"unknown"`), write `<root>/RUNNING.lock` with `{ pid, started_at, host, operator, command }`, append journal `lock-acquired` event with the operator. Initialize `last_sso_probe_at` to now.

Pre-flight does NOT verify `target-cutover-data-plane.json` is attached. That check happens at the handoff step (§7), because the policy is intended to be attached just-in-time for the data-plane window, not at pre-flight.

**Lock release.** On clean exit (`verdict: completed / halted / aborted`): remove `<root>/RUNNING.lock`, append journal `lock-released` event. On unclean exit (process killed, OOM, segfault): lock stays; resume detects and takes over.

## 15. Schemas

Three JSON Schemas govern the executor's inputs (beyond what upstream skills emit):

- `schemas/execution-step.schema.json` — every entry in `execution-steps.json` validates against this. Action enum is closed.
- `schemas/execution-log.schema.json` — the in-memory `{ metadata, entries }` shape after reading the JSONL back. Event enum is closed.

Two upstream schemas the executor reads:
- `schemas/cutover-checklist-control-plane.schema.json` — drives `cp-phase*` step compile
- `schemas/cutover-checklist-data-plane.schema.json` — drives `dp-phase*` step compile, including `freeze_windows[]` and `irreversible` flags

Compile-time validation: `execution-steps.json` is validated before the executor begins the walk. Validation failure halts execution before any AWS call.

## 16. Action / tool catalog

The schema's `action` enum is closed. Current values:

- Control-plane: `terraform-apply`, `manual-decision` (the handoff step uses this)
- Data-plane: `snapshot-share`, `snapshot-restore`, `ami-share`, `kms-grant`, `datasync-start`, `dms-create-replication-task`, `dms-start-replication-task`, `s3-sync`, `s3-batch-replication-job`, `dynamodb-export`, `dynamodb-import`, `secret-put-value`, `route53-change`, `rds-promote-read-replica`, `verify-only`, `manual-decision`

Adding a new action requires:

1. New value in `execution-step.schema.json` `action` enum
2. New row in SKILL.md template table with `preview_cmd`, `execute_cmd`, `verify_cmd`
3. Compile logic update in the sub-agent for that action's placeholder expansion
4. If long-running: status parse rule in §10
5. IAM update: the action's permissions must be either in `target-cutover-control-plane.json` or `target-cutover-data-plane.json`
6. Update to the corresponding upstream checklist builder (control-plane or data-plane)

## 17. Security model

**IAM transitions during a single run.** The target profile MUST have `target-cutover-control-plane.json` attached at pre-flight. At the handoff step, the operator attaches `target-cutover-data-plane.json` ALONGSIDE (not replacing) the control-plane policy. Both policies remain attached for the duration of data-plane execution. After the run completes, the operator can detach `target-cutover-data-plane.json` to shrink the standing blast radius.

The executor does NOT auto-detach IAM. The data-plane policy stays attached until the operator removes it; the executor's responsibility ends at the journal.

**Source profile is read-only-plus-share.** The executor invokes the source profile only for: `aws sts get-caller-identity` (pre-flight), `modify-db-snapshot-attribute` (snapshot share), `modify-image-attribute` (AMI share), `modify-snapshot-attribute` (EBS snapshot share), `create-grant` on source KMS keys, and read-only `describe-*` calls. The source policy (`examples/iam/source-read-only.json`) permits these.

**Secrets are never read or written into commands.** `secret-put-value` actions reference `--secret-string @<file>` where the file path is supplied by the operator at the approval prompt. The executor never reads the file's contents; the AWS CLI does. The file's contents never enter the journal, the stdout log, or any returned value.

**Logs may contain sensitive data.** `stdout_tail` and `stderr_tail` in journal entries are ≤2KB each. Full output goes to `execution/<step_id>.stdout.log` / `.stderr.log`. Operator should treat the run directory as sensitive.

**No outbound calls except AWS.** The executor uses Bash to call `aws`, `terraform`, `dig`, and shell built-ins. It does not call any MCP server. The sub-agent's `tools:` frontmatter is `Read, Write, Bash, AskUserQuestion` only.

## 18. Idempotency and determinism

**`step_id` is deterministic.** Given the same input checklists, the compile step always produces the same step_ids. This is what makes resume work.

**Step ordering is deterministic.** Plane ordering is strict (control plane → handoff → data plane). Within a plane, phase order is enforced (0..6 / 1..5). Within a phase, `requires[]` defines a partial order; topological sort with ties broken by `step_id` lex order.

**`execute_cmd` is not guaranteed idempotent.** Strategy is "verify before re-execute on resume": if `verify_cmd` says the work is already done, the step is marked `succeeded` without re-running.

**Compile is pure given inputs.** Re-compiling on the same inputs produces a byte-identical `execution-steps.json`. No timestamps, no random IDs.

**Known non-determinism — flagged for future fix.** The compile step is currently a model invocation, not pure code. Same inputs *should* yield identical step_ids and ordering but determinism is not guaranteed at the wire level. Item 1 on the post-pilot work list (see §20) is to move compile to pure JS in `workflows/execute.js`, eliminating this gap.

## 18.5. SSO mid-run probe

SSO sessions expire on a fixed timer (typically 1 hour from `aws sso login`, configurable per Identity Center instance). Pre-flight verifies the session at run start; without periodic re-checks, mid-run expiry surfaces only when a step fails with `ExpiredTokenException` — and that step is then journaled as failed, triggering the rollback dialog for what is actually a credentials problem, not a step problem. The probe avoids that confusion.

**Cadence.** Before each step (between `step-started` and `preview-shown`), check `now - last_sso_probe_at`. If > 900 seconds (15 minutes), probe both profiles:

```
aws sts get-caller-identity --profile $MIGRATION_SOURCE_PROFILE
aws sts get-caller-identity --profile $MIGRATION_TARGET_PROFILE
```

**On success** (both exit 0): append `sso-probe-passed` event with `at: now`. Set `last_sso_probe_at = now`. Continue with the step.

**On failure** (either exits non-zero): append `sso-probe-failed` event with `at: now`, `notes` containing the failing profile name and stderr tail. Halt with operator-facing message:

```
SSO session for profile <name> has expired or is invalid.
  Re-authenticate:  aws sso login --profile <name>
  Resume:           /aws-migration-architect:execute --run-id <id> --resume
```

The lock file is NOT removed on SSO halt — `--resume` is expected. The journal records the failure; resume reads it and re-probes before continuing.

**Resume reconstruction.** On `--resume`, scan the journal for the most recent `sso-probe-passed` event and use its `at` as the initial `last_sso_probe_at`. If no such event exists (very fresh run), use the resume-start timestamp.

**Rationale for 900s.** Conservative against the shortest reasonable SSO session (1 hour). One extra API call per profile every 15 minutes is negligible cost. Shorter cadence (e.g. every step) wastes API calls on per-step-fast runs; longer cadence (e.g. every hour) defeats the purpose because 1-hour SSO sessions could expire between probes.

**Not covered by this probe.** Mid-step expiry — a step that takes longer than 900s could expire mid-execute. For long-running poll steps, the executor relies on `ExpiredTokenException` detection in the poll loop (handled as a transient retry once; halts on second occurrence with the same operator-facing message).

## 19. Out of scope (explicit non-features)

- **Batch / unattended approval.** Per-step approval is the contract.
- **Multi-region cutover.** Different problem domain (cross-region cohort detection is upstream work in `dependency-mapper`, not the executor).
- **Cross-cloud.** Different problem domain.
- **Automated rollback beyond the plan's first step.** Plan's rollback is a list; executor runs the first step on approval, surfaces the rest to the operator.
- **Generating either checklist.** That's the `cutover-control-plane-builder` and `cutover-data-plane-builder` agents' job.
- **Re-running `:audit` automatically.** Operator runs `:audit` after `:execute` completes.
- **Modifying Terraform files.** Executor runs `terraform apply -target=module.<name>`; does not edit HCL.
- **Bypassing either `APPROVED BY` gate.** Not via flag, not via env var.
- **Auto-detaching IAM policies post-run.** Operator's responsibility.
- **Per-resource Terraform applies.** Module-level only.

## 20. Open questions (resolve before v1.0)

Resolved in v0.3 (now enforced): concurrent-run PID lock (§14), operator identity mandatory on approval events (§8), SSO mid-run probe at 15-min cadence (§18.5).

Still open:

- **Compile-to-code refactor.** Move the steps-file synthesis out of the sub-agent into pure JS in `workflows/execute.js`. Eliminates the non-determinism gap noted in §18. Highest-priority post-pilot work.
- **Journal corruption.** If the JSONL has a partial last line, resume currently fails. Should we truncate and continue?
- **Long-running step abandonment.** If the operator stops Claude Code mid-poll, the AWS job continues. On resume, re-verify. But if the job has been running for hours and the operator wants to cancel, add an explicit "cancel job" option to the poll-resume prompt?
- **IAM transition automation.** Today the operator manually attaches `target-cutover-data-plane.json` at the handoff step. Should the executor probe via `iam:simulate-principal-policy` and refuse to advance until simulation passes?
- **Per-resource bundle approval.** Discussed but not yet built — bundle related steps for one resource (e.g. snapshot-share + KMS-grant + restore) into one approval with high-risk re-prompts inside. Would reduce prompt fatigue at scale.
- **Cross-region cohort awareness.** Requires upstream changes to `dependency-mapper`. Not in executor scope today; the executor will walk whatever the data-plane checklist tells it to regardless of region.
- **Mid-step SSO expiry.** §18.5 covers between-step probing. A single step lasting > 1 hour can still expire mid-execute. Today: `ExpiredTokenException` detection in the poll loop handles it once. Should we shorten step `time_box_minutes` enforcement or pre-empt long polls when session is near expiry?

## 21. Versioning

Schemas: pinned by `$id` URL. Breaking changes bump the URL.

`execution-steps.json` carries no schema version inline today (the schema's `$id` is the implicit version). Cross-version resume is undefined.

`execution-log.jsonl`: the metadata line carries `plugin_version`. Resume from a journal whose `plugin_version` doesn't match the running plugin warns the operator and asks for confirmation.

## 22. End-of-run guarantees

When the executor returns:

- `execution-log.jsonl` reflects every approval, every command, every verification, every rollback step in the run
- `execution-summary.json` contains the final `verdict` (`completed | halted | aborted | failed`) plus counts
- `execution-report.md` is human-readable and links to per-step stdout/stderr logs
- The journal is sufficient to reconstruct exactly what changed in AWS and in what order, for incident review

The executor does NOT guarantee that the target account matches `inventory.json` — that's `post-migration-auditor`'s job. The executor only guarantees that it ran every step the operator approved and that the journal records the outcome of each.

---

*End of spec. Cross-reference: SKILL.md (operator playbook), `../../agents/cutover-executor.md` (sub-agent), `../../workflows/execute.js` (workflow), `../../commands/execute.md` (slash command), `../../../schemas/execution-step.schema.json`, `../../../schemas/execution-log.schema.json`, `../../../schemas/cutover-checklist-control-plane.schema.json`, `../../../schemas/cutover-checklist-data-plane.schema.json`, `../../../schemas/data-migration-plan.schema.json`, `../../../examples/iam/target-cutover-control-plane.json`, `../../../examples/iam/target-cutover-data-plane.json`.*
