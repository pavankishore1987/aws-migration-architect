# Cutover Checklist — DATA PLANE (example-run)

> APPROVED BY: ____________________  ON: ____-__-__
>
> (Signed **separately** from the control-plane checklist. The executor refuses to advance into data-plane steps without this line AND confirmation that `target-cutover-data-plane.json` is attached.)

**Source:** 111111111111 → **Target:** 222222222222
**IAM policies required:** `target-cutover-control-plane.json` + `target-cutover-data-plane.json`
**Reads:** `data-migration-plan.json` (sizing, strategy, freeze windows, validation)
**Total data:** 9.6 TB · **Longest freeze:** 45 min (RDS)

## Phase 1 — Pre-Staging (no freeze yet)
- [ ] `dp-phase1-001` Confirm data-plane IAM policy attached
- [ ] `dp-phase1-010` KMS grant on source `orders-rds-cmk` for target role
- [ ] `dp-phase1-020` Share `prod-orders` snapshot with target account

## Phase 2 — Bulk Transfers (long-running; executor polls)
- [ ] `dp-phase2-010` S3 batch replication: assets (6.5 TB) — poll to `Complete`
- [ ] `dp-phase2-020` S3 batch replication: logs (3 TB) — poll to `Complete`
- [ ] `dp-phase2-030` Restore `prod-orders` from snapshot (target KMS key) — poll to `available`

## Phase 3 — Application Data
- [ ] `dp-phase3-010` `secret-put-value` prod/orders/db from operator-supplied file (**never read from source**)

## Phase 4 — Cutover (freeze + swap)
- [ ] `dp-phase4-001` Reduce TTL on `api.acme-corp.example.com` (ahead of cutover)
- [ ] `dp-phase4-010` Freeze writes: deny-write bucket policy on source assets
- [ ] `dp-phase4-020` Freeze writes: set source RDS read-only
- [ ] `dp-phase4-040` **route53-change — swap alias to TARGET ALB ⚠ IRREVERSIBLE** (second confirmation required)
- **GATE (platform + data-platform):** bulk transfers Complete · RDS available · secret populated

## Phase 5 — Data Validation
- [ ] `dp-phase5-010` Assets: object+byte count + 100-object checksum sample
- [ ] `dp-phase5-020` RDS: per-table row-count + smoke query
- [ ] `dp-phase5-090` Run `post-migration-auditor`

## Freeze windows
| Datastore | Duration | Begins at | Release |
|---|---|---|---|
| assets bucket | 35 min | `dp-phase4-010-freeze-assets` | `dp-phase4-090-release-freeze` |
| prod-orders RDS | 45 min | `dp-phase4-020-freeze-rds` | `dp-phase4-090-release-freeze` |
