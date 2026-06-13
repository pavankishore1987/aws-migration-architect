---
name: audit
description: Compare source and target AWS accounts after the cutover. Re-runs the same describe-* scope against both profiles, structurally diffs, categorizes drift (missing/extra/config/security/cost/scope), and emits audit-diff.json + audit-report.md.
---

# /aws-migration-architect:audit

Verify post-cutover parity between source and target accounts.

## Argument hint

`--run-id <id> [--source-profile <name>] [--target-profile <name>]`

## Prerequisites

Both profiles authenticated:
```bash
aws sso login --profile $MIGRATION_SOURCE_PROFILE
aws sso login --profile $MIGRATION_TARGET_PROFILE
```

A prior `/aws-migration-architect:migrate` or `/aws-migration-architect:discover` run must exist so that the source-side `inventory.json` is on disk. Pass that `run-id`.

## What this command does

Invokes the `post-migration-auditor` sub-agent via the audit workflow. The auditor:

1. Re-inventories the target account using the same scope as source (regions, services, tag filter)
2. Matches resources by stable identity (name tags, identifiers — not ARNs)
3. Normalizes ARNs / timestamps / IDs / region literals on both sides
4. Structurally diffs each matched pair
5. Categorizes findings: missing-in-target / extra-in-target / config drift / security drift / cost drift / scope drift
6. Emits `audit-diff.json` (schema-validated) + `audit-report.md` (human-readable)
7. Returns a verdict: `clean` | `minor-drift` | `significant-drift` | `failed`

## Procedure

1. Parse args. `--run-id` is **required** — fail with a clear message if missing.
2. Fall back to env vars for profiles.
3. Verify both profiles authenticate. Surface auth errors before invoking the workflow.
4. Invoke `Workflow({ name: "aws-migration-architect:audit", args: { sourceProfile, targetProfile, runId } })`.
5. Surface the verdict + drift counts.
6. If verdict is `clean` or `minor-drift`, tell the user the migration is effectively complete.
7. If verdict is `significant-drift`, point them at `audit-report.md` (most-severe findings first) for triage.
8. If verdict is `failed`, the workflow already raised; surface the underlying error.

## Self-consistency note

If `MIGRATION_SOURCE_PROFILE == MIGRATION_TARGET_PROFILE`, the audit should report **zero drift**. This is a normalization-correctness test, not a real audit. If you see non-zero drift in that case, it's a bug in the auditor's normalization logic — file an issue.
