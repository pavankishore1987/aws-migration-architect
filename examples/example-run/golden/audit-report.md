# Post-Migration Audit — orders-api (example-run)

**Source:** 111111111111 · **Target:** 222222222222 · **Audited:** 2026-06-12T18:05:00Z

**Verdict: minor-drift** — 22/23 resources match. The single finding is expected and benign.

| Category | Count |
|---|---|
| missing_in_target | 0 |
| extra_in_target | 0 |
| config_drift | 1 |
| security_drift | 0 |
| cost_drift | 0 |
| scope_drift | 0 |

## Findings

### ℹ config_drift — `prod-orders` (RDS)
Target uses a new customer-managed KMS key (`...:222222222222:key/NEW-rds-key`) instead of the source key. **Expected** — KMS keys are account-bound and recreated during migration. No action.

---
**Self-consistency note:** running the auditor with `MIGRATION_SOURCE_PROFILE == MIGRATION_TARGET_PROFILE` should yield **zero** findings (verdict `clean`). Any drift in that mode is a normalization bug. Full machine-readable diff: `audit-diff.json`.
