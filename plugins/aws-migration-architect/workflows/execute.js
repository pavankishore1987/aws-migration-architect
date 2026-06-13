export const meta = {
  name: 'aws-migration-architect:execute',
  description: 'Execute an already-approved cutover-checklist.md against the target account, one resource at a time, with mandatory per-step human approval and a resumable JSONL journal. Halts and offers rollback on failure. Polls long-running data-plane jobs (DataSync, DMS, S3 Batch, DynamoDB export/import).',
  whenToUse: 'After /aws-migration-architect:migrate has produced cutover-checklist.md AND the human has read and signed it (APPROVED BY line in the file). Or to resume a halted prior execution via args.resume=true.',
  phases: [
    { title: 'Execute', detail: 'cutover-executor (per-step approval, resumable)' },
  ],
}

const EXECUTION_SCHEMA = {
  type: 'object',
  required: ['run_id', 'verdict', 'steps_total', 'artifacts'],
  properties: {
    run_id:            { type: 'string' },
    verdict:           { type: 'string', enum: ['completed', 'halted', 'aborted', 'failed'] },
    steps_total:       { type: 'integer', minimum: 0 },
    steps_succeeded:   { type: 'integer', minimum: 0 },
    steps_skipped:     { type: 'integer', minimum: 0 },
    steps_failed:      { type: 'integer', minimum: 0 },
    halt_step_id:      { type: ['string', 'null'] },
    halt_reason:       { type: ['string', 'null'] },
    elapsed_seconds:   { type: 'integer', minimum: 0 },
    approvals_requested: { type: 'integer', minimum: 0 },
    approvals_given:     { type: 'integer', minimum: 0 },
    artifacts: {
      type: 'object',
      required: ['execution_steps_json', 'execution_log_jsonl', 'execution_report_md'],
      properties: {
        execution_steps_json:    { type: 'string' },
        execution_log_jsonl:     { type: 'string' },
        execution_summary_json:  { type: 'string' },
        execution_report_md:     { type: 'string' },
      },
    },
  },
}

const sourceProfile = args?.sourceProfile || process.env.MIGRATION_SOURCE_PROFILE
const targetProfile = args?.targetProfile || process.env.MIGRATION_TARGET_PROFILE
const runId         = args?.runId
const resume        = args?.resume === true

if (!sourceProfile || !targetProfile) {
  throw new Error(
    'MIGRATION_SOURCE_PROFILE and MIGRATION_TARGET_PROFILE must be set, ' +
    'or sourceProfile + targetProfile passed via args.'
  )
}

if (!runId) {
  throw new Error(
    'execute needs a runId to locate the prior run directory. ' +
    'Pass via args.runId or use the run-id printed by /aws-migration-architect:migrate.'
  )
}

const root = `${process.env.AWS_MIGRATION_ROOT || '~/.aws-migration'}/runs/${sourceProfile}-to-${targetProfile}-${runId}`

log(`AWS Migration Architect — execute — runId=${runId}`)
log(`Source: ${sourceProfile}`)
log(`Target: ${targetProfile}`)
log(`Run dir: ${root}`)
log(`Resume:  ${resume}`)

phase('Execute')

const execution = await agent(
  `Run the cutover-executor sub-agent.

Run ID: ${runId}
Run directory: ${root}
Source profile: ${sourceProfile}
Target profile: ${targetProfile}
Resume mode: ${resume}

Inputs to read from ${root}:
  - cutover-checklist.json (REQUIRED — execution source of truth)
  - cutover-checklist.md   (must contain a human "APPROVED BY: <name> ON: <date>" line near the top; refuse to run if missing)
  - migration-plan.json    (rollback steps come from phases[N].rollback.steps[])
  - dependency-graph.json  (for placeholder expansion in command templates)
  - hardcoded-values.json  (any resource in manual_review_required[] forces approval_required: true)
  - resource-ownership.json
  - terraform/             (terraform-apply steps target -target=<addr> here)

Behavior:
  1. Pre-flight: verify both profiles, terraform init+validate, and the APPROVED BY line.
  2. Compile execution-steps.json (validate against schemas/execution-step.schema.json).
  3. Print plan summary and ask the operator go/no-go.
  4. Walk steps in dependency order with per-step approve/skip/abort prompt.
     - Long-running steps (DataSync, DMS, S3 Batch, DynamoDB export/import): poll instead of block.
  5. On any failure: enter the rollback dialog (retry / rollback / abort).
  6. ${resume
    ? 'RESUME mode: read existing execution-log.jsonl, re-verify any in-flight step against AWS, continue from the next pending step.'
    : 'Fresh run: refuse if execution-log.jsonl already exists (operator must pass --resume to continue or move the prior journal aside).'}

Emit to ${root}:
  - execution-steps.json  (validates against schemas/execution-step.schema.json)
  - execution-log.jsonl   (append-only journal; validates as {metadata, entries} against schemas/execution-log.schema.json)
  - execution-summary.json (the summary object; written at end-of-run)
  - execution-report.md   (human-readable report)
  - execution/<step_id>.stdout.log, .stderr.log per executed step

Per-step approval is mandatory. Do not batch. Do not auto-retry. Do not skip the rollback dialog on failure.

Return the structured summary defined in your operating procedure.`,
  {
    agentType: 'aws-migration-architect:cutover-executor',
    label:     'cutover-executor',
    phase:     'Execute',
    schema:    EXECUTION_SCHEMA,
  }
)

if (!execution) {
  throw new Error('Executor failed to return a summary — check execution-log.jsonl for the last recorded state.')
}

log(``)
log(`╔══════════════════════════════════════════════════════════════════╗`)
log(`║  Execution verdict: ${execution.verdict.toUpperCase().padEnd(44)} ║`)
log(`╠══════════════════════════════════════════════════════════════════╣`)
log(`║  Steps total:       ${execution.steps_total}`)
log(`║  Succeeded:         ${execution.steps_succeeded ?? 0}`)
log(`║  Skipped:           ${execution.steps_skipped ?? 0}`)
log(`║  Failed:            ${execution.steps_failed ?? 0}`)
log(`║  Approvals:         ${execution.approvals_given ?? 0} / ${execution.approvals_requested ?? 0}`)
log(`║  Elapsed:           ${execution.elapsed_seconds ?? 0}s`)
if (execution.halt_step_id) {
  log(`║  Halted at:         ${execution.halt_step_id}`)
  log(`║  Halt reason:       ${execution.halt_reason || ''}`)
}
log(`╠══════════════════════════════════════════════════════════════════╣`)
log(`║  Report:  ${execution.artifacts.execution_report_md}`)
log(`║  Journal: ${execution.artifacts.execution_log_jsonl}`)
log(`╚══════════════════════════════════════════════════════════════════╝`)

if (execution.verdict === 'completed') {
  log(`✓ Cutover executed successfully. Next: /aws-migration-architect:audit --run-id ${runId}`)
} else if (execution.verdict === 'halted') {
  log(`⚠ Execution halted at ${execution.halt_step_id}. To resume: /aws-migration-architect:execute --run-id ${runId} --resume`)
} else if (execution.verdict === 'aborted') {
  log(`⚠ Execution aborted by operator. Review ${execution.artifacts.execution_report_md} before retrying.`)
} else {
  log(`✗ Execution failed. Review ${execution.artifacts.execution_report_md} and the stderr log for the failed step.`)
}

return {
  runId,
  root,
  verdict:          execution.verdict,
  steps_total:      execution.steps_total,
  steps_succeeded:  execution.steps_succeeded,
  steps_skipped:    execution.steps_skipped,
  steps_failed:     execution.steps_failed,
  halt_step_id:     execution.halt_step_id,
  halt_reason:      execution.halt_reason,
  artifacts:        execution.artifacts,
  next_step: execution.verdict === 'completed'
    ? `Run /aws-migration-architect:audit --run-id ${runId} to verify source/target parity.`
    : execution.verdict === 'halted'
      ? `Resume with /aws-migration-architect:execute --run-id ${runId} --resume.`
      : `Review execution-report.md and decide whether to retry, resume, or roll back manually.`,
}
