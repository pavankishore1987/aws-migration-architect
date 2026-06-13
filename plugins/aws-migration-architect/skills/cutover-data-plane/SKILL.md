---
name: cutover-data-plane
description: Generate the data-plane cutover runbook — the steps that move actual data (snapshot shares, KMS grants, AMI shares, DataSync, DMS, S3 sync, snapshot-restore, ECR push, secret values), freeze writes during cutover, swap DNS / promote replicas, and validate the copy. Consumes data-migration-plan.json for sizing, strategy, freeze windows, and validation criteria. Phase 1 (Pre-Staging) → 2 (Bulk Transfers) → 3 (Application Data) → 4 (Cutover: freeze + promote + swap) → 5 (Data Validation). Produces cutover-checklist-data-plane.md + .json. Runs AFTER the control-plane runbook completes.
---

# AWS Migration: Cutover (Data Plane)

This skill produces the runbook for **moving data into the already-provisioned target shape**. Every step here is a real data operation. The control-plane runbook must complete first.

## When to use this skill

- After `data-migration-planner` (reads `data-migration-plan.json`)
- After `cutover-control-plane` (the data-plane runbook depends on target containers existing)
- Before the actual cutover window

## Prerequisites

- `data-migration-plan.json` exists (this is the primary input — sizing, strategy, windows, validation all live here)
- `migration-plan.json`, `resource-ownership.json`, `dependency-graph.json`, `hardcoded-values.json` exist
- `cutover-checklist-control-plane.json` exists (the data-plane references its handoff criteria)

## Inputs

| Input | Source | Required |
|---|---|---|
| `data-migration-plan.json` | `data-migration-planner` | yes (primary) |
| `migration-plan.json` | `migration-planner` | yes |
| `resource-ownership.json` | `inventory` | yes |
| `dependency-graph.json` | `dependency-analyzer` | yes |
| `hardcoded-values.json` | `dependency-analyzer` | yes |
| `cutover-checklist-control-plane.json` | `cutover-control-plane` | yes |

## Outputs

- **`cutover-checklist-data-plane.md`** — printable runbook for the operator
- **`cutover-checklist-data-plane.json`** — validates against `schemas/cutover-checklist-data-plane.schema.json`. Consumed by the cutover-executor.

## Phase structure (always 5 phases, numbered 1–5)

### Phase 1 — Pre-Staging

Setup that has to happen before any data moves. Mostly cross-account permission grants:

- For every RDS / Aurora datastore: `aws rds modify-db-snapshot-attribute --attribute-name restore --values-to-add <target-acct>`
- For every customer-managed KMS key the source encrypts data with: `aws kms create-grant ... --grantee-principal arn:aws:iam::<target-acct>:root --operations Decrypt DescribeKey`
- For every EC2 AMI: `aws ec2 modify-image-attribute --launch-permission "Add=[{UserId=<target-acct>}]"`
- For every EBS snapshot used for data volumes: `aws ec2 modify-snapshot-attribute`
- For each DataSync agent: agent creation in target if needed
- For each DMS replication instance: instance creation in target if not done by Terraform

Pre-staging steps are typically reversible (revoke grant, remove launch permission). Mark as `irreversible: false`.

### Phase 2 — Bulk Transfers

The big movers. This is usually the longest phase by wall-clock:

For each datastore in `data-migration-plan.json` where `strategy.mode in ["bulk", "bulk-plus-delta", "snapshot-restore"]`:

| Strategy.tool | Operation | long_running | Poll |
|---|---|---|---|
| `aws-s3-sync` | `s3-sync` | true (for large) | `aws s3 ls --summarize` |
| `s3-batch-replication` | `s3-batch-replication` | true | `aws s3control describe-job` |
| `aws-rds-snapshot-share` (restore part) | `snapshot-restore` | true | `aws rds describe-db-instances` (Status field) |
| `aws-dms` | `dms-start` | true | `aws dms describe-replication-tasks` |
| `aws-datasync` | `datasync-start` | true | `aws datasync describe-task-execution` |
| `dynamodb-export-import` | `dynamodb-export` → `dynamodb-import` | true | `aws dynamodb describe-export` / `describe-import` |
| `ec2-snapshot-share` (volume creation) | `snapshot-restore` | false (fast) | n/a |

For each step, inline:
- `command` — the exact AWS CLI call
- `long_running: true` if applicable + `poll_cmd` + `poll_terminal_states`
- `time_box_minutes` from `data-migration-plan.datastores[].transfer_estimate.bulk_phase_hours * 60`
- `datastore_arn`
- `irreversible: false` (sync/restore can be cleaned up by deleting the target)

### Phase 3 — Application Data

Non-storage data that apps depend on:

- For each ECR repo: `ecr-push` (push images to target ECR)
- For each Lambda function: `lambda-code-upload` (upload deployment artifact to target deployment bucket)
- For each Secrets Manager secret (where strategy is not snapshot-restore): `secret-put-value` — operator supplies value file path at runtime
- For each SSM Parameter (non-secret): API call to put value in target
- For each AppConfig configuration: deployment to target

### Phase 4 — Cutover

The actual switch. This phase contains the freeze windows. **Steps here are often `irreversible: true`**:

For each tier-1/tier-2 datastore with `freeze_window.required: true` (per `data-migration-plan.json`):
1. `freeze-writes` — enforce per `freeze_window.notes` (e.g. set RDS parameter to `default_transaction_read_only=true`, attach bucket-policy denying writes)
2. Final delta sync (for `bulk-plus-delta` strategies) — re-run sync to catch writes during bulk
3. `dms-promote` / `rds-promote-read-replica` if applicable
4. `route53-change` — apply the pre-staged change-batch JSON to flip traffic
5. `traffic-shift` — verify ALB request counts shifting
6. Release the freeze (or, if everything succeeded, the source is now read-only forever)

All steps in this phase carry `irreversible: true` for irreversible ops (route53-change after TTL propagation, dms-promote, deleted-source-data steps).

### Phase 5 — Data Validation

Per the validation methods in `data-migration-plan.datastores[].validation`:

For each datastore:
- Run the listed `methods[]` (row-count, object-count, byte-count, checksum-sample, checksum-full, key-list-diff, smoke-query, application-replay)
- Compare against `acceptance_criteria`
- Record pass/fail

Final go/no-go gate at phase 5 end:
- All datastores pass validation
- No critical alerts in CloudWatch
- Cost trajectory matches forecast
- All team approvers signed off

## Freeze window handling

`freeze_windows[]` at the top of the JSON aggregates every freeze window from `data-migration-plan.json`. Each entry maps to a step in Phase 4. The cutover-executor reads `freeze_windows[]` to:
- Set a UI countdown timer per active freeze
- Warn if a freeze has exceeded its declared duration (operator gets a nudge to wrap up)
- Track which datastores are currently frozen (so operator never starts a new freeze on top of an existing one)

## Per-team approval gates

For every step where `owner_team` is set on the corresponding datastore in `data-migration-plan.json`, inject an approval gate. For Phase 4 cutover steps with `irreversible: true`, mandatory second-confirmation per the cutover-executor's high-risk dialog.

## Standard scaffolding per phase

**Pre (Phase 1 only):**
- [ ] Control-plane runbook complete; all `handoff_to_data_plane.criteria[]` verified
- [ ] `target-cutover-data-plane.json` IAM policy attached to target profile
- [ ] On-call paged for the migration window
- [ ] Real-time spend dashboard open

**Post (Phase 5 end):**
- [ ] All data-plane jobs in terminal-success state (no in-flight DMS/DataSync)
- [ ] Source kept warm per `data-migration-plan.datastores[].rollback.retain_source_for_hours`
- [ ] Cost watchdog: 24h, 72h, 7d
- [ ] Run `/aws-migration-architect:audit`

## What this skill does NOT include

- Any Terraform applies — those are control-plane.
- Any IAM creation/modification — control-plane (except `kms-grant` which is data-plane because it's a permission for data movement specifically).
- Any infrastructure provisioning — control-plane.
- Any non-cutover operational activity.

## Anti-patterns — DO NOT

- Do not include `terraform apply` steps. Module applies are control-plane.
- Do not include `aws iam create-role` or `aws iam attach-role-policy` — control-plane.
- Do not emit steps without a `datastore_arn` unless they're genuinely cross-datastore (e.g. global health-check creation in Phase 1).
- Do not assume the control plane is done — verify the handoff criteria as Phase 1 pre-cutover.
- Do not include freeze windows that aren't sourced from `data-migration-plan.json` — that's where freeze windows are computed.

## Sub-agent

Calls `cutover-data-plane-builder` to render the per-phase steps from `data-migration-plan.json` and `migration-plan.json`.
