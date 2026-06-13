# Cutover Checklist — CONTROL PLANE (example-run)

> APPROVED BY: ____________________  ON: ____-__-__
>
> (The `cutover-executor` refuses to run until this line is filled in. Control plane and data plane are signed **separately**.)

**Source:** 111111111111 → **Target:** 222222222222
**IAM policy required during this checklist:** `target-cutover-control-plane.json`
**Scope:** Terraform module applies + control-plane API only. **NO data movement, NO freeze, NO production DNS swap.**

## Phase 0 — Globals
- [ ] `cp-phase0-001` Verify both profiles authenticate
- [ ] `cp-phase0-010` Create Terraform state backend (S3 + lock table) in target
- [ ] `cp-phase0-020` `terraform apply -target=module.iam` — new KMS keys, GitHub OIDC provider, roles
- [ ] `cp-phase0-090` Record new KMS key ARNs into tfvars

## Phase 1 — Networking
- [ ] `cp-phase1-010` `terraform apply -target=module.networking`
- [ ] `cp-phase1-090` Verify SG ingress rules re-linked to new target SG IDs

## Phase 2 — Storage Containers
- [ ] `cp-phase2-010` `terraform apply -target=module.storage` (empty buckets only)

## Phase 3 — Database Containers
- [ ] `cp-phase3-010` `terraform apply -target=module.databases` (subnet group + param group + SG; **no instance**)

## Phase 4 — Compute Containers
- [ ] `cp-phase4-001` Confirm AMI `ami-0source1111111111` shared to target
- [ ] `cp-phase4-010` `terraform apply -target=module.compute` (ALB, Lambda w/ EIP remapped, EC2 launch templates)
- [ ] `cp-phase4-090` Smoke test target ALB DNS directly

## Phase 5 — DNS Scaffolding
- [ ] `cp-phase5-010` `terraform apply -target=module.dns` (staging records only — **no production swap**)

## Phase 6 — Control Plane Validation
- [ ] `cp-phase6-010` `terraform plan` clean; all modules applied
- **GATE (platform):** all 6 modules applied · plan clean · ALB smoke green

## Handoff to data plane
Before starting `cutover-checklist-data-plane.md`:
1. All control-plane modules applied, `terraform plan` clean.
2. Target KMS keys exist; source-account grants ready to request.
3. Source AMI shared to target.
4. **Attach `target-cutover-data-plane.json` IAM policy** (in addition to control-plane).
