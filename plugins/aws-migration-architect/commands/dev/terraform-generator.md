---
name: terraform-generator
description: "[DEV] Run the terraform-generator skill in isolation. Requires AWS_MIGRATION_DEV=true."
---

# /aws-migration-architect:dev:terraform-generator

**Development only.** Refused unless `AWS_MIGRATION_DEV=true`.

## Argument hint

`[--source-profile <name>] [--target-profile <name>] [--run-dir <path>]`

## Procedure

1. If `AWS_MIGRATION_DEV` is not `true`, halt. Point to `Use the terraform-generator skill` or `/aws-migration-architect:migrate`.
2. Parse args; require `inventory.json` + `dependency-graph.json` in run dir.
3. Verify source (and target if generating cross-account variables) profiles authenticate.
4. Run **terraform-generator** per `skills/terraform-generator/SKILL.md`. Delegate to `aws-migration-architect:terraform-builder`.
5. Run `terraform fmt` and `terraform validate` in output modules. Print `terraform/` path.
