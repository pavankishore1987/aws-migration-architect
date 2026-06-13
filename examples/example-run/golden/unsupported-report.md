# Services in source account NOT covered by MVP

The migration plugin scanned the source account and found the following services with at least one resource that the MVP does **not** generate Terraform or a migration plan for. The user must plan these resources manually.

## SageMaker (1 resource)

- Notebook instance `ml-experiments-notebook` (us-east-1) — dev environment, Project=ml-research

**Recommended action:**
- Re-deploy via SageMaker Studio in the target account. Notebook instance state (installed packages, in-progress notebooks) is not portable — back up notebooks to git or S3 before decommissioning the source.
- If using lifecycle configurations, those need to be re-created.

## CloudFormation stacks (2 stacks — flag-only; NEVER auto-converted to HCL)

A CFN stack is a wrapper, not a migratable resource. The plugin inventories the underlying resources individually (they appear under their own services in `inventory.json`, each tagged with `provider_specific.aws.cfn_stack_owner = "<stack-name>"`) but **does not auto-generate Terraform for any CFN-managed resource** — that would conflict with the stack's drift detection.

- `orders-api-base` (us-east-1) — 47 resources, CREATE_COMPLETE
- `orders-monitoring` (us-east-1) — 12 resources, CREATE_COMPLETE

**Recommended action per stack** (record your choice in `cloudformation-decisions.md` in the run directory):

1. **Re-deploy the CFN stack natively in target** — `cloudformation create-stack` in target with the same template (`cloudformation get-template --stack-name <name>`). Some resources (KMS keys, RDS instances) will be new in target either way. The plugin will skip generating HCL for everything the stack owns.
2. **Port to Terraform** — drop the stack source-side, let the generator emit HCL by setting `MIGRATION_CFN_IMPORT_STACKS=<stack>`, follow up with `terraform import` per resource in target. Slower but consolidates IaC on Terraform.
3. **Re-implement in target** — re-build manually; useful when the CFN template is stale or poorly understood.

The `migration-plan.md` will not order these resources until you record a decision per stack.

## Cost Explorer anomaly monitors (1 monitor — covered but flag-only)

- `orders-spend-monitor` (global) — DIMENSIONAL/SERVICE

**Recommended action:** Not on the migration critical path. Anomaly *history* does not transfer to the target. Recreate via console OR enable the optional `ce/anomaly-monitor.hcl.tmpl` template; either way the target starts with a fresh baseline.

## Direct Connect / Transit Gateway peering / RAM-shared resources

None detected in this example. If your real account has these, expect them in the unsupported list — cross-account network topology needs to be coordinated outside this plugin.

---

**Why these aren't in MVP:** Each unsupported service needs its own `aws describe-*` handler + HCL template + JSON normalization logic. Coverage grows over time, but each addition is its own change. Add a GitHub issue if a service important to your migration is missing.
