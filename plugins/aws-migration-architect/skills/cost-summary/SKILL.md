---
name: cost-summary
description: Pull the source account's last-full-month net billed cost (NetUnblendedCost) from Cost Explorer, grouped by service, and render a box-format cost table. Read-only and best-effort — never blocks. Use to estimate current monthly spend during discovery, or any time the user asks "what is this account costing per month?".
---

# AWS Migration: Cost Summary

Produces a quick, account-wide **net billed cost** breakdown for the source account using AWS Cost Explorer. This is the actual invoiced cost (post-discount, post-credit), not a list-price estimate. It complements the `inventory` skill: inventory tells you *what* is in the account, this tells you *what it costs*.

This skill is **read-only** and **best-effort** — if Cost Explorer is not enabled or `ce:GetCostAndUsage` is denied, it reports that cleanly and never blocks discovery.

## When to use this skill

- During discovery, to ground the migration business case in real monthly spend
- When the user asks "how much is this account costing?" / "what's the monthly bill?"
- Before/after a migration to compare source vs target run-rate (run once per account)

## Prerequisites

- `$MIGRATION_SOURCE_PROFILE` points at a configured AWS profile with `ce:GetCostAndUsage` (already included in `examples/iam/source-read-only.json`)
- Cost Explorer is enabled on the account (first-time enablement can take ~24h to backfill data)
- `aws sts get-caller-identity --profile $MIGRATION_SOURCE_PROFILE` succeeds

## Inputs

| Input | Source | Required |
|---|---|---|
| `$MIGRATION_SOURCE_PROFILE` | env var | yes |
| `$AWS_MIGRATION_ROOT` | env var, default `~/.aws-migration` | no |
| run directory | task brief / discover workflow | no — defaults to the latest run dir for the profile |

## Output

Written to the run directory (or `$AWS_MIGRATION_ROOT/runs/<source>-to-<target>-<run-id>/`):

- **`cost-summary.json`** — validates against `schemas/cost-summary.schema.json`. Holds `metadata` (period + metric + currency), `available`, per-service `by_service[]` sorted by descending amount, and the `total`. When Cost Explorer is unavailable, `available: false` with `unavailable_reason`.

## Workflow

### Step 1 — Verify prereqs

```bash
aws sts get-caller-identity --profile "$MIGRATION_SOURCE_PROFILE"
```

If this fails, halt and report the auth error.

### Step 2 — Compute the last full month

Cost Explorer is **global and account-wide** — it is not region-scoped, so run it once. Use the **last full calendar month**: `period_start` = first day of the previous month (inclusive), `period_end` = first day of the current month (exclusive), both `YYYY-MM-DD`.

### Step 3 — Query Cost Explorer

```bash
aws ce get-cost-and-usage \
    --profile "$MIGRATION_SOURCE_PROFILE" \
    --time-period Start=<period_start>,End=<period_end> \
    --granularity MONTHLY \
    --metrics NetUnblendedCost \
    --group-by Type=DIMENSION,Key=SERVICE \
    --output json
```

- Use `NetUnblendedCost` — the cost that actually hits the invoice after discounts and credits.
- Account-wide cost includes line items outside the migration scope (Tax, Support, marketplace/LLM, etc.). Report them as-is; do **not** silently drop them.
- If the call returns AccessDenied or Cost Explorer is not enabled, write `cost-summary.json` with `available: false` and a clear `unavailable_reason`, then stop without error.

### Step 4 — Emit and validate

Build `cost-summary.json`: set `available: true`, `metadata` (`period_start`, `period_end`, `period_label`, `metric: NetUnblendedCost`, `currency: USD`), `by_service[]` (each `{ service, amount, unit }`, sorted by descending `amount`), and `total` (sum of all amounts). Validate against `schemas/cost-summary.schema.json`.

### Step 5 — Render the box-format cost table

Print to stdout. Title shows the month and metric. One row per service, sorted by descending net cost. Roll up every service under $1.00/mo into a single `< 1.00 each` line that names them. The final `TOTAL` row sums all rows and appends ` / mo`.

```
Net billed cost — May 2026 (NetUnblendedCost, last full month)
┌───────────────────────────────────────────────────────────┬────────────────┐
│ Service                                                   │ Net Cost (USD) │
├───────────────────────────────────────────────────────────┼────────────────┤
│ AWS End User Messaging                                    │ 965.96         │
│ Amazon RDS Optimize CPU License Included Third Party Fees │ 851.14         │
│ Tax                                                       │ 826.36         │
│ Amazon EC2 - Compute                                      │ 724.38         │
│ Amazon RDS                                                │ 393.99         │
│ Amazon Elastic Load Balancing                             │ 377.22         │
│ AWS Business Support+                                     │ 374.83         │
│ EC2 - Other                                               │ 352.41         │
│ Amazon EKS                                                │ 157.30         │
│ Amazon VPC                                                │ 147.58         │
│ Amazon Cognito                                            │ 91.04          │
│ Claude Haiku 4.5 (Bedrock)                                │ 48.50          │
│ CloudWatch                                                │ 45.05          │
│ ElastiCache                                               │ 32.74          │
│ AWS WAF                                                   │ 18.01          │
│ Secrets Manager                                           │ 6.76           │
│ Claude Sonnet 4.5 (Bedrock)                               │ 2.75           │
│ ECR / API GW / DynamoDB / S3                              │ < 1.00 each    │
├───────────────────────────────────────────────────────────┼────────────────┤
│ TOTAL                                                     │ 5,417.18 / mo  │
└───────────────────────────────────────────────────────────┴────────────────┘
```

If Cost Explorer was unavailable, print a single line instead: `Net billed cost — unavailable (<reason>)`.

## Related skills

- `inventory` — the *what* (per-service resource counts by region); run first
- `dependency-analyzer` — resource relationships
- `migration-planner` — consumes inventory + dependencies; uses `cost-baseline.json` for source-vs-target delta (distinct from this account-wide snapshot)

## Anti-patterns — DO NOT

- Do not call any `create-*` / `modify-*` / `delete-*` operation — this skill is read-only.
- Do not let a Cost Explorer failure block discovery — degrade to `available: false`.
- Do not drop non-infrastructure line items (Tax, Support, marketplace) — report the true invoice total.
- Do not confuse this with `cost-baseline.json` (migration delta estimate produced by the planner) — different artifact, different schema.
