# Migration Plan — orders-api (111111111111 → 222222222222)

**Run:** example-run · **Region:** us-east-1 → us-east-1 · **Readiness:** 72/100 (see `readiness-score.json`)

23 in-scope resources · 4 high-risk · steady-state cost delta +$80/mo · first-month delta +$3,340 (see `cost-baseline.json`).

## Phase 1 — Networking (~25 min)
VPC `10.0.0.0/16` + 3 subnets (AZ literals → `data.aws_availability_zones`), then security groups (peer-SG rules re-linked to new target SG IDs).
**Rollback:** `terraform destroy -target=module.networking` (window 30 min).

## Phase 2 — Storage (~10 min)
Empty `acme-prod-orders-assets` + `acme-prod-orders-logs` with parameterized KMS references. **Data movement is a data-plane concern (see `data-migration-plan.md`).**

## Phase 3 — Databases (~45 min) — HIGH RISK
`prod-orders` container; instance appears via cross-account snapshot-restore in the data plane, re-encrypted with the new target KMS key.
**Gate:** DB restore validated, row counts match. **Approvers:** platform.

## Phase 4 — Applications (~70 min) — HIGH RISK
IAM (new GitHub OIDC provider; `analytics-cross-account` trust re-pointed), Lambda (EIP literal `54.231.45.67` remapped), EC2 from shared AMIs, ALB.
**Gate:** smoke tests green; OIDC role assumable from GitHub Actions.

## Phase 5 — DNS Cutover (~20 min) — HIGH RISK
Freeze writes → final delta → swap `api.acme-corp.example.com` alias to target ALB. **Irreversible beyond TTL propagation.**
**Gate:** freeze-window validations pass; counts match. **Approvers:** platform, data-platform.

## Phase 6 — Validation (~30 min)
Run `post-migration-auditor`; produce `audit-diff.json`.

---
Full machine-readable plan: `migration-plan.json`.
