# HCL templates

These templates are filled in by the `terraform-builder` sub-agent from normalized `aws describe-*` JSON.

## Template variable conventions

Every template uses these substitution variables. The sub-agent substitutes them from the source JSON or the parameterization map in `hardcoded-values.json`:

| Token | Replaced with | Example |
|---|---|---|
| `{{name}}` | resource Name tag or service-default name | `prod-web` |
| `{{slug}}` | name lowercased, hyphenated | `prod_web` |
| `{{aws_region}}` | always `var.aws_region` | (literal in HCL) |
| `{{target_account_id}}` | always `var.target_account_id` | (literal in HCL) |
| `{{source_account_id}}` | always `var.source_account_id` | (literal in HCL) |
| `{{az_lookup N}}` | `data.aws_availability_zones.available.names[N]` | (literal in HCL) |
| `{{tags}}` | rendered HCL map from source tags + migration-added tags | `{ Name = "...", MigratedAt = "..." }` |
| `{{ref:<arn>}}` | resolved cross-resource reference if the ARN is in inventory; literal otherwise | `aws_kms_key.s3_key.arn` |
| `{{kms_alias_var <alias>}}` | Terraform variable for the new target KMS alias | `var.kms_s3_alias` |

## When a template doesn't exist

Falls back to a generic `provider-specific.aws` block that re-emits the describe-* output with substitutions but without idiomatic structure. The generation report lists every resource that fell back so the user can add templates over time.

## Adding a new service

1. Create `<service>/<resource-type>.hcl.tmpl`
2. Use the substitution conventions above
3. List parameterization targets (ARNs, regions, AZs) — the sub-agent will auto-detect, but explicit hints help
4. Add a fixture in `examples/example-run/source/<service>-<type>.json` for round-trip tests

## Current coverage

These templates are shipped as representative examples; the sub-agent generates HCL for the other ~30 MVP services using inline templating from the `awsiac` MCP patterns.

| Service | Resource | Template file |
|---|---|---|
| vpc | aws_vpc | `vpc/vpc.hcl.tmpl` |
| vpc | aws_subnet | `vpc/subnet.hcl.tmpl` |
| vpc | aws_security_group | `vpc/security-group.hcl.tmpl` |
| ec2 | aws_instance | `ec2/instance.hcl.tmpl` |
| s3 | aws_s3_bucket | `s3/bucket.hcl.tmpl` |
| rds | aws_db_instance | `rds/db-instance.hcl.tmpl` |
| lambda | aws_lambda_function | `lambda/function.hcl.tmpl` |
| iam | aws_iam_role | `iam/role.hcl.tmpl` |
| iam | aws_kms_key | `iam/kms-key.hcl.tmpl` |
| iam | aws_secretsmanager_secret | `iam/secret.hcl.tmpl` |
