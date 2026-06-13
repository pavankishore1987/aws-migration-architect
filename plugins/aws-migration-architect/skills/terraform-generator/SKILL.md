---
name: terraform-generator
description: Convert source-account AWS resources into Terraform modules from `aws describe-*` JSON via templated HCL. Parameterizes every source-account ARN, region, AZ, and KMS alias into Terraform variables so the same module deploys to the target account. Emits a module per category (networking, compute, storage, databases, iam, dns) and runs `terraform fmt && terraform validate` before declaring success.
---

# AWS Migration: Terraform Generator

This skill is **how the source account becomes infrastructure-as-code**. It does NOT use Terraformer or any external import tool — it generates HCL directly from `aws describe-*` JSON via templated substitution, so users only need the `terraform` binary on their machine.

## When to use this skill

- After `inventory` and `dependency-analyzer` complete
- When you want a re-deployable Terraform representation of the source account, with account-bound literals parameterized so the modules can apply to the target

## Prerequisites

- `inventory.json`, `dependency-graph.json`, `hardcoded-values.json` exist in the run directory
- `terraform` binary on `$PATH` (>= 1.6)
- `$MIGRATION_SOURCE_PROFILE` set (used for a few targeted re-fetches when describe output is missing fields)
- `awsiac` MCP server registered (used for module-structure best practices)

## Inputs

| Input | Source | Required |
|---|---|---|
| `inventory.json` | `inventory` skill | yes |
| `dependency-graph.json` | `dependency-analyzer` skill | yes |
| `hardcoded-values.json` | `dependency-analyzer` skill | yes |
| `$MIGRATION_SOURCE_PROFILE` | env var | yes |
| `$MIGRATION_TARGET_REGION` | env var, default = source region | no |
| `templates/` | repo-shipped HCL templates | yes |

## Outputs

Written to `<run-dir>/terraform/`:

```
terraform/
├── networking/         # vpc, subnets, route tables, IGW, NAT, VPC endpoints, SGs
│   ├── main.tf
│   ├── variables.tf
│   └── outputs.tf
├── compute/            # EC2, Lambda, ECS, EKS, Auto Scaling
├── storage/            # S3, EFS, FSx, EBS volume definitions
├── databases/          # RDS, Aurora, DynamoDB, ElastiCache, OpenSearch
├── iam/                # roles, policies, KMS keys (NEW keys in target), Secrets Manager containers
├── dns/                # Route53, ACM, CloudFront, API Gateway
└── root/
    ├── providers.tf
    ├── variables.tf    # source_account_id, target_account_id, target_region, etc.
    ├── main.tf         # module calls wiring the six categories together
    └── terraform.tfvars.example
```

Plus a generation report: `terraform/.generation-report.md` listing per-resource success/skip with reasons.

## Workflow

### Step 1 — Read inputs, build the parameterization map

- Load `inventory.json` (resources to generate)
- Load `dependency-graph.json` (cross-resource edges → become `depends_on` or output/input references)
- Load `hardcoded-values.auto_parameterized[]` → these become Terraform variables in `variables.tf`

Build maps:
- `arn → tf_resource_address` (for cross-resource refs)
- `source_account_id → var.source_account_id` (and same for target)
- `kms_alias → var.kms_<purpose>_alias`

### Step 2 — Spawn the `terraform-builder` sub-agent

The sub-agent processes resources category-by-category. For each resource:

1. Match the resource's `service` + `type` to a template in `templates/<service>/<type>.hcl.tmpl`
2. Re-run targeted `aws <service> describe-<resource> --profile $MIGRATION_SOURCE_PROFILE` if `inventory.json` is stale or fields are missing
3. Normalize JSON (strip timestamps, AWS-managed metadata, AccountId duplication)
4. Substitute into the template:
   - Account ID literals → `var.target_account_id`
   - Region literals → `var.aws_region`
   - AZ literals (`us-east-1a`) → `data.aws_availability_zones.available.names[N]`
   - Cross-resource ARNs → module outputs / data sources
   - KMS aliases → new aliases in target (we create new keys)
5. Append to the module's `main.tf`

### Step 3 — Special handling per category

**Networking.** Always emit a `data "aws_availability_zones" "available" {}` and reference its `.names[]` by index. VPC CIDRs are extracted as variables (default = source CIDR; user overrides if there's a conflict).

**IAM.** Source-account ARNs in trust policies and resource policies → target-account variables. Role names preserved. Service-linked roles skipped (auto-created in target).

**KMS.** New keys are created in target (never moved). Key policies are templated with `var.target_account_id`. Aliases are preserved. Any resource that referenced a source KMS key now references the corresponding new target key via module output.

**Secrets Manager.** Secret *containers* are created with the original name, KMS reference, description, tags. Secret **values** are set to a placeholder string with a `lifecycle { ignore_changes = [secret_string] }` block so a subsequent manual put-secret-value does not get reverted by Terraform.

**S3.** Bucket name: source bucket name + suffix configurable via `var.bucket_name_suffix` (default empty — assumes target naming conflicts are resolved by the user). Bucket policies parameterize source-account ARNs.

**Route53.** Zones are recreated; record sets parameterize ALB/NLB DNS targets. Alias records updated to point at the new target ALB.

### Step 4 — Module wiring

`terraform/root/main.tf` calls the six category modules in order, passing outputs as inputs:

```hcl
module "iam" {
  source = "../iam"
  target_account_id = var.target_account_id
  target_region     = var.aws_region
}

module "networking" {
  source            = "../networking"
  target_account_id = var.target_account_id
  kms_arns          = module.iam.kms_arns
}

module "storage" {
  source       = "../storage"
  vpc_id       = module.networking.vpc_id
  subnet_ids   = module.networking.private_subnet_ids
  kms_s3_arn   = module.iam.kms_s3_arn
}
# ... and so on
```

### Step 5 — Provider and backend stub

`terraform/root/providers.tf`:

```hcl
terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  # backend "s3" { ... } — user fills in
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}
```

State backend left as a comment for the user — picking one (S3 + DynamoDB lock, Terraform Cloud, etc.) is an org decision.

### Step 6 — Best-practice pass

Query the `awsiac` MCP server for any patterns we should adopt:
- `mcp__plugin_aws-migration-architect_awsiac__search_iac_patterns` — search for best-practice module structures by service
- Apply discovered patterns to module layout (e.g., separating data sources from resources, output naming conventions)

### Step 7 — Format and validate

```bash
cd terraform/
terraform fmt -recursive
cd root/
terraform init -backend=false
terraform validate
```

If `terraform validate` fails, the generation report lists which resource caused it and emits a warning to the user. Do not delete the artifact on failure — let the user inspect.

### Step 8 — Generation report

Emit `terraform/.generation-report.md`:

```markdown
# Terraform Generation Report

✓ Generated:  1,189 / 1,247 resources
⚠ Skipped:       58 resources (see below)
✓ Validated:  terraform fmt + validate passed

## Skipped resources
- SageMaker endpoint `recommender-v2` — out of MVP (see unsupported-report.md)
- IAM role `AWSServiceRoleForRDS` — service-linked, auto-created in target
- ...
```

## Related skills

- `inventory` — provides resource list
- `dependency-analyzer` — provides parameterization map via `hardcoded-values.json`
- `migration-planner` — references the generated modules in phase ordering

## Sub-agent

Calls `terraform-builder` for the per-resource HCL generation.
