---
name: post-migration-auditor
description: After the human-driven cutover, compare source and target accounts and produce a structural diff. Runs describe-* against both profiles in parallel, normalizes (strips ARNs / timestamps / instance IDs), and categorizes drift: missing-in-target, extra-in-target, config drift, security drift, cost drift, scope drift. Emits audit-diff.json + a human-readable report. Use as the final step of a migration to verify parity.
---

# AWS Migration: Post-Migration Auditor

This is the **last skill** in the suite. After the human has executed the cutover (Phase 5 in the plan), this skill compares what's in source vs what's in target and gives a yes/no answer on whether the migration is complete.

## When to use this skill

- After the cutover is complete (Phase 5 done, Phase 6 begins)
- For ongoing parity checks during a parallel-run period
- To detect drift between two accounts that should be equivalent (also useful outside migrations)

## Prerequisites

- Both `$MIGRATION_SOURCE_PROFILE` and `$MIGRATION_TARGET_PROFILE` set and authenticated
- The source-side `inventory.json` exists (used as the expected baseline)
- The same scope (regions, services, tag filter) is applied to both sides

## Inputs

| Input | Source | Required |
|---|---|---|
| `inventory.json` (source) | `inventory` skill | yes |
| `$MIGRATION_SOURCE_PROFILE` | env var | yes |
| `$MIGRATION_TARGET_PROFILE` | env var | yes |

## Outputs

- **`audit-diff.json`** — validates against `schemas/audit-diff.schema.json`. Summary counts per drift category, full `findings[]` array.
- **`audit-report.md`** — human-readable summary organized by drift category.

## Workflow

### Step 1 — Re-inventory the target

Spawn the `post-migration-auditor` sub-agent. It re-runs the same describe-* sweep against `$MIGRATION_TARGET_PROFILE` using the same `coverage` block (same regions, same services, same tag filter as the source inventory).

This produces a target-side temporary inventory in memory (not persisted as a separate artifact unless `--persist-target-inventory` is passed).

### Step 2 — Match resources by stable identity

Source and target resources have different ARNs (different account IDs, possibly different region, possibly different instance IDs). Match by **stable identity**:

| Resource type | Stable identity key |
|---|---|
| EC2 instance | `Name` tag + `InstanceType` + region |
| RDS instance | `DBInstanceIdentifier` |
| Lambda function | `FunctionName` |
| S3 bucket | bucket name + suffix (if `var.bucket_name_suffix` was applied) |
| IAM role | role name |
| KMS key | alias |
| VPC | `Name` tag |
| Subnet | `Name` tag + AZ-by-index (us-east-1a → us-west-2a as positional first) |
| Security group | `GroupName` |
| Secrets Manager secret | secret name |
| Route53 zone | zone name |

Resources without a clear match → "missing-in-target" or "extra-in-target".

### Step 3 — Structural diff per matched pair

For each matched (source, target) pair:

1. Normalize both sides:
   - Strip ARNs entirely (the account ID and possibly region differs by design)
   - Strip timestamps (`CreateDate`, `LastModifiedDate`, etc.)
   - Strip auto-generated IDs (`InstanceId`, `VpcId`, `EniId`)
   - Strip CloudWatch log groups specific to source instance IDs
2. Diff the remaining JSON structurally
3. Categorize each diff:
   - **security drift** if the field is in any of: `SecurityGroups`, `IpPermissions`, `Policy`, `BucketPolicy`, `PolicyDocument`, `Encrypted`, `KmsKeyId`, `PubliclyAccessible`
   - **config drift** for any other functional field difference
   - **cost drift** if the field affects pricing: `InstanceType`, `DBInstanceClass`, `Iops`, `Throughput`, `ProvisionedConcurrencyConfig`, `MemorySize`
   - **scope drift** if the resource is in target but not in source-side `coverage.services_scanned` (means the user added something post-cutover, or migrated a service that wasn't in the original scope)

### Step 4 — Categorize the findings

- **missing-in-target** — source has it, target doesn't → severity error
- **extra-in-target** — target has it, source didn't → severity warning (could be intentional post-cutover work)
- **config drift** — both sides have it but values differ → severity warning unless it's a security field
- **security drift** — security-relevant fields differ → severity error
- **cost drift** — cost-relevant fields differ → severity warning
- **scope drift** — target has resources in services that source's coverage doesn't include → severity info

### Step 5 — Compute the verdict

```
verdict = "clean"            if total findings == 0
verdict = "minor-drift"      if findings < 5 and no error-severity
verdict = "significant-drift" if any error-severity present
verdict = "failed"           if matching failed (e.g., target auth lost mid-run)
```

### Step 6 — Validate, emit, summarize

Validate `audit-diff.json` against schema. Render `audit-report.md`. Print:

```
✓ Post-migration audit complete
  Total resources in scope:   1,189
  Matched:                    1,184
  Missing in target:              3   ← see findings
  Extra in target:                2
  Config drift:                  47
  Security drift:                 0
  Cost drift:                     8
  Scope drift:                    0
  Verdict:                       minor-drift
  Report: audit-report.md
```

## Important behavior: self-consistency check

If `$MIGRATION_SOURCE_PROFILE` and `$MIGRATION_TARGET_PROFILE` point at the **same** profile, the auditor should report **zero findings**. Any non-empty diff in that case is a bug in the normalization logic and must be fixed before the auditor is trusted.

Verification #5 in the plan tests exactly this case.

## Related skills

- `inventory` — provides the source-side baseline
- `cutover-manager` — Phase 6 of its checklist invokes this skill

## Sub-agent

Calls `post-migration-auditor` for the cross-profile describe-* sweep + structural diff.
