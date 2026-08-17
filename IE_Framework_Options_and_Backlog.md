# I=E Framework — Solution Options & Delivery Backlog

**Team:** Workflow Arbiters
**Status:** Draft for alignment
**Purpose:** High-level architecture, three build options, and the decomposed work — spikes, POCs, refinements and build tasks — ready to load into Jira.

This is greenfield. Nothing exists today. Everything below is work to be created.

---

## 1. Goal

Build a framework that proves, for every credit application, that what the business approved is what actually ran — and produces evidence a regulator will accept, years later.

Success means:
- Every execution gets a machine-generated verdict. No sampling, no exceptions.
- The verdict is reproducible: same inputs, same answer, forever.
- One framework serves **both** centrally-hosted and federated tenants.
- Zero impact on the 10-second decision path.

---

## 2. High-level architecture

The engine is the same in all three options. Only the packaging and runtime location differ.

```
   INTENT SOURCE                    EXECUTION SOURCE
   spec.md + BPMN (git)             EXECUTION_RECORD + STEP# (DynamoDB)
        │                                    │
        ▼                                    ▼
   ┌──────────────┐                   ┌──────────────┐
   │ Intent       │                   │ Trace        │
   │ Adapter      │                   │ Adapter      │
   └──────┬───────┘                   └──────┬───────┘
          │                                  │
          └──────────────┬───────────────────┘
                         ▼
              ┌────────────────────────┐
              │   CANONICAL MODEL      │   format-neutral
              │   • process graph      │   the engine never
              │   • assertions         │   sees BPMN or JSON
              │   • execution steps    │
              └───────────┬────────────┘
                          ▼
              ┌────────────────────────┐
              │   EVALUATION CORE      │   pure function
              │   • path conformance   │   no I/O, no clock,
              │   • assertion eval     │   no network, no AI
              └───────────┬────────────┘
                          ▼
              ┌────────────────────────┐
              │   VERDICT              │
              │   PASS / FAIL /        │
              │   INDETERMINATE        │
              │   + violations[]       │
              │   + version bindings   │
              │   + seal               │
              └───────────┬────────────┘
                          ▼
          ┌───────────────┴───────────────┐
          ▼                               ▼
   EVIDENCE WRITER                 ALERT ROUTER
   CONFORMANCE# record             HARD → compliance queue + page
   sealed, immutable               SOFT → operational monitoring
```

**Design rules that hold for every option:**

1. The evaluation core is a pure library. It takes a model, returns a verdict. It knows nothing about where the data came from or where it runs.
2. Adapters are the only format-aware code. New notation or new runtime = new adapter, no core change.
3. Nothing runs in the decision path. All evaluation is post-execution.
4. Fail-safe: if conformance is down, credit decisions continue unaffected.
5. Read-only on execution data. The framework never writes to anything the platform depends on.

---

## 3. The decision: where does it run

Three ways to package and deploy the same engine.

### Option 1 — Library (embedded framework)

I=E ships as a versioned artifact that tenants pull in. CDK injects it into the workflow's terminal state. It executes inside the tenant's own execution context, reads their trace, writes the verdict back to their store.

```
   TENANT ACCOUNT (federated or central — identical)
   ┌─────────────────────────────────────────────┐
   │  Step Functions workflow                    │
   │       │                                     │
   │       ▼ terminal state                      │
   │  ┌──────────────────┐                       │
   │  │ I=E library      │──reads──► DynamoDB    │
   │  │ (injected via    │──writes─► CONFORMANCE#│
   │  │  CDK)            │──emits──► CloudWatch  │
   │  └──────────────────┘                       │
   └─────────────────────────────────────────────┘
```

**Pros**
- Works identically for federated and central tenants — one artifact, both models
- No central infrastructure to provision or operate
- Trace freshness guaranteed — runs the moment the trace is complete
- No cross-account access needed
- Alerts route naturally to the tenant that owns the workflow
- Fastest to first working version

**Cons**
- Version upgrades need tenant redeploy — fleet fragments over time
- A bug fix cannot be pushed centrally
- Cross-tenant aggregate view is hard (no shared store)
- Consumes tenant compute inside their account
- Mandate is weaker: a tenant could pin an old version
- Contends with live executions for DynamoDB throughput

### Option 2 — Service inside the workflow engine platform

I=E runs as a service in the Decisioning Platform's managed runtime. It consumes execution traces and writes verdicts centrally.

```
   DP MANAGED RUNTIME
   ┌─────────────────────────────────────────────┐
   │  Workflow engine    ──►  I=E service        │
   │                            │                │
   │                            ▼                │
   │                      central evidence store │
   └─────────────────────────────────────────────┘
                    ▲
                    │ cross-account?
   ┌────────────────┴────────────────┐
   │  FEDERATED TENANT ACCOUNT       │  ← problem
   └─────────────────────────────────┘
```

**Pros**
- One version everywhere; central upgrade and central bug fix
- Aggregate and cross-tenant views are natural
- Mandate is trivially enforceable — tenants cannot bypass it
- No tenant compute consumed
- Single place to operate and monitor

**Cons**
- **Does not serve federated tenants without cross-account access** — which the hothouse deck explicitly rejected
- Violates the stated Federated Infrastructure Boundaries principle
- Introduces eventual-consistency lag between execution and verdict
- Largest blast radius — one service failing affects all tenants
- Central team becomes an operational bottleneck
- Complicates cross-account alert forwarding

### Option 3 — Federated deployable platform

I=E is its own CDK-deployable stack. We build and version it; each tenant deploys it into their own account. For centrally-hosted tenants, the same stack deploys into the platform's account.

```
   TENANT ACCOUNT
   ┌─────────────────────────────────────────────┐
   │  Workflow    ──emits──►  trace store        │
   │                              │              │
   │                              ▼              │
   │  ┌────────────────────────────────────┐     │
   │  │  I=E STACK (our CDK constructs)    │     │
   │  │  • queue  • evaluator  • evidence  │     │
   │  │  • query API  • aggregate view     │     │
   │  └────────────────────────────────────┘     │
   └─────────────────────────────────────────────┘
   Same stack deploys into DP account for hosted tenants.
```

**Pros**
- Serves federated and central with one artifact
- Own compute and own store — no contention with the operational database
- Can host aggregate queries and the read path per tenant
- Upgradeable through a pipeline rather than a tenant code change
- Natural home for retention, sealing and the evidence API
- Alerts stay inside tenant boundaries

**Cons**
- Real infrastructure to build, deploy and operate
- Per-tenant deployment and cost overhead
- Onboarding is heavier — tenants must accept a stack
- Most moving parts of the three
- Longest time to first working version

### Comparison

| Dimension | 1 · Library | 2 · Central service | 3 · Federated stack |
|---|:---:|:---:|:---:|
| Serves federated tenants | ✅ | ❌ | ✅ |
| Serves central tenants | ✅ | ✅ | ✅ |
| One solution, both models | ✅ | ❌ | ✅ |
| Central version control | ❌ | ✅ | ⚠️ via pipeline |
| Central bug fix | ❌ | ✅ | ⚠️ needs redeploy |
| Mandate enforceable | ⚠️ | ✅ | ✅ |
| Cross-tenant aggregate | ❌ | ✅ | ⚠️ per tenant |
| Avoids operational DB contention | ❌ | ⚠️ | ✅ |
| Central infra required | ✅ none | ❌ | ✅ none |
| Trace freshness | ✅ | ⚠️ lag | ✅ |
| Blast radius | ✅ contained | ❌ platform-wide | ✅ contained |
| Time to first version | ✅ fastest | ⚠️ | ❌ slowest |
| Operational burden on us | ✅ low | ❌ high | ⚠️ medium |

### Recommendation

**Option 1 for Phase 1. Option 3 as the Phase 2 target. Option 2 is not viable.**

Reasoning:

1. **Option 2 fails the primary constraint.** The platform must serve federated tenants, and a central service cannot reach them without cross-account access that has already been rejected. It is documented here for completeness, not as a live candidate.

2. **Option 1 is the fastest path to a working verdict** and matches the deployment pattern already adopted in the hothouse deck — injected via CDK into the terminal state, running outside the execution container. Nothing gets re-litigated.

3. **Option 3 answers what Option 1 cannot** — DB contention, aggregate views, the read path, central upgrade. These become necessary once volume grows and the UI capability lands.

4. **The migration is cheap if the core is built right.** Because the evaluation core is a pure library in every option, moving from 1 to 3 changes the *host*, not the engine. That single design rule is what keeps this decision reversible — and it is why POC-2 below exists.

---

## 4. Delivery backlog

Task types:
- **SPIKE** — answer a question. Timeboxed. Has a kill criterion.
- **POC** — prove something works. Has a success criterion.
- **REFINEMENT** — a decision to be made with named people. Produces a written decision.
- **BUILD** — delivery work.

---

### EPIC 1 — Prove the foundation *(blocks everything)*

Nothing can be built until we know the trace can support conformance at all.

| ID | Type | Title | Detail | Est |
|---|---|---|---|---|
| E1-S1 | SPIKE | Trace payload fidelity | Take a real pilot workflow. Confirm `STEP#` records contain the fields that assertions need to evaluate. **Kill criterion:** if payloads do not carry decision-relevant fields, semantic conformance cannot be delivered as specified — escalate before any build. | 2w |
| E1-S2 | SPIKE | Graphite node visibility | Does the JIT decision service emit per-node DAG evaluation detail into the trace? **Kill criterion:** if not, semantic conformance is bounded at the state-machine level only. Requires contract with Oracle/Func. | 1w |
| E1-S3 | SPIKE | Intent version resolution | Can a running execution resolve which spec/BPMN version governed it? Evaluate the two mechanisms named in the deck: bundled in the deployable artifact, or stored separately but runtime-accessible. **Kill criterion:** if neither is achievable, verdicts must be labelled version-unbound. | 1w |
| E1-S4 | SPIKE | Persistable response data | What response data can we persist? Is there data that cannot be stored, and if so how do we evaluate assertions over it? *(Raised independently on the platform spike list.)* | 1w |
| E1-P1 | POC | Happy path end to end | One workflow, one real assertion, real trace, verdict written. Conforming run produces PASS; deviating run produces FAIL with populated `violations[]`. **This is the deck's POC 1 — foundational, blocks POCs 2–5.** | 3w |

---

### EPIC 2 — Evaluation core

The engine. Built as a pure library regardless of which option ships.

| ID | Type | Title | Detail | Est |
|---|---|---|---|---|
| E2-R1 | REFINEMENT | Canonical model definition | Agree the format-neutral model with the architect: process graph, assertion set, execution steps. This is what makes the design notation-agnostic. | 1w |
| E2-B1 | BUILD | Intent adapter | BPMN + spec.md → canonical intent model | 2w |
| E2-B2 | BUILD | Trace adapter | DynamoDB records → canonical execution model | 2w |
| E2-B3 | BUILD | Path conformance evaluator | Verify predecessor edges; recompute gateway conditions against actual payload | 3w |
| E2-B4 | BUILD | Assertion evaluator | Parse the invariants block; evaluate each assertion as a boolean over recorded payloads; per-assertion result with expected vs actual | 3w |
| E2-B5 | BUILD | Verdict record and seal | Structured record: verdict, per-layer result, violations, version bindings, evaluator version, hash seal | 2w |
| E2-P2 | POC | Same core, two hosts | Run the identical core against (a) a live trace and (b) a synthetic trace from a different source. **Success criterion:** identical verdict from both. This proves the core is host-agnostic and keeps Options 1 and 3 both open. | 1w |

---

### EPIC 3 — Packaging and deployment

| ID | Type | Title | Detail | Est |
|---|---|---|---|---|
| E3-S5 | SPIKE | Packaging option evaluation | Evaluate library vs central service vs federated stack against both tenant models. Produce a written recommendation with the fleet-versioning and upgrade story. | 2w |
| E3-S6 | SPIKE | Data store contention | Does reading traces contend with live executions writing `STEP#` inside their 10-second budget? Do we need a separate analytics store, or can we consume a stream/replica? *(On the platform spike list, marked important for this team.)* **Kill criterion:** if direct reads risk throttling live writes, Option 1 requires a stream-based read path before production.| 1w |
| E3-P3 | POC | CDK terminal-state injection | Prove the library can be injected via CDK into a workflow's terminal node and execute outside the execution container. | 2w |
| E3-P4 | POC | Multi-tenant isolation | Two tenants, independent configuration, no shared infrastructure dependency. | 2w |
| E3-B6 | BUILD | CDK construct | The construct tenants consume. Conformance is not optional in it. | 3w |

---

### EPIC 4 — Evidence and provenance

| ID | Type | Title | Detail | Est |
|---|---|---|---|---|
| E4-R2 | REFINEMENT | Evidence record contents | Agree what must be captured: frozen intent, attestation, version bindings (spec, code, rules, flags), concern records, seal. Test for inclusion: would its absence leave a regulator question unanswerable? | 1w |
| E4-S7 | SPIKE | Immutability mechanism | How is "immutable" actually achieved — hash chain, WORM, append-only with revision chain? Both source documents assert immutability without specifying a mechanism. | 1w |
| E4-S8 | SPIKE | Retention requirements | Confirm with compliance how long conformance evidence must survive, and in what form it must be retrievable. | 1w |
| E4-B7 | BUILD | Evidence writer | Persist the sealed verdict record | 2w |
| E4-B8 | BUILD | Provenance binding | Capture artifact hash ↔ spec version ↔ rule version ↔ flag state at execution time | 3w |
| E4-P5 | POC | Replay proves determinism | Re-run a sealed verdict from its sealed inputs; assert identical output. **Success criterion:** byte-identical verdict. This is the demo that ends a regulator conversation. | 1w |

---

### EPIC 5 — Alerting and severity

| ID | Type | Title | Detail | Est |
|---|---|---|---|---|
| E5-R3 | REFINEMENT | HARD/SOFT classification policy | Agree with product what makes a violation HARD. Currently one example each in the deck. | 1w |
| E5-B9 | BUILD | Alert router | HARD → compliance queue + high-priority page; SOFT → operational monitoring | 2w |
| E5-B10 | BUILD | Tenant alert configuration | Tenants configure *how* they are alerted — not *whether* they are checked | 2w |
| E5-S9 | SPIKE | Federated diagnostics | How do we get diagnostic information from federated tenant deployments back to the central platform, to confirm conformance is actually running? *(On the platform spike list, marked high priority.)* | 2w |

---

### EPIC 6 — Mandate and onboarding

| ID | Type | Title | Detail | Est |
|---|---|---|---|---|
| E6-S10 | SPIKE | Mandate enforcement | How do we make conformance non-bypassable in the CDK, given tenants control their own deployment? Under Option 1 a tenant could pin an old version — what prevents that? | 2w |
| E6-R4 | REFINEMENT | Onboarding reduced mode | Is a reduced mode permitted while a tenant onboards, and who approves it? | 1w |
| E6-B11 | BUILD | Onboarding path | Conformance provisioned as part of tenant onboarding, with no platform-team involvement required | 3w |

---

## 5. Sequencing

```
  EPIC 1 ──────────────────────────►  everything depends on this
    │        (spikes run in parallel, POC-1 after)
    ▼
  EPIC 2 ─────────────────────────►  the engine
    │
    ├──► EPIC 3   packaging (S5 and S6 can start during Epic 2)
    ├──► EPIC 4   evidence
    ├──► EPIC 5   alerting
    └──► EPIC 6   mandate
```

**Run first, before committing to anything:** E1-S1, E1-S3, E3-S6. All three have kill criteria that would change scope materially.

**Rough Phase 1 shape:** Epic 1 and Epic 2 complete, plus E3-P3 and E4-B8. That is a working verdict, bound to a version, for the pilot.

---

## 6. Jira import

Epic → Task. Estimates in weeks. Types map to labels.

| Epic | Key | Type | Summary | Est |
|---|---|---|---|---|
| Foundation | E1-S1 | Spike | Trace payload fidelity | 2w |
| Foundation | E1-S2 | Spike | Graphite node visibility | 1w |
| Foundation | E1-S3 | Spike | Intent version resolution | 1w |
| Foundation | E1-S4 | Spike | Persistable response data | 1w |
| Foundation | E1-P1 | POC | Happy path end to end | 3w |
| Evaluation core | E2-R1 | Refinement | Canonical model definition | 1w |
| Evaluation core | E2-B1 | Build | Intent adapter | 2w |
| Evaluation core | E2-B2 | Build | Trace adapter | 2w |
| Evaluation core | E2-B3 | Build | Path conformance evaluator | 3w |
| Evaluation core | E2-B4 | Build | Assertion evaluator | 3w |
| Evaluation core | E2-B5 | Build | Verdict record and seal | 2w |
| Evaluation core | E2-P2 | POC | Same core, two hosts | 1w |
| Packaging | E3-S5 | Spike | Packaging option evaluation | 2w |
| Packaging | E3-S6 | Spike | Data store contention | 1w |
| Packaging | E3-P3 | POC | CDK terminal-state injection | 2w |
| Packaging | E3-P4 | POC | Multi-tenant isolation | 2w |
| Packaging | E3-B6 | Build | CDK construct | 3w |
| Evidence | E4-R2 | Refinement | Evidence record contents | 1w |
| Evidence | E4-S7 | Spike | Immutability mechanism | 1w |
| Evidence | E4-S8 | Spike | Retention requirements | 1w |
| Evidence | E4-B7 | Build | Evidence writer | 2w |
| Evidence | E4-B8 | Build | Provenance binding | 3w |
| Evidence | E4-P5 | POC | Replay proves determinism | 1w |
| Alerting | E5-R3 | Refinement | HARD/SOFT classification policy | 1w |
| Alerting | E5-B9 | Build | Alert router | 2w |
| Alerting | E5-B10 | Build | Tenant alert configuration | 2w |
| Alerting | E5-S9 | Spike | Federated diagnostics | 2w |
| Mandate | E6-S10 | Spike | Mandate enforcement | 2w |
| Mandate | E6-R4 | Refinement | Onboarding reduced mode | 1w |
| Mandate | E6-B11 | Build | Onboarding path | 3w |

**Totals:** 10 spikes (14w), 6 POCs (10w), 4 refinements (4w), 11 build tasks (26w). 54 person-weeks of identified work, before parallelism.

With 5 engineers, and allowing that spikes and refinements are not fully parallelisable, this is roughly a two-quarter body of work — with Phase 1 (Epics 1–2 plus binding) landing inside one quarter.

---

## 7. Not in this backlog

Deliberately excluded, with reasons:

- **Backtesting and shadow testing** — parked. Both depend on the loans team's data, permissions and traffic routing, none of which are within our control. The design keeps the door open: because the evaluation core is host-agnostic (E2-P2), a replayed or shadow execution can produce a verdict later with only an adapter.
- **Design-time and authoring-time conformance (C1, C2)** — run inside Oracle's SDD tooling. We consume their outputs as evidence; we do not build their checks.
- **AI and agentic layers** — no corpus exists pre-launch, and the agents' tools are this backlog's outputs. Later phase.
- **UI and visualization** — separate capability, separate document.
