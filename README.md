# AWS Migration Architect

A Claude Code plugin that turns the messy reality of AWS account-to-account migration into a deterministic, schema-validated pipeline. Nine specialist skills, nine bounded sub-agents, four slash commands, and an orchestrator that takes you from a source-account scan all the way through resource-by-resource execution against the target. The cutover is split into two distinct runbooks — **control plane** (Terraform + AWS API to create the empty target shape) and **data plane** (snapshot share, DataSync, DMS, freeze, swap, validate) — each separately approved by a human.

This is the **plugin you point at a source AWS account when you need to move it to a different AWS account**. It is not a generic AWS expert; it is a focused migration toolkit.

---

## What it does

| Step | Skill | What you get |
|------|-------|-------------|
| 1 | `inventory` | `inventory.json` — every resource in the source account, scoped by region + service + tag |
| 2 | `dependency-analyzer` | `dependency-graph.json`, IAM trust classification, hard-coded value detection, per-resource risk score, 4 Mermaid architecture diagrams |
| 3 | `terraform-generator` | `terraform/{networking,compute,storage,databases,iam,dns}/` — re-deployable HCL with account IDs / regions / AZs parameterized |
| 4 | `migration-planner` | `cost-baseline.json` → `readiness-score.json` → `migration-plan.json` + `.md` (6 phases with rollback) |
| 5 | `data-migration-planner` | `data-migration-plan.json` + `.md` — per-datastore sizing (CloudWatch + describe APIs), transfer tool + mode by size/RPO/encryption, wall-clock time estimate with confidence, transfer cost (egress + tool runtime + double-storage) via awspricing MCP, RPO/RTO targets per criticality tier, freeze windows for non-continuous strategies, validation methods + acceptance criteria, rollback retention |
| 6 | `cutover-control-plane` | `cutover-checklist-control-plane.md` + `.json` — 7-phase runbook (0 Globals → 1 Networking → 2 Storage Containers → 3 Database Containers → 4 Compute Containers → 5 DNS Scaffolding → 6 Control Plane Validation). Terraform module applies + AWS control-plane API only. NO data movement, NO freeze, NO production DNS swap. Hands off to data-plane runbook via `handoff_to_data_plane.criteria[]`. |
| 7 | `cutover-data-plane` | `cutover-checklist-data-plane.md` + `.json` — 5-phase runbook (1 Pre-Staging → 2 Bulk Transfers → 3 Application Data → 4 Cutover (freeze + promote + swap) → 5 Data Validation). Consumes `data-migration-plan.json` for sizing/strategy/freeze-windows/validation. Marks irreversible steps (route53 swap, DMS promote). Aggregates `freeze_windows[]`. |
| 8 | `cutover-executor` | `execution-steps.json`, `execution-log.jsonl`, `execution-report.md` — walks BOTH checklists in order (control plane then data plane) with mandatory per-step human approval, polls long-running data-plane jobs (DataSync/DMS/S3 Batch/DynamoDB export-import), halts and offers rollback on failure, resumable via append-only journal. Refuses to advance from control plane to data plane until operator confirms handoff criteria + data-plane IAM is attached. |
| 9 | `post-migration-auditor` | `audit-diff.json` + `audit-report.md` — verifies parity between source and target after cutover |

Two modes:
- **Phase 1 — human-driven.** Invoke each skill in conversation. A human reads each artifact before the next step. The executor is the only skill that mutates AWS; everything before it is planning.
- **Phase 2 — orchestrated.** Run `/aws-migration-architect:migrate` to take you from inventory through the printed checklist. Read and sign the checklist (`APPROVED BY: <name> ON: <date>` line near the top). Then `/aws-migration-architect:execute --run-id <id>` walks the checklist resource-by-resource against the target with per-step approval. Then `/aws-migration-architect:audit --run-id <id>` verifies parity.

---

## Installation

### 1. Add the marketplace and install the plugin

In Claude Code:

```
/plugin marketplace add /Users/pventrapragada/Desktop/workspace/aws_migration/aws-migration-architect
/plugin install aws-migration-architect
```

You should now see:
- 9 skills: `inventory`, `dependency-analyzer`, `terraform-generator`, `migration-planner`, `data-migration-planner`, `cutover-control-plane`, `cutover-data-plane`, `cutover-executor`, `post-migration-auditor`
- 9 sub-agents (used by skills and the orchestrator)
- 4 slash commands: `/aws-migration-architect:migrate`, `:discover`, `:execute`, `:audit`
- 3 MCP servers wired automatically: `awsknowledge`, `awsiac`, `awspricing`

Verify with `/plugin`.

### 2. Local prerequisites

Install on your workstation (not in any AWS account):

```bash
# macOS (Homebrew)
brew install awscli terraform uv

# Linux (one option of several)
pipx install awscli  # or use the AWS-published installer
brew install terraform || download from terraform.io
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Minimum versions: AWS CLI ≥ 2.15, Terraform ≥ 1.6, `uvx` (from `astral-sh/uv`, any recent version).

### 3. Configure your two AWS profiles

You need **two** AWS profiles: one for the source account, one for the target. **SSO is strongly recommended** over static access keys.

#### Path A — AWS IAM Identity Center (SSO)

If your organization has IAM Identity Center enabled, ask your admin for the **SSO start URL**, then:

```bash
aws configure sso --profile migration-source
#   SSO start URL          → https://your-org.awsapps.com/start
#   SSO region             → us-east-1
#   [browser opens, you sign in]
#   pick source account    → 111111111111
#   pick permission set    → MigrationReadOnly (or ReadOnlyAccess)
#   default region         → us-east-1

aws configure sso --profile migration-target
#   (same flow, pick the target account)
```

#### Path B — Static access keys (only if SSO is not available)

```bash
aws configure --profile migration-source
#   paste access key + secret for an IAM user with the source IAM policy attached

aws configure --profile migration-target
#   same for target
```

This is less secure (keys live on disk, must be rotated manually).

#### Path C — AssumeRole

Configure a `bastion` profile with `sts:AssumeRole`, then:

```ini
# ~/.aws/config
[profile migration-source]
role_arn       = arn:aws:iam::111111111111:role/MigrationReadOnly
source_profile = bastion

[profile migration-target]
role_arn       = arn:aws:iam::222222222222:role/MigrationOperator
source_profile = bastion
```

### 4. Apply the IAM policies in each account

Use the policy JSON shipped with this repo. Replace `<TERRAFORM_STATE_BUCKET>` and `<TERRAFORM_LOCK_TABLE>` with your values in the target policies.

**Source account** — attach to the role/user you assume:
- `examples/iam/source-read-only.json`

**Target account** — attach policies depending on which phase you're in:
- Phase 1 (validate-only, before any apply): `examples/iam/target-validate-only.json`
- Phase 2 (control-plane apply via `:execute`): `examples/iam/target-cutover-control-plane.json`
- Phase 2 + data-plane (additive, only when `:execute` reaches Storage/Databases/DNS phases): also attach `examples/iam/target-cutover-data-plane.json`
- Legacy combined policy (still shipped for reference, not recommended for fresh installs): `examples/iam/target-cutover.json`

The control-plane policy permits Terraform applies and IAM management but **explicitly excludes** DataSync, DMS, RDS snapshot/restore/promote, EC2 AMI/snapshot share, DynamoDB export/import, Route53 record changes, and Secrets Manager put. Those live in the data-plane policy and are intended to be attached just for the cutover window then detached.

The source policy **deliberately excludes `secretsmanager:GetSecretValue` and `ssm:GetParameter` for SecureString**. The plugin never reads secret values.

### 5. Authenticate and export env vars

```bash
aws sso login --profile migration-source  # if using SSO
aws sso login --profile migration-target

export MIGRATION_SOURCE_PROFILE=migration-source
export MIGRATION_TARGET_PROFILE=migration-target

# Verify
aws sts get-caller-identity --profile $MIGRATION_SOURCE_PROFILE
aws sts get-caller-identity --profile $MIGRATION_TARGET_PROFILE
```

---

## Configuration

All knobs are environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `MIGRATION_SOURCE_PROFILE` | (required) | AWS profile name for the source account |
| `MIGRATION_TARGET_PROFILE` | (required for migrate/audit) | AWS profile name for the target account |
| `AWS_MIGRATION_ROOT` | `~/.aws-migration` | Directory under which all run artifacts are written |
| `MIGRATION_REGIONS` | (all enabled) | Comma-separated regions to scan. Empty = all enabled regions |
| `MIGRATION_SERVICES` | (MVP list) | Comma-separated service codes to scope down to a subset |
| `MIGRATION_TAG_FILTER` | (none) | `K=V,K=V` (AND semantics). Restricts inventory to tagged resources |
| `MIGRATION_FORCE_INCLUDE` | (none) | Comma-separated ARNs to include even if they don't match the tag filter |
| `MIGRATION_OWNERSHIP_TAGS` | `Owner,Team` | Tag keys, in priority order, used to extract resource ownership |
| `MIGRATION_INCREMENTAL` | `false` | Set to `true` to reuse a prior `inventory.json` and re-fetch only changed resources via AWS Config history |

---

## Usage

### Phase 2 — orchestrated end-to-end (recommended after the first run)

```
/aws-migration-architect:migrate
```

What happens:
- **Discover phase**: `inventory-explorer` then `dependency-mapper`
- **Generate phase**: `terraform-builder` and `migration-planner` in parallel (both depend only on Discover artifacts)
- **DataPlan phase**: `data-migration-planner` sizes each datastore, picks the transfer tool, estimates time + cost, captures freeze windows. Halts on any `blocker` warning (external KMS, RPO=0 paired with bulk strategy) unless `--force`.
- **Cutover phase**: `cutover-control-plane-builder` and `cutover-data-plane-builder` run in parallel — two checklists, two distinct concerns. Orchestrator pauses after both complete.

Then the human sign-off + execution loop:

1. Read `cutover-checklist-control-plane.md` AND `cutover-checklist-data-plane.md` end-to-end (alongside `data-migration-plan.md`). Confirm phases, approval gates, rollback windows, freeze windows, named tools per datastore.
2. Add an `APPROVED BY: <name> ON: <YYYY-MM-DD>` line near the top of **each** checklist (control plane and data plane sign off separately). The executor refuses to run without both lines.
3. Run `/aws-migration-architect:execute --run-id <id>`:
   - Compiles `execution-steps.json` from the checklist (preview/execute/verify/rollback/poll per step)
   - Walks every step in dependency order. **Per-step human approval is mandatory** — approve / skip / abort for every mutating command.
   - Polls long-running jobs (DataSync, DMS, S3 Batch, DynamoDB export/import) without holding an approval prompt open for hours
   - On failure: halts, shows the failed step + exit code + stderr, offers the rollback steps from `migration-plan.json`, asks retry / rollback / abort
   - Append-only `execution-log.jsonl` makes the run resumable: `/aws-migration-architect:execute --run-id <id> --resume` re-verifies any in-flight step against AWS and continues
4. After execution completes successfully, run `/aws-migration-architect:audit --run-id <id>` to verify source/target parity.

The orchestrator halts mid-run if the readiness score drops below 50. Override with `--force` (not recommended for the first migration). The executor's pre-flight is separate and refuses to start if the checklist isn't signed, regardless of `--force`.

### Phase 1 — human-driven, skill-by-skill

For the first migration you may want to review each artifact before proceeding to the next. Invoke each skill in conversation:

1. "Inventory my source AWS account using the `inventory` skill"
2. Review `inventory.json`, `unsupported-report.md`
3. "Run the `dependency-analyzer` skill against this run"
4. Review `dependency-graph.json`, `hardcoded-values.json`, the Mermaid diagrams
5. "Run `terraform-generator`"
6. Review the generated `terraform/`. Hand-edit if needed.
7. "Run `migration-planner`"
8. Read `readiness-score.json` and `migration-plan.md`. Decide go / no-go.
9. "Run `data-migration-planner`"
10. Read `data-migration-plan.md` — per-datastore sizing, strategy, transfer time, cost, freeze windows. Resolve any `blocker` warnings before continuing.
11. "Run `cutover-control-plane`" — produces `cutover-checklist-control-plane.md` (7-phase target-shape runbook)
12. "Run `cutover-data-plane`" — produces `cutover-checklist-data-plane.md` (5-phase data-movement runbook)
13. **Read BOTH checklists. Add the `APPROVED BY: <name> ON: <date>` line to each.**
14. "Run `cutover-executor`" — walks both checklists in order (control plane then data plane) with per-step approval. Halts and offers rollback on failure.
15. After execution: "Run `post-migration-auditor`"

### Discover-only — scope check before committing

```
/aws-migration-architect:discover
```

Runs only inventory + dependency-analysis. Cheap and fast — useful when you're not sure whether to migrate yet.

---

## How the plugin uses the AWS MCP servers

Three AWS-operated MCP servers are wired in `.mcp.json`:

| Server | Used by | What for |
|---|---|---|
| `awsknowledge` | inventory-explorer, dependency-mapper, post-migration-auditor | AWS service documentation when the agent hits an unfamiliar resource type |
| `awsiac` | terraform-builder | Best-practice patterns for module structure, state backend, naming |
| `awspricing` | migration-planner | Per-resource on-demand pricing in the target region for the cost baseline |

These servers run locally (via `uvx` for `awsiac` and `awspricing`) or via HTTP (for `awsknowledge`). They don't see your AWS resource data — only the questions the agents ask them about *AWS services in general*.

---

## What the plugin does NOT do

Honest list of things explicitly out of scope so you know where to plan manually. The plan file in `/Users/pventrapragada/.claude/plans/delightful-greeting-pretzel.md` has the full version.

- **Cross-cloud.** AWS→Azure, AWS→GCP, on-prem→AWS are not in MVP.
- **Unattended execution.** `:execute` requires per-step human approval for every mutating command. There is no batch-approve mode and no `--yes` flag. By design.
- **Identity federation setup.** SAML / OIDC IdP relationships must be re-established in target manually (the plugin flags them).
- **IAM Identity Center permission sets.** Org-admin job, not the plugin's.
- **Org-level config.** SCPs, CloudTrail, Config rules, GuardDuty, Security Hub.
- **Marketplace subscriptions.** Non-transferable.
- **Cross-account third-party trusts.** Flagged in `external_account_dependencies[]`, not migrated.
- **RI / Savings Plan purchase decisions in target.** The planner quotes on-demand baseline; buying commitments is a finance decision.
- **Multi-region within one account.** Different problem.
- **Reversal of irreversible operations.** The executor's rollback dialog runs the best-effort `rollback_cmd` from the migration plan, but some state changes (DNS TTL propagation, deleted snapshots, completed cross-account replications) cannot be fully undone. Per-step approval reduces blast radius; it does not undo physics.

---

## Migration gotchas the plugin handles

These are the recurring AWS-specific footguns; the plugin addresses each (full details in the plan file):

| Gotcha | What the plugin does |
|---|---|
| KMS keys are account-bound | Creates new keys in target with equivalent policy; parameterizes every `kms_key_id` reference |
| EC2 AMIs need cross-account sharing | Generates the `modify-image-attribute --launch-permission` command in the cutover checklist |
| Elastic IPs don't transfer | `dependency-analyzer` finds every reference to a source EIP literal and emits `eip_remap_required[]` |
| VPC CIDR conflicts break peering | Records source CIDRs; planner warns at plan time if target overlaps |
| Reserved Instances / Savings Plans don't transfer | Cost baseline quotes on-demand pricing as the post-migration baseline; flags the RI/SP exposure |
| Secret values must NEVER inline in HCL | Terraform creates the container only; value populated separately during cutover |
| Region/AZ literals break in cross-region migration | All AZs replaced with `data.aws_availability_zones` lookups; region as a Terraform variable |
| IAM trust types break in target (OIDC, IRSA, SAML, cross-account) | Classified per-role in `dependency-graph.iam_trusts[]`; needs_target_rework explicit |
| Service-linked roles like `AWSServiceRoleFor*` | Filtered out (AWS recreates them); listed in `coverage.skipped_service_linked_roles[]` |
| Hard-coded source account IDs / domains / EIPs in configs | Detected by `dependency-analyzer`; `terraform-generator` parameterizes what it can; the rest go to the cutover checklist |

---

## Repo layout

```
aws-migration-architect/
├── .claude-plugin/marketplace.json         # marketplace entry
├── plugins/aws-migration-architect/
│   ├── .claude-plugin/plugin.json          # plugin manifest
│   ├── .mcp.json                           # AWS MCP wiring
│   ├── skills/                             # 9 SKILL.md (human-facing playbooks)
│   ├── agents/                             # 9 sub-agents (bounded executors)
│   ├── workflows/                          # migrate.js, discover.js, execute.js, audit.js
│   └── commands/                           # migrate.md, discover.md, execute.md, audit.md
├── schemas/                                # 14 JSON schemas (the determinism contracts)
├── examples/
│   ├── iam/                                # scoped IAM policy JSON (source / target-validate-only /
│   │                                       #   target-cutover-control-plane / target-cutover-data-plane)
│   └── example-run/                        # fixtures + golden artifacts
├── README.md
├── PRIVACY.md
└── LICENSE                                 # MIT-0
```

---

## Troubleshooting

**"`uvx` not found"** when MCP servers start
Install `uv` via `curl -LsSf https://astral.sh/uv/install.sh | sh` and restart Claude Code.

**"InvalidClientTokenId"** on `aws sts get-caller-identity`
Your SSO session expired. Run `aws sso login --profile <name>` again.

**Inventory crashes mid-run on a service**
The sub-agent should log which service. File an issue with the service + error. As a workaround, use `MIGRATION_SERVICES` to scope past it.

**`terraform validate` fails after generation**
Check `terraform/.generation-report.md`. The failing resource is listed. Hand-edit the generated file; the plugin does NOT automatically fix `validate` failures (intentional — your hand-edit is more reliable than a model retry).

**Audit shows drift after self-consistency test (same profile both sides)**
This is a normalization bug. File an issue with the leaked field path.

---

## License

MIT-0. See `LICENSE`.

## Privacy

See `PRIVACY.md` for what data this plugin reads and where it writes. Short version: AWS resource metadata only (no secret values), all artifacts local-only.
