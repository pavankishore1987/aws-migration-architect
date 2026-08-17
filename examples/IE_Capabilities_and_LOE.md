# Capabilities and Level of Effort

**Team:** Workflow Arbiters
**Status:** Draft for alignment
**Basis:** Order-of-magnitude estimates built from the shape of the work. Shared components are counted once and marked. Person-weeks (PW), not calendar weeks.

---

## Capability 1 — I=E conformance

### Layer C0 · Intent capture — was the requirement captured and approved

| Feature | What it means | PW |
|---|---|---|
| Frozen PRD and approval | The requirement document is copied, hashed and stored at the moment it is approved, with the approver's name. The PRD is not in version control today, so an approval pointing at a living document proves nothing | 1 |

**Subtotal 1**

### Layer C1 · Design — is the spec a faithful translation of the requirement

| Feature | What it means | PW |
|---|---|---|
| Structural completeness gate | Blocks a design where a branch goes nowhere or a terminal state is missing. Uses the same graph parser the runtime check needs, so the check itself is small | 1 |
| Attestation on record | The intent owner signs that the generated rules capture the business and regulatory intent, sealed into the artifact at that version. This is what lets a decision trace back to a named person | 2 |
| Drafted invariants | AI proposes the assertions from the requirements and flags requirements with no rule covering them. A human edits and approves | 3 |

**Subtotal 6**

### Layer C2 · Generation — does the code do what the spec says

| Feature | What it means | PW |
|---|---|---|
| Graph comparison gate | Compares the approved process graph against the generated state machine and decision graph. Blocks the PR on a mismatch — a dropped branch, a `<` written as `<=` | 3 |
| Binding record | Links the intent version to the code commit. This is the link everything downstream depends on | 1 |

**Subtotal 4**

### Layer C3 · Verification — does it behave correctly under test

| Feature | What it means | PW |
|---|---|---|
| Test results as evidence | The CI ladder already runs; this captures what was tested against which artifact as a record rather than a build log | 1 |

**Subtotal 1**

### Layer C4 · Runtime — did this application follow the approved design

| Feature | What it means | PW |
|---|---|---|
| Verdict on every application | Two checks: did it take a legal path through the approved process, and did every business rule hold true against the real data. Both must pass. Runs after the decision, so it adds no latency | 7 |
| Version binding | The verdict names the exact intent, code, rules and flag state in force. Without this, a verdict claims conformance to something it cannot prove was running | 3 |
| Reproducible on demand | Re-run any past verdict against its sealed inputs and get an identical answer. Mostly a property of the pure evaluator, so the added work is the stored hashes and a small verification job | 2 |
| Alerting by severity | A critical breach pages the team that owns the workflow. A minor one logs quietly, so nobody stops reading alerts | 1 |

**Subtotal 13**

### Across layers — evidence, containment, watching

| Feature | What it means | PW |
|---|---|---|
| Tamper-evident chain | Each record carries the hash of the one before it, across four separate stores. Alter one and the chain visibly breaks | 4 |
| Ask the evidence a question | A query API so a person or a screen can retrieve applications, verdicts and violations. Shared with the UI, counted once here | 4 |
| Assembled audit exhibits | Walks the chain and assembles the full record for one application, ready for a regulator | 3 |
| Threshold-triggered halt | When failures cross a limit the business set, a flag trips and part of the workflow stops. Forty applications affected instead of four thousand | 4 |
| Drift and anomaly detection | Watches approval rates, input distributions and path proportions for movement no single verdict would show. Every execution can pass while the population shifts | 4 |
| Assisted investigation | Gathers the trace, the governing intent and similar recent failures, and drafts a summary. A person decides what to do | 4 |

**Subtotal 23**

### Discovery — the questions that could change the plan

| Feature | What it means | PW |
|---|---|---|
| Four blocking spikes | Does the trace contain the values the rules need? Can an execution resolve its governing version? Do our reads compete with live decisions? Are the deck's invariants checkable against a real execution, or only in a test harness? Each is timeboxed with an answer that would stop the build | 5 |

**Subtotal 5**

**Capability 1 total — 53**

---

## Capability 2 — Visualization

| Feature | What it means | PW |
|---|---|---|
| Read path proven | Establishes how execution data is retrieved without competing with live decisions, and how to render a workflow at the version that governed it. Three of its questions are shared with conformance and run once | 5 |
| Access gate | Server-side. Tenant scoping, persona gating, PII redaction, and a record of every view with its business justification | 8 |
| Plain-English explanation | A paragraph and ordered steps describing what happened and why, rendered from the approved intent — never generated at the moment of viewing | 6 |
| Search and execution view | Find an application; see its path, timings, rules fired and verdict, with engineer depth in the same screen | 7 |
| Audit exhibit export | Produces the record a risk manager hands to a regulator, verifiable on its own | 2 |

**Capability 2 total — 28**

---

## Capability 3 — Feature flags

| Feature | What it means | PW |
|---|---|---|
| Flag management | Platform-wide flag definition, targeting and lifecycle | not scoped |
| Programmatic control | The interface that lets a threshold breach trip a flag without a human | not scoped |
| Flag state in the verdict | Captures which flags were on during an execution, so a deliberate flag-driven path is not mistaken for a violation | not scoped |

**Capability 3 total — not yet scoped.** This is the capability that delivers containment, and it has never been estimated.

---

## Summary

| Capability | PW |
|---|---|
| 1 · I=E conformance | 53 |
| 2 · Visualization | 28 |
| 3 · Feature flags | not scoped |
| **Total known** | **81** |

Rounded working figures: **conformance ~47 excluding discovery, 53 including it. Visualization 28.**

---

## What we are asking to fund now

| Feature | PW |
|---|---|
| Four blocking spikes | 5 |
| Verdict on every application | 7 |
| Version binding | 3 |
| Reproducible on demand — stored input hashes only | 2 |
| Alerting by severity | 1 |
| Deployment into a tenant, verdict schema and sealing fields | 2 |
| **Total** | **20** |

Five of those weeks are discovery that gates the rest and waits on Func and Oracle, which is why this lands across a quarter rather than a month.

Everything else in this document is direction, not commitment.

---

## How to read these numbers

- **Person-weeks, not calendar weeks.** Five engineers give roughly 65 person-weeks in a quarter, before leave, support and meetings.
- **81 person-weeks is close to two quarters of real team time** across two capabilities, with a third unpriced.
- **Only the funding ask has been thought through properly.** Everything beyond it depends on four spike outcomes and four conversations with other teams that have not happened yet.
- **Shared work is counted once.** The query API, the read path and the evidence record contents serve both conformance and the UI.
- **These are estimates from the shape of the work, not from a team that has built this before.** Before they are committed, the engineers who would build the top five items should size them.
