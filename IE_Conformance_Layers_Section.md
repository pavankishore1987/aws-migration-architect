# The five conformance layers

*Drop-in replacement for the existing "The five conformance layers" section. Sits after "Goals & constraints" and before "Solution A".*

---

Every solution below is described against these five layers. They are the same layers in all three; what differs is which are enforced, where they run, and what persists.

Each layer is the same shape — a function that takes two things that should agree and returns a verdict. Same signature everywhere:

```
check(intent, subject, context) → verdict
```

`intent` is what was approved. `subject` is what is claimed to implement it. `context` is the version bindings that make the comparison meaningful. The function is pure: no clock, no network, no configuration. Anything it needs is handed to it (ADR-005).

The layers differ only in what fills those three slots.

---

## Layer summary

| Layer | Compares | Catches |
| --- | --- | --- |
| **C0** Intent capture | Business need ↔ PRD | Ambiguity, missing exception paths, unmeasurable requirements |
| **C1** Design | Approved PRD ↔ spec.md + BPMN | Requirements lost or invented in translation; structurally incomplete process |
| **C2** Generation | spec.md + BPMN ↔ Decision DAG + ASL | Codegen defects; a branch dropped; `<` becoming `<=` |
| **C3** Verification | Artifact ↔ expected behaviour | Behavioural defects under test conditions |
| **C4** Runtime | Intent ↔ actual execution trace | Drift, rule changes, flag effects — anything only visible against real data |

---

## C0 — Intent capture

```
c0(business_need, prd) → prd_hash + approval_record
```

| | |
| --- | --- |
| **Deterministic check** | Document exists; required sections present; every requirement is measurable |
| **Advisory (LLM)** | Ambiguous or conflicting requirements; missing exception paths; requirements with no acceptance criterion |
| **Human step** | Product owner approves. Mandatory — this is the chain's anchor |
| **Persists** | Frozen PRD copy, its hash, approver, timestamp |
| **Where** | Authoring environment; record written to git or object storage |
| **Cannot check** | Whether the business need was understood correctly. Nothing can |

The PRD is not version-controlled today (R11). The approval must freeze and hash a copy, not point at a living document.

---

## C1 — Design

```
c1(prd_hash, spec, bpmn) → verdict + attestation_record
```

| | |
| --- | --- |
| **Deterministic check** | BPMN structurally complete — terminal states exist, every gateway branch resolves; every spec step maps to a BPMN task; schemas valid |
| **Advisory (LLM)** | Requirements lost between PRD and spec; requirements invented that the PRD never stated; invariants with no corresponding requirement |
| **Human step** | Intent owner attests that the generated invariants capture the business and regulatory intent |
| **Persists** | Attester, intent hash, timestamp — sealed into the artifact at that version |
| **Where** | SpecKit / authoring; gate in the pipeline |
| **Cannot check** | Whether the approved rule is the right rule. Only the attestation makes that attributable |

spec.md and BPMN version together as one Intent, with one hash and one attestation (ADR-002).

---

## C2 — Generation

```
c2(intent_hash, spec, bpmn, dag, asl) → verdict + binding_record
```

| | |
| --- | --- |
| **Deterministic check** | Graph comparison — BPMN ↔ ASL ↔ Decision DAG; node identity preserved; code compiles; artifact hashes recorded |
| **Advisory (LLM)** | Spec-to-code meaning comparison; missing implementation; orphan code the spec never asked for |
| **Persists** | Binding record — intent hash ↔ code SHA. This is the link C4 depends on |
| **Where** | Pipeline gate; blocks the PR |
| **Catches** | `score < 620` generated as `score <= 620`. Every applicant scoring exactly 620 wrongly declined |

The `<=` case passes structural comparison — the graph shape is correct. The LLM flags it; an engineer confirms; the gate blocks. AI finds, a person decides.

Deterministic graph comparison depends on generated artifacts preserving node identity from the BPMN (S7). If they do not, C2 falls back to advisory only.

---

## C3 — Verification

```
c3(artifact_sha, tests, historical_data) → verdict + verification_record
```

| | |
| --- | --- |
| **Deterministic check** | Test ladder — unit → component → integration → live dependency → acceptance → E2E. Backtest population comparison |
| **Advisory (LLM)** | Generate edge cases; group and explain failures; label each backtest difference as intended policy change or defect |
| **Persists** | Artifact tested, outcome, deploy approval |
| **Where** | Pipeline gate |
| **Cannot check** | Behaviour under data no test reached. That is C4's job |

Backtest and shadow testing are blocked on the pilot tenant's data and traffic routing, and are parked for now.

---

## C4 — Runtime

```
c4(intent_at_governing_version, trace, context) → verdict
```

| | |
| --- | --- |
| **Deterministic — structural** | Every executed step had a valid predecessor edge in the BPMN; no step out of order; gateway conditions recalculated against actual payload |
| **Deterministic — semantic** | Each invariant in `## Invariants` evaluated as a boolean against real step response payloads |
| **Both must pass** | Structural pass with semantic fail is still FAILED |
| **Advisory (LLM)** | Explain the verdict in plain words; summarise incidents; suggest root cause |
| **Advisory (ML)** | Data drift, path drift, outcome drift, latency anomalies — over the verdict corpus, not per execution |
| **Persists** | Full verdict: status, `violations[]`, intent version, code SHA, rule version, flag state, evaluator version, seal |
| **Where** | Terminal state, outside the execution container, CDK-injected. Async — zero latency to the decision |
| **Store** | `CONFORMANCE#` in the tenant's execution store, beside the trace it judged |

Three open dependencies: `STEP#` payload fidelity (S1), governing intent version resolution (S2), and whether reads contend with live writes (S3).

**INCOMPLETE is undefined.** The verdict has three values; only two have criteria. POC 4 introduces `INCOMPLETE_TRACE` separately without stating the relationship. This must be defined before build — a verdict value with no criteria cannot be evaluated, displayed, or explained.

**Invariant evaluability is unconfirmed.** INV-003 verifies call count using a mock/spy, which cannot exist against a production trace. If that pattern holds across the six worked invariants, runtime semantic conformance covers materially less than assumed and a second, trace-evaluable invariant form is required (S4).

---

## What each layer contributes to the chain

| Layer | Record | Trust zone | Answers |
| --- | --- | --- | --- |
| C0 | Frozen PRD + approval | git / object store | What was asked for, and who signed it off |
| C1 | Attestation | git | Who approved this Intent |
| C2 | Binding | CI artifact store | Which code implements which Intent |
| C3 | Verification result | CI + deploy records | What was tested before it shipped |
| C4 | Verdict | Tenant execution store | Whether this application matched the Intent |
| any | Override | with the bypassed gate | Where a control was skipped, and by whom |

Each record carries the hash of the one before it. From a verdict, walk backwards: verdict → code SHA → intent version → attester → frozen PRD.

Five hops from a customer decision to a named, accountable person. That chain is the difference between output and evidence — and only Solution C produces all five links.

---

## One property that holds at every layer

The function is pure and the host is not. The same evaluator runs in Claude Code on a laptop, in the pipeline, and in a Lambda — identical logic, three thin adapters (ADR-005).

What does not travel is trust. A laptop verdict is advisory, because the developer controls the inputs. A pipeline verdict gates. A runtime verdict is evidence. Every verdict record must therefore name where it ran and what it ran against.
