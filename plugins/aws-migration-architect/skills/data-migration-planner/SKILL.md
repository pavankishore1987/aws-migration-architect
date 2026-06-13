---
name: data-migration-planner
description: Plan the data movement for every data-bearing resource in scope. Sizes each datastore via AWS APIs, picks the right transfer tool + mode (bulk vs bulk+delta vs continuous), estimates wall-clock transfer time and dollar cost (egress, cross-region, cross-account, tool runtime, double storage), captures encryption requirements (KMS grants, re-encryption), surfaces RPO/RTO targets per criticality tier, and produces freeze windows and validation criteria per datastore. Output is data-migration-plan.json + .md — consumed by cutover-data-plane to inject real timings into the cutover checklist.
---

# AWS Migration: Data Migration Planner

This skill answers the questions a cutover checklist alone doesn't: **how big is it, how long will it take, how much will it cost, when do writes have to stop, and how do we know the copy is correct?** Without this skill, the checklist's "step 47: aws s3 sync ..." is one line; in reality it might be 38 hours and $2,400 of egress.

## When to use this skill

- After `migration-planner` (it reads `cost-baseline.json`)
- Before `cutover-data-plane` (which uses the freeze windows + transfer estimates to time the runbook)
- Re-run when scope changes (new datastores enter scope, criticality tiers change)

## Prerequisites

- `inventory.json`, `dependency-graph.json`, `cost-baseline.json`, `resource-ownership.json` exist in the run directory
- Source AWS profile authenticated (sizing reads CloudWatch + describe APIs)
- `awspricing` MCP server available (for cost lookup)

## Inputs

| Input | Source | Required |
|---|---|---|
| `inventory.json` | `inventory` | yes |
| `dependency-graph.json` | `dependency-analyzer` | yes |
| `cost-baseline.json` | `migration-planner` | yes |
| `resource-ownership.json` | `inventory` | yes |
| `hardcoded-values.json` | `dependency-analyzer` | yes (for encryption flags) |
| `MIGRATION_SOURCE_PROFILE` env | operator | yes |
| `MIGRATION_RPO_DEFAULT_MINUTES`, `MIGRATION_RTO_DEFAULT_MINUTES` env | operator | optional (defaults: 60 / 240) |
| `MIGRATION_CRITICALITY_TAG` env | operator | optional (default: `Criticality`) |

## Outputs

- **`data-migration-plan.json`** — validates against `schemas/data-migration-plan.schema.json`. Machine-readable; consumed by `cutover-data-plane`.
- **`data-migration-plan.md`** — human-readable: per-datastore table (size, tool, hours, cost), critical-path Gantt-style ordering, total cutover-window recommendation, warnings.

## Workflow

### Step 1 — Enumerate data-bearing resources

Walk `inventory.json` and select resources where data movement is required. The data-bearing set:

| Service | Resource types |
|---|---|
| S3 | Buckets |
| RDS / Aurora | DB instances, clusters |
| DynamoDB | Tables |
| EFS / FSx | File systems |
| EC2 | EBS volumes with data (filter out boot volumes for stateless EC2) |
| ECR | Repositories with images |
| Redshift | Clusters |
| ElastiCache | Replication groups (if persistence enabled) |
| Backup | Vaults (if cross-account copy is the strategy) |

Empty buckets, empty tables, and empty file systems should be flagged but not planned for transfer — they get created by Terraform, no data to move.

### Step 2 — Size each datastore

Use the cheapest accurate API per service. **Never** download data to size it.

| Service | Sizing API | Field |
|---|---|---|
| S3 | CloudWatch metric `AWS/S3/BucketSizeBytes` + `NumberOfObjects` | last 24h average |
| RDS | `describe-db-instances` `AllocatedStorage` (GB); CloudWatch `FreeStorageSpace` for used | Allocated - Free |
| DynamoDB | `describe-table` `TableSizeBytes`, `ItemCount` | direct |
| EFS | `describe-file-systems` `SizeInBytes.Value` | direct |
| FSx | `describe-file-systems` `StorageCapacity` + CloudWatch `FreeStorageCapacity` | Used = Cap - Free |
| EBS | `describe-volumes` `Size` (allocated); CloudWatch for IOPS (used can't be measured cheaply, estimate as allocated) | allocated |
| ECR | `describe-images --repository-name ...` sum `imageSizeInBytes` | direct |

Record `sizing_method` per datastore. CloudWatch reads have ~1h staleness; describe-API reads are real-time. If a service requires authenticated metrics the source profile can't read, fall back to `estimated-from-allocated` and emit a `warning`.

### Step 3 — Choose transfer tool + mode per datastore

The choice depends on size, RPO target, encryption, and whether the schema changes. Default mapping:

| Service | Size | RPO ≥ 60min | RPO < 60min (continuous) |
|---|---|---|---|
| S3 | < 1 TB | `aws-s3-sync` bulk | `s3-batch-replication` bulk-plus-delta |
| S3 | ≥ 1 TB | `s3-batch-replication` bulk-plus-delta | `s3-batch-replication` continuous |
| RDS | < 500 GB | `aws-rds-snapshot-share` snapshot-restore | `aws-dms` continuous-replication |
| RDS | ≥ 500 GB | `aws-rds-snapshot-share` snapshot-restore + DMS for delta | `aws-dms` continuous-replication |
| DynamoDB | any | `dynamodb-export-import` bulk | `aws-backup-cross-account` continuous (if Global Tables not viable) |
| EFS / FSx | any | `aws-datasync` bulk | `aws-datasync` bulk-plus-delta |
| EBS (data) | any | `ec2-snapshot-share` snapshot-restore | only viable via DataSync on the mounted FS |
| ECR | any | `ecr-push-pull` bulk | `ecr-push-pull` bulk (re-push deltas) |
| Redshift | any | UNLOAD to S3 → COPY in target | manual + DMS |
| ElastiCache | any | snapshot + restore | manual (continuous is rare) |

Record `reason` (size threshold, encryption constraint, RPO target). Record `alternatives_considered` with `rejected_because` for the runner-up.

Special cases:
- **DynamoDB Global Tables** — if the table already replicates to the target region in the same account, the migration is just adding a replica in the target *account* (often easier than export/import). Flag this in the plan.
- **RDS Multi-AZ** — snapshot from the standby (no impact). Note in the plan.
- **Aurora Global Database** — different problem; flag for manual review.

### Step 4 — Encryption handling per datastore

For each encrypted datastore:

1. Identify `source_kms_key_arn` from the resource description
2. Classify: `aws-managed` (auto-handled, no grant needed for cross-account share), `customer-managed` (must grant target account), `external` (cannot grant — blocker)
3. Determine target key: existing `target_kms_key_arn` if Terraform pre-generated it, else mark for creation in Phase 1
4. Set `requires_target_kms_grant: true` if customer-managed
5. Set `requires_re_encryption: true` if the target uses a different key (most cross-account migrations)

If any datastore uses an external KMS key (CloudHSM, BYOK that source account doesn't fully control), emit a `blocker`-severity warning. The plan cannot proceed for that datastore without operator intervention.

### Step 5 — Estimate transfer time

Use a per-tool throughput model. These are conservative defaults — annotate `confidence` accordingly.

| Tool | Default throughput | Real-world ceiling |
|---|---|---|
| `aws-s3-sync` (single-process) | 200 Mbps | 1 Gbps with `--cli-write-timeout` + parallel processes |
| `s3-batch-replication` | per-object overhead bound; assume 1000 objects/s | scales with object count, not bytes |
| `aws-rds-snapshot-share` + restore | ~1 GB / 30s metadata; restore is size-dependent: ~30 min for first 500 GB + 5 min/100 GB after | varies with instance class |
| `aws-dms` | depends on replication instance: t3.medium ~50 Mbps, c5.4xlarge ~1 Gbps | replicas can run faster than primary writes |
| `aws-datasync` | 10 Gbps per task; throttle to 200 Mbps if business-hours | up to network/agent ceiling |
| `dynamodb-export-import` | export ~2 min / GB; import ~5 min / GB | parallelism is fixed |
| `ec2-snapshot-share` + restore | snapshot share is metadata only (seconds); restore depends on usage pattern | first read of each block from S3 |
| `ecr-push-pull` | 100 Mbps per repo | parallelize across repos |

Compute:
- `bulk_phase_hours` = size / throughput
- `delta_phase_hours` = depends on write rate during bulk phase (0 if writes are frozen during bulk; otherwise: bulk_hours × source-write-rate-as-fraction-of-throughput)
- `cutover_phase_minutes` = final switchover step (snapshot-restore final apply, DMS replica promotion, DNS swap)
- `total_wall_clock_hours` = sum, with confidence

Set `confidence: low` when sizing was estimated or throughput is a tool default.

### Step 6 — Estimate cost

Query `awspricing` MCP for the cost components:

| Component | How to price |
|---|---|
| Data transfer (egress) | Source region → target region per-GB rate × size |
| Data transfer (cross-account, same region) | $0 within same region usually — verify |
| DMS instance-hours | Instance class price × estimated_hours |
| DataSync per-GB | $0.0125/GB transferred (current; verify via MCP) |
| S3 Batch operations | $0.25 / million objects + standard request fees |
| Double-storage | Target storage per-GB-month × size × (cutover_window + retain_source_for_hours) / 720 |
| Validation | API calls during validation (negligible usually); if full checksum, account for compute |

`total_usd` = sum. Record `pricing_source`.

### Step 7 — RPO / RTO targets per datastore

Read criticality tag (`MIGRATION_CRITICALITY_TAG`, default `Criticality`). Default tier mapping if absent:

| Tier | RPO default | RTO default |
|---|---|---|
| tier-1 (production-critical) | 0 minutes (continuous replication required) | 30 minutes |
| tier-2 (production) | 60 minutes | 240 minutes |
| tier-3 (non-production, dev/test) | 1440 minutes (24h) | 1440 minutes |

If RPO target conflicts with the chosen strategy (e.g. tier-1 with snapshot-restore strategy), warn and recommend upgrading to continuous replication (DMS, S3 batch replication).

### Step 8 — Freeze windows per datastore

A freeze window is required when:
- RPO is 0 AND strategy is not continuous-replication
- The datastore has writes during the cutover window AND tool is bulk-mode

For each datastore where `freeze_window.required: true`:
- `duration_minutes` = cutover_phase_minutes + validation_minutes + safety margin (default 15 min)
- `begins_at_phase` = the cutover-data-plane phase that initiates the final switchover (usually Phase 3 for databases, Phase 5 for DNS)
- `notes` = the concrete enforcement mechanism (set RDS parameter to read-only, attach bucket policy denying writes, etc.)

### Step 9 — Validation methods per datastore

Pick methods by service and criticality:

| Service | Tier-1 / Tier-2 | Tier-3 |
|---|---|---|
| S3 | `object-count` + `byte-count` + `checksum-sample` (100 random objects) | `object-count` |
| RDS | `row-count` per table + `smoke-query` per critical table | `row-count` |
| DynamoDB | `object-count` + `checksum-sample` (1000 random items) | `object-count` |
| EFS / FSx | `byte-count` + `checksum-sample` (100 random files) | `byte-count` |
| EBS | mount and run filesystem check | filesystem check |
| ECR | `object-count` (image count) + verify digests match | `object-count` |

Write concrete `acceptance_criteria` ("row counts match within 0 rows", "100/100 sample checksums match"). Estimate `validation_minutes`.

### Step 10 — Rollback retention

For each datastore, set `retain_source_for_hours` based on criticality:
- tier-1: 168 hours (7 days)
- tier-2: 72 hours (3 days)
- tier-3: 24 hours

Compute `retention_cost_usd` = source storage cost × hours / 720.

### Step 11 — Bandwidth and sequencing

For each datastore:
- `throttle_business_hours: true` if criticality is tier-1 or tier-2 AND business-hours window can be determined from `Owner`/`Team` tag
- Default business-hours window: `Mon-Fri 09:00-18:00` in the owner team's likely timezone (best-effort from `MIGRATION_OWNER_TIMEZONE_HINT` env or fall back to `America/New_York`)
- `max_concurrent_jobs` per service: 4 for DataSync, 2 for DMS, 1 for snapshot-restore (sequential), unlimited for S3 sync

Compute `depends_on[]`:
- A DB containing schema referenced by other DBs goes first
- Reference data (lookup tables) before transactional data
- Anything downstream of a DMS replication source must wait for the source to be ready

### Step 12 — Critical path and summary

- Sort datastores by `total_wall_clock_hours` descending
- `summary.critical_path[]` = ARNs in that order (the first item gates everything; the second can run in parallel if `max_concurrent_jobs > 1`)
- `summary.cutover_window_recommendation_hours` = the longest single `freeze_window.duration_minutes` across all tier-1/tier-2 datastores, rounded up to nearest hour, plus 1h safety margin
- `summary.estimated_total_transfer_hours` = wall-clock factoring in concurrency limits
- `summary.estimated_total_transfer_cost_usd` = sum of `cost_estimate.total_usd`
- `summary.estimated_double_storage_cost_usd` = sum of `cost_estimate.double_storage_during_overlap_usd`

### Step 13 — Warnings

Surface as `warnings[]`:
- `blocker` if external KMS key used (cannot grant)
- `blocker` if no viable transfer strategy (e.g. ElastiCache + RPO=0)
- `warning` if `total_wall_clock_hours > 168` (one week)
- `warning` if cross-region egress > $1000
- `warning` if a tier-1 datastore has `confidence: low`
- `warning` if a freeze window > 4 hours for tier-1
- `info` if any datastore is empty (no transfer needed)

### Step 14 — Emit + validate

Write `data-migration-plan.json`, validate against `schemas/data-migration-plan.schema.json`. Render `data-migration-plan.md` from the JSON. Print:

```
✓ Data migration plan generated
  Datastores:        N  (S3=… RDS=… DynamoDB=… EFS=… EBS=… ECR=…)
  Total data:        N TB
  Critical path:     <arn> (X hours)
  Recommended window: Y hours
  Total transfer cost: $Z
  Blockers:          N · Warnings: N
  Print:  data-migration-plan.md
  Track:  data-migration-plan.json
```

If any `blocker` warnings exist, the cutover-data-plane should NOT proceed without resolution. Surface this clearly.

## Anti-patterns — DO NOT

- Do not download data to size it. CloudWatch and describe APIs only.
- Do not assume default throughput is achievable in production. Annotate `confidence: low` and recommend a measured trial.
- Do not skip the freeze window for tier-1 with bulk strategy. RPO=0 + bulk = data loss. Force a continuous-replication choice instead.
- Do not guess at KMS key types. If you can't determine, emit a warning and skip the datastore from the auto-plan.
- Do not estimate cost without `awspricing` MCP. Manual list prices go stale fast.

## Related skills

- `migration-planner` — produces `cost-baseline.json` (input)
- `cutover-data-plane` — consumes `data-migration-plan.json` to inject real timings + freeze windows into the runbook
- `post-migration-auditor` — reads the validation methods from this plan to know what to check

## Sub-agent

Calls `data-migration-planner` to do the sizing, strategy selection, estimation, and emission.
