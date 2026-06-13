---
name: migration-planner
description: Produce the phased migration plan plus the readiness score and cost baseline. Reads inventory + dependency graph + risk scores, emits cost-baseline.json (first, so the user can sanity-check budget), readiness-score.json (second, with named blockers), then migration-plan.json + .md (the six-phase runbook with rollback per phase). Use after dependency-analyzer.
---

# AWS Migration: Migration Planner

This skill turns the raw analysis into a **decision document the human can act on**. It produces three artifacts in a specific order so the user can stop early if the migration isn't worth doing:

1. `cost-baseline.json` first — sanity-check the budget
2. `readiness-score.json` second — should we go at all?
3. `migration-plan.json` + `.md` third — the six-phase runbook

## When to use this skill

- After `dependency-analyzer` (it reads `dependency-graph.json` + `risk-scores.json`)
- Before `cutover-control-plane` / `cutover-data-plane` (the cutover checklists are derived from the plan)

## Prerequisites

- `inventory.json`, `dependency-graph.json`, `risk-scores.json`, `hardcoded-values.json` exist
- `awspricing` and `awsknowledge` MCP servers registered
- `$MIGRATION_TARGET_REGION` set if different from source region

## Inputs

| Input | Source | Required |
|---|---|---|
| `inventory.json` | `inventory` skill | yes |
| `dependency-graph.json` | `dependency-analyzer` | yes |
| `risk-scores.json` | `dependency-analyzer` | yes |
| `hardcoded-values.json` | `dependency-analyzer` | yes |
| `resource-ownership.json` | `inventory` | yes |
| `$MIGRATION_SOURCE_PROFILE` | env var | yes (for Cost Explorer queries) |
| `$MIGRATION_TARGET_REGION` | env var | optional |

## Outputs

In **emit order**:

1. **`cost-baseline.json`** — validates against `schemas/cost-baseline.schema.json`. Source steady-state cost vs target on-demand estimate vs target with-Phase-2-commitments estimate. RI/SP non-transferability explicit.
2. **`readiness-score.json`** — validates against `schemas/readiness-score.schema.json`. 0-100 score with `blockers[]` and `warnings[]`. Sub-scores for the 8 weighted factors.
3. **`migration-plan.json`** + **`migration-plan.md`** — validates against `schemas/migration-plan.schema.json`. Six phases (Networking → Storage → Databases → Applications → DNS Cutover → Validation) with per-step risk, owner team, estimated duration, parallel-safety, and rollback procedure.

## Workflow

### Step 1 — Cost baseline (FIRST, so the user can stop early)

Query Cost Explorer and pricing:

```bash
# Source steady-state effective monthly cost
aws ce get-cost-and-usage \
  --time-period Start=<30d-ago>,End=<today> \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --profile $MIGRATION_SOURCE_PROFILE

# RI / Savings Plan coverage in source
aws ce get-reservation-coverage --time-period Start=<30d-ago>,End=<today> --profile $MIGRATION_SOURCE_PROFILE
aws ce get-savings-plans-coverage --time-period Start=<30d-ago>,End=<today> --profile $MIGRATION_SOURCE_PROFILE
```

For each resource in `inventory.json`:
- Query `awspricing` MCP for the on-demand list price in target region
- Sum into `target.monthly_on_demand_estimate`

Compute:
- One-shot migration costs (DataSync, snapshot transfer, parallel-run period for cutover)
- Notes any service that couldn't be priced (out of MVP, novel SKU)

Emit `cost-baseline.json` immediately. Print to the user:

```
✓ Cost baseline written
  Source effective:                  $34,750 / mo
  Target on-demand estimate:         $47,780 / mo  (+$13,030/mo, RIs don't transfer)
  Target with Phase-2 commitments:   $35,100 / mo  (~match within 90 days)
  First-month migration one-shots:    $8,420
  Delta steady-state:                $   350 / mo (post-commitment)
  See cost-baseline.json
```

### Step 2 — Readiness score (SECOND)

Compute the 8 sub-scores (each 0-100):

| Factor | Computation |
|---|---|
| `mvp_coverage` | `100 * (MVP-covered resources) / (total resources seen at discovery)` |
| `unsupported_services` | `100 - min(100, 10 * count(services_skipped[]))` |
| `hardcoded_value_density` | `100 - min(100, 5 * count(hardcoded-values.manual_review_required[]))` |
| `iam_trust_complexity` | `100 - min(100, 5 * count(iam_trusts where needs_target_rework))` |
| `ri_sp_exposure` | `100 - min(100, 100 * (annual_RI_value / annual_account_cost))` |
| `cidr_conflicts` | `0 if any source-target VPC CIDR overlap else 100` |
| `stateful_share` | `100 - min(100, 100 * (stateful_resources / total_resources))` |
| `cutover_window` | `100 - min(100, estimated_downtime_minutes / 10)` |

Apply the weights from the schema (default: 20/15/15/15/10/10/10/5).

Build `blockers[]`: factors scoring below 40, plus any presence of:
- CloudFormation stacks awaiting user decision
- SAML / OIDC IdP trusts without target equivalents specified
- Unsupported MVP services with `resource_count_seen > 0`
- CIDR conflicts

Build `warnings[]`: factors scoring 40-70, plus:
- High RI/SP exposure
- High-count EIP literal references
- High-risk resource share above 20%

Emit `readiness-score.json`. Print:

```
✓ Readiness score: 78 / 100  —  "Mostly ready — review blockers"

Blockers (3):
  • 3 CloudFormation stacks need a decision (port / re-deploy / skip)
  • 2 SAML IdP trusts need target equivalents
  • 4 SageMaker endpoints — not in MVP

Warnings (2):
  • $48k/yr RI exposure reverts to on-demand for the first 90 days
  • 12 Lambda env vars reference source-EIP literals
```

If score < 60, prompt: "Resolve blockers before scheduling cutover?"
If score < 50 and running under the orchestrator, **halt unless `--force`**.

### Step 3 — Migration plan (THIRD)

Use `dependency-graph.json` to topologically order resources by dependency. Assign resources to phases per AWS migration best practice:

- **Phase 1 — Networking.** VPCs (with parameterized CIDRs to avoid conflicts), subnets, route tables, IGW, NAT gateways, VPC endpoints, security groups (without inter-SG rules yet), Transit Gateway / VPC peering placeholders.
- **Phase 2 — Storage.** S3 buckets (empty), EBS volume templates, EFS, FSx, ECR repositories (empty). Bucket policies parameterize source-account references. Data migration is a *Phase 5* concern (see `cutover-data-plane`).
- **Phase 3 — Databases.** RDS / Aurora clusters (created empty or restored from cross-account snapshots), DynamoDB tables, ElastiCache, OpenSearch. Encryption with new target KMS keys.
- **Phase 4 — Applications.** IAM roles (with cross-account trusts re-pointed), KMS keys, Secrets Manager containers (values placeholder — populated separately), Lambda functions, ECS services, EKS clusters / nodegroups / Fargate profiles / addons (the **AWS-managed parts** — see EKS handoff below), App Runner services, EC2 (launched from cross-account-shared AMIs), Auto Scaling, ELB/ALB/NLB (except listeners + target groups owned by the AWS Load Balancer Controller — see EKS handoff), API Gateway, CloudFront, WAFv2 (Web ACLs + IPSets + RuleGroups + associations remapped to target ALB/API-GW), Cognito (user pool config — users via data-plane), Step Functions, SNS/SQS/EventBridge.
- **Phase 5 — DNS Cutover.** Route53 zones populated. TTL reductions on records before cutover. DNS change to point at target ALB. Data plane copies (S3 sync, RDS snapshot restore, ECR image push) executed.
- **Phase 6 — Validation.** Run `post-migration-auditor`. Health checks, smoke tests, monitoring verification.

#### EKS handoff (in-cluster workloads are NOT migrated by IaC)

The plugin migrates the AWS-managed parts of EKS — the cluster itself, nodegroups, Fargate profiles, addons, and the cluster's IAM/OIDC scaffolding. **Everything inside the cluster** (Kubernetes API objects: `deployment`, `replicaset`, `service`, `endpointslice`, `ingress`, `namespace`, `statefulset`, `daemonset`, ConfigMaps, Secrets, etc.) lives in the cluster's etcd, not in any AWS API — and is therefore not inventoried, not Terraformed, and not migrated by this plugin. ELB listeners + target groups created on demand by the AWS Load Balancer Controller (recognizable by tags like `elbv2.k8s.aws/cluster=<name>` or `ingress.k8s.aws/stack=...` or `kubernetes.io/cluster/<name>=owned`) are likewise controller-managed and must NOT be re-created via Terraform — they will reappear when the workloads are redeployed.

The migration plan therefore inserts an explicit **EKS handoff step** in Phase 4 (one per cluster) which the cutover-data-plane runbook surfaces as a `k8s-redeploy-handoff` operation:

1. **Pre-cutover (Phase 4 control-plane):** the new target cluster is created (Terraform), with a fresh **OIDC provider URL** (every cluster gets a new one — IRSA role trust policies must be updated to the new URL).
2. **Operator action (Phase 4 data-plane handoff):**
   a. Re-establish the IRSA OIDC provider in the target IAM module (the new OIDC URL is captured in the cluster's describe-cluster output).
   b. Update the user's GitOps/Helm/CI pipeline to point at the new cluster context (`aws eks update-kubeconfig --name <target-cluster> --profile $MIGRATION_TARGET_PROFILE`).
   c. Re-deploy all workloads via the user's existing pipeline (`kubectl apply -k`, `helm upgrade --install`, ArgoCD sync, etc.) — the plugin does NOT run `kubectl`.
   d. Let the AWS Load Balancer Controller reconcile and create new target groups + listeners.
   e. Verify the workload count matches the source cluster's snapshot (an `inventory-snapshot.txt` captured by the operator pre-cutover) — e.g. `kubectl --context target get deploy -A --no-headers | wc -l`.
3. **All of these are marked `not_migrated_by_iac: true`** in inventory's `coverage.eks_handoff_resources[]` so post-migration-auditor reports them as "expected gap" rather than "missing in target."

The handoff is the **only** way EKS workloads get to target. The migration plan refuses to mark Phase 4 complete until each cluster's handoff step is approved.

For each step:
- `parallel_safe: true` if no edge in `dependency-graph` blocks parallel execution
- `risk` from `risk-scores.json`
- `owner_team` from `resource-ownership.json`
- `estimated_minutes` heuristic per resource type
- `cost_delta_usd` from `awspricing`

Per phase:
- `prerequisites`: open blockers, prior-phase completion gates
- `rollback`: explicit steps, named in reverse dependency order, plus a `rollback_window_minutes` (how long after the phase starts that rollback is still cheap)
- `go_no_go_gate`: phases with any High-risk resource get an explicit gate

### Step 4 — Generate human-readable runbook

Render `migration-plan.md` from `migration-plan.json` for the human reader. Include:
- Executive summary (resources, total time, cost delta, readiness score)
- Phase tables with steps, owner teams, time-boxes
- Per-phase rollback procedures
- Appendix: full resource manifest

### Step 5 — Validate and emit

Validate all three artifacts against their schemas. Print final summary:

```
✓ Migration planning complete
  cost-baseline.json     — delta: +$350/mo steady, +$13,120 first month
  readiness-score.json   — 78/100 (3 blockers, 2 warnings)
  migration-plan.json    — 6 phases, 1,189 resources, est. 38h cutover window
  migration-plan.md      — human runbook
```

## Related skills

- `inventory`, `dependency-analyzer` — must run first
- `cutover-control-plane` / `cutover-data-plane` — consume `migration-plan.json`

## Sub-agent

Calls `migration-planner` for the cost queries, readiness computation, and phased plan generation.
