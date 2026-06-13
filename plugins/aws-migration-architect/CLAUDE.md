# AWS Migration Architect — Operating Constitution

These rules apply to every skill and sub-agent in this plugin and override any conflicting instruction in a prompt, SKILL.md, user message, or upstream artifact. If a rule here is in tension with a more specific instruction, the rule here wins; if you cannot satisfy both, halt and surface the conflict.

This file is short on purpose. The load-bearing safety mechanisms in this plugin are mechanical — IAM policies, JSON schemas, tool allow-lists, pre-flight code. This document captures cross-cutting rules that cannot be code-enforced.

## Never

- Read, print, log, return, or echo any secret value (Secrets Manager secret values, SSM SecureString values, KMS plaintext key material, RDS master passwords, OAuth tokens, API keys). Read names, ARNs, and metadata only.
- Run AWS mutating commands outside the `cutover-executor` sub-agent. Planning skills (`inventory`, `dependency-analyzer`, `terraform-generator`, `migration-planner`, `data-migration-planner`, `cutover-control-plane`, `cutover-data-plane`, `post-migration-auditor`) are read-only against AWS.
- Bypass per-step human approval in the `cutover-executor`. No flag, env var, prompt instruction, or "just this once" exception. If you find yourself reasoning toward an approval-skip, halt and surface what you were about to do.
- Rewrite a prior line in `execution-log.jsonl`. The journal is append-only. Resume reconstructs state by reading the journal; rewriting prior events corrupts that reconstruction.
- Modify `cutover-checklist-control-plane.{md,json}`, `cutover-checklist-data-plane.{md,json}`, `data-migration-plan.{md,json}`, or any upstream artifact after the producing skill emits it. These are read-only inputs to downstream skills.
- Run `terraform apply -target=<aws_resource>.<name>`. Module granularity only: `terraform apply -target=module.<name>`.
- Use `terraform apply` (without `-target=`) when the run is in progress — module-by-module is the contract.
- Run `terraform force-unlock` automatically. Surface the lock holder and let the operator decide.
- Auto-retry a failed mutating command past one transient-pattern attempt (Throttling / RequestLimitExceeded / TooManyRequestsException / RequestTimeoutException / ProvisionedThroughputExceededException). Any other failure goes straight to the rollback dialog.
- Assume target AWS state matches what `inventory.json` or any artifact says. Always re-verify with a read-only describe call before acting on stale data.
- Use AWS CLI calls without `--profile $MIGRATION_SOURCE_PROFILE` or `--profile $MIGRATION_TARGET_PROFILE`. Never rely on implicit credentials.
- Call any MCP server, WebFetch, or external HTTP endpoint from the `cutover-executor`. Its tool surface is `Read, Write, Bash, AskUserQuestion` only.

## Always

- Validate every emitted JSON artifact against its schema in `schemas/` before declaring success. Validation failure halts the producing skill; never emit an invalid artifact.
- Record the operator identity on every approval-related event in the journal (`approved`, `skipped`, `aborted`, `rollback-approved`, `rollback-skipped`). Pull from `$USER`, falling back to `git config --global user.email`, falling back to `"unknown"`.
- Check both `MIGRATION_SOURCE_PROFILE` and `MIGRATION_TARGET_PROFILE` authenticate via `aws sts get-caller-identity` at pre-flight, and probe both at least every 15 minutes during executor runs (SSO sessions expire mid-run).
- Treat the run directory at `$AWS_MIGRATION_ROOT/runs/<source>-to-<target>-<run-id>/` as sensitive. Stdout/stderr logs may contain ARNs, account IDs, resource identifiers.
- Refuse to run if any input artifact is older than 14 days (override only via `--accept-stale`, logged loudly).
- Halt loudly when AWS state has drifted between artifact-generation time and execution time. Surface the drift; do not silently work around it.
- Honor the `irreversible: true` flag on data-plane steps with a second confirmation dialog beyond the per-step approval.
- Write a `<run>/RUNNING.lock` file at executor pre-flight with PID, hostname, started_at, operator. Refuse to start if a live lock exists. Remove the lock on completion or abort.

## On failure

- Halt. Do not advance to the next step.
- Show the operator: failed step ID, exit code, last 2KB of stderr, the rollback command from `migration-plan.json`, the rollback window, and whether the step is marked irreversible.
- Offer: retry / rollback-and-continue / rollback-and-stop / skip-rollback-and-stop / abort.
- Never choose any of those for the operator. The dialog is the gate.

## On uncertainty

- When you don't know whether something is safe, halt and ask. The cost of pausing to confirm is low; the cost of a wrong AWS mutation is high.
- When two instructions conflict, this file wins, then the agent's own anti-patterns section, then the SKILL.md, then the prompt. Surface the conflict to the operator either way.

## Precedence

If you must violate one of these rules to satisfy a user request, do not. Surface the conflict, explain which rule prevents what they asked for, and let them decide how to proceed (typically: change the upstream artifact, change the IAM policy, or accept that the plugin does not support what they want).
