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
| rds | aws_db_proxy (+ default target group + targets) | `rds/db-proxy.hcl.tmpl` |
| lambda | aws_lambda_function | `lambda/function.hcl.tmpl` |
| iam | aws_iam_role | `iam/role.hcl.tmpl` |
| iam | aws_kms_key | `iam/kms-key.hcl.tmpl` |
| iam | aws_secretsmanager_secret | `iam/secret.hcl.tmpl` |
| cognito | aws_cognito_user_pool | `cognito/user-pool.hcl.tmpl` |
| cognito | aws_cognito_user_pool_client | `cognito/user-pool-client.hcl.tmpl` |
| cognito | aws_cognito_user_group | `cognito/user-pool-group.hcl.tmpl` |
| cognito | aws_cognito_identity_provider | `cognito/identity-provider.hcl.tmpl` |
| memorydb | aws_memorydb_cluster | `memorydb/cluster.hcl.tmpl` |
| memorydb | aws_memorydb_parameter_group | `memorydb/parameter-group.hcl.tmpl` |
| memorydb | aws_memorydb_subnet_group | `memorydb/subnet-group.hcl.tmpl` |
| memorydb | aws_memorydb_user | `memorydb/user.hcl.tmpl` |
| memorydb | aws_memorydb_acl | `memorydb/acl.hcl.tmpl` |
| wafv2 | aws_wafv2_web_acl (+ aws_wafv2_web_acl_association) | `wafv2/web-acl.hcl.tmpl` |
| wafv2 | aws_wafv2_ip_set | `wafv2/ip-set.hcl.tmpl` |
| wafv2 | aws_wafv2_rule_group | `wafv2/rule-group.hcl.tmpl` |
| athena | aws_athena_workgroup | `athena/workgroup.hcl.tmpl` |
| athena | aws_athena_data_catalog | `athena/data-catalog.hcl.tmpl` |
| athena | aws_athena_named_query | `athena/named-query.hcl.tmpl` |
| apprunner | aws_apprunner_service (+ optional aws_apprunner_vpc_connector) | `apprunner/service.hcl.tmpl` |
| apprunner | aws_apprunner_auto_scaling_configuration_version | `apprunner/autoscaling-configuration.hcl.tmpl` |
| ce | aws_ce_anomaly_monitor | `ce/anomaly-monitor.hcl.tmpl` (optional, flag-only) |
| ce | aws_ce_anomaly_subscription | `ce/anomaly-subscription.hcl.tmpl` (optional, flag-only) |
