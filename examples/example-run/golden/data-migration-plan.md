# Data Migration Plan — orders-api (example-run)

**Total data:** 9.6 TB across 3 datastores · **Est. transfer:** ~14.6h · **Transfer cost:** ~$215 · **Recommended cutover window:** 2h · **Longest freeze:** 45 min (RDS).

| Datastore | Type | Size | Tool / mode | Est. time | Cost | Freeze | RPO | Validation |
|---|---|---|---|---|---|---|---|---|
| `acme-prod-orders-assets` | S3 | 6.5 TB / 4.2M obj | s3-batch-replication / bulk+delta | ~9.8h | ~$42 | 35 min | 0 | object+byte count, 100-obj checksum |
| `acme-prod-orders-logs` | S3 | 3.0 TB / 8.9M obj | s3-batch-replication / bulk | ~4.4h | ~$14 | none | 24h | object-count (±0.01%) |
| `prod-orders` | RDS postgres | 100 GB | rds-snapshot-share / snapshot-restore | ~0.8h | ~$6 | 45 min | 0 | row-count + smoke query |

**Critical path:** `acme-prod-orders-assets` (largest; gates the window) → logs → RDS.

**Encryption:** assets + RDS use customer-managed KMS keys → require target KMS grant + re-encryption (new target keys). Logs use AES256 (aws-managed) → no grant needed.

**Warnings:**
- ⚠ Assets transfer time uses default 1 Gbps (not measured) — run a 10 GB calibration sample before scheduling.
- ℹ Logs migrate without a freeze window (append-only, tier-3).

---
Sizes from CloudWatch `BucketSizeBytes`/`NumberOfObjects` and RDS `describe-db-instances` (`AllocatedStorage`). Nothing was downloaded. Full detail: `data-migration-plan.json`.
