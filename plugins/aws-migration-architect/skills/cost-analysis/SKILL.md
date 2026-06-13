---
name: cost-analysis
description: Deep cost analysis for the source account — explains WHY spend is high (per-service usage-type drivers, Reserved Instance / Savings Plans coverage gaps, data-transfer/NAT/idle waste) and shows a trailing month-over-month trend including the current in-progress (accrued, uninvoiced) month. Read-only and best-effort. Use when the user asks "why is this account so expensive?", "what's driving the bill?", or "how is cost trending?".
---

# AWS Migration: Cost Analysis

Goes beyond the single-month total from `cost-summary`. This skill answers two questions:

1. **Why is the bill high?** — break each top service into its usage-type drivers and commitment-coverage gaps, with plain-English reasons and reduction levers.
2. **How is it trending?** — trailing month-over-month net cost, plus the current in-progress month's accrued (uninvoiced) cost, since AWS bills monthly in arrears.

Read-only and best-effort: a Cost Explorer or permission failure degrades to `available: false` and never blocks anything.

## When to use this skill

- The user asks why the account is expensive or what's driving the bill
- Building the migration business case (which costs disappear vs follow the workload)
- Tracking spend trend before/after cutover

## Prerequisites

- `$MIGRATION_SOURCE_PROFILE` configured with the Cost Explorer read actions in `examples/iam/source-read-only.json`: `ce:GetCostAndUsage`, `ce:GetReservationCoverage`, `ce:GetReservationUtilization`, `ce:GetSavingsPlansCoverage`, `ce:GetSavingsPlansUtilization`
- Cost Explorer enabled on the account
- `aws sts get-caller-identity --profile $MIGRATION_SOURCE_PROFILE` succeeds

## Inputs

| Input | Source | Required |
|---|---|---|
| `$MIGRATION_SOURCE_PROFILE` | env var | yes |
| `$AWS_MIGRATION_ROOT` | env var, default `~/.aws-migration` | no |
| `$MIGRATION_COST_TREND_MONTHS` | env var, default `12` | no |
| run directory | task brief | no — defaults to the latest run dir for the profile |

## Output

- **`cost-analysis.json`** — validates against `schemas/cost-analysis.schema.json`: `cost_drivers[]`, `commitments`, and `trend`. When Cost Explorer is unavailable, `available: false` with `unavailable_reason`.

## Workflow

### Step 1 — Verify prereqs

```bash
aws sts get-caller-identity --profile "$MIGRATION_SOURCE_PROFILE"
```

If this fails, halt and report the auth error. Cost Explorer is global — all `ce` calls run once, not per region.

### Step 2 — Drivers: per-service usage-type breakdown ("why high")

For the **last full month**, get the per-service totals grouped by usage type (Cost Explorer allows two group-bys):

```bash
aws ce get-cost-and-usage \
    --profile "$MIGRATION_SOURCE_PROFILE" \
    --time-period Start=<first-of-prev-month>,End=<first-of-this-month> \
    --granularity MONTHLY --metrics NetUnblendedCost \
    --group-by Type=DIMENSION,Key=SERVICE Type=DIMENSION,Key=USAGE_TYPE \
    --output json
```

For the top ~8 services by net cost, keep the top 3–5 usage types each and translate them into reasons. Common driver patterns to name explicitly:

- **`Amazon EC2 - Compute` / `BoxUsage:*`** — on-demand instance hours. High here usually means low Savings-Plans/RI coverage (see Step 3) or oversized/idle instances.
- **`EC2 - Other`** — decompose it: `*-NatGateway-Hours` + `NatGateway-Bytes` (NAT egress), `EBS:VolumeUsage*` / `EBS:VolumeIOUsage` (volumes/IOPS), `DataTransfer-Regional-Bytes` (inter-AZ), `*-VPC-Endpoint-Hours`, idle `ElasticIP:IdleAddress`.
- **`Amazon RDS` + license line items** — `InstanceUsage:db.*` plus License-Included third-party fees (SQL Server / Oracle) which are often the single biggest lever (BYOL or engine change).
- **`Amazon Elastic Load Balancing`** — `LCUUsage` / `LoadBalancerUsage` (LCU hours, count of LBs).
- **`DataTransfer-Out-Bytes` / `*-AWS-Out-Bytes`** — internet/inter-region egress.
- **Tax / Support / marketplace / LLM (Bedrock) line items** — real invoice cost but not migratable infrastructure; call them out so they aren't mistaken for workload spend.

For each driver, add 1–2 `recommendations` (e.g., "buy a 1-yr Compute Savings Plan to cover the steady ~$X/mo on-demand", "consolidate 4 NAT gateways to 1 per AZ", "release N idle Elastic IPs", "RDS SQL Server → BYOL or Aurora PostgreSQL").

### Step 3 — Commitments: RI & Savings Plans coverage/utilization

```bash
aws ce get-savings-plans-coverage      --profile "$MIGRATION_SOURCE_PROFILE" --time-period Start=<prev-month>,End=<this-month> --granularity MONTHLY
aws ce get-savings-plans-utilization   --profile "$MIGRATION_SOURCE_PROFILE" --time-period Start=<prev-month>,End=<this-month> --granularity MONTHLY
aws ce get-reservation-coverage        --profile "$MIGRATION_SOURCE_PROFILE" --time-period Start=<prev-month>,End=<this-month> --granularity MONTHLY
aws ce get-reservation-utilization     --profile "$MIGRATION_SOURCE_PROFILE" --time-period Start=<prev-month>,End=<this-month> --granularity MONTHLY
```

Record coverage % and utilization % into `commitments`. Low coverage on steady compute is the #1 reason on-demand spend is high; low utilization means existing commitments are being wasted. Note RI/SP non-transferability — these do **not** migrate to the target account.

### Step 4 — Trend: trailing month-over-month

Pull `$MIGRATION_COST_TREND_MONTHS` (default 12) full months:

```bash
aws ce get-cost-and-usage \
    --profile "$MIGRATION_SOURCE_PROFILE" \
    --time-period Start=<first-of-month-N-months-ago>,End=<first-of-this-month> \
    --granularity MONTHLY --metrics NetUnblendedCost \
    --output json
```

Compute per-month `mom_change_pct` (null for the first), `trailing_avg_monthly`, and a `direction` (`rising`/`flat`/`falling`) from the linear trend. Cost Explorer retains ~14 months of history; set `months_available` to what actually returned.

Also capture the **current in-progress month** separately (AWS bills monthly in arrears, so it is still accruing and uninvoiced) into `current_month_to_date_accrued` — keep it out of the trailing-month comparison since it's a partial month:

```bash
aws ce get-cost-and-usage \
    --profile "$MIGRATION_SOURCE_PROFILE" \
    --time-period Start=<first-of-this-month>,End=<today+1> \
    --granularity MONTHLY --metrics NetUnblendedCost
```

### Step 5 — Emit and validate

Build `cost-analysis.json` and validate against `schemas/cost-analysis.schema.json`. On any Cost Explorer failure, write `available: false` + `unavailable_reason` and stop without error.

### Step 6 — Render the report

Print box-format tables to stdout.

**Cost drivers — why the bill is high (last full month):**

```
┌──────────────────────────────┬────────────┬───────┬──────────────────────────────────────────────────────────────┐
│ Service                      │ Net $/mo   │ Share │ Why it's high → lever                                         │
├──────────────────────────────┼────────────┼───────┼──────────────────────────────────────────────────────────────┤
│ Amazon EC2 - Compute         │ 724.38     │ 13.4% │ On-demand m5/c5 hours, 0% SP coverage → buy 1-yr Compute SP   │
│ RDS License-Included (3P)    │ 851.14     │ 15.7% │ SQL Server license fees → BYOL or move to Aurora PostgreSQL   │
│ EC2 - Other                  │ 352.41     │ 6.5%  │ 4× NAT-Hours + inter-AZ transfer → consolidate NAT / VPC endpts│
│ Amazon Elastic Load Balancing│ 377.22     │ 7.0%  │ LCU hours across 19 ALB/NLB → retire unused LBs               │
└──────────────────────────────┴────────────┴───────┴──────────────────────────────────────────────────────────────┘
```

**Commitment coverage:**

```
┌───────────────────┬───────────┬──────────────┐
│ Commitment        │ Coverage  │ Utilization  │
├───────────────────┼───────────┼──────────────┤
│ Savings Plans     │ 0%        │ —            │
│ Reserved (EC2/RDS)│ 12%       │ 96%          │
└───────────────────┴───────────┴──────────────┘
```

**Net cost trend (NetUnblendedCost, trailing months):**

```
┌──────────┬────────────────┬──────────┐
│ Month    │ Net Cost (USD) │ MoM Δ    │
├──────────┼────────────────┼──────────┤
│ 2025-12  │ 4,980.11       │ —        │
│ 2026-01  │ 5,012.40       │ +0.6%    │
│ 2026-04  │ 5,201.77       │ +2.1%    │
│ 2026-05  │ 5,417.18       │ +4.1%    │
└──────────┴────────────────┴──────────┘
Trend: rising · trailing avg 5,150.62 / mo · 12 months of history
Current month (2026-06, in progress, uninvoiced): 2,310.55 month-to-date
```

If Cost Explorer was unavailable, print a single line: `Cost analysis — unavailable (<reason>)`.

## Related skills

- `cost-summary` — the single-month net-billed total (run that first for the headline number)
- `inventory` — the resource counts those costs map to
- `migration-planner` — produces `cost-baseline.json` (source-vs-target delta estimate); this skill explains the *current* source bill, not the target projection

## Anti-patterns — DO NOT

- Do not call any `create-*` / `modify-*` / `delete-*` operation — read-only.
- Do not fold the current in-progress month into month-over-month deltas — it's a partial, still-accruing month; report it separately as `current_month_to_date_accrued`.
- Do not drop Tax/Support/marketplace/LLM line items — but clearly label them as non-migratable so they aren't read as workload cost.
- Do not let a Cost Explorer failure block discovery — degrade to `available: false`.
- Do not confuse `cost-analysis.json` with `cost-baseline.json` (planner delta) or `cost-summary.json` (single-month snapshot).
