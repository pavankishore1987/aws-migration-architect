export const meta = {
  name: 'aws-migration-architect:migrate',
  description: 'AWS account-to-account migration: inventory → deps → terraform + plan → data-migration plan → cutover checklist. Halts after the checklist for human sign-off (APPROVED BY line in cutover-checklist.md); operator then runs /aws-migration-architect:execute to apply the checklist resource-by-resource, followed by :audit.',
  whenToUse: 'When the user has two AWS profiles (source + target) configured and wants a deterministic end-to-end migration pipeline. Use :discover for a first-pass scope check, :execute after signing the checklist, :audit after execution.',
  phases: [
    { title: 'Discover',  detail: 'inventory + dependency-analyzer' },
    { title: 'Generate',  detail: 'terraform-generator + migration-planner (parallel)' },
    { title: 'DataPlan',  detail: 'data-migration-planner (sizing, strategy, transfer time, cost, freeze windows)' },
    { title: 'Cutover',   detail: 'cutover-checklist-builder (pause for human sign-off, then :execute)' },
  ],
}

// ---- Schema fragments for sub-agent validation ----
// These are deliberate sketches: the wire-level structured outputs match these
// shapes; richer per-field schemas live in /schemas/ for human inspection.

const INVENTORY_SCHEMA = {
  type: 'object',
  required: ['run_id', 'captured_at', 'source_account_id', 'resource_count', 'artifacts'],
  properties: {
    run_id:             { type: 'string' },
    captured_at:        { type: 'string' },
    source_account_id:  { type: 'string', pattern: '^[0-9]{12}$' },
    resource_count:     { type: 'integer', minimum: 0 },
    regions_scanned:    { type: 'array', items: { type: 'string' } },
    services_scanned:   { type: 'array', items: { type: 'string' } },
    services_skipped_count: { type: 'integer', minimum: 0 },
    teams_identified:   { type: 'array', items: { type: 'string' } },
    artifacts: {
      type: 'object',
      required: ['inventory', 'resource_ownership', 'unsupported_report'],
      properties: {
        inventory:          { type: 'string' },
        resource_ownership: { type: 'string' },
        unsupported_report: { type: 'string' },
      },
    },
  },
}

const DEPENDENCY_SCHEMA = {
  type: 'object',
  required: ['run_id', 'edges_count', 'iam_trusts_count', 'risk_distribution'],
  properties: {
    run_id:                          { type: 'string' },
    captured_at:                     { type: 'string' },
    edges_count:                     { type: 'integer', minimum: 0 },
    iam_trusts_count:                { type: 'integer', minimum: 0 },
    iam_trusts_needing_rework:       { type: 'integer', minimum: 0 },
    hardcoded_auto_count:            { type: 'integer', minimum: 0 },
    hardcoded_manual_count:          { type: 'integer', minimum: 0 },
    risk_distribution: {
      type: 'object',
      required: ['low', 'medium', 'high'],
      properties: {
        low:    { type: 'integer', minimum: 0 },
        medium: { type: 'integer', minimum: 0 },
        high:   { type: 'integer', minimum: 0 },
      },
    },
    diagrams: { type: 'array', items: { type: 'string' } },
  },
}

const TERRAFORM_SCHEMA = {
  type: 'object',
  required: ['run_id', 'modules_generated', 'resource_counts', 'validation', 'terraform_dir'],
  properties: {
    run_id:            { type: 'string' },
    captured_at:       { type: 'string' },
    modules_generated: { type: 'array', items: { type: 'string' } },
    resource_counts:   { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } },
    template_gaps:     { type: 'array', items: { type: 'string' } },
    skipped_count:     { type: 'integer', minimum: 0 },
    validation: {
      type: 'object',
      properties: {
        fmt:      { type: 'string' },
        init:     { type: 'string' },
        validate: { type: 'string' },
      },
    },
    terraform_dir: { type: 'string' },
  },
}

const PLAN_SCHEMA = {
  type: 'object',
  required: ['run_id', 'score', 'blockers_count', 'warnings_count', 'total_resources', 'artifacts'],
  properties: {
    run_id:                     { type: 'string' },
    score:                      { type: 'integer', minimum: 0, maximum: 100 },
    blockers_count:             { type: 'integer', minimum: 0 },
    warnings_count:             { type: 'integer', minimum: 0 },
    total_resources:            { type: 'integer', minimum: 0 },
    estimated_cutover_minutes:  { type: 'integer', minimum: 0 },
    cost_delta_steady_state:    { type: 'number' },
    halted:                     { type: ['string', 'null'] },
    artifacts: {
      type: 'object',
      required: ['cost_baseline', 'readiness_score', 'migration_plan_json', 'migration_plan_md'],
      properties: {
        cost_baseline:        { type: 'string' },
        readiness_score:      { type: 'string' },
        migration_plan_json:  { type: 'string' },
        migration_plan_md:    { type: 'string' },
      },
    },
  },
}

const DATA_PLAN_SCHEMA = {
  type: 'object',
  required: ['run_id', 'datastores_total', 'total_data_bytes', 'artifacts'],
  properties: {
    run_id:                              { type: 'string' },
    captured_at:                         { type: 'string' },
    datastores_total:                    { type: 'integer', minimum: 0 },
    datastores_by_service:               { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } },
    total_data_bytes:                    { type: 'integer', minimum: 0 },
    estimated_total_transfer_hours:      { type: 'number', minimum: 0 },
    estimated_total_transfer_cost_usd:   { type: 'number', minimum: 0 },
    estimated_double_storage_cost_usd:   { type: 'number', minimum: 0 },
    cutover_window_recommendation_hours: { type: 'number', minimum: 0 },
    critical_path_top:                   { type: ['string', 'null'] },
    blockers_count:                      { type: 'integer', minimum: 0 },
    warnings_count:                      { type: 'integer', minimum: 0 },
    artifacts: {
      type: 'object',
      required: ['data_migration_plan_json', 'data_migration_plan_md'],
      properties: {
        data_migration_plan_json: { type: 'string' },
        data_migration_plan_md:   { type: 'string' },
      },
    },
  },
}

const CONTROL_PLANE_CHECKLIST_SCHEMA = {
  type: 'object',
  required: ['run_id', 'phase_count', 'item_count', 'artifacts'],
  properties: {
    run_id:                    { type: 'string' },
    captured_at:               { type: 'string' },
    phase_count:               { type: 'integer', minimum: 7, maximum: 7 },
    item_count:                { type: 'integer', minimum: 0 },
    terraform_module_applies:  { type: 'integer', minimum: 0 },
    aws_cli_steps:             { type: 'integer', minimum: 0 },
    manual_steps:              { type: 'integer', minimum: 0 },
    approval_gate_count:       { type: 'integer', minimum: 0 },
    handoff_criteria_count:    { type: 'integer', minimum: 0 },
    artifacts: {
      type: 'object',
      required: ['cutover_checklist_control_plane_md', 'cutover_checklist_control_plane_json'],
      properties: {
        cutover_checklist_control_plane_md:   { type: 'string' },
        cutover_checklist_control_plane_json: { type: 'string' },
      },
    },
  },
}

const DATA_PLANE_CHECKLIST_SCHEMA = {
  type: 'object',
  required: ['run_id', 'phase_count', 'item_count', 'artifacts'],
  properties: {
    run_id:                  { type: 'string' },
    captured_at:             { type: 'string' },
    phase_count:             { type: 'integer', minimum: 5, maximum: 5 },
    item_count:              { type: 'integer', minimum: 0 },
    long_running_step_count: { type: 'integer', minimum: 0 },
    irreversible_step_count: { type: 'integer', minimum: 0 },
    freeze_window_count:     { type: 'integer', minimum: 0 },
    longest_freeze_minutes:  { type: 'integer', minimum: 0 },
    validation_step_count:   { type: 'integer', minimum: 0 },
    approval_gate_count:     { type: 'integer', minimum: 0 },
    artifacts: {
      type: 'object',
      required: ['cutover_checklist_data_plane_md', 'cutover_checklist_data_plane_json'],
      properties: {
        cutover_checklist_data_plane_md:   { type: 'string' },
        cutover_checklist_data_plane_json: { type: 'string' },
      },
    },
  },
}

// ---- args ----
// args = { sourceProfile, targetProfile, runId?, force?, resume? }
// Defaults pull from env if not supplied via args.

const sourceProfile = args?.sourceProfile || process.env.MIGRATION_SOURCE_PROFILE
const targetProfile = args?.targetProfile || process.env.MIGRATION_TARGET_PROFILE
const force         = args?.force === true
const runId         = args?.runId || `run-${sourceProfile || 'src'}-${targetProfile || 'tgt'}`

if (!sourceProfile || !targetProfile) {
  throw new Error(
    'MIGRATION_SOURCE_PROFILE and MIGRATION_TARGET_PROFILE must be set, ' +
    'or sourceProfile + targetProfile passed via args.'
  )
}

const root = `${process.env.AWS_MIGRATION_ROOT || '~/.aws-migration'}/runs/${sourceProfile}-to-${targetProfile}-${runId}`

log(`AWS Migration Architect — runId=${runId}`)
log(`Source profile: ${sourceProfile}`)
log(`Target profile: ${targetProfile}`)
log(`Output dir:     ${root}`)

// ---- Phase: Discover ----

phase('Discover')

const inventory = await agent(
  `Run the inventory-explorer sub-agent against profile ${sourceProfile}.

Run ID: ${runId}
Run directory: ${root}
Orchestrator mode: true (skip interactive scope-confirmation prompt; honor env vars).

Required env: MIGRATION_SOURCE_PROFILE=${sourceProfile}, MIGRATION_TARGET_PROFILE=${targetProfile}.
Optional env (honor if set): MIGRATION_REGIONS, MIGRATION_SERVICES, MIGRATION_TAG_FILTER,
                              MIGRATION_FORCE_INCLUDE, MIGRATION_OWNERSHIP_TAGS, MIGRATION_INCREMENTAL.

Emit inventory.json, resource-ownership.json, unsupported-report.md to ${root}.
Validate inventory.json against schemas/inventory.schema.json before returning.

Return the structured summary defined in your operating procedure.`,
  {
    agentType: 'aws-migration-architect:inventory-explorer',
    label:     'inventory-explorer',
    phase:     'Discover',
    schema:    INVENTORY_SCHEMA,
  }
)

if (!inventory) {
  throw new Error('Inventory failed — orchestrator halting. Re-run with --resume to retry inventory.')
}

log(`✓ Inventory: ${inventory.resource_count} resources, ${inventory.services_scanned?.length || 0} services, ${inventory.regions_scanned?.length || 0} regions`)

const dependencies = await agent(
  `Run the dependency-mapper sub-agent.

Run ID: ${runId}
Run directory: ${root}
Read ${root}/inventory.json.

Emit dependency-graph.json, hardcoded-values.json, risk-scores.json, and architecture/{vpc-topology,dependency-graph,dns-topology,iam-trust-graph}.mmd to ${root}.

Validate each output against its schema in schemas/.

Return the structured summary defined in your operating procedure.`,
  {
    agentType: 'aws-migration-architect:dependency-mapper',
    label:     'dependency-mapper',
    phase:     'Discover',
    schema:    DEPENDENCY_SCHEMA,
  }
)

if (!dependencies) {
  throw new Error('Dependency analysis failed — orchestrator halting.')
}

log(`✓ Dependencies: ${dependencies.edges_count} edges, ${dependencies.iam_trusts_needing_rework}/${dependencies.iam_trusts_count} IAM trusts need rework, ${dependencies.risk_distribution.high} high-risk resources`)

// ---- Phase: Generate ----

phase('Generate')

const [terraform, plan] = await parallel([
  () => agent(
    `Run the terraform-builder sub-agent.

Run ID: ${runId}
Run directory: ${root}
Read ${root}/inventory.json, ${root}/dependency-graph.json, ${root}/hardcoded-values.json.

Generate Terraform modules under ${root}/terraform/{root,iam,networking,storage,databases,compute,dns}/.
Run terraform fmt -recursive and terraform validate in ${root}/terraform/root.

Emit a generation report at ${root}/terraform/.generation-report.md.
Return the structured summary defined in your operating procedure.`,
    {
      agentType: 'aws-migration-architect:terraform-builder',
      label:     'terraform-builder',
      phase:     'Generate',
      schema:    TERRAFORM_SCHEMA,
    }
  ),
  () => agent(
    `Run the migration-planner sub-agent.

Run ID: ${runId}
Run directory: ${root}
Orchestrator mode: true. Force: ${force}.

Read ${root}/inventory.json, ${root}/dependency-graph.json, ${root}/risk-scores.json,
${root}/hardcoded-values.json, ${root}/resource-ownership.json.

Source profile: ${sourceProfile}
Target profile: ${targetProfile}

Emit IN THIS ORDER (per skill operating procedure):
  1. ${root}/cost-baseline.json
  2. ${root}/readiness-score.json   (halt if score < 50 and not force)
  3. ${root}/migration-plan.json    (only if not halted)
  4. ${root}/migration-plan.md      (only if not halted)

If you halt due to low readiness, return { halted: "low_readiness", score: N, ... } and the orchestrator will surface that.

Return the structured summary defined in your operating procedure.`,
    {
      agentType: 'aws-migration-architect:migration-planner',
      label:     'migration-planner',
      phase:     'Generate',
      schema:    PLAN_SCHEMA,
    }
  ),
])

if (!terraform || !plan) {
  throw new Error('Generate phase failed — orchestrator halting.')
}

log(`✓ Terraform: ${Object.values(terraform.resource_counts || {}).reduce((a, b) => a + b, 0)} resources generated, validation=${terraform.validation?.validate || 'unknown'}`)

if (plan.halted === 'low_readiness') {
  log(`⚠ Readiness score ${plan.score}/100 is below 50 — HALTING.`)
  log(`  Blockers: ${plan.blockers_count}, warnings: ${plan.warnings_count}`)
  log(`  Review ${plan.artifacts.readiness_score} and ${root}/migration-plan.md (if generated).`)
  log(`  To force-continue: re-run /aws-migration-architect:migrate with --force.`)
  return {
    runId,
    root,
    halted: 'low_readiness',
    readiness_score: plan.score,
    blockers: plan.blockers_count,
    artifacts: { ...inventory.artifacts, ...plan.artifacts, terraform_dir: terraform.terraform_dir },
  }
}

log(`✓ Plan: score ${plan.score}/100, ${plan.blockers_count} blockers, ${plan.warnings_count} warnings, ${Math.round((plan.estimated_cutover_minutes || 0) / 60)}h cutover window`)

// ---- Phase: DataPlan ----

phase('DataPlan')

const dataPlan = await agent(
  `Run the data-migration-planner sub-agent.

Run ID: ${runId}
Run directory: ${root}
Source profile: ${sourceProfile}
Target profile: ${targetProfile}

Read ${root}/inventory.json, ${root}/dependency-graph.json, ${root}/cost-baseline.json,
${root}/resource-ownership.json, ${root}/hardcoded-values.json.

For every data-bearing resource (S3, RDS, DynamoDB, EFS/FSx, EBS-with-data, ECR, Redshift, ElastiCache-with-persistence):
  1. Size via CloudWatch + describe APIs (read-only)
  2. Pick transfer tool + mode by the rules in the skill
  3. Capture encryption requirements (KMS grants, re-encryption)
  4. Estimate wall-clock time using per-tool throughput model (set confidence)
  5. Price via awspricing MCP (egress, tool runtime, double-storage, validation)
  6. Apply RPO/RTO defaults by criticality tier (env: MIGRATION_CRITICALITY_TAG, MIGRATION_RPO_DEFAULT_MINUTES, MIGRATION_RTO_DEFAULT_MINUTES)
  7. Compute freeze windows for non-continuous strategies
  8. Define validation methods + acceptance criteria
  9. Rollback retention per tier
 10. Bandwidth + sequencing

Emit:
  - ${root}/data-migration-plan.json   (validates against schemas/data-migration-plan.schema.json)
  - ${root}/data-migration-plan.md

Return the structured summary defined in your operating procedure.`,
  {
    agentType: 'aws-migration-architect:data-migration-planner',
    label:     'data-migration-planner',
    phase:     'DataPlan',
    schema:    DATA_PLAN_SCHEMA,
  }
)

if (!dataPlan) {
  throw new Error('Data migration planning failed — orchestrator halting.')
}

log(`✓ DataPlan: ${dataPlan.datastores_total} datastores, ${(dataPlan.total_data_bytes / 1e12).toFixed(2)} TB total, ${dataPlan.estimated_total_transfer_hours.toFixed(1)}h estimated, $${Math.round(dataPlan.estimated_total_transfer_cost_usd)} transfer cost, ${dataPlan.cutover_window_recommendation_hours}h recommended window`)

if (dataPlan.blockers_count > 0 && !force) {
  log(`⚠ Data plan has ${dataPlan.blockers_count} blocker(s) — HALTING.`)
  log(`  Common blockers: external KMS keys (cannot grant), RPO=0 paired with bulk-mode strategy.`)
  log(`  Review ${dataPlan.artifacts.data_migration_plan_md} and resolve, or re-run with --force.`)
  return {
    runId,
    root,
    halted: 'data_plan_blockers',
    blockers_count: dataPlan.blockers_count,
    artifacts: {
      ...inventory.artifacts,
      ...plan.artifacts,
      terraform_dir:       terraform.terraform_dir,
      data_migration_plan: dataPlan.artifacts.data_migration_plan_md,
    },
  }
}

// ---- Phase: Cutover ----

phase('Cutover')

const [controlPlaneChecklist, dataPlaneChecklist] = await parallel([
  () => agent(
    `Run the cutover-control-plane-builder sub-agent.

Run ID: ${runId}
Run directory: ${root}
Source account: ${sourceProfile} ; Target account: ${targetProfile}

Read ${root}/migration-plan.json, ${root}/resource-ownership.json,
${root}/dependency-graph.json, ${root}/hardcoded-values.json.
Also read ${root}/data-migration-plan.json (to know which DBs need empty target containers vs which will appear via snapshot-restore).
List ${root}/terraform/ to know which modules exist.

Emit:
  - ${root}/cutover-checklist-control-plane.md   (printable human runbook)
  - ${root}/cutover-checklist-control-plane.json (machine-readable for the executor)

7 phases: 0 Globals → 1 Networking → 2 Storage Containers → 3 Database Containers → 4 Compute Containers → 5 DNS Scaffolding → 6 Control Plane Validation.

NO data movement, NO freeze windows, NO production DNS swaps, NO terraform -target= per resource. Terraform applies are module-level only.

Validate against schemas/cutover-checklist-control-plane.schema.json.
Return the structured summary defined in your operating procedure.`,
    {
      agentType: 'aws-migration-architect:cutover-control-plane-builder',
      label:     'cutover-control-plane-builder',
      phase:     'Cutover',
      schema:    CONTROL_PLANE_CHECKLIST_SCHEMA,
    }
  ),
  () => agent(
    `Run the cutover-data-plane-builder sub-agent.

Run ID: ${runId}
Run directory: ${root}
Source account: ${sourceProfile} ; Target account: ${targetProfile}

Primary input: ${root}/data-migration-plan.json (sizing, strategy, freeze windows, validation criteria).
Also read ${root}/migration-plan.json, ${root}/resource-ownership.json,
${root}/dependency-graph.json, ${root}/hardcoded-values.json.

Emit:
  - ${root}/cutover-checklist-data-plane.md   (printable human runbook)
  - ${root}/cutover-checklist-data-plane.json (machine-readable for the executor)

5 phases: 1 Pre-Staging → 2 Bulk Transfers → 3 Application Data → 4 Cutover (freeze + promote + swap) → 5 Data Validation.

NO terraform applies, NO IAM creation (except kms-grant). Every freeze window in freeze_windows[] aggregates from data-migration-plan.json. Mark route53 traffic changes and DMS-promote as irreversible: true.

Validate against schemas/cutover-checklist-data-plane.schema.json.
Return the structured summary defined in your operating procedure.`,
    {
      agentType: 'aws-migration-architect:cutover-data-plane-builder',
      label:     'cutover-data-plane-builder',
      phase:     'Cutover',
      schema:    DATA_PLANE_CHECKLIST_SCHEMA,
    }
  ),
])

if (!controlPlaneChecklist || !dataPlaneChecklist) {
  throw new Error('Cutover checklist generation failed — orchestrator halting (control or data plane).')
}

log(``)
log(`╔══════════════════════════════════════════════════════════════════╗`)
log(`║  Cutover checklists ready (control plane + data plane)           ║`)
log(`╠══════════════════════════════════════════════════════════════════╣`)
log(`║  Control plane:  ${controlPlaneChecklist.artifacts.cutover_checklist_control_plane_md}`)
log(`║    Items: ${controlPlaneChecklist.item_count} · Terraform applies: ${controlPlaneChecklist.terraform_module_applies ?? 0} · Gates: ${controlPlaneChecklist.approval_gate_count}`)
log(`║  Data plane:     ${dataPlaneChecklist.artifacts.cutover_checklist_data_plane_md}`)
log(`║    Items: ${dataPlaneChecklist.item_count} · Long-running: ${dataPlaneChecklist.long_running_step_count ?? 0} · Irreversible: ${dataPlaneChecklist.irreversible_step_count ?? 0} · Freezes: ${dataPlaneChecklist.freeze_window_count ?? 0} · Gates: ${dataPlaneChecklist.approval_gate_count}`)
log(`╠══════════════════════════════════════════════════════════════════╣`)
log(`║  ORCHESTRATOR PAUSING — both checklists need human sign-off.     ║`)
log(`║  1) Read BOTH checklists + data-migration-plan.md end-to-end.    ║`)
log(`║  2) Add APPROVED BY: <name> ON: <YYYY-MM-DD> near the top of     ║`)
log(`║     EACH checklist (control plane and data plane).               ║`)
log(`║  3) Run:                                                         ║`)
log(`║       /aws-migration-architect:execute --run-id ${runId}`)
log(`║     The executor walks control-plane first (target IAM:          ║`)
log(`║     target-cutover-control-plane.json), then data-plane (also    ║`)
log(`║     attach target-cutover-data-plane.json).                      ║`)
log(`║  4) After execute completes:                                     ║`)
log(`║       /aws-migration-architect:audit --run-id ${runId}`)
log(`╚══════════════════════════════════════════════════════════════════╝`)

return {
  runId,
  root,
  source_account_id:  inventory.source_account_id,
  resource_count:     inventory.resource_count,
  readiness_score:    plan.score,
  cost_delta_monthly: plan.cost_delta_steady_state,
  artifacts: {
    inventory:           inventory.artifacts.inventory,
    resource_ownership:  inventory.artifacts.resource_ownership,
    unsupported_report:  inventory.artifacts.unsupported_report,
    dependency_graph:    `${root}/dependency-graph.json`,
    hardcoded_values:    `${root}/hardcoded-values.json`,
    risk_scores:         `${root}/risk-scores.json`,
    architecture_dir:    `${root}/architecture/`,
    terraform_dir:       terraform.terraform_dir,
    cost_baseline:       plan.artifacts.cost_baseline,
    readiness_score:     plan.artifacts.readiness_score,
    migration_plan:      plan.artifacts.migration_plan_md,
    data_migration_plan:           dataPlan.artifacts.data_migration_plan_md,
    cutover_checklist_control_plane: controlPlaneChecklist.artifacts.cutover_checklist_control_plane_md,
    cutover_checklist_data_plane:    dataPlaneChecklist.artifacts.cutover_checklist_data_plane_md,
  },
  next_step: `Sign cutover-checklist.md (APPROVED BY line), then run /aws-migration-architect:execute --run-id ${runId}, then /aws-migration-architect:audit --run-id ${runId}.`,
}
