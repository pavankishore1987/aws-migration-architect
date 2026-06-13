---
name: inventory
description: Discover-then-confirm scan of an AWS source account. Enumerates enabled regions, snapshots services in scope, asks the user to confirm coverage, then runs a deep describe-* pass and emits inventory.json, resource-ownership.json, and unsupported-report.md. Use when starting a new account-to-account migration, or to refresh source state with MIGRATION_INCREMENTAL=true.
---

# AWS Migration: Inventory

This skill produces the **source-of-truth artifact** the rest of the migration suite depends on. Everything downstream — dependency analysis, Terraform generation, migration planning, cutover, audit — reads `inventory.json`.

## When to use this skill

- Starting a new migration run against a source account
- Refreshing source state (with `MIGRATION_INCREMENTAL=true`) before re-planning
- Scoping a partial migration to a specific project or environment

## Prerequisites

- `$MIGRATION_SOURCE_PROFILE` points at a configured AWS profile with at least `ReadOnlyAccess` (see `examples/iam/source-read-only.json` for the minimum scoped policy)
- `aws sso login --profile $MIGRATION_SOURCE_PROFILE` (or equivalent) has been run
- `aws sts get-caller-identity --profile $MIGRATION_SOURCE_PROFILE` succeeds

## Inputs

| Input | Source | Required |
|---|---|---|
| `$MIGRATION_SOURCE_PROFILE` | env var | yes |
| `$MIGRATION_REGIONS` | env var (comma-separated) | no — defaults to all enabled regions |
| `$MIGRATION_TAG_FILTER` | env var (`K=V,K=V` AND semantics) | no |
| `$MIGRATION_FORCE_INCLUDE` | env var (comma-separated ARNs) | no |
| `$MIGRATION_OWNERSHIP_TAGS` | env var, default `Owner,Team` | no |
| `$MIGRATION_INCREMENTAL` | env var `true`/`false`, default `false` | no |
| `$AWS_MIGRATION_ROOT` | env var, default `~/.aws-migration` | no |
| AWS Config exports | user-supplied JSON files (optional) | no |

## Outputs

Written to `$AWS_MIGRATION_ROOT/runs/<source>-to-<target>-<run-id>/`:

- **`inventory.json`** — validates against `schemas/inventory.schema.json`. Top-level `coverage` block documents scanned vs skipped regions/services. Each resource has generic `type` + `provider_specific.aws` per the cloud-agnostic data model.
- **`resource-ownership.json`** — validates against `schemas/resource-ownership.schema.json`. Map of `team → resources[]` from `MIGRATION_OWNERSHIP_TAGS`. Drives per-team approval gates in the cutover checklist.
- **`unsupported-report.md`** — consolidated triage doc for services seen at discovery but **not** in MVP. Prevents false confidence ("did SageMaker actually get migrated?").

## Workflow

### Step 1 — Verify prereqs and pick the run-id

```bash
aws sts get-caller-identity --profile "$MIGRATION_SOURCE_PROFILE"
```

Generate `run-id` as a UUID v4 (or read from an `--resume <run-id>` argument). Create the run directory at `$AWS_MIGRATION_ROOT/runs/<source>-to-<target>-<run-id>/`.

### Step 2 — Enumerate enabled regions

```bash
aws ec2 describe-regions \
    --all-regions=false \
    --profile "$MIGRATION_SOURCE_PROFILE" \
    --query 'Regions[].RegionName' \
    --output text
```

If `$MIGRATION_REGIONS` is set, intersect with enabled regions (warn on any user-requested region that is opted-out).

### Step 3 — Discovery snapshot (cheap)

In priority order:
1. **Resource Explorer** (`aws resource-explorer-2 search --query-string "*"`) if a view exists in the account — fastest path, cross-region in one call
2. **AWS Config aggregator** (`aws configservice list-aggregate-discovered-resources`) if Config is enabled
3. **Fallback: `list-*` sweep** across MVP services in each scoped region (slower)

Apply `$MIGRATION_TAG_FILTER` (AND semantics) and add `$MIGRATION_FORCE_INCLUDE` ARNs. Identify CloudFormation stacks; record in `coverage.cloudformation_stacks[]`.

### Step 4 — Confirm scope with the user

Print the snapshot table:

```
┌──────────────────────────────────────────────────────────┐
│ Source account 111111111111 — discovery snapshot         │
├──────────────────────────────────────────────────────────┤
│ Enabled regions: us-east-1, us-west-2, eu-west-1         │
│ Tag filter:     Project=foo,Env=prod                     │
│ Services seen with >0 resources:                         │
│   ✓ EC2 (47), VPC (8), S3 (23), RDS (4), Lambda (89)     │
│   ⚠ Glue (3), SageMaker (2)                  → not MVP   │
│ CloudFormation stacks: 3                                 │
└──────────────────────────────────────────────────────────┘
```

Ask: **"Inventory all MVP services in [confirmed regions]? [Y / specify subset / abort]"**.

Skip the prompt entirely if `$MIGRATION_REGIONS`, `$MIGRATION_SERVICES`, and `$MIGRATION_TAG_FILTER` are all set (orchestrator mode).

### Step 5 — Deep inventory pass

For each (confirmed region × MVP service), invoke the sub-agent `inventory-explorer` with the bounded scope. The sub-agent:
- Runs `describe-*` / `list-*` / `get-*` for each resource type
- Iterates pagination with `--starting-token` loops (no silent truncation)
- Honors AWS CLI exponential backoff for throttling
- Filters out `AWSServiceRoleFor*` (service-linked roles → `coverage.skipped_service_linked_roles[]`)
- Tags each resource with criticality heuristic (P1 = stateful + tagged as production; P2 = used by P1; P3 = standalone non-prod)
- Maps to the cloud-agnostic generic type (`compute_instance`, `load_balancer`, `object_store`, `block_storage`, etc.) with raw output under `provider_specific.aws`

### Step 6 — Incremental mode (if enabled)

If `$MIGRATION_INCREMENTAL=true`:
- Read the most recent prior `inventory.json` for the same source profile
- If `>30 days old`, fall back to full inventory (warn)
- For services with Config: query `config:get-resource-config-history --earlier-time <previous_captured_at>` and only re-fetch changed resources
- For services without Config: re-run full `describe-*` for those services
- Merge delta into the prior inventory; record `incremental_from: <previous_run_id>` in metadata

### Step 7 — Resource ownership extraction

Read `$MIGRATION_OWNERSHIP_TAGS` (default `Owner,Team`). For each resource:
- Find the first matching tag; the value is the team identifier
- Group resources by team → emit `resource-ownership.json`
- Resources without any matching tag → `unowned_resources[]`

### Step 8 — Unsupported-service report

For each service in `coverage.services_skipped` with `resource_count_seen > 0`:
- List the resources seen (name, region, brief description)
- Suggest a recommended action (re-deploy via service-native tool, hand-port, skip, etc.)
- Render as markdown to `unsupported-report.md`

### Step 9 — Validate and emit

Validate `inventory.json` against `schemas/inventory.schema.json`. Validate `resource-ownership.json` against its schema. Print the **inventory report** — a per-service resource table (friendly service names; `Where (region: count)` with default-VPC/SG artifacts collapsed to `+ 1 default each`; target groups as an indented sub-row excluded from the total; IAM/S3 marked `global`). See the inventory-explorer agent's "Inventory report format" for the exact box-drawing layout. Example:

```
┌───────────────────┬───────┬───────────────────────────────────────────────┐
│ Service           │ Count │ Where (region: count)                         │
├───────────────────┼───────┼───────────────────────────────────────────────┤
│ ALB/NLB (v2)      │ 19    │ us-west-1 (19)                                │
│   └ Target groups │ 215   │ us-west-1 (215)                               │
│ EC2 instances     │ 12    │ us-west-1 (11), ap-south-1 (1)                │
│ VPCs              │ 7     │ us-west-1 (2), ap-south-1 (2), + 1 default …  │
│ IAM roles         │ 34    │ global                                        │
│ S3 buckets        │ 5     │ global                                        │
└───────────────────┴───────┴───────────────────────────────────────────────┘
Total resources (excl. target-group sub-counts): 308
```

For a net-billed-cost breakdown of the same account, run the `cost-summary` skill.

## Related skills

- `dependency-analyzer` — next step; reads `inventory.json`
- `migration-planner` — needs `inventory.json` + `dependency-graph.json`
- `post-migration-auditor` — uses `inventory.json` as the post-migration expectation

## Sub-agent

Calls `inventory-explorer` for the deep `describe-*` pass.
