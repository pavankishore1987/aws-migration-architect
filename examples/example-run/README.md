# Example run fixtures

This directory contains pre-recorded `aws describe-*` JSON outputs that simulate a small source account. They let you test the full migration pipeline end-to-end without authenticating against any real AWS account.

## Layout

```
example-run/
├── README.md                              # this file
├── source/                                # simulated source account (111111111111) JSON describe-* outputs
│   ├── account-info.json                  # caller identity + enabled regions
│   ├── ec2-describe-vpcs.json
│   ├── ec2-describe-subnets.json
│   ├── ec2-describe-security-groups.json
│   ├── ec2-describe-instances.json
│   ├── elbv2-describe-load-balancers.json
│   ├── lambda-list-functions.json
│   ├── lambda-get-function-policy.json
│   ├── s3-list-buckets.json
│   ├── rds-describe-db-instances.json
│   ├── iam-list-roles.json
│   ├── route53-list-hosted-zones.json
│   ├── kms-list-keys.json
│   ├── secretsmanager-list-secrets.json
│   ├── sagemaker-list-notebook-instances.json   # NOT-in-MVP trigger
│   └── cloudformation-list-stacks.json          # CFN-in-source trigger
├── target/                                # simulated post-cutover target (222222222222) for audit testing
│   ├── account-info.json
│   ├── ec2-describe-vpcs.json
│   ├── s3-list-buckets.json
│   ├── rds-describe-db-instances.json
│   ├── iam-list-roles.json
│   └── lambda-list-functions.json         # mirror of source/ with new account ID, IDs, KMS keys
└── golden/                                # expected outputs from running the pipeline against source/
    ├── inventory.json
    ├── resource-ownership.json
    ├── unsupported-report.md
    ├── dependency-graph.json
    ├── hardcoded-values.json
    ├── risk-scores.json
    ├── architecture/
    │   ├── vpc-topology.mmd
    │   ├── dependency-graph.mmd
    │   ├── dns-topology.mmd
    │   └── iam-trust-graph.mmd
    ├── cost-baseline.json
    ├── readiness-score.json
    ├── migration-plan.json
    ├── migration-plan.md
    ├── data-migration-plan.json
    ├── data-migration-plan.md
    ├── cutover-checklist-control-plane.json    # 7-phase target-shape runbook
    ├── cutover-checklist-control-plane.md       # ← human adds "APPROVED BY:" line
    ├── cutover-checklist-data-plane.json        # 5-phase data-movement runbook
    ├── cutover-checklist-data-plane.md          # ← SEPARATE "APPROVED BY:" line
    ├── audit-diff.json                          # from running auditor against target/
    └── audit-report.md
```

> Note: the original single `cutover-checklist.md` was split into separate **control-plane** and **data-plane** checklists, each signed independently. The golden files reflect the current architecture.

## Scenario

The simulated source account `111111111111` holds **23 in-scope resources** for the `orders-api` app:

- 1 VPC in `us-east-1` with 3 subnets (1 public, 2 private) and 4 security groups
- 2 EC2 instances in private subnets, fronted by 1 ALB
- 1 RDS PostgreSQL DB (`prod-orders`, MultiAZ, KMS-encrypted)
- 2 Lambda functions — `orders-api-handler` env vars carry an **EIP literal** (`54.231.45.67`) and an **external domain** (deliberate hardcoded-values triggers)
- 2 S3 buckets (one customer-managed-KMS, one AES256)
- 3 IAM roles: a Lambda service role, a **GitHub OIDC** role, and a **cross-account** role trusted by `333333333333` (deliberate IAM-trust-rework triggers); plus `AWSServiceRoleForRDS` which is filtered out as service-linked
- 1 Route53 hosted zone with an alias record pointing at the ALB
- 2 customer-managed KMS keys + 1 Secrets Manager secret (value never read)
- 1 SageMaker notebook instance (deliberate "not in MVP" trigger → `unsupported-report.md`)
- 2 CloudFormation stacks (deliberate "CFN-in-source" trigger → `coverage.cloudformation_stacks[]`)

The simulated target account `222222222222` is the same shape but with new account ID, new resource IDs/ARNs, and new (account-bound) KMS keys — i.e., what a successful migration should look like. The only intentional drift the auditor should report is the recreated KMS key on `prod-orders` (benign `config_drift`, info severity).

## How to use these fixtures

The skills are designed to read real AWS API responses, but for offline testing you can either:

1. Use the `Plug stub AWS` approach: the sub-agents have a `--fixture-dir` mode that reads from disk instead of shelling out to `aws` (not currently wired — future enhancement).
2. Use the fixtures as **expected-output checks**: run the plugin against a real sandbox account, then diff your outputs against the `golden/` files to confirm correctness.

For now, the fixtures serve as documentation of what each artifact looks like in practice.
