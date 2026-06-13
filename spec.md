# AWS Migration Architect — Claude Code plugin

## Context

AWS account-to-account migrations are repetitive but error-prone, and the two existing sample plugins in this directory cover **building on AWS** (`sample-claude-code-plugins-for-startups`) and **Well-Architected reviews** (`sample-well-architected-skills-and-steering`) — neither covers **migrating an existing account**. The user wants a new Claude Code plugin that bundles nine specialist migration skills, each with a matching bounded sub-agent, plus a deterministic orchestrator that goes all the way through resource-by-resource execution against the target.

**This deliverable includes three phases of work:**
- **Phase 1 — skills + sub-agents (human-driven):** a human invokes each skill conversationally and reviews its output before moving on. Nine skills, nine sub-agents, JSON-schema-validated artifacts on disk between stages.
- **Phase 2 — Workflow orchestrator (agentic, deterministic):** a Workflow script pipelines the planning sub-agents given `{sourceProfile, targetProfile}`, validates each handoff against its schema, and exposes the slash command `/aws-migration-architect:migrate`. The orchestrator runs four phases (Discover → Generate → DataPlan → Cutover) and halts after producing the two cutover checklists for human sign-off. Control flow lives in the orchestrator code, not free-form prompts.
- **Phase 3 — guided execution against the target:** after the human signs both cutover checklists (`APPROVED BY:` line on each), the `cutover-executor` skill walks them in order — control-plane checklist (Terraform module applies + AWS control-plane API) first, then data-plane checklist (snapshot share, restore, DataSync, DMS, freeze, swap, validate) — with mandatory per-step human approval, append-only journaling, and resumability. Exposed as `/aws-migration-architect:execute`.

MVP focus: **AWS → AWS account migration with Terraform-portable output**. Output Terraform modules should be re-targetable later (Azure/GCP) but no per-cloud work in MVP. Hybrid AWS access: **AWS CLI for live-account reads, AWS-published MCP servers for service knowledge / IaC patterns / pricing.**

---

## Repo shape

Mirror `sample-claude-code-plugins-for-startups` exactly — that's the established Claude Code plugin convention and the user has it sitting next door as a reference.

```
aws-migration-architect/                       ← new git repo, sibling to the two samples
├── .claude-plugin/
│   └── marketplace.json                       ← marketplace entry
├── plugins/
│   └── aws-migration-architect/
│       ├── .claude-plugin/plugin.json         ← plugin manifest
│       ├── .mcp.json                          ← AWS MCP server wiring
│       ├── skills/
│       │   ├── inventory/SKILL.md
│       │   ├── cost-summary/SKILL.md            ← last-full-month net billed cost (Cost Explorer), box-format table
│       │   ├── cost-analysis/SKILL.md           ← cost drivers (why high) + trailing trend
│       │   ├── dependency-analyzer/SKILL.md
│       │   ├── terraform-generator/
│       │   │   ├── SKILL.md
│       │   │   └── templates/                 ← per-resource HCL templates (vpc, ec2, rds, …)
│       │   ├── migration-planner/SKILL.md
│       │   ├── data-migration-planner/SKILL.md ← sizing, strategy, time, cost, freeze windows
│       │   ├── cutover-control-plane/SKILL.md ← 7-phase target-shape runbook (Terraform + control-plane API)
│       │   ├── cutover-data-plane/SKILL.md    ← 5-phase data-movement runbook (transfer + freeze + swap + validate)
│       │   ├── cutover-executor/              ← walks BOTH checklists with per-step approval
│       │   │   ├── SKILL.md
│       │   │   └── SPEC.md                    ← engineering contract for the executor
│       │   └── post-migration-auditor/SKILL.md
│       ├── agents/
│       │   ├── inventory-explorer.md
│       │   ├── dependency-mapper.md
│       │   ├── terraform-builder.md
│       │   ├── migration-planner.md
│       │   ├── data-migration-planner.md
│       │   ├── cutover-control-plane-builder.md
│       │   ├── cutover-data-plane-builder.md
│       │   ├── cutover-executor.md
│       │   └── post-migration-auditor.md
│       ├── workflows/                         ← Phase-2 + Phase-3 orchestrator scripts
│       │   ├── migrate.js                     ← end-to-end planning pipeline (4 phases)
│       │   ├── discover.js                    ← inventory + deps only
│       │   ├── execute.js                     ← Phase 3: walks both signed checklists
│       │   └── audit.js                       ← post-cutover audit only
│       └── commands/                          ← slash commands that wrap the workflows
│           ├── migrate.md, discover.md, execute.md, audit.md   ← user-facing
│           └── dev/                           ← dev-only per-skill testers (namespace :dev:)
├── schemas/                                   ← JSON schemas for inter-skill artifacts (16 total)
│   ├── inventory.schema.json
│   ├── resource-ownership.schema.json
│   ├── cost-summary.schema.json               ← account-wide net billed cost snapshot (distinct from cost-baseline)
│   ├── cost-analysis.schema.json              ← cost drivers + commitments + trailing trend
│   ├── dependency-graph.schema.json
│   ├── hardcoded-values.schema.json
│   ├── risk-scores.schema.json
│   ├── cost-baseline.schema.json
│   ├── readiness-score.schema.json
│   ├── migration-plan.schema.json
│   ├── data-migration-plan.schema.json        ← per-datastore sizing/strategy/cost/freeze/validation
│   ├── cutover-checklist-control-plane.schema.json
│   ├── cutover-checklist-data-plane.schema.json
│   ├── execution-step.schema.json             ← per-step contract for the executor
│   ├── execution-log.schema.json              ← append-only journal contract
│   └── audit-diff.schema.json
├── examples/                                  ← fixtures: sample describe-* outputs + golden artifacts
│   ├── iam/
│   │   ├── source-read-only.json
│   │   ├── target-validate-only.json
│   │   ├── target-cutover.json                ← legacy combined (kept for reference)
│   │   ├── target-cutover-control-plane.json  ← Terraform applies + control-plane API
│   │   └── target-cutover-data-plane.json     ← DataSync/DMS/RDS-restore/Route53/etc (attach during data-plane window)
│   └── example-run/
├── README.md
├── LICENSE                                    ← MIT-0 (matches AWS samples)
└── PRIVACY.md
```

Naming conventions (verbatim from `sample-claude-code-plugins-for-startups`): kebab-case for skill and agent names, `model: opus` on every agent, scoped `Bash(aws *)` rather than wildcard. Marketplace and plugin versions must stay in sync.

---

## Prerequisites & account setup

### How profiles are wired

The plugin never asks the user to paste credentials. Instead it reads two env vars that point at AWS named profiles already configured on the user's machine:

```bash
export MIGRATION_SOURCE_PROFILE=migration-source
export MIGRATION_TARGET_PROFILE=migration-target
```

The user configures the profiles in `~/.aws/config` (`~/.aws/credentials` for static keys). SSO is the recommended path because keys for two accounts on the same machine is a security smell:

```ini
# ~/.aws/config — SSO example
[profile migration-source]
sso_start_url    = https://your-org.awsapps.com/start
sso_account_id   = 111111111111      ← source account
sso_role_name    = MigrationReadOnly
region           = us-east-1

[profile migration-target]
sso_start_url    = https://your-org.awsapps.com/start
sso_account_id   = 222222222222      ← target account
sso_role_name    = MigrationOperator
region           = us-east-1
```

Then once per session: `aws sso login --profile migration-source && aws sso login --profile migration-target`.

Every `aws` call in skills/agents shells out with `--profile $MIGRATION_SOURCE_PROFILE` (reads) or `--profile $MIGRATION_TARGET_PROFILE` (writes / dry-runs).

### What needs to exist in the accounts

| Account | IAM role needed | Why | When |
|---|---|---|---|
| **Source** | AWS-managed `ReadOnlyAccess` (or `source-read-only.json`) | `inventory`, `dependency-analyzer`, `data-migration-planner`, `post-migration-auditor` only call `Describe*` / `List*` / `Get*`. `cutover-executor` additionally uses source profile for `modify-db-snapshot-attribute`, `modify-image-attribute`, `modify-snapshot-attribute`, `kms:CreateGrant` — all permission-grant ops, no data reads. | Phases 1, 2, 3 |
| **Target (validate-only)** | `ReadOnlyAccess` (or `target-validate-only.json`) | `terraform-generator` produces HCL; `terraform plan` runs against target read-only | Phase 1 + early Phase 2 |
| **Target (control-plane apply)** | `target-cutover-control-plane.json` | `cutover-executor` runs `terraform apply` per module, creates IAM roles, networking, KMS keys, empty resource containers, DNS scaffolding | Phase 3 control-plane sub-phase |
| **Target (data-plane, additive)** | `target-cutover-data-plane.json` (alongside control-plane policy) | `cutover-executor` runs DataSync / DMS / RDS-restore / RDS-promote / S3-sync / Route53 record changes / Secrets put. **Attached just for the data-plane window, detached after.** Operator attaches at the executor's handoff step. | Phase 3 data-plane sub-phase only |

The README ships the minimum IAM policy JSON for each role so users can scope tighter than the managed policies if they want. The control-plane and data-plane target policies are deliberately split so the data-plane policy (broader by necessity — DMS, DataSync, snapshot-restore, route53-change) is only attached during its window, not standing.

### Local prerequisites on the user's machine

- **AWS CLI v2** (>= 2.15) — installed and on `$PATH`
- **`terraform` binary** (>= 1.6) — for `terraform-generator`'s `fmt`/`validate` and Phase 2 `plan`/`apply`
- **`uvx`** (from `astral-sh/uv`) — Claude Code launches the `awsiac` and `awspricing` MCP servers via `uvx`
- **Two configured AWS profiles** as shown above, with `aws sts get-caller-identity --profile <name>` working for both

Nothing is installed *in* the AWS account itself — no Lambda, no agent, no role assumed by Claude Code. The plugin runs entirely on the user's workstation against the AWS public APIs.

### Explicit IAM policies shipped in the repo

To avoid users either over-granting (`AdministratorAccess` to debug a permission error) or under-granting (skills fail mid-run), the repo ships scoped policy JSON:

- **`examples/iam/source-read-only.json`** — minimum actions for `inventory`, `cost-summary`, `cost-analysis`, `dependency-analyzer`, `data-migration-planner`, `post-migration-auditor`, plus the cross-account share permissions the `cutover-executor` invokes on source side (`rds:ModifyDBSnapshotAttribute`, `ec2:ModifyImageAttribute`, `ec2:ModifySnapshotAttribute`, `kms:CreateGrant`):
  ```
  ec2:Describe*, vpc:Describe*, s3:List*, s3:GetBucket*, rds:Describe*,
  lambda:List*, lambda:Get*, iam:List*, iam:Get*, iam:SimulatePrincipalPolicy,
  route53:List*, route53:Get*, acm:List*, acm:Describe*, kms:List*, kms:Describe*,
  secretsmanager:List*, secretsmanager:Describe*  (note: NEVER GetSecretValue),
  ssm:Describe*, ssm:GetParameter* (with NoSecureString condition),
  cloudwatch:Describe*, logs:Describe*, apigateway:GET,
  dynamodb:Describe*, dynamodb:List*, elasticloadbalancing:Describe*,
  cloudfront:List*, cloudfront:Get*, ecs:Describe*, ecs:List*,
  eks:Describe*, eks:List*, ecr:Describe*, sns:List*, sns:Get*,
  sqs:List*, sqs:GetQueue*, events:List*, events:Describe*,
  states:List*, states:Describe*, resource-explorer-2:*, config:Describe*,
  config:Get*, tag:Get*, ce:GetCostAndUsage,
  ce:GetReservationCoverage, ce:GetReservationUtilization,
  ce:GetSavingsPlansCoverage, ce:GetSavingsPlansUtilization  (cost-summary + cost-analysis)
  ```
- **`examples/iam/target-validate-only.json`** — same shape, for Phase 1 / Phase 2 `terraform plan` against target
- **`examples/iam/target-cutover.json`** — legacy combined policy (`PowerUserAccess` + IAM management); kept for reference but new installs should use the split below
- **`examples/iam/target-cutover-control-plane.json`** — Terraform applies + IAM management, with `NotAction` excluding data-plane services (DataSync, DMS, RDS snapshot-restore/promote/share, EC2 AMI share, DynamoDB export/import, Route53 record changes, Secrets put). Attached for the duration of Phase 3.
- **`examples/iam/target-cutover-data-plane.json`** — additive policy for the data-plane window: DataSync, DMS, RDS restore/promote/share, EC2 AMI/snapshot share, DynamoDB export/import, S3 replicate/sync, Route53 record changes, Secrets put (tag-conditioned to `ManagedBy=terraform`), KMS grants. Explicit `Deny` block on destructive data-plane ops (`DeleteTable`, `DeleteSnapshot`, etc). Attached only for the data-plane sub-phase of Phase 3 and detached after.

`secretsmanager:GetSecretValue` and `ssm:GetParameter` (without `NoSecureString`) are **deliberately excluded** from the source policy — the plugin must never read secret values (see "Migration gotchas" below). The `cutover-executor` references operator-supplied secret file paths at runtime rather than reading from source Secrets Manager.

### Cross-account considerations handled by the skills

1. **ARN parameterization.** Source HCL referencing `arn:aws:...:111111111111:...` must become a Terraform variable so the same module deploys to `222222222222`. `terraform-generator` extracts every literal account ID into `variables.tf`.
2. **KMS / S3 bucket / IAM trust policies.** These often hard-code the source account ID. `dependency-analyzer` flags them; `terraform-generator` parameterizes them.
3. **Data plane is not in the IaC.** Bulk S3 object copies, RDS snapshot sharing, AMI copies — `cutover-data-plane` produces a checklist for these (sourced from `data-migration-plan.json`) because they're operational, not declarative. `cutover-executor` walks the data-plane checklist and orchestrates the long-running jobs.
4. **Region / AZ remapping.** Source AZ literals like `us-east-1a` would break in a target region `us-west-2`. `terraform-generator` replaces all AZ literals with `data.aws_availability_zones.available.names[N]` lookups; `target_region` is a Terraform variable. Region-specific service endpoints (ECR registry URLs, S3 regional endpoints) are likewise parameterized.
5. **Secret values are NEVER inlined.** When `terraform-generator` encounters Secrets Manager or SSM SecureString resources, it emits HCL that creates the *secret container* (name, KMS key reference, description, tags) with the value set to a placeholder. Actual secret values move as a separate cutover step (manual re-input or out-of-band script reading from a secure vault). `inventory.json` lists secret ARNs but **never values**, and the source IAM policy excludes `GetSecretValue` to enforce this at the API layer.

---

## Scope discovery (regions + services)

**The plugin does NOT silently enumerate all regions and all AWS services** — that would be slow, expensive, and create false confidence in coverage. Instead, the `inventory` skill runs a **discover-then-confirm** flow before its deep inventory pass.

### Regions

- `inventory` calls `aws ec2 describe-regions --all-regions=false --profile $MIGRATION_SOURCE_PROFILE` to list **enabled regions only** (opted-out regions are skipped — `describe-*` against them returns `OptInRequired`).
- It prints the enabled-region list and asks the user to confirm or scope down.
- Env var override: `MIGRATION_REGIONS=us-east-1,eu-west-1` skips the prompt for power users / orchestrator runs.
- The default is **all enabled regions**, not all 30 AWS regions.

### Services — the MVP coverage list

The plugin covers the ~30-40 services that hit ~95% of real accounts:

| Category | Services in MVP |
|---|---|
| **Compute** | EC2 (+ AMIs, EBS, key pairs), Lambda, ECS, EKS, ECR, Auto Scaling |
| **Networking** | VPC (subnets, RTs, IGW, NAT, VPC endpoints), Security Groups, ELB/ALB/NLB, Route53, CloudFront, ACM, API Gateway (REST + HTTP) |
| **Storage** | S3 (incl. bucket policies, lifecycle), EFS, FSx |
| **Databases** | RDS, Aurora, DynamoDB, ElastiCache, OpenSearch |
| **Identity/secrets** | IAM (roles, policies, users), KMS, Secrets Manager, SSM Parameter Store |
| **Messaging** | SNS, SQS, EventBridge, Step Functions |
| **Observability** | CloudWatch (logs, alarms, dashboards), X-Ray |

**Explicitly NOT in MVP** (printed to the user when discovery sees them):
- ML/AI: SageMaker, Bedrock, Comprehend, Rekognition
- Data: Glue, Athena, Redshift, EMR, Kinesis
- End-user: Connect, Chime, WorkSpaces, AppStream
- Cross-account/network specials: Direct Connect, Transit Gateway peering, RAM-shared resources
- Marketplace subscriptions
- Anything brand new without stable Terraform support

Each new service is mechanical to add (`aws describe-*` call + HCL template + JSON-normalization function) but each is its own contract — coverage grows over time, not all at once.

### Discover-then-confirm flow

```
USER: /aws-migration-architect:inventory
        ↓
plugin queries AWS Resource Explorer (preferred, if enabled in source account)
OR AWS Config (fallback, if enabled)
OR falls back to a `list-*` sweep across MVP services in enabled regions
   (Resource Explorer/Config are vastly faster — both should be recommended
   prerequisites in the README, but the fallback ensures it works without them)
        ↓
prints a discovery snapshot:
   ┌──────────────────────────────────────────────────────────┐
   │ Source account 111111111111 — discovery snapshot         │
   ├──────────────────────────────────────────────────────────┤
   │ Enabled regions: us-east-1, us-west-2, eu-west-1, ap-…   │
   │ Services seen with >0 resources:                         │
   │   ✓ EC2 (47), VPC (8), S3 (23), RDS (4), Lambda (89),    │
   │     IAM (134), CloudWatch (210), Route53 (12)  → MVP     │
   │   ⚠ Glue (3), SageMaker (2)                  → not MVP   │
   │   ⚠ AppStream (1)                            → not MVP   │
   └──────────────────────────────────────────────────────────┘
"Inventory all MVP services in us-east-1 + us-west-2? [Y/specify]"
        ↓
user confirms (or scopes regions/services down)
        ↓
deep inventory runs only against the confirmed scope
```

### `coverage` block in inventory.json

Every `inventory.json` includes a top-level `coverage` block so downstream skills and the human reviewer know **exactly what was and wasn't scanned**:

```json
{
  "coverage": {
    "regions_scanned":  ["us-east-1", "us-west-2"],
    "regions_skipped":  [{"region": "eu-west-1", "reason": "user-excluded"}],
    "services_scanned": ["ec2", "vpc", "s3", "rds", "lambda", "iam", "..."],
    "services_skipped": [
      {"service": "glue",      "reason": "not in MVP — 3 resources seen at discovery"},
      {"service": "sagemaker", "reason": "not in MVP — 2 resources seen at discovery"},
      {"service": "appstream", "reason": "not in MVP — 1 resource seen at discovery"}
    ],
    "discovery_source": "resource-explorer"
  },
  "resources": [ ... ]
}
```

`migration-planner` and `post-migration-auditor` use this block to flag drift between source scope and target — the auditor will report "service X exists in target but was never in source scope" or vice versa as **scope-drift**, distinct from config drift.

### Tag-based scoping

Real migrations are rarely "everything in the account" — they're "everything tagged `Project=foo, Env=prod`". The plugin supports tag filtering:

- `MIGRATION_TAG_FILTER=Project=foo,Env=prod` (comma-separated, **AND** semantics) restricts discovery and inventory to resources matching all specified tags.
- Resources without tags (or matching only some) are excluded and listed in `coverage.excluded_by_tag_filter[]`.
- Untagged resources the user wants included anyway: `MIGRATION_FORCE_INCLUDE=arn:aws:ec2:us-east-1:111111111111:instance/i-abc,arn:...` (explicit ARN list).
- Tag filter combined with region filter → both apply (AND).
- If no tag filter is set, the whole confirmed-scope account is scanned.

### CloudFormation stacks in source

If source has CFN-managed resources, the discovery snapshot prints them in `coverage.cloudformation_stacks[]`. **MVP does not auto-convert CFN to Terraform** — that's a separate problem. The user decides per stack:
- Export from CFN, hand-port to Terraform, retire the stack
- Re-deploy the CFN template directly in target
- Skip and re-implement in target

Flagged in `migration-plan.md` as a manual phase prerequisite that blocks the planner from proceeding until the user picks an approach per stack.

### Incremental re-inventory

For large accounts (5k+ resources) where a full inventory takes 10+ minutes, the plugin supports incremental mode:

```bash
export MIGRATION_INCREMENTAL=true
/aws-migration-architect:inventory
```

When enabled, `inventory` reads the **most recent prior `inventory.json` for the same source profile** from `$AWS_MIGRATION_ROOT/runs/`, then:
1. Re-runs the discovery snapshot to detect services with new/removed resources
2. For services where AWS Config is enabled, queries `config:get-resource-config-history` since `previous_captured_at` — pulls only changed resources
3. For services without Config coverage, re-runs the full `describe-*` for that service only (still cheaper than scanning all services)
4. Merges the delta into the previous inventory → emits a new `inventory.json` with `incremental_from: <previous_run_id>` in metadata

The first run for a given source profile is always full. Incremental falls back to full if the prior inventory is >30 days old (too much drift to trust the delta).

### Unsupported-service report

For every service detected in discovery but **not** in the MVP coverage list, the plugin emits a single consolidated `unsupported-report.md` so the user has one document to triage rather than digging through `coverage.services_skipped[]`:

```markdown
# Services in source account NOT covered by MVP

## SageMaker (4 resources)
- Endpoint `recommender-v2` (us-east-1) — production
- Notebook instances ×3 (dev)
**Recommended action:** Re-deploy via SageMaker Studio in target; no automation in this plugin.

## Glue (3 resources)
- 2 catalog databases, 1 ETL job
**Recommended action:** Hand-port the ETL job; recreate catalog via CDK or CFN.
...
```

The point is to **prevent false confidence**: the user never thinks "migration is 100% complete" while SageMaker silently didn't get touched.

### Orchestrator mode (Phase 2)

When `/aws-migration-architect:migrate` runs, the discover-then-confirm prompt is the orchestrator's first interactive checkpoint. If `MIGRATION_REGIONS`, `MIGRATION_SERVICES`, and `MIGRATION_TAG_FILTER` env vars are set, the prompt is skipped entirely — useful for replayable CI-style runs.

---

## The 11 skills (9 with matching sub-agents)

Each numbered row is a **skill (human-facing playbook)** plus a **sub-agent (bounded executor)** that the Phase-2 Workflow will call. Skills explain the workflow and decision points; agents do the narrow operational work. This split mirrors how `aws-plan` (skill) invokes `aws-explorer` (agent) in the sample plugin. The `+` rows (`cost-summary`, `cost-analysis`) are **auxiliary, inline skills** — read-only Cost Explorer calls with no dedicated sub-agent, and not part of the migration pipeline.

| # | Skill | Sub-agent | Tools | MCP | Artifacts (output) |
|---|---|---|---|---|---|
| 1 | `inventory` | `inventory-explorer` | `Read, Grep, Glob, Bash(aws --profile * *)` | `awsknowledge` | `inventory.json`, `resource-ownership.json`, `unsupported-report.md` |
| + | `cost-summary` | _(inline — none)_ | `Bash(aws ce get-cost-and-usage *), Bash(aws sts get-caller-identity *), Read, Write` | — | `cost-summary.json` |
| + | `cost-analysis` | _(inline — none)_ | `Bash(aws ce *), Bash(aws sts get-caller-identity *), Read, Write` | — | `cost-analysis.json` |
| 2 | `dependency-analyzer` | `dependency-mapper` | `Read, Bash(aws --profile * *), Grep` | `awsknowledge` | `dependency-graph.json` (incl. `iam_trusts[]`), `hardcoded-values.json`, `risk-scores.json`, `architecture/*.mmd` |
| 3 | `terraform-generator` | `terraform-builder` | `Read, Write, Bash(aws * describe-*), Bash(terraform fmt), Bash(terraform validate)` | `awsiac` | `terraform/` modules |
| 4 | `migration-planner` | `migration-planner` | `Read, Write` | `awsknowledge, awspricing` | `migration-plan.json` + `.md`, `readiness-score.json`, `cost-baseline.json` |
| 5 | `data-migration-planner` | `data-migration-planner` | `Read, Write, Bash(aws --profile source describe-* / get-metric-statistics)` | `awspricing` | `data-migration-plan.json` + `.md` |
| 6 | `cutover-control-plane` | `cutover-control-plane-builder` | `Read, Write` | — | `cutover-checklist-control-plane.md` + `.json` |
| 7 | `cutover-data-plane` | `cutover-data-plane-builder` | `Read, Write` | — | `cutover-checklist-data-plane.md` + `.json` (incl. `freeze_windows[]`) |
| 8 | `cutover-executor` | `cutover-executor` | `Read, Write, Bash, AskUserQuestion` | — | `execution-steps.json`, `execution-log.jsonl`, `execution-summary.json`, `execution-report.md`, per-step stdout/stderr logs |
| 9 | `post-migration-auditor` | `post-migration-auditor` | `Read, Bash(aws --profile source *), Bash(aws --profile target *), Bash(diff)` | `awsknowledge` | `audit-diff.json` + `.md` |

### Per-skill specification

**1. `inventory`** — Scan source account using the discover-then-confirm flow (see "Scope discovery" above). Discovery pass via AWS Resource Explorer (preferred) / AWS Config (fallback) / `list-*` sweep (last resort) → user confirms scope → deep `describe-*` pass over confirmed (regions × services). Tags each resource with: service, criticality (heuristic), migration priority (P1/P2/P3), region. Emits `inventory.json` with a top-level `coverage` block documenting scanned vs skipped regions/services. Also accepts user-supplied **AWS Config exports** and **screenshots** as supplementary inputs (per user spec).

Side artifacts:
- **`resource-ownership.json`** — extracts `Owner`, `Team`, `CostCenter` (configurable via `MIGRATION_OWNERSHIP_TAGS=Owner,Team`) tags from each resource and emits a map of `team → resources[]`. Used by `cutover-control-plane` and `cutover-data-plane` to populate per-team approval gates in their respective checklists (each team approves their resources before cutover proceeds), and by `data-migration-planner` to set `owner_team` per datastore.
- **`unsupported-report.md`** — consolidated triage doc for services seen in source but not in MVP (see "Unsupported-service report" above).

The inventory report printed to stdout is a **per-service box table** (`Service | Count | Where (region: count)`): friendly service names, target groups as an indented sub-row excluded from the grand total, default VPCs/SGs collapsed to `+ 1 default each`, and account-global resources (IAM, S3, Route 53 zones) marked `global`. It carries **no cost data** — cost is the separate `cost-summary` skill.

**`+`. `cost-summary`** (auxiliary, inline) — Read-only, best-effort account-wide cost snapshot. Computes the last full calendar month and runs a single `aws ce get-cost-and-usage --metrics NetUnblendedCost --group-by SERVICE` (Cost Explorer is global, so it runs once — not region-scoped). Emits `cost-summary.json` (validates against `cost-summary.schema.json`: `metadata` + `available` + `by_service[]` sorted descending + `total`) and prints a box-format cost table titled `Net billed cost — <Month Year> (NetUnblendedCost, last full month)`, rolling sub-$1.00 services into a `< 1.00 each` line and ending with a `TOTAL … / mo` row. Non-infrastructure line items (Tax, Support, marketplace/LLM) are reported as-is so the total matches the real invoice. If Cost Explorer is disabled or `ce:GetCostAndUsage` is denied, it writes `available: false` with a reason and never blocks discovery. Distinct from `cost-baseline.json` (the planner's source-vs-target delta estimate).

**`+`. `cost-analysis`** (auxiliary, inline) — Read-only, best-effort deep cost analysis answering "why is the bill high, and how is it trending?". Two parts:
1. **Drivers (why high).** `aws ce get-cost-and-usage --group-by SERVICE,USAGE_TYPE` for the last full month → for the top services, the underlying usage-type drivers (on-demand `BoxUsage`, `EC2 - Other` decomposed into NAT-Hours/EBS/inter-AZ transfer/idle-EIP, RDS license-included third-party fees, ELB LCU hours, egress, plus Tax/Support/marketplace labeled non-migratable) with plain-English `reasons[]` + `recommendations[]`. Plus `commitments` from `ce get-savings-plans-coverage|utilization` and `ce get-reservation-coverage|utilization` (low coverage on steady compute is the #1 high-spend cause; RI/SP don't transfer to target).
2. **Trend.** `$MIGRATION_COST_TREND_MONTHS` (default 12) months of `MONTHLY` `NetUnblendedCost` with per-month `mom_change_pct`, `trailing_avg_monthly`, and `direction` (CE retains ~14 months). The current in-progress month is captured separately as `current_month_to_date_accrued` (still accruing/uninvoiced since AWS bills monthly in arrears) and kept out of the month-over-month deltas. Emits `cost-analysis.json` (validates against `cost-analysis.schema.json`); degrades to `available: false` on any CE failure. Reuses Cost Explorer permissions already in `source-read-only.json` (`ce:GetCostAndUsage` + RI/SP coverage/utilization).

**2. `dependency-analyzer`** — Reads `inventory.json`. Resolves the hidden coupling that breaks migrations across four categories:

1. **Resource-to-resource coupling.** EC2 → security groups → other EC2, EC2 → RDS via SG rules, Lambda env vars → Secrets Manager / SSM parameters, S3 bucket policies → IAM principals, Route53 records → ALB/NLB targets, CloudFront origins → S3/ALB.
2. **IAM trust analysis.** Classifies every role trust policy as same-account AssumeRole / cross-account AssumeRole / OIDC federation / IRSA (EKS) / SAML / web-identity / AWS service principal. Cross-account, OIDC, IRSA, and SAML trusts almost always need explicit re-work in target (see "IAM trust analysis" gotcha below). Written to `dependency-graph.json` under `iam_trusts[]`.
3. **Hard-coded value detection.** Scans every resource configuration (Lambda env vars, SSM parameters, user-data scripts, IAM policy documents, S3 bucket policies, Route53 record values) for: source account IDs, region names, Elastic IPs, ARNs, domain names, OIDC provider URLs, KMS key aliases. Auto-fixable ones become Terraform variables in `terraform-generator`; manual-review ones go to `hardcoded-values.json` (see "Hard-coded values" gotcha below).
4. **Risk scoring.** Tags each resource as Low / Medium / High migration risk based on dependency count, stateful-ness, IAM trust complexity, and hard-coded value density. Emits `risk-scores.json`. `migration-planner` uses these to order phases (High-risk gets earlier go/no-go gates).

**Architecture diagrams.** As a side effect of dependency analysis, emits Mermaid (`.mmd`) files under `architecture/` for human review:
- `vpc-topology.mmd` — VPCs, subnets, route tables, IGW/NAT/VPC-endpoints
- `dependency-graph.mmd` — service-to-service dependencies
- `dns-topology.mmd` — Route53 zones → records → ALB/NLB/CloudFront targets
- `iam-trust-graph.mmd` — role trust relationships (color-coded by trust type)

Mermaid renders inline on GitHub and in most markdown viewers — no extra tooling for human review.

**3. `terraform-generator`** — Convert source-account resources to Terraform modules by **templated HCL generation from `aws describe-*` JSON output** (no external import tooling — Terraformer is explicitly not a prerequisite). For each AWS resource type, `templates/` holds an HCL template; the agent runs the matching `aws … describe-*`, normalizes the JSON, and substitutes into the template. Output structure: `terraform/{networking,compute,storage,databases,iam,dns}/` with `variables.tf` extracted per module. Uses `awsiac` MCP for best-practice patterns (state backend, module structure, naming). Runs `terraform fmt && terraform validate` before declaring success.

**4. `migration-planner`** — Reads `inventory.json` + `dependency-graph.json` + `risk-scores.json`. Produces three artifacts in a specific order:

1. **`cost-baseline.json` (first, before the full plan).** Source steady-state cost vs target estimated cost from `awspricing` MCP. Emitted early so the user can sanity-check budget before deeper planning. Includes one-shot migration costs (DataSync, snapshot transfer) and notes RI/SP non-transferability.
2. **`readiness-score.json` (second).** A 0-100 score with named blockers and warnings (see "Migration readiness, risk, and cost baseline" section below). Phase-2 orchestrator halts under 50 unless `--force`; Phase 1 always proceeds but the human reads the score before committing.
3. **`migration-plan.json` + `migration-plan.md` (third, the full plan).** Phased per the user's spec: **Phase 1 Networking → Phase 2 Storage → Phase 3 Databases → Phase 4 Applications → Phase 5 DNS Cutover → Phase 6 Validation**. Each phase has pre-reqs, parallel-safe vs serial steps, estimated duration, rollback procedure, cost delta, and High-risk resources flagged for additional gates.

**5. `data-migration-planner`** — Reads `inventory.json` + `dependency-graph.json` + `cost-baseline.json` + `resource-ownership.json` + `hardcoded-values.json`. For each data-bearing resource (S3, RDS, DynamoDB, EFS/FSx, EBS-with-data, ECR, Redshift, ElastiCache-with-persistence), sizes the datastore via CloudWatch metrics + describe APIs (never downloads), picks the transfer tool + mode by size + RPO + encryption (default mapping: `aws-s3-sync` / `s3-batch-replication` / `aws-rds-snapshot-share` / `aws-dms` / `aws-datasync` / `dynamodb-export-import` / `ec2-snapshot-share` / `ecr-push-pull`), estimates wall-clock transfer time using per-tool throughput model with `confidence` labeling, prices the transfer via `awspricing` MCP (egress, tool runtime, double-storage during overlap, validation), applies RPO/RTO defaults per criticality tier (tier-1/tier-2/tier-3 from `Criticality` tag), computes freeze windows for non-continuous strategies, defines validation methods per service and criticality (`row-count` / `object-count` / `byte-count` / `checksum-sample` / `checksum-full` / `key-list-diff` / `smoke-query` / `application-replay`), assigns rollback retention hours, and emits `data-migration-plan.json` + `.md`. Halts with `blocker` warnings for external KMS keys (cannot grant) and RPO=0 paired with bulk-mode strategies.

**6. `cutover-control-plane`** — Reads `migration-plan.json` + `resource-ownership.json` + `dependency-graph.json` + `hardcoded-values.json` + `data-migration-plan.json` (the last to know which DB containers need pre-creation vs which will appear via snapshot-restore). Produces the **control-plane** runbook: 7 phases (0 Globals → 1 Networking → 2 Storage Containers → 3 Database Containers → 4 Compute Containers → 5 DNS Scaffolding → 6 Control Plane Validation). Every step is either a Terraform module apply (`terraform apply -target=module.<name>`, never per-resource `-target`), an AWS control-plane API call, or an operator manual step. **No data movement, no freeze windows, no production DNS swap.** Emits `cutover-checklist-control-plane.md` + `.json` with `handoff_to_data_plane.criteria[]` listing what must be true before the data-plane runbook starts.

**7. `cutover-data-plane`** — Reads `data-migration-plan.json` (primary input — sizing/strategy/freeze windows/validation come from there) + `migration-plan.json` + `resource-ownership.json` + `dependency-graph.json` + `hardcoded-values.json` + `cutover-checklist-control-plane.json` (for handoff criteria). Produces the **data-plane** runbook: 5 phases (1 Pre-Staging → 2 Bulk Transfers → 3 Application Data → 4 Cutover → 5 Data Validation). Operation types include `snapshot-share`, `kms-grant`, `ami-share`, `snapshot-restore`, `datasync-start`, `dms-start`, `s3-sync`, `s3-batch-replication`, `dynamodb-export`, `dynamodb-import`, `ecr-push`, `secret-put-value` (operator-supplied file path), `freeze-writes`, `dms-promote`, `rds-promote-read-replica`, `route53-change`, `traffic-shift`. Long-running operations carry `long_running: true` + `poll_cmd` + `poll_terminal_states`. Steps that cannot be cleanly rolled back (route53 traffic changes after TTL, dms-promote) get `irreversible: true`. Aggregates every datastore's freeze window into top-level `freeze_windows[]`. Emits `cutover-checklist-data-plane.md` + `.json`.

**8. `cutover-executor`** — Reads BOTH cutover checklists, `data-migration-plan.json`, `migration-plan.json`, `dependency-graph.json`, `hardcoded-values.json`, `resource-ownership.json`. Pre-flight verifies both profiles authenticate, `terraform validate` is clean, and BOTH checklist markdown files carry an `APPROVED BY: <name> ON: <YYYY-MM-DD>` line (separate sign-offs). Compiles `execution-steps.json` as a flat array in execution order — control-plane phases 0-6 (`cp-phase{N}-{seq}-{slug}`), then a synthesized handoff step (operator confirms `handoff_to_data_plane.criteria[]` met + `target-cutover-data-plane.json` IAM now attached), then data-plane phases 1-5 (`dp-phase{N}-{seq}-{slug}`). Walks the array in dependency order with **mandatory per-step human approval** (no batch mode, no `--yes`); for each step: runs the read-only `preview_cmd`, prompts approve/skip/abort, runs the mutating `execute_cmd`, polls if long-running, runs `verify_cmd`. On failure: shows the failed step + exit code + stderr + the `rollback_cmd` from the plan, prompts retry/rollback/abort. Long-running data-plane jobs (DataSync, DMS, S3 Batch, DynamoDB export/import, RDS snapshot-restore) are polled at the declared interval — operator approves the start once, executor polls until terminal. Data-plane steps with `irreversible: true` get a second confirmation dialog. Append-only journal (`execution-log.jsonl`) makes the run resumable: `/aws-migration-architect:execute --run-id <id> --resume` re-verifies any in-flight step against AWS before continuing. Emits `execution-summary.json` and `execution-report.md` at end of run. **This is the only skill in the plugin that mutates real AWS state.** See `plugins/aws-migration-architect/skills/cutover-executor/SPEC.md` for the engineering contract.

**9. `post-migration-auditor`** — Runs `aws describe-*` against **both** profiles in parallel, normalizes (strip ARNs/timestamps/IDs), diffs structurally. Categorizes drift: **missing in target** | **extra in target** | **config drift** | **security drift** | **cost drift** | **scope drift** (resource exists in target outside source's confirmed scope). Emits diff JSON for the orchestrator + human-readable summary.

---

## Migration readiness, risk, and cost baseline

Before the user commits to executing the migration, the plugin produces three artifacts the human reads to decide go/no-go:

### `readiness-score.json` — overall readiness 0-100

Computed by `migration-planner` from weighted inputs:

| Factor | Weight | What contributes |
|---|---|---|
| MVP coverage gap | 20% | resources-in-MVP ÷ total-resources |
| Unsupported services | 15% | inverse of `services_skipped` count |
| Hard-coded value density | 15% | inverse of `hardcoded-values.json` entries |
| Cross-account / OIDC / SAML IAM trusts | 15% | inverse of trusts needing manual re-work |
| RI/SP exposure | 10% | proportional to source RI/SP value |
| CIDR conflicts vs target | 10% | binary (any conflict drops to 0) |
| Stateful resource share | 10% | inverse of RDS + EBS-data + EFS volume |
| Cutover-window estimate | 5% | inverse of estimated downtime |

```json
{
  "score": 78,
  "label": "Mostly ready — review blockers before scheduling cutover",
  "blockers": [
    "3 CloudFormation stacks must be ported or kept as-is (decision required)",
    "2 SAML IdP trusts in IAM need manual re-creation in target",
    "4 SageMaker endpoints in source — not in MVP, plan manually"
  ],
  "warnings": [
    "$48k/yr RI exposure will revert to on-demand in target",
    "12 Lambda env vars reference source-EIP literals"
  ],
  "factors": { "mvp_coverage": 92, "unsupported_services": 78, ... }
}
```

Score under 60 → human prompted with "Migration readiness is low. Recommend resolving blockers first." Phase 2 orchestrator halts under 50 unless `--force` is passed.

### `cost-baseline.json` — early cost picture

Produced **before** the full plan so the user can sanity-check the budget before going deeper:

```json
{
  "source": {
    "monthly_on_demand":         47230,
    "monthly_ri_sp_discount":   -12480,
    "monthly_effective":         34750
  },
  "target": {
    "monthly_on_demand_estimate":           47780,
    "monthly_with_phase2_commitments":      35100,
    "first_month_includes_migration_costs":  8420
  },
  "delta_monthly_steady_state":  350,
  "first_month_total_delta":   13120,
  "notes": [
    "RIs in source ($48k/yr) cannot transfer — first ≥90 days in target at full on-demand pricing",
    "DataSync costs (~$5k one-shot) included in first_month_includes_migration_costs",
    "Bedrock/Glue/SageMaker not estimated — out of MVP"
  ]
}
```

### `risk-scores.json` — per-resource Low / Medium / High

`dependency-analyzer` tags each resource:

- **Low** — stateless, no cross-resource dependencies, fully covered by MVP, no IAM trust complexity
- **Medium** — 1-3 dependencies, MVP-covered, no cross-account / OIDC / SAML trust, no hard-coded source-account values outside ARNs
- **High** — stateful (RDS, EBS-data, EFS) **OR** in unsupported service **OR** cross-account / OIDC / IRSA / SAML trust **OR** non-fixable hard-coded values (EIP literals, external domain names)

`migration-planner` orders the phased plan so High-risk resources get earlier go/no-go gates, more rollback prep time, and explicit team-owner sign-off (via `resource-ownership.json`).

---

## Deterministic I/O contracts (the key Phase-2 enabler)

Every artifact is written to a deterministic path and validated against a JSON schema in `schemas/`. The root is **configurable via `$AWS_MIGRATION_ROOT`**, defaulting to `~/.aws-migration/`:

```
$AWS_MIGRATION_ROOT/runs/<source-profile>-to-<target-profile>-<run-id>/
  inventory.json                      # from `inventory`
  resource-ownership.json             # from `inventory`  (team → resources map)
  unsupported-report.md               # from `inventory`  (services NOT in MVP)
  cost-summary.json                   # from `cost-summary` (auxiliary; net billed cost, best-effort)
  cost-analysis.json                  # from `cost-analysis` (auxiliary; drivers + trailing trend, best-effort)
  dependency-graph.json               # from `dependency-analyzer` (incl. iam_trusts[])
  hardcoded-values.json               # from `dependency-analyzer`
  risk-scores.json                    # from `dependency-analyzer`
  architecture/                       # from `dependency-analyzer`
    vpc-topology.mmd
    dependency-graph.mmd
    dns-topology.mmd
    iam-trust-graph.mmd
  terraform/                          # from `terraform-generator`
  cost-baseline.json                  # from `migration-planner`  (first)
  readiness-score.json                # from `migration-planner`  (second)
  migration-plan.json                 # from `migration-planner`  (third)
  migration-plan.md
  data-migration-plan.json            # from `data-migration-planner`
  data-migration-plan.md
  cutover-checklist-control-plane.json # from `cutover-control-plane`
  cutover-checklist-control-plane.md  # ← human adds "APPROVED BY:" line near top
  cutover-checklist-data-plane.json   # from `cutover-data-plane`
  cutover-checklist-data-plane.md     # ← human adds SEPARATE "APPROVED BY:" line near top
  execution-steps.json                # from `cutover-executor` (compile output, immutable after)
  execution-log.jsonl                 # from `cutover-executor` (append-only journal)
  execution-summary.json              # from `cutover-executor` (end-of-run)
  execution-report.md                 # from `cutover-executor` (end-of-run)
  execution/
    <step_id>.stdout.log              # per-step full stdout (journal carries 2KB tail)
    <step_id>.stderr.log              # per-step full stderr
  audit-diff.json                     # from `post-migration-auditor`
  audit-report.md

# Default: ~/.aws-migration/runs/...
# Override (e.g., per-project): export AWS_MIGRATION_ROOT=./.aws-migration
```

Each skill declares its **input schema** (what artifacts must already exist) and **output schema** (what it produces) in its SKILL.md frontmatter / body. In Phase 1 a human invokes them in order; in Phase 2 the Workflow validates each handoff and refuses to proceed on schema mismatch. This is what makes the suite "deterministic" per the user's requirement — control flow lives in the schemas and the orchestrator code, not in free-form prompts.

`run-id` is generated once by the first skill (`inventory`) and threaded through subsequent invocations via the artifact path.

### Staleness handling

Every artifact carries top-level metadata:
```json
{
  "captured_at":       "2026-06-12T14:32:00Z",
  "source_account_id": "111111111111",
  "target_account_id": "222222222222",
  "run_id":            "<uuid>",
  "plugin_version":    "0.1.0",
  ...
}
```

Downstream skills print a warning if any input artifact is **>7 days old**:

> ⚠ inventory.json was captured 12 days ago. Source account may have drifted. Re-run `inventory` to refresh? [y/N]

In Phase 2 the orchestrator halts on >14 days stale and requires the user to either re-run inventory or pass `--accept-stale` (logged loudly).

---

## AWS access model

- **CLI for live-account access.** Two env vars: `MIGRATION_SOURCE_PROFILE` and `MIGRATION_TARGET_PROFILE` pointing at named profiles in `~/.aws/config`. All `aws` calls in skills/agents shell out with `--profile $MIGRATION_{SOURCE,TARGET}_PROFILE`. README ships a minimum read-only IAM policy for the source account.
- **AWS MCP servers for knowledge.** Reuse the exact three servers wired in the sample plugin (`.mcp.json` copied verbatim, only the plugin namespace differs):
  - `awsknowledge` (HTTP, `https://knowledge-mcp.global.api.aws`) — service docs
  - `awsiac` (`uvx awslabs.aws-iac-mcp-server@latest`) — Terraform/CDK patterns
  - `awspricing` (`uvx awslabs.aws-pricing-mcp-server@latest`) — cost estimation for `migration-planner`
- **MVP is read-only on target.** No `aws ec2 run-instances` or `terraform apply` from the plugin. `terraform-generator` runs `validate` only; the actual apply is a checklist item the human runs.

---

## Migration gotchas the plugin handles

AWS account-to-account migrations break in a handful of recurring places. The plugin explicitly addresses each:

### IAM trust analysis — top migration failure point
`dependency-analyzer` walks every IAM role's trust policy and classifies the trusts. These almost always need explicit re-work in target:

| Trust type | What it points at | Migration action |
|---|---|---|
| **AssumeRole same-account** | Another role in source account | Auto-handled — ARN parameterized to target account ID |
| **AssumeRole cross-account** | A role in a third AWS account | Flagged in `external_account_dependencies[]` — the third-party account must also be updated to trust target |
| **OIDC federation** (GitHub Actions, GitLab) | `token.actions.githubusercontent.com:sub` | New OIDC provider must be created in target; CI configuration updated to assume the target role |
| **IRSA** (EKS service accounts) | `oidc.eks.us-east-1.amazonaws.com/id/XXX:sub` | EKS cluster OIDC provider in target gets a new ID — every IRSA role policy regenerated with the target cluster's OIDC URL |
| **SAML federation** (Okta, Azure AD) | Identity provider ARN | SAML metadata XML re-uploaded to target; IdP updated with target's ACS URL |
| **AWS service principals** | `lambda.amazonaws.com`, `ec2.amazonaws.com`, etc. | No change — service principals are global |
| **Web identity** (Cognito, custom) | Cognito user pool ARN | Cognito pool created in target; identity ID format may differ |

All trust analyses are written to `dependency-graph.json` under `iam_trusts[]` and contribute heavily to the readiness score.

### Hard-coded values — detect all, parameterize what we can
Account-bound literals break in target. `dependency-analyzer` scans every resource's configuration (Lambda env vars, SSM parameters, user-data scripts, IAM policy documents, S3 bucket policies, Route53 record values) for:

| Pattern | Example | What the plugin does |
|---|---|---|
| Source account ID | `111111111111` | Auto-parameterize → `var.source_account_id` / `var.target_account_id` |
| Region name | `us-east-1` | Auto-parameterize → `var.aws_region` |
| Elastic IP literal | `54.x.x.x` | Cannot auto-fix — warning in `hardcoded-values.json` + added to `eip_remap_required[]` |
| Resource ARN | `arn:aws:s3:::source-bucket-foo` | Auto-parameterize as a reference if the resource is in inventory; warning if external |
| Domain name | `internal.source.example.com` | Detected and reported — user decides if it should be re-pointed |
| OIDC provider URL | `oidc.eks.us-east-1.amazonaws.com/id/XXX` | Always flagged — different in target cluster |
| KMS key alias | `alias/source-cmk-foo` | Detected; new target key created with same alias |

Full report in `hardcoded-values.json`:
```json
{
  "auto_parameterized": [
    {"location": "lambda:fn-xyz:env:DB_HOST", "value": "rds.111111111111...", "var": "var.db_endpoint"},
    {"location": "ec2:i-abc:user_data", "value": "us-east-1", "var": "var.aws_region"}
  ],
  "manual_review_required": [
    {"location": "lambda:fn-foo:env:ALLOWED_IP", "value": "54.x.x.x", "reason": "EIP literal"},
    {"location": "ssm:/app/api/url", "value": "https://api.internal.source.example.com", "reason": "Domain"}
  ]
}
```

### KMS keys — replaced, never moved
KMS keys are account-bound; you can't migrate a CMK from one account to another. The plugin creates **new** keys in the target with equivalent policies. `terraform-generator` parameterizes every `kms_key_id` reference into a Terraform variable so the new target-account ARN flows through. Anything encrypted with a source key (EBS volumes, RDS snapshots, S3 objects, Secrets Manager) must be re-encrypted at the data-plane layer — `data-migration-planner` flags `requires_target_kms_grant` and `requires_re_encryption` per datastore, and `cutover-data-plane` emits `kms-grant` Phase 1 steps that the executor then runs against the source profile.

### EC2 AMIs — cross-account share required
For EC2 migration, source AMIs must be shared with the target account before the target can launch from them. The `cutover-data-plane` Phase 1 Pre-Staging emits `ami-share` steps and `cutover-executor` runs them against the source profile:
```
aws ec2 modify-image-attribute --image-id ami-xxx \
    --launch-permission "Add=[{UserId=<target-account-id>}]" \
    --profile $MIGRATION_SOURCE_PROFILE
```
If AMIs are encrypted with source KMS, the source KMS key needs a grant to the target account's role too. `dependency-analyzer` flags encrypted AMIs and emits the grant commands.

### Elastic IPs — don't transfer
EIPs are account-bound. The target account allocates new EIPs at provisioning time, so any source application or external integration that hardcodes a source EIP must be updated. `dependency-analyzer` scans for resources referencing source EIP literals (Lambda env vars, SSM parameters, Route53 A records pointing to EIPs) and emits a `eip_remap_required[]` list in the dependency graph.

### VPC CIDR conflicts
If the user wants to peer source and target VPCs during the cutover window (common for data migration), overlapping CIDR ranges break peering. `inventory` records all source VPC CIDRs; `migration-planner` warns at plan time when target VPC list is provided and CIDRs overlap. If no overlap analysis can be done (e.g., target is empty), the plan flags this as a "verify before cutover" item.

### Reserved Instances and Savings Plans — non-transferable
RIs and SPs are account-bound. `migration-planner`'s cost analysis (via `awspricing` MCP):
- Reads source RI/SP coverage from `aws ce get-reservation-coverage`
- Quotes target on-demand pricing as the post-migration baseline
- Explicitly notes the cost delta: "source has $48k/yr in active RIs; target will pay on-demand pricing of ~$67k/yr equivalent until new commitments are purchased"

### Data plane — checklist names canonical AWS tools per resource
`data-migration-planner` picks the right AWS-native tool for each data type and `cutover-data-plane` emits the executable step:
| Resource | Tool |
|---|---|
| S3 objects | S3 batch replication (continuous) or `aws s3 sync` (one-shot) |
| RDS / Aurora | Cross-account snapshot share + restore (`modify-db-snapshot-attribute`) |
| EBS volumes (data) | Cross-account snapshot share + `create-volume-from-snapshot` |
| DynamoDB | AWS Backup cross-account copy, or DDB export-to-S3 + import |
| ECR images | `aws ecr get-login-password` + cross-account pull/push, or pull-through cache |
| EFS / FSx | AWS DataSync |
| Live DB migration (zero downtime) | AWS DMS |

### Service-linked roles — skipped, not migrated
Roles named `AWSServiceRoleFor*` are auto-created by AWS services in any account that uses them. The plugin filters them from inventory (listed in `coverage.skipped_service_linked_roles[]` for transparency) and trusts AWS to recreate them in target.

### Pagination — no silent truncation
All sub-agent `aws list-*` / `describe-*` calls iterate full pagination via `--no-cli-pager` + `--max-items 0` and explicit `--starting-token` loops. Throttle exceptions trigger exponential backoff via the AWS CLI's built-in retry. Inventory of a 5k-resource account takes ~5-10 min wall time; 50k-resource accounts work but should be pre-filtered with `MIGRATION_TAG_FILTER`.

### Scale assumption
MVP is designed for accounts with up to ~5,000 resources. Larger accounts work but inventory wall time grows linearly. Above ~50k resources the orchestrator times out under default Workflow agent budgets — `migration-planner` warns the user at planning time based on inventory count.

### Multi-account source / AWS Organizations
The plugin treats the migration as a **single source profile → single target profile** operation. If the user's actual source is multiple accounts in an AWS Organization, run the plugin once per source account (each produces its own `run-id` directory) and consolidate at the planning layer. Documented in README, not enforced by code.

---

## Phase 2: the deterministic orchestrator

Phase 2 (planning orchestration) and Phase 3 (execution) are **in this deliverable**, not future epics. Phase 2 is a thin layer over the seven planning sub-agents (inventory through cutover-data-plane); Phase 3 is `cutover-executor` walking both signed checklists.

### `workflows/migrate.js` — the planning pipeline (Phase 2)

```javascript
export const meta = {
  name: 'aws-migration-architect:migrate',
  description: 'AWS account-to-account migration: inventory → deps → terraform + plan → data-migration plan → cutover checklists',
  phases: [
    { title: 'Discover' },   // inventory, dependency-analyzer
    { title: 'Generate' },   // terraform-generator, migration-planner (parallel)
    { title: 'DataPlan' },   // data-migration-planner (sizing, strategy, time, cost, freeze)
    { title: 'Cutover' },    // cutover-control-plane-builder + cutover-data-plane-builder (parallel)
  ],
}

const { sourceProfile, targetProfile, runId, force } = args
const root = `${process.env.AWS_MIGRATION_ROOT || '~/.aws-migration'}/runs/${sourceProfile}-to-${targetProfile}-${runId}`

phase('Discover')
const inventory = await agent(`Run inventory-explorer against profile ${sourceProfile}.`,
  { agentType: 'aws-migration-architect:inventory-explorer', schema: INVENTORY_SCHEMA, phase: 'Discover' })
const deps = await agent(`Read ${root}/inventory.json. Run dependency-mapper.`,
  { agentType: 'aws-migration-architect:dependency-mapper', schema: DEPENDENCY_SCHEMA, phase: 'Discover' })

phase('Generate')
const [terraform, plan] = await parallel([
  () => agent(`Run terraform-builder.`, { agentType: 'aws-migration-architect:terraform-builder', schema: TERRAFORM_SCHEMA }),
  () => agent(`Run migration-planner.`, { agentType: 'aws-migration-architect:migration-planner', schema: PLAN_SCHEMA }),
])
if (plan.halted === 'low_readiness' && !force) return { halted: 'low_readiness', ... }

phase('DataPlan')
const dataPlan = await agent(`Run data-migration-planner. Size every datastore, pick strategy, estimate time + cost, define freeze windows + validation.`,
  { agentType: 'aws-migration-architect:data-migration-planner', schema: DATA_PLAN_SCHEMA, phase: 'DataPlan' })
if (dataPlan.blockers_count > 0 && !force) return { halted: 'data_plan_blockers', ... }

phase('Cutover')
const [controlPlaneChecklist, dataPlaneChecklist] = await parallel([
  () => agent(`Run cutover-control-plane-builder. 7 phases of Terraform + control-plane API. NO data movement.`,
    { agentType: 'aws-migration-architect:cutover-control-plane-builder', schema: CONTROL_PLANE_CHECKLIST_SCHEMA }),
  () => agent(`Run cutover-data-plane-builder. 5 phases of data movement + freeze + swap + validate. Consumes data-migration-plan.json.`,
    { agentType: 'aws-migration-architect:cutover-data-plane-builder', schema: DATA_PLANE_CHECKLIST_SCHEMA }),
])

log(`Both checklists ready. Add APPROVED BY line near top of each .md, then run /aws-migration-architect:execute --run-id ${runId}.`)
return { runId, root, inventory, deps, terraform, plan, dataPlan, controlPlaneChecklist, dataPlaneChecklist }
```

### `workflows/execute.js` — the execution pipeline (Phase 3)

```javascript
export const meta = {
  name: 'aws-migration-architect:execute',
  description: 'Walk both signed checklists against the target account with per-step human approval and an append-only journal.',
  phases: [{ title: 'Execute' }],
}

const { sourceProfile, targetProfile, runId, resume } = args
const root = `${process.env.AWS_MIGRATION_ROOT || '~/.aws-migration'}/runs/${sourceProfile}-to-${targetProfile}-${runId}`

phase('Execute')
const execution = await agent(
  `Run cutover-executor. Read both checklists + data-migration-plan.json + migration-plan.json.
   Pre-flight: verify both APPROVED BY lines, terraform validate, both profiles authenticate.
   Compile execution-steps.json (cp-phase{N}-... then handoff then dp-phase{N}-...).
   Walk with mandatory per-step approval. Poll long-running jobs. Halt + offer rollback on failure.
   Resume mode: ${resume === true}.`,
  { agentType: 'aws-migration-architect:cutover-executor', schema: EXECUTION_SCHEMA, phase: 'Execute' }
)

return execution
```

Audit runs as a separate workflow (`workflows/audit.js`) — invoked by the operator after execute completes.

### Determinism guarantees

- **Schemas, not prompts, drive control flow.** Each `agent()` call has a JSON schema; the orchestrator only proceeds if validation passes. Schema mismatch → null → workflow halts with the validation error visible.
- **Idempotent artifact paths.** Every stage reads/writes to deterministic paths under `$AWS_MIGRATION_ROOT/runs/<run-id>/`. Re-running a stage overwrites cleanly.
- **Resumability.** If a stage fails or the user cancels, the next `/aws-migration-architect:migrate --resume <run-id>` picks up from the last incomplete artifact (Workflow's built-in `resumeFromRunId` plus the on-disk artifacts).
- **No model-driven branching at the top level.** Control flow (pipeline, parallel, phase) is JavaScript. Agents do bounded work and return typed data.

### Slash commands

Each `commands/*.md` is a thin wrapper that captures arguments and calls the Workflow tool (user commands) or runs a single skill (dev commands). This mirrors the standard Claude Code plugin slash-command pattern.

**User-facing (documented for operators):**

- `/aws-migration-architect:migrate` → runs `workflows/migrate.js` through the four planning phases. Halts after producing both cutover checklists for human sign-off.
- `/aws-migration-architect:discover` → runs only inventory + dependency-analyzer (`workflows/discover.js`) — useful for exploration before committing to migration
- `/aws-migration-architect:execute` → runs `workflows/execute.js` (Phase 3). Refuses to start unless both checklist `APPROVED BY:` lines are present. Walks both checklists in order (control plane → handoff → data plane) with per-step approval. Supports `--resume` for halted runs.
- `/aws-migration-architect:audit` → runs only `post-migration-auditor` (`workflows/audit.js`) — invoked after execute completes

**Dev-only (plugin authors — not in end-user docs):**

Claude Code has no “hidden command” API. Per-skill testers live under `commands/dev/` and appear in `/help` as the `:dev:` namespace. Each command **refuses to run** unless `export AWS_MIGRATION_DEV=true`. Examples:

- `/aws-migration-architect:dev:inventory`
- `/aws-migration-architect:dev:cost-summary`
- `/aws-migration-architect:dev:dependency-analyzer --run-dir <path>`
- … one command per skill (11 total). See `commands/dev/README.md`.

End users should use the four user commands above or chat (`Use the <skill> skill`). Devs set `AWS_MIGRATION_DEV=true` before invoking `:dev:*` to test one skill in isolation.

---

## Out of scope (explicitly deferred — not in MVP)

These are real concerns the plugin **does not** address. Listed explicitly so the user knows where to plan manually:

**Cross-cloud / non-AWS source:**
- AWS→Azure, AWS→GCP, on-prem→AWS (skill prompts written so they don't preclude it, but no specific support in MVP)

**Unattended execution:**
- `/aws-migration-architect:execute` requires per-step human approval for every mutating command. There is no batch mode, no `--yes`, no `--skip-approval-for-low-risk`. Deliberate. The plugin orchestrates the cutover (compiles steps, sequences them, polls long-running jobs, journals every event, offers rollback on failure) but a human approves each mutating command. Data-plane operations (DataSync, DMS, snapshot-restore, S3 sync, DynamoDB export/import) ARE orchestrated and polled by `cutover-executor`; what isn't supported is running without a human at the keyboard.

**Identity-layer beyond IAM:**
- Identity federation: SAML / OIDC IdP integration (Okta, Google Workspace, Azure AD). If source has a SAML IdP trust, the target needs equivalent IdP configuration manually. Flagged in `dependency-analyzer` as `external_identity_provider_trusts[]` but not migrated.
- AWS SSO / IAM Identity Center permission sets (the org-level config that grants users access to accounts) — out of scope; org admin must replicate.

**Account-level / org-level config:**
- AWS Organizations SCPs — plugin can't see SCPs from a member account; if source and target are in different orgs with different SCPs, behavior may differ. Flagged in README as "user must verify."
- CloudTrail, AWS Config, GuardDuty, Security Hub — these are typically configured per-account by org admin; plugin doesn't migrate them. README documents.
- AWS Marketplace subscriptions — non-transferable, must be re-purchased in target.

**Cross-account dependencies (flagged, not migrated):**
- VPC peering / Transit Gateway attachments / RAM-shared resources crossing into accounts other than source/target — `dependency-analyzer` reports these as `external_account_dependencies[]`; user resolves manually.
- DNS delegation at the registrar (if source's R53 zone is delegated from a registrar like Route53 Domains or GoDaddy) — `cutover-data-plane` includes the delegation-change step as `manual-decision`, but neither the checklist builder nor the executor can execute it.
- Private hosted zone → VPC association — checklist item, manual cutover.

**Operational / governance:**
- Reserved Instance / Savings Plan purchases in target — `migration-planner` quotes the on-demand baseline; actually buying commitments is a finance decision out of the plugin's scope.
- Multi-region migrations within a single account-pair (e.g., us-east-1 → us-west-2 in the same account) — separate problem with different mechanics.
- Pricing API rate limiting / caching — rely on `awspricing` MCP's defaults.

**Provisioning safety:**
- Per-resource `terraform apply -target=<resource>`. `cutover-executor` runs Terraform applies at **module granularity only** (`terraform apply -target=module.<name>`), one approval per module. HashiCorp documents per-resource `-target` as an exceptional-circumstances escape hatch; using it as a normal mode produces partial state divergence and noisy plans. The control-plane checklist guarantees one Terraform-apply step per module, not per resource.
- Reversal of irreversible AWS state changes. `cutover-executor`'s rollback dialog runs the plan's `rollback_cmd`, but some state (DNS TTL propagation, deleted snapshots, completed cross-account replications, route53 record changes after TTL propagation, DMS-promote) cannot be fully undone. Data-plane steps marked `irreversible: true` get a second confirmation but the underlying physics still applies.

---

## Verification

**Phase 1 (skills + sub-agents, human-driven):**
1. **Install locally:** `/plugin marketplace add /Users/pventrapragada/Desktop/workspace/aws_migration/aws-migration-architect`. Confirm `/plugin` lists `aws-migration-architect` with 11 skills, 9 agents, 4 slash commands.
2. **MCP wiring:** confirm `awsknowledge`, `awsiac`, `awspricing` register without errors.
3. **Fixture run (no real AWS):** point the skills at `examples/example-run/` (pre-recorded `aws describe-*` JSON). Each skill produces its artifact; each artifact validates against the schema in `schemas/`. Round-trip the full chain manually.
4. **Real-account smoke test:** configure two AWS profiles against a sandbox source + fresh target. Run `inventory` → `dependency-analyzer` → `terraform-generator` conversationally. Verify `terraform fmt && terraform validate` passes in the generated module directory.
5. **Auditor self-consistency:** run `post-migration-auditor` against `MIGRATION_SOURCE_PROFILE=X MIGRATION_TARGET_PROFILE=X` (same profile both sides). Expect zero drift — any non-empty diff is a normalization bug.
6. **Per-skill in isolation:** each SKILL.md must be runnable standalone given its declared input artifacts present on disk — verify by invoking `cutover-control-plane` with only `migration-plan.json` + `dependency-graph.json` + `resource-ownership.json` + `hardcoded-values.json` present, and `cutover-data-plane` with only those plus `data-migration-plan.json` and the control-plane checklist.
7. **Diagrams render:** open `architecture/*.mmd` in a Mermaid-supporting viewer (GitHub web, VS Code's Markdown Preview Mermaid extension) and confirm each renders without syntax errors. Visually spot-check that VPC topology matches inventory.
8. **Readiness score sanity:** on the fixture run, `readiness-score.json` is in 0-100; blockers/warnings arrays are populated when known issues are present (e.g., the fixture includes a SAML trust → blocker should list it).
9. **Cost baseline shape:** `cost-baseline.json` has both `source` and `target` sub-objects with non-null monthly figures; RI/SP delta is explicit when source has RIs.
10. **Hard-coded values report:** intentionally seed a fixture with a Lambda env var of `54.123.45.67`; verify it appears in `hardcoded-values.json` under `manual_review_required` with reason "EIP literal".
11. **Incremental inventory:** run `inventory` twice against the fixtures with `MIGRATION_INCREMENTAL=true` on the second run; confirm it completes faster and emits `incremental_from: <previous_run_id>` in metadata.

**Phase 2 (planning orchestrator, deterministic):**
12. **Slash command discovery:** confirm `/aws-migration-architect:migrate`, `:discover`, `:execute`, `:audit` appear in the command palette and run their respective workflows.
13. **End-to-end fixture run:** `/aws-migration-architect:migrate` against the `examples/example-run/` fixtures. All four phases (Discover → Generate → DataPlan → Cutover) complete; every artifact validates against its schema; final return value matches the documented shape.
14. **Schema-mismatch halt:** intentionally corrupt one stage's output (e.g., delete a required field from `inventory.json` mid-run). Confirm the next stage halts with a clear validation error rather than proceeding with bad data.
15. **Readiness gate:** seed a fixture that drives readiness below 50; confirm the orchestrator halts unless `--force` is passed.
16. **DataPlan blocker gate:** seed a fixture with an external KMS key on a data-bearing resource; confirm `data-migration-planner` emits a `blocker` and the orchestrator halts with `halted: "data_plan_blockers"` unless `--force`.
17. **Resumability:** kill the workflow mid-`Generate`. Re-run with `--resume <run-id>`. Confirm `Discover` artifacts are reused and only the incomplete stage re-runs.
18. **Determinism check:** run `:migrate` twice against the same source profile + same fixtures with different `run-id`s. Artifacts should be byte-identical apart from timestamps and run-id fields.
19. **Two checklists, two sign-offs:** confirm both `cutover-checklist-control-plane.md` and `cutover-checklist-data-plane.md` are produced. Confirm `/aws-migration-architect:execute` refuses to start if either `APPROVED BY:` line is missing.

**Phase 3 (executor, mutating against target):**
20. **Pre-flight refusal without sign-offs:** invoke `/aws-migration-architect:execute --run-id <id>` without adding APPROVED BY lines. Confirm the executor halts at pre-flight with a clear message naming the missing file, writes a single `step-failed` journal entry, and makes zero AWS calls.
21. **Module-level Terraform apply:** confirm the compiled `execution-steps.json` contains one `terraform-apply` step per Terraform module (not per resource). Confirm the `execute_cmd` is `terraform apply -target=module.<name>`, never `-target=<aws_resource>.<name>`.
22. **Handoff gate:** confirm the synthesized `cp-phase6-999-handoff-to-data-plane` step appears between control-plane and data-plane steps. Confirm the executor refuses to advance past it until the operator confirms `target-cutover-data-plane.json` is attached.
23. **Per-step approval is non-skippable:** attempt to bypass the approval prompt. Confirm there is no flag that disables it. Confirm `skip` marks the step `skipped` and prevents dependent steps from running.
24. **Long-running poll:** seed a DataSync or DMS step. Confirm the executor polls `poll_cmd` at the declared interval, writes `poll-tick` events to the journal, and reaches `poll-terminal` without re-prompting the operator.
25. **Rollback dialog on failure:** inject an `execute_cmd` that exits non-zero. Confirm the executor halts, shows the rollback_cmd from the plan, and offers retry/rollback/abort.
26. **Resume re-verification:** kill the executor mid-step. Re-run with `--resume`. Confirm in-flight steps are re-verified against AWS (not re-prompted) and the run continues from the next pending step.
27. **Irreversible re-confirmation:** confirm Phase 4 data-plane steps with `irreversible: true` get a second confirmation dialog beyond the initial approval.
28. **Journal append-only:** verify `execution-log.jsonl` is never rewritten in place — each event is a new line with a monotonically increasing `entry_id`.
29. **Concurrent-run safety (open question — pending):** invoke two `/execute` runs against the same run-id. Today: undefined. After PID-lockfile work lands: second invocation refuses with a clear message.

---

## Decisions locked in

- **Repo name:** `aws-migration-architect`
- **Scope:** Phases 1, 2, AND 3 ship together — skills + sub-agents (human-driven), planning orchestrator (`:migrate`), and execution orchestrator (`:execute`). The executor is the only component that mutates AWS state.
- **Terraformer:** not a dependency — templated HCL from `aws describe-*` JSON, using `awsiac` MCP for pattern guidance
- **Artifact root:** `$AWS_MIGRATION_ROOT` env var, defaults to `~/.aws-migration/`
- **Account access:** two named AWS profiles (`MIGRATION_SOURCE_PROFILE`, `MIGRATION_TARGET_PROFILE`); SSO strongly preferred; static keys supported as fallback
- **IAM policies:** scoped policy JSON shipped at `examples/iam/source-read-only.json`, `target-validate-only.json`, `target-cutover-control-plane.json`, `target-cutover-data-plane.json` (split so the broader data-plane policy is attached only during its window, then detached). Legacy combined `target-cutover.json` kept for reference. `GetSecretValue` deliberately excluded from source.
- **Local prerequisites:** AWS CLI v2 (≥ 2.15), `terraform` (≥ 1.6), `uvx`
- **Regions:** auto-detect enabled regions via `describe-regions`, confirm with user; `MIGRATION_REGIONS` env var skips the prompt
- **Services:** MVP covers a defined ~30-40 service list; discover-then-confirm flow; `inventory.json` ships a `coverage` block
- **Tag filtering:** `MIGRATION_TAG_FILTER=K=V,K=V` (AND semantics) plus `MIGRATION_FORCE_INCLUDE=arn,arn` for untagged exceptions
- **Staleness:** `captured_at` on every artifact; warn at >7 days, orchestrator halts at >14 days unless `--accept-stale`
- **Secret values:** never inlined; Terraform creates secret container only; data-plane move is a separate cutover step
- **Region/AZ remapping:** all AZ literals replaced with `data.aws_availability_zones` lookups; region as a TF variable
- **CloudFormation in source:** flagged in coverage, not auto-converted; user decides per stack
- **Incremental inventory:** opt-in via `MIGRATION_INCREMENTAL=true`; uses prior `inventory.json` + Config history; falls back to full if >30 days stale
- **Resource ownership:** extracted from tags (`MIGRATION_OWNERSHIP_TAGS=Owner,Team` default), used to populate per-team approval gates in the cutover checklist
- **IAM trust analysis:** first-class category in `dependency-analyzer`; cross-account / OIDC / IRSA / SAML trusts heavily weighted in readiness scoring
- **Hard-coded value detection:** account IDs / regions / EIPs / ARNs / domains / OIDC URLs / KMS aliases scanned; auto-fixable → TF vars, manual → `hardcoded-values.json`
- **Risk scoring:** per-resource Low/Medium/High in `risk-scores.json`; drives phase ordering and approval gates in the plan
- **Readiness gate:** orchestrator halts below 50 unless `--force`; warns below 60
- **Cost baseline emitted early** in planner phase (before full plan), so the user can sanity-check budget before deeper work
- **Architecture diagrams:** Mermaid (`.mmd`) for VPC / dependency / DNS / IAM-trust topologies — renders inline on GitHub
- **Unsupported-service report:** single `unsupported-report.md` consolidating non-MVP services seen at discovery
- **Cloud-agnostic-friendly data model:** internal schemas use generic types (`compute_instance`, `load_balancer`, `object_store`, `block_storage`) with AWS-specific details under `provider_specific.aws`. Future AWS→Azure/GCP work becomes adding adapters, not redesigning artifacts.
- **Cutover-manager split:** the original `cutover-manager` skill was split into `cutover-control-plane` (7-phase target-shape runbook: Terraform module applies + control-plane API) and `cutover-data-plane` (5-phase data-movement runbook: snapshot/share/restore/DataSync/DMS/freeze/swap/validate). Each is approved separately by a human (`APPROVED BY:` line on each `.md`). The executor walks them in order with a synthesized handoff step in between.
- **`data-migration-planner` added** as skill 5 (between `migration-planner` and the cutover builders). Sources every datastore via CloudWatch + describe APIs, picks the transfer tool, estimates time + cost, computes freeze windows, defines validation methods. Halts on `blocker` warnings (external KMS, RPO=0 + bulk strategy) unless `--force`.
- **`cutover-executor` added** as skill 8. Walks both signed checklists with mandatory per-step human approval. Append-only JSONL journal makes runs resumable; on resume, in-flight steps are re-verified against AWS before continuing. Long-running data-plane jobs polled without held approvals. Failure halts and offers rollback. The only skill in the plugin that mutates AWS state.
- **Terraform applies are module-level only.** `cutover-executor` runs `terraform apply -target=module.<name>`, never `-target=<aws_resource>.<name>`. Per-resource `-target` is HashiCorp's documented escape hatch; using it as a normal mode produces noisy state divergence.
- **No batch / unattended approval mode for the executor.** Per-step approval is the contract. No `--yes`, no `--auto-approve`, no `--skip-approval-for-low-risk`. Deliberate.
- **Hosting:** local-only repo for now; `plugin.json` `repository` field blank/local path
