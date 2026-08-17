# I=E Conformance — Solution Overview (plain English)

**Team:** Workflow Arbiters
**Status:** Draft for alignment
**Read time:** 5 minutes. The full discovery document sits behind this one.

---

## The one-line idea

Check that what the business approved is what actually ran — at four points in the life of an application, not just one.

---

## The four layers

Every layer asks one question. Every layer has two kinds of checks:

- **Deterministic checks** — code. Same input, same answer, every time. These produce the pass/fail.
- **AI checks** — helpers. They find problems and explain things. They never decide pass/fail.

---

### Layer C1 — Design

**Question: Did we correctly translate business intent into an executable design?**

Input: PRD
Output: Spec + BPMN + DAG + acceptance criteria

Deterministic checks:
- BPMN structure is valid (terminal states exist, every branch goes somewhere)
- Every spec step maps to a BPMN task
- Schemas and required fields are valid

AI checks (advisory — a human approves):
- Missing requirements
- Requirements added that are not in the PRD
- Ambiguous or conflicting requirements
- Missing exception paths
- Requirements with no test

Then a human signs off. That signature is saved forever with that version.

---

### Layer C2 — Generation

**Question: Did the generated code faithfully implement the approved design?**

Input: Spec + BPMN + DAG
Output: Java + ASL + JSON + config

Deterministic checks:
- Code compiles, types check
- BPMN structure matches the Step Functions structure
- Artifact hashes recorded

AI checks (advisory):
- Spec-to-code meaning comparison
- Missing implementation (spec says it, code doesn't do it)
- Orphan code (code does it, spec never said it)

Example of what this layer catches:

```
Spec:            score <  620 → decline
Generated Java:  score <= 620 → decline
```

One character wrong. Every applicant with exactly 620 gets declined who should not be. This is a generation defect — we want to catch it here, not in production.

---

### Layer C3 — Verification

**Question: Does the implementation actually behave as intended when executed?**

This is where CI/CD tests live: unit → component → integration → live dependency → acceptance → end-to-end.

Plus two checks that matter most for our platform:

**Backtest** — run old workflow and new workflow on the same historical applications:

```
100,000 historical applications

Old:  Approved 71%   Declined 25%   Review 4%
New:  Approved 69%   Declined 27%   Review 4%
```

Then explain why the 2% moved. Every moved application gets a label: *intended policy change* or *defect*. Without the labels, the number means nothing.

**Shadow test** — new version runs beside the live one, on real traffic. Its answers are thrown away. Only compared:

```
10,000 shadow executions
Same decision:       9,921
Different decision:     79  → investigate
```

Those 79 are the most useful evidence we can get before switching versions.

AI checks (advisory): generate edge cases, explain test failures, group failures, label backtest differences.

---

### Layer C4 — Runtime

**Question: For each real application, did the platform execute according to the approved design?**

After the application finishes (never during — zero added latency):

Deterministic checks — these produce the verdict:
- Did it take an allowed path through the BPMN?
- Did every rule in the spec hold true in the real data?
- Was it running the right versions?

ML (advisory): data drift, path anomalies, outcome drift, latency anomalies.
AI (advisory): explain a decision in plain words, summarize incidents, suggest root cause.

---

## The proof — what we can show for any application

```
APP-19282

PRD              v8
Spec             v14
BPMN             v21
Decision DAG     v37
Java artifact    SHA abc...
Step Function    v12
Container        SHA xyz...
Rules            v28
Flag state       hash ff1...
Evaluator        v3
Approved by      J. Okafor, 2026-06-14

Observed path:   A → B → D → F
Expected path:   A → B → D → F

Decision:        DECLINE
Conformance:     PASS
```

A regulator can pick any application, years later, and we hand them this. Every line is a version we can fetch. Re-run the check and you get the same answer. That is the whole point.

---

## Why both AI and deterministic

- The problems worth catching early are **meaning** problems. Only AI can compare meaning.
- The verdict must be **repeatable forever**. Only deterministic code can promise that.

So: **AI finds and explains. Code decides.** AI output that matters gets frozen and signed by a human — after that it never changes.

---

## Where each layer runs

| Layer | When | Where the record lives |
|---|---|---|
| C1 Design | When intent is created | Git (signed, versioned) |
| C2 Generation | On every PR | CI build records |
| C3 Verification | Before every deploy | CI + deploy records |
| C4 Runtime | After every real application | Tenant's DynamoDB store |

Each record points to the one before it (by hash). Follow the chain backwards from any decision and you reach the human who approved the intent. That chain is the audit story.

---

## What we ask leadership to decide

1. Which layers does our team own vs. Oracle? (C4 is clearly ours; C1–C2 run in their tooling)
2. How does a running application know which intent version governs it? (Marked "out of scope" today — nothing works without it)
3. Is conformance a gate, a monitor, or both?
4. When a check fails in production — do we only page someone, or do we also stop the damage (flags, rollback)?
5. Where do backtesting and shadow testing formally live?

---

## Decisions already made

**Conformance is mandatory. Tenants cannot opt out.**

Every workflow built on this framework is checked. There is no `enableSemantic: false`, no `skipInvariants`, no tenant switch that turns the control off.

Why: a control a tenant can disable is not a control a regulator will accept. If any tenant can opt out, we cannot say "every decision on this platform is verified" — we can only say "every decision except the ones nobody checked." That sentence is worth nothing in an audit.

What this changes:
- Conformance moves into the CDK constructs as a fixed part of the framework, not a configurable add-on
- Tenant configuration covers *how they are alerted*, not *whether they are checked*
- Onboarding a tenant means onboarding their conformance at the same time
- Our team's INDETERMINATE rate becomes a platform-wide quality metric, because there is no longer a hidden population

Open follow-on: whether a tenant can operate temporarily in a reduced mode during onboarding, and who approves that.

---

## What we do first (Phase 1)

Build Layer C4 for the pilot, plus the minimum version-binding to make its verdicts real. Two short spikes before building:

- **Spike 1 (2 weeks):** does the runtime trace contain the data our rules need to check? If not — stop and escalate.
- **Spike 2 (1 week):** can an execution resolve its intent version today? If not — verdicts get labeled accordingly and binding becomes the first build item.

Everything else — gates, agents, drift models — layers on after, in phases, on top of a core that already works.
