export const meta = {
  name: 'aws-migration-architect:audit',
  description: 'Compare source and target AWS accounts post-cutover. Re-runs the same scope against both profiles, structurally diffs, categorizes drift (missing/extra/config/security/cost/scope), emits audit-diff.json + audit-report.md. Use after the human-driven cutover to verify parity.',
  whenToUse: 'After the cutover is complete. Also useful for periodic drift detection during parallel-run periods, or for comparing any two AWS accounts that should be equivalent.',
  phases: [{ title: 'Audit', detail: 'post-migration-auditor' }],
}

const AUDIT_SCHEMA = {
  type: 'object',
  required: ['run_id', 'verdict', 'summary', 'artifacts'],
  properties: {
    run_id:            { type: 'string' },
    captured_at:       { type: 'string' },
    source_account_id: { type: 'string', pattern: '^[0-9]{12}$' },
    target_account_id: { type: 'string', pattern: '^[0-9]{12}$' },
    verdict:           { type: 'string', enum: ['clean', 'minor-drift', 'significant-drift', 'failed'] },
    summary: {
      type: 'object',
      required: ['total_resources_in_source_scope', 'matches'],
      properties: {
        total_resources_in_source_scope: { type: 'integer', minimum: 0 },
        matches:                          { type: 'integer', minimum: 0 },
        drift_count_by_category: {
          type: 'object',
          properties: {
            missing_in_target: { type: 'integer', minimum: 0 },
            extra_in_target:   { type: 'integer', minimum: 0 },
            config_drift:      { type: 'integer', minimum: 0 },
            security_drift:    { type: 'integer', minimum: 0 },
            cost_drift:        { type: 'integer', minimum: 0 },
            scope_drift:       { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    artifacts: {
      type: 'object',
      required: ['audit_diff_json', 'audit_report_md'],
      properties: {
        audit_diff_json: { type: 'string' },
        audit_report_md: { type: 'string' },
      },
    },
  },
}

const sourceProfile = args?.sourceProfile || process.env.MIGRATION_SOURCE_PROFILE
const targetProfile = args?.targetProfile || process.env.MIGRATION_TARGET_PROFILE
const runId         = args?.runId

if (!sourceProfile || !targetProfile) {
  throw new Error(
    'MIGRATION_SOURCE_PROFILE and MIGRATION_TARGET_PROFILE must be set, ' +
    'or sourceProfile + targetProfile passed via args.'
  )
}

if (!runId) {
  throw new Error(
    'audit needs a runId to locate the source-side inventory.json. ' +
    'Pass via args.runId or use the run-id printed by /aws-migration-architect:migrate.'
  )
}

const root = `${process.env.AWS_MIGRATION_ROOT || '~/.aws-migration'}/runs/${sourceProfile}-to-${targetProfile}-${runId}`

log(`AWS Migration Architect — audit — runId=${runId}`)
log(`Source: ${sourceProfile}`)
log(`Target: ${targetProfile}`)
log(`Run dir: ${root}`)

phase('Audit')

const audit = await agent(
  `Run the post-migration-auditor sub-agent.

Run ID: ${runId}
Run directory: ${root}
Source profile: ${sourceProfile}
Target profile: ${targetProfile}

Read ${root}/inventory.json — this is the expected baseline.

Re-inventory target with the SAME scope (regions, services, tag filter) as source-side inventory.coverage.

Match resources by stable identity. Normalize ARNs / timestamps / IDs. Structurally diff.

Categorize each finding:
  - missing_in_target | extra_in_target | config_drift | security_drift | cost_drift | scope_drift

Emit:
  - ${root}/audit-diff.json
  - ${root}/audit-report.md

Validate audit-diff.json against schemas/audit-diff.schema.json.

Return the structured summary defined in your operating procedure.`,
  {
    agentType: 'aws-migration-architect:post-migration-auditor',
    label:     'post-migration-auditor',
    phase:     'Audit',
    schema:    AUDIT_SCHEMA,
  }
)

if (!audit) {
  throw new Error('Audit failed — orchestrator halting. Check both profiles authenticate.')
}

const drift = audit.summary.drift_count_by_category || {}
log(``)
log(`╔══════════════════════════════════════════════════════════════════╗`)
log(`║  Audit verdict: ${audit.verdict.toUpperCase().padEnd(48)} ║`)
log(`╠══════════════════════════════════════════════════════════════════╣`)
log(`║  Matched:           ${audit.summary.matches} / ${audit.summary.total_resources_in_source_scope}`)
log(`║  Missing in target: ${drift.missing_in_target ?? 0}`)
log(`║  Extra in target:   ${drift.extra_in_target ?? 0}`)
log(`║  Config drift:      ${drift.config_drift ?? 0}`)
log(`║  Security drift:    ${drift.security_drift ?? 0}`)
log(`║  Cost drift:        ${drift.cost_drift ?? 0}`)
log(`║  Scope drift:       ${drift.scope_drift ?? 0}`)
log(`╠══════════════════════════════════════════════════════════════════╣`)
log(`║  Report: ${audit.artifacts.audit_report_md}`)
log(`╚══════════════════════════════════════════════════════════════════╝`)

if (audit.verdict === 'clean') {
  log(`✓ Migration verified complete — zero drift detected.`)
} else if (audit.verdict === 'minor-drift') {
  log(`✓ Migration mostly complete — review warnings in audit-report.md.`)
} else if (audit.verdict === 'significant-drift') {
  log(`⚠ Significant drift — review audit-report.md before declaring migration done.`)
} else {
  log(`✗ Audit failed — both profiles must authenticate; re-check credentials.`)
}

return {
  runId,
  root,
  verdict:           audit.verdict,
  source_account_id: audit.source_account_id,
  target_account_id: audit.target_account_id,
  matched:           audit.summary.matches,
  expected:          audit.summary.total_resources_in_source_scope,
  drift:             drift,
  artifacts: {
    audit_diff_json: audit.artifacts.audit_diff_json,
    audit_report_md: audit.artifacts.audit_report_md,
  },
}
