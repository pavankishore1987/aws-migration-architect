# Services in source account NOT covered by MVP

The migration plugin scanned the source account and found the following services with at least one resource that the MVP does **not** generate Terraform or a migration plan for. The user must plan these resources manually.

## SageMaker (1 resource)

- Notebook instance `ml-experiments-notebook` (us-east-1) — dev environment, Project=ml-research

**Recommended action:**
- Re-deploy via SageMaker Studio in the target account. Notebook instance state (installed packages, in-progress notebooks) is not portable — back up notebooks to git or S3 before decommissioning the source.
- If using lifecycle configurations, those need to be re-created.

## CloudFormation stacks (2 stacks)

- `orders-api-base` (us-east-1) — 47 resources, CREATE_COMPLETE
- `orders-monitoring` (us-east-1) — 12 resources, CREATE_COMPLETE

**Recommended action per stack:**
Decide one of:
1. **Port to Terraform** — `cloudformation get-template`, hand-port, then `terraform import` the resources in target. The generated `terraform/` directory in this run did NOT auto-convert these.
2. **Re-deploy as CFN in target** — `cloudformation create-stack` in target with the same template. Some resources (KMS keys, RDS instances) will be new in target either way.
3. **Re-implement in target** — drop the CFN stack pattern, re-build the resources in Terraform alongside the rest of the migration.

The `migration-plan.md` will not order these resources until you record a decision in `cloudformation-decisions.md` (file the user creates manually).

## Direct Connect / Transit Gateway peering / RAM-shared resources

None detected in this example. If your real account has these, expect them in the unsupported list — cross-account network topology needs to be coordinated outside this plugin.

---

**Why these aren't in MVP:** Each unsupported service needs its own `aws describe-*` handler + HCL template + JSON normalization logic. Coverage grows over time, but each addition is its own change. Add a GitHub issue if a service important to your migration is missing.
