# Example run fixtures

This directory contains pre-recorded `aws describe-*` JSON outputs that simulate a small source account. They let you test the full migration pipeline end-to-end without authenticating against any real AWS account.

## Layout

```
example-run/
├── README.md                              # this file
├── source/                                # simulated source account JSON describe-* outputs
│   ├── account-info.json                  # caller identity + enabled regions
│   ├── ec2-describe-vpcs.json
│   ├── ec2-describe-subnets.json
│   ├── ec2-describe-security-groups.json
│   ├── ec2-describe-instances.json
│   ├── lambda-list-functions.json
│   ├── lambda-get-function-policy.json
│   ├── s3-list-buckets.json
│   ├── rds-describe-db-instances.json
│   ├── iam-list-roles.json
│   └── route53-list-hosted-zones.json
├── target/                                # simulated post-cutover target (for audit testing)
│   ├── account-info.json
│   └── ...                                # mirror of source/ with new account ID, IDs
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
    │   └── iam-trust-graph.mmd
    ├── cost-baseline.json
    ├── readiness-score.json
    ├── migration-plan.json
    ├── migration-plan.md
    ├── cutover-checklist.md
    └── audit-diff.json                    # from running auditor against target/
```

## Scenario

The simulated source account `111111111111`:

- 1 VPC in `us-east-1` with 3 subnets (1 public, 2 private)
- 2 EC2 instances in private subnets
- 1 RDS PostgreSQL DB in private subnet
- 3 Lambda functions (env vars reference Secrets Manager + EIP literal — a deliberate hardcoded-values trigger)
- 2 S3 buckets
- 1 IAM role with a GitHub OIDC trust (a deliberate IAM-trust-rework trigger)
- 1 Route53 hosted zone with alias records pointing at an ALB
- 1 SageMaker notebook instance (a deliberate "not in MVP" trigger)
- 2 CloudFormation stacks (a deliberate "CFN-in-source" trigger)

The simulated target account `222222222222` is the same shape but with new account ID, new resource IDs, and new ARNs — i.e., what a successful migration should look like.

## How to use these fixtures

The skills are designed to read real AWS API responses, but for offline testing you can either:

1. Use the `Plug stub AWS` approach: the sub-agents have a `--fixture-dir` mode that reads from disk instead of shelling out to `aws` (not currently wired — future enhancement).
2. Use the fixtures as **expected-output checks**: run the plugin against a real sandbox account, then diff your outputs against the `golden/` files to confirm correctness.

For now, the fixtures serve as documentation of what each artifact looks like in practice.
