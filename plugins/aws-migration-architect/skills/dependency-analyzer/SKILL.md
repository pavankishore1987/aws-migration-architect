---
name: dependency-analyzer
description: Find the hidden coupling that breaks migrations. Walks resource-to-resource references (SG rules, Lambda env vars, S3 policies, IAM trust chains), classifies IAM trusts (cross-account, OIDC, IRSA, SAML), detects hard-coded values (account IDs, regions, EIPs, ARNs, domains), assigns Low/Medium/High risk per resource, and emits Mermaid architecture diagrams. Use after `inventory` and before `terraform-generator` or `migration-planner`.
---

# AWS Migration: Dependency Analyzer

This is where migrations fail. Resource configs reference other resources by ARN, IP, hostname, role name, or KMS alias — and any of those references becomes invalid when the migration crosses an account boundary. This skill enumerates every cross-resource reference and classifies it.

## When to use this skill

- After `inventory` completes (it reads `inventory.json`)
- Before `terraform-generator` (it depends on the hard-coded-values report to parameterize HCL)
- Before `migration-planner` (it needs risk scores to order phases)

## Prerequisites

- `inventory.json` exists in the current run directory
- `$MIGRATION_SOURCE_PROFILE` still set (the analyzer makes additional targeted `describe-*` calls to follow ARN references)

## Inputs

| Input | Source | Required |
|---|---|---|
| `inventory.json` | prior `inventory` skill run | yes |
| `$MIGRATION_SOURCE_PROFILE` | env var | yes |
| `$AWS_MIGRATION_ROOT` | env var, default `~/.aws-migration` | no |

## Outputs

- **`dependency-graph.json`** — validates against `schemas/dependency-graph.schema.json`. Contains:
  - `edges[]` — resource-to-resource references
  - `iam_trusts[]` — classified per role
  - `external_account_dependencies[]` — peering / TGW / RAM crossings into third-party accounts
  - `external_identity_provider_trusts[]` — SAML / OIDC IdPs that must be reconfigured in target
  - `eip_remap_required[]` — EIP literals referenced in resource configs
  - `fragile_couplings[]` — high-severity findings worth surfacing in the planner's blockers
- **`hardcoded-values.json`** — validates against `schemas/hardcoded-values.schema.json`. Two arrays: `auto_parameterized[]` (handled by terraform-generator) and `manual_review_required[]` (user must decide).
- **`risk-scores.json`** — validates against `schemas/risk-scores.schema.json`. Per-resource Low / Medium / High with reason codes.
- **`architecture/*.mmd`** — Mermaid diagrams for human review:
  - `vpc-topology.mmd` — VPCs, subnets, route tables, gateways
  - `dependency-graph.mmd` — top-N most-connected resources and their edges
  - `dns-topology.mmd` — Route53 zones → records → ALB/NLB/CloudFront targets
  - `iam-trust-graph.mmd` — color-coded by trust type

## Workflow

### Step 1 — Read inventory and stage the resource index

Build an in-memory index of `arn → resource` from `inventory.json` for fast lookup during reference walks. Apply the staleness check: if `inventory.json` is >7 days old, warn the user.

### Step 2 — Resource-to-resource reference walks

Spawn the `dependency-mapper` sub-agent to scan each resource's `provider_specific.aws` and extract references. Patterns to detect:

| Source resource | Pattern → emitted edge |
|---|---|
| EC2 security groups | `IpPermissions.UserIdGroupPairs` → `sg-ingress` / `sg-egress` edges between SGs |
| EC2 instances | SG references → `sg-ingress` linking instances |
| Lambda function | `Environment.Variables.*` matching `arn:aws:secretsmanager:...` → `lambda-env-secret` edge |
| Lambda function | `Environment.Variables.*` matching `arn:aws:ssm:.../parameter/...` → `lambda-env-ssm` |
| Lambda function | `Role` → `iam-policy` edge to role |
| IAM role | `AssumeRolePolicyDocument` → `iam-trust` edges + entry in `iam_trusts[]` |
| IAM policy | Resource ARNs in `Resource` and `NotResource` → `iam-policy` edges |
| S3 bucket | `Policy.Statement[].Principal.AWS` → `s3-bucket-policy` edges |
| Route53 record | `AliasTarget.DNSName` → `r53-alias` edge to ALB/NLB/CloudFront |
| Route53 record | CNAME values → `r53-cname` |
| CloudFront distribution | `Origins[].DomainName` → `cloudfront-origin` |
| ELB target groups | `Targets[].Id` (instance IDs) → `elb-target` |
| ECS task definition | `taskRoleArn`, `executionRoleArn` → `ecs-task-role` |
| EKS service account | OIDC subject → `eks-irsa` + entry in `iam_trusts[]` |
| Any resource | `kms_key_id` / `KmsKeyId` → `kms-key-use` |
| Cognito user pool | `LambdaConfig.{PreSignUp,PostConfirmation,PreAuthentication,PostAuthentication,UserMigration,DefineAuthChallenge,CreateAuthChallenge,VerifyAuthChallengeResponse,CustomMessage,PreTokenGeneration}` → `cognito-trigger` edges to the Lambda. Trigger ARNs become target-Lambda variables at HCL generation time. |
| Cognito user pool client | `CallbackURLs[]` / `LogoutURLs[]` → `cognito-callback-url` edges to external domains (recorded in `hardcoded-values.manual_review_required[]` when the hostname is not under a source Route53 zone). |
| Cognito identity provider | `ProviderDetails.client_id` (Google/Facebook/Apple) and SAML `MetadataURL` → `cognito-idp-federation` (always `needs_target_rework: true` — provider secrets re-supplied at cutover). |
| MemoryDB cluster | `SubnetGroupName` → `memorydb-subnet-group`, `ParameterGroupName` → `memorydb-parameter-group`, `ACLName` → `memorydb-acl`, `SecurityGroupIds[]` → `sg-ingress`, `KmsKeyId` → `kms-key-use`. |
| MemoryDB ACL | `UserNames[]` → ACL-user membership edges (recorded inline on the ACL resource; user passwords flagged for the data-plane secret-put step). |
| WAFv2 Web ACL | each ARN returned by `list-resources-for-web-acl` → `wafv2-association` edge. **Every association is a remap candidate**: target ALB/API-Gateway/AppSync ARNs differ from source, so each association is recorded in `hardcoded-values.auto_parameterized[]` with the target resource's module output as the `var`. Web ACL rule statements referencing IPSets / RuleGroups / RegexPatternSets are rewritten by name to point at the new target ARN. CloudFront-scoped Web ACLs MUST live in us-east-1 — flag if `target_region != us-east-1`. |
| Athena workgroup | `ResultConfiguration.OutputLocation` (`s3://<bucket>/<prefix>`) → `athena-results-bucket` edge. If the bucket is in inventory, parameterize to that bucket's module output; otherwise flag in `manual_review_required[]` ("Athena workgroup `<name>` writes to bucket `<bucket>` that is NOT in scope — create it in target before queries run."). Workgroup `Configuration.DataCatalogName` (if not `AwsDataCatalog`) → `athena-glue-catalog` edge pointing at the data catalog; if the catalog is a federated LAMBDA/HIVE source, that's out of MVP — flag for manual rebuild. |
| Athena named query / prepared statement | parse SQL for table refs of the form `<catalog>.<db>.<table>` or `<db>.<table>` referencing Glue databases; if the database isn't in inventory under glue, flag in `manual_review_required[]`. |
| App Runner service | `SourceConfiguration.ImageRepository.ImageIdentifier` → `apprunner-image-source` edge to the source ECR repo (target URI rewritten to target-account registry; ECR images themselves migrate in data-plane Phase 3 ecr-push). `InstanceConfiguration.InstanceRoleArn` + `AuthenticationConfiguration.AccessRoleArn` → `apprunner-instance-role`. `RuntimeEnvironmentSecrets[]` values → `apprunner-secret-env` edges (Secrets Manager ARNs — target ARNs differ; values supplied via secret-put-value at cutover). `NetworkConfiguration.EgressConfiguration.VpcConnectorArn` → `apprunner-vpc-connector` referencing the VPC connector resource. |
| Any resource with `provider_specific.aws.cfn_stack_owner` set | `cfn-managed-resource` edge from the resource to the CloudFormation stack (recorded as `cfn://<stack-name>` since the stack itself is not in `resources[]`). Add an entry to `fragile_couplings[]` with severity `high`: *"<resource-arn> is managed by CFN stack <stack-name>. Auto-generated HCL for this resource will conflict with the stack's drift detection — pick redeploy-as-CFN-in-target OR import-to-Terraform per the per-stack decision in `cloudformation-decisions.md`."* The terraform-generator skips emitting HCL for CFN-managed resources by default. |
| CE anomaly subscription | `MonitorArnList[]` → `ce-anomaly-subscription` edges to each anomaly monitor in inventory. SNS-typed subscribers (target ARN) parameterize to the target SNS module output; email subscribers carry through as-is. |
| RDS proxy | `Auth[].SecretArn` → `rds-proxy-secret` edge (target Secrets Manager ARN — proxy cannot start serving until the secret value is populated in target). `VpcSubnetIds[]` → `rds-proxy-subnet` edges (target subnet IDs from networking module). `VpcSecurityGroupIds[]` → `sg-ingress`. Per-target-group `Targets[].RdsResourceId` → `rds-proxy-target` edges to the target DB instance or cluster (which must exist before the proxy can register them — order in migration-plan: DB containers first, then proxy). `RoleArn` → `iam-policy` edge to the proxy execution role. |

### Step 3 — IAM trust classification

For every IAM role, parse `AssumeRolePolicyDocument` and classify by `Principal`:

| Principal pattern | trust_type | needs_target_rework |
|---|---|---|
| `arn:aws:iam::<source-account>:role/*` | `same-account-role` | false (ARN parameterizes) |
| `arn:aws:iam::<other-account>:root` or role | `cross-account-role` | **true** |
| `<account>.dkr.ecr.<region>.amazonaws.com` (Federated) | various | check by URL |
| Federated `token.actions.githubusercontent.com` | `oidc-github` | **true** |
| Federated `gitlab.com` | `oidc-gitlab` | **true** |
| Federated `oidc.eks.<region>.amazonaws.com/id/<id>` | `irsa-eks` | **true** (new cluster, new ID) |
| Federated SAML provider ARN | `saml-federation` | **true** |
| Federated Cognito | `web-identity-cognito` | **true** |
| Service `lambda.amazonaws.com`, `ec2.amazonaws.com`, etc. | `aws-service-principal` | false |

Record `external_account_dependencies[]` for any cross-account trust pointing at an account that is neither source nor target.

Record `external_identity_provider_trusts[]` for SAML / OIDC providers.

### Step 4 — Hard-coded value detection

Scan every string field in every resource's config (Lambda env vars, SSM parameters, user-data scripts, IAM policy documents, S3 bucket policies, Route53 record values) for these patterns:

| Pattern | Regex sketch | Auto / Manual |
|---|---|---|
| Source account ID | `\b<source-account-id>\b` | auto → `var.source_account_id` / `var.target_account_id` |
| Region literal | `\b(us\|eu\|ap\|sa\|af\|me\|ca)-[a-z]+-\d\b` | auto → `var.aws_region` |
| Resource ARN (internal) | `arn:aws:[^:]+:[^:]*:<source-account-id>:.*` | auto → variable referencing the resource module output |
| Resource ARN (external) | `arn:aws:[^:]+:[^:]*:(?!<source>)(?!<target>)\d{12}:.*` | manual (external-resource-arn) |
| Elastic IP literal | EIPs from inventory matched as exact strings in configs | manual (elastic-ip-literal) |
| OIDC provider URL | `oidc.eks.*.amazonaws.com/id/[A-F0-9]+` | manual (oidc-provider-url) |
| KMS alias | `alias/...` resolved to current account | auto → variable referencing target KMS alias |
| External domain | Hostnames not in source-account Route53 zones | manual (external-domain) |

Emit `hardcoded-values.json`. `terraform-generator` consumes `auto_parameterized[]` directly; `manual_review_required[]` goes into the cutover checklist as items the human must decide on.

### Step 5 — Risk scoring

For each resource, assign a risk level using these rules in order (first match wins):

- **High** if any of:
  - Stateful (RDS, EBS-data volumes, EFS, FSx, DynamoDB tables with data)
  - In an unsupported MVP service
  - Has a cross-account / OIDC / IRSA / SAML trust
  - Referenced in `hardcoded-values.manual_review_required[]`
  - Encrypted with KMS and the KMS key is used by 3+ other resources (high blast radius if mishandled)
  - CIDR overlap with target (for VPCs)

- **Medium** if any of:
  - Has 1-3 dependency edges
  - References secrets/SSM parameters
  - Lambda with 5+ env vars (config complexity)
  - IAM role with 10+ attached policies

- **Low** otherwise

Emit `risk-scores.json` with per-resource entries and a summary count.

### Step 6 — Mermaid architecture diagrams

Generate four Mermaid `.mmd` files under `architecture/`:

**`vpc-topology.mmd`** — per-region VPC structure:
```
graph TB
  subgraph us-east-1
    subgraph vpc-abc[vpc-prod-main 10.0.0.0/16]
      subnet-1[subnet-public-1a]
      subnet-2[subnet-private-1a]
      igw[Internet Gateway]
      nat[NAT Gateway]
    end
  end
```

**`dependency-graph.mmd`** — top-30 most-connected resources, edges colored by relation type.

**`dns-topology.mmd`** — Route53 zones → records → targets.

**`iam-trust-graph.mmd`** — roles with their trusts, colored: green=service principal, blue=same-account, **red=cross-account/OIDC/SAML** (needs re-work).

Mermaid renders inline on GitHub and in most markdown viewers.

### Step 7 — Validate and emit

Validate each output against its schema. Print summary:

```
✓ Dependency analysis complete
  Edges:            2841
  IAM trusts:       412 total — 38 need target re-work (cross-account/OIDC/SAML)
  Hard-coded values: 1247 auto, 23 manual-review
  Risk distribution: 712 low / 423 medium / 112 high
  Diagrams:         architecture/{vpc,dependency,dns,iam-trust}.mmd
  Output:           ~/.aws-migration/runs/<run-id>/
```

## Related skills

- `inventory` — must run first
- `terraform-generator` — consumes `hardcoded-values.auto_parameterized[]`
- `migration-planner` — consumes `dependency-graph.json` + `risk-scores.json`

## Sub-agent

Calls `dependency-mapper` for the cross-reference walk and IAM trust classification.
