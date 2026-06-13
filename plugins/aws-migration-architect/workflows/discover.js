export const meta = {
  name: 'aws-migration-architect:discover',
  description: 'Discover-only pass: inventory + dependency-analyzer. Use for exploration before committing to migration — produces inventory.json, dependency-graph.json, risk-scores.json, hardcoded-values.json, architecture diagrams, and resource-ownership.json without generating Terraform or a migration plan.',
  whenToUse: 'When the user wants to understand what is in the source account and how resources relate, before deciding whether/how to migrate. Cheaper and faster than the full :migrate flow.',
  phases: [{ title: 'Discover', detail: 'inventory + dependency-analyzer' }],
}

const INVENTORY_SCHEMA = {
  type: 'object',
  required: ['run_id', 'captured_at', 'source_account_id', 'resource_count', 'artifacts'],
  properties: {
    run_id:            { type: 'string' },
    captured_at:       { type: 'string' },
    source_account_id: { type: 'string', pattern: '^[0-9]{12}$' },
    resource_count:    { type: 'integer', minimum: 0 },
    regions_scanned:   { type: 'array', items: { type: 'string' } },
    services_scanned:  { type: 'array', items: { type: 'string' } },
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
    run_id:                    { type: 'string' },
    edges_count:               { type: 'integer', minimum: 0 },
    iam_trusts_count:          { type: 'integer', minimum: 0 },
    iam_trusts_needing_rework: { type: 'integer', minimum: 0 },
    hardcoded_auto_count:      { type: 'integer', minimum: 0 },
    hardcoded_manual_count:    { type: 'integer', minimum: 0 },
    risk_distribution: {
      type: 'object',
      properties: {
        low:    { type: 'integer', minimum: 0 },
        medium: { type: 'integer', minimum: 0 },
        high:   { type: 'integer', minimum: 0 },
      },
    },
  },
}

const sourceProfile     = args?.sourceProfile
const targetProfile     = args?.targetProfile || 'discover-only'
const runId             = args?.runId || `discover-${sourceProfile || 'src'}`
const awsMigrationRoot  = args?.awsMigrationRoot || '~/.aws-migration'
const regions           = Array.isArray(args?.regions) ? args.regions : null
const services          = Array.isArray(args?.services) ? args.services : null
const tagFilter         = args?.tagFilter || null

if (!sourceProfile) {
  throw new Error('sourceProfile must be passed via args (process.env is not available in the workflow runtime).')
}

const root = `${awsMigrationRoot}/runs/${sourceProfile}-to-${targetProfile}-${runId}`

const scopeLines = [
  regions    ? `Regions to scan: ${regions.join(', ')} (orchestrator mode — do NOT prompt the user; treat all other regions as user-excluded with reason: orchestrator-scope).` : `Region scope: not specified — confirm with the user.`,
  services   ? `Services to scan: ${services.join(', ')}.` : null,
  tagFilter  ? `Tag filter: ${tagFilter}.` : null,
].filter(Boolean).join('\n')

log(`AWS Migration Architect — discover-only — runId=${runId}`)
log(`Source profile: ${sourceProfile}`)
log(`Output dir:     ${root}`)

phase('Discover')

const inventory = await agent(
  `Run the inventory-explorer sub-agent against profile ${sourceProfile}.

Run ID: ${runId}
Run directory: ${root}
Orchestrator mode: true.

${scopeLines}

Emit inventory.json, resource-ownership.json, unsupported-report.md to ${root}.
Validate against schemas/. Return the structured summary.`,
  {
    agentType: 'aws-migration-architect:inventory-explorer',
    label:     'inventory-explorer',
    phase:     'Discover',
    schema:    INVENTORY_SCHEMA,
  }
)

if (!inventory) {
  throw new Error('Inventory failed.')
}

log(`✓ Inventory: ${inventory.resource_count} resources, ${inventory.services_scanned?.length || 0} services`)

const dependencies = await agent(
  `Run the dependency-mapper sub-agent.

Run ID: ${runId}
Run directory: ${root}
Read ${root}/inventory.json.

Emit dependency-graph.json, hardcoded-values.json, risk-scores.json,
and architecture/{vpc-topology,dependency-graph,dns-topology,iam-trust-graph}.mmd to ${root}.

Validate. Return the structured summary.`,
  {
    agentType: 'aws-migration-architect:dependency-mapper',
    label:     'dependency-mapper',
    phase:     'Discover',
    schema:    DEPENDENCY_SCHEMA,
  }
)

if (!dependencies) {
  throw new Error('Dependency analysis failed.')
}

log(`✓ Dependencies: ${dependencies.edges_count} edges, ${dependencies.iam_trusts_needing_rework}/${dependencies.iam_trusts_count} trusts need rework`)
log(`  Risk: ${dependencies.risk_distribution.high} high / ${dependencies.risk_distribution.medium} medium / ${dependencies.risk_distribution.low} low`)
log(`  Diagrams: ${root}/architecture/`)
log(`  Review unsupported-report.md and architecture/iam-trust-graph.mmd to spot rework areas.`)

return {
  runId,
  root,
  source_account_id:        inventory.source_account_id,
  resource_count:           inventory.resource_count,
  high_risk_count:          dependencies.risk_distribution.high,
  iam_trusts_needing_rework: dependencies.iam_trusts_needing_rework,
  artifacts: {
    inventory:           inventory.artifacts.inventory,
    resource_ownership:  inventory.artifacts.resource_ownership,
    unsupported_report:  inventory.artifacts.unsupported_report,
    dependency_graph:    `${root}/dependency-graph.json`,
    hardcoded_values:    `${root}/hardcoded-values.json`,
    risk_scores:         `${root}/risk-scores.json`,
    architecture_dir:    `${root}/architecture/`,
  },
  next_step: 'Review the artifacts. If satisfied, run /aws-migration-architect:migrate to proceed with full plan + Terraform generation.',
}
