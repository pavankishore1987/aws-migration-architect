# Privacy and Data Handling

## What this plugin does with your AWS data

This plugin runs entirely on your workstation against AWS public APIs using the credentials in your AWS profiles. It does not send any AWS data to third parties beyond the AWS-published MCP servers configured in `.mcp.json` (which are also AWS-operated).

## What gets read

- AWS resource metadata via `describe-*`, `list-*`, `get-*` API calls (against the source profile)
- AWS Config history (if Config is enabled in the source account) for incremental inventory
- AWS Resource Explorer index (if enabled) for discovery snapshots
- AWS Pricing API and AWS Cost Explorer (for cost baseline analysis)

## What is deliberately NOT read

- **`secretsmanager:GetSecretValue`** is excluded from the recommended source IAM policy. The plugin never reads secret values. Secrets Manager and SSM SecureString values do not flow through any plugin artifact path.
- **`ssm:GetParameter`** without the `NoSecureString` condition is excluded for the same reason.

## What gets written

All artifacts are written to your local filesystem under `$AWS_MIGRATION_ROOT/runs/<run-id>/` (default `~/.aws-migration/`). Nothing is uploaded.

## AWS MCP servers

The plugin wires three AWS-operated MCP servers:
- `awsknowledge` — AWS service documentation lookup (HTTP, knowledge-mcp.global.api.aws)
- `awsiac` — Terraform/CDK pattern guidance (local `uvx` process)
- `awspricing` — pricing lookup (local `uvx` process)

These are queried for AWS *service knowledge* and *patterns* — they are not sent your account resource data.

## Sensitive data in generated Terraform

The `terraform-generator` skill emits HCL that may include resource names, ARNs, tags, and configuration values from your source account. **Treat the generated `terraform/` directory as containing your AWS topology** — review before committing to a repository, and avoid pushing to public repositories without scrubbing.
