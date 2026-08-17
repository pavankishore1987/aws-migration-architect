# I=E Conformance — Context Pack (v4)

**Paste this into a new chat with the files listed below.** Replaces `IE_Context_Pack_v3.md` and `IE_Context_Handoff_v2.md`, both now out of date.

**Suggested opening message:**

> Continuing work on I=E conformance. Read the context pack first. Act as my senior architect — plain English, one thing at a time. [What you want to do next.]

---

## 0. The file set

| File | What it is | Status |
|---|---|---|
| `IE_Context_Pack_v4.md` | **This file.** Read first. | current |
| `IE_Solution_Options_and_Recommendation.md` | **The main deliverable.** Three solutions, recommendation, spikes, ADRs, risks, questions. | ⚠️ **add this yourself — see note** |
| `IE_Conformance_Layers_Section.md` | Drop-in section: the five layers with the function at each one. | current |
| `IE_UI_Options_and_Backlog.md` | Document 2 — the visualization capability. | current |
| `IE_Framework_Options_and_Backlog.md` | Earlier packaging options + 31-item backlog. Superseded on options, still useful on backlog. | partly superseded |
| `IE_Conformance_Discovery_WorkingDoc.md` | Deep discovery. Gaps, unknowns, risks, target-state appendix. | reference |
| `IE_Solution_Overview_PlainEnglish.md` | 5-minute plain-English version of the solution. | reference |
| `IE_Conformance_Intent_Doc_transcription.md` | Product requirements, verbatim. | source |
| `IE_Hothouse_Ideation_Deck_transcription.md` | Director's deck, verbatim, including reviewer comments. | source |
| `Sample_Reference_Centrally_Managed_Runtime_transcription.md` | Another team's doc — format reference. | source |

**Note on the missing file:** the Solution Options & Recommendation document was written in a chat session and never saved to disk. Export it from that conversation and drop it in this folder before starting. Without it, the assistant is missing the current recommendation, the ADRs, and the spike list.

---

## 1. Who

**The person** leads **The Workflow Arbiters** — 5 engineers plus themselves — inside a Decisioning Platform organisation. They are the lead/manager; the assistant acts as senior architect.

**Their team owns three capabilities:** I=E conformance, UI/visualization, platform-wide feature flags. Also assigned: auditability, backtesting, shadow testing.

**Two sibling teams:**
- **The Oracle** — SDD/SDK/CDK, AI code generation, GitHub Spec Kit
- **The Func and the Furious** — managed runtime, platform engineering, self-service

**Communication preference (important):** plain English, short sentences, one topic at a time. The person has said the assistant's writing is hard to follow and that they got overwhelmed when several threads ran in parallel. Prefer small answers. Finish one thing before opening another. Produce artifacts rather than long analysis in chat.

---

## 2. The platform

- **Decisioning Platform** — real-time credit application decisioning and auditing; credit cards and partner cards.
- **Two consumption models:** federated (tenant deploys libraries on own infra) or centralized (hosted, API integration). Tenants are internal teams.
- **Framework = orchestrator + JIT decision service.** Orchestrator is AWS Step Functions in ASL. JIT service is **Graphite** — Spring Boot, builds workflows as DAG graphs.
- **CDK** provisions tenant infrastructure; **SDK** turns business requirements into framework artifacts.
- **SDD via GitHub Spec Kit:** PRD → refined PRD (human sign-off) → spec.md + BPMN → review → generated Java graphs, ASL, unit tests, ATDDs → engineer review → CI gates.
- **NFRs:** sub-10-second happy path; regulator-grade auditability; self-service observability; technical and non-technical users.
- **Concerns:** the state machine holds position; **Axon** owns suspension/resolution; a webhook resumes the state machine.
- **RulesLab** — current rule engine, called by the JIT service. Open question: converge into Graphite or stay separate?
- **Status:** pre-launch, piloting **personal loans**. Current production platform runs on **Go + Step Functions** and holds data usable for backtesting.
- **AI infrastructure is a separate environment.** LangGraph/LangChain and any fine-tuned models cannot be deployed on the same infrastructure as the runtime. Confirmed by the person.

---

## 3. The solution, in short

Five conformance layers. Each is a pure function comparing what was approved against what claims to implement it.

```
C0 intent capture   business need ↔ PRD
C1 design           PRD ↔ spec.md + BPMN
C2 generation       spec + BPMN ↔ DAG + ASL
C3 verification     artifact ↔ expected behaviour
C4 runtime          intent ↔ actual execution trace
```

**Technique split, enforced everywhere:**
- **Deterministic** — verdict, path check, invariant evaluation, version binding, sealing. Never AI.
- **LLM (advisory)** — semantic comparison, gap detection, explanation, edge-case generation, backtest labelling.
- **ML (advisory, C4 only)** — drift and anomaly detection. Needs a corpus that does not exist pre-launch.
- **Agentic (advisory, Phase 3)** — investigate, author, onboard, assemble exhibits. Autonomy ladder: observe → propose → act only on reversible non-production → human approval always for production → never autonomous on anything touching a live credit decision.

**The rule that holds it together:** *AI finds and explains. Code decides.*

**Evidence chain — each layer's record in its own trust zone, hash-linked:**

| Layer | Record | Holder |
|---|---|---|
| C0 | Frozen PRD + approval | git / object store |
| C1 | Attestation | git |
| C2 | Binding (intent hash ↔ code SHA) | CI artifact store |
| C3 | Verification result | CI + deploy records |
| C4 | Verdict | Tenant's DynamoDB `WorkflowPersistenceStore` |
| any | Override record | with the bypassed gate |

Walk backwards from a verdict: verdict → code SHA → intent version → attester → frozen PRD. Five hops from a decision to a named person.

---

## 4. Target architecture — corrected layering

Two earlier diagrams had the agent layer drawn *below* the LLM and ML services, which contradicts the call direction. Corrected order:

```
  Intent plane    Build plane    Runtime plane
        └──────────────┼──────────────┘
                       ▼
     DETERMINISTIC CORE — produces every verdict
          pure evaluator, version-bound, no AI
                       ▼
     EVIDENCE CHAIN — sealed, append only
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
    ACCESS GATE                CONTAINMENT
    persona, tenant,           verdict threshold
    redaction, logged          → trip flag
          ▼
    ANSWER LAYER — agents
    grounded, attested or live
          ▼
    LLM and ML services — called as tools
          ▼
    USER INTERFACE
```

Three rules the diagram encodes:
1. **Agents sit above their tools.** They call LLM and ML; the services do not feed them.
2. **The answer layer sits below the access gate**, so an agent can never retrieve what the asking person could not.
3. **Containment branches off the evidence chain directly.** No agent, and no LLM, in the path of halting a live credit decision.

---

## 5. Decisions made

**D-1 — Conformance is mandatory. No tenant opt-out.** Supersedes the deck's Workflow Flexibility principle and changes POC 5. Open follow-on: is a reduced mode permitted during onboarding, and who approves it?

**D-2 — Deterministic core, agentic shell.** Agents onboard, author, investigate, explain, watch. Agents never compute a verdict.

**D-3 — Adopt Solution C as the target, delivered in three phases. Ask for Phase 1 only.** Phase 1 has the same visible scope as Solution A, but built Solution-C-shaped: pure library core, verdict record carrying the fields the chain needs, attestation captured from day one because it cannot be added retroactively.

**D-4 — The evaluation core is a pure library** (ADR-005). No I/O, no clock, no network, no config. Adapters are the only format-aware code: CLI, MCP server, pipeline, Lambda. The library is built first; MCP is one wrapper among four, not a prerequisite.

**D-5 — Conformance runs outside the execution container**, triggered at the terminal state, CDK-injected. Inside the container it would share the transaction's fate and add latency.

---

## 6. Findings from reviewing the recommendation document

These were raised and not yet actioned:

1. **The Phase 1 ask depends on Q1.** Phase 1 includes C0/C1 attestation, but Q1 asks whether C0/C1 are the team's at all. Either drop attestation from the ask or state that Phase 1 shrinks by a third if Q1 comes back "Oracle".
2. **The Phase 1 estimate does not hold.** 14 person-weeks is 5 weeks of spikes plus 9 weeks of POCs — **no build items at all**. Alert routing, verdict schema, attestation capture, CDK construct and version binding are named in the phase but unestimated. Honest figure is **20–25 person-weeks**, which is still under half a quarter for five engineers.
3. **Phase 1 fails G5 by the document's own assessment.** Every violation it catches means an applicant was already decided wrongly. Name this in the recommendation rather than leaving it in the comparison table.
4. **Run S4 first, not fourth.** Cheapest spike, potentially the most damaging finding.
5. **The POCs are not prototypes — they are the product.** P1, P3 and P5 describe Phase 1's deliverable. Build them as the real library from the first commit with the golden case suite as the harness, or the quarter ends with five demos that still need productionising.
6. **R9 (four un-negotiated dependencies) is arguably R1.** Phase 1 needs two of those conversations to go well; Phase 2 needs all four. They move on other teams' calendars.

---

## 7. Open questions for leadership

| # | Question | Why it matters |
|---|---|---|
| Q1 | Do C0 and C1 belong to us or to Oracle? | Changes scope by roughly a third. Blocks the Phase 1 ask |
| Q2 | Who owns closing the intent version binding gap? | Nothing works without it |
| Q3 | Is conformance a gate, a monitor, or both? | The reviewer argued gating; the deck adopted monitoring; nobody reconciled them |
| Q4 | When a check fails in production, does anything stop? | Determines whether containment and feature flags are in scope |
| Q5 | Do we accept the phased commitment? | Determines what starts Monday |

---

## 8. Architect questions with no answers yet

- What is actually inside a `STEP#` payload — full response, projection, or summary?
- **Are the deck's six invariants post-execution assertions or authoring-time tests?** INV-003 verifies call count with a mock/spy, which cannot run in production. *Sharpest single finding across all sessions.*
- **Nothing defines INCOMPLETE.** The verdict has three values; only two have criteria. POC 4 introduces `INCOMPLETE_TRACE` separately without stating the relationship. Blocks both the engine and the UI.
- Do BPMN gateway conditions reference anything outside the step payload — time, flags, lookups? If so, recalculation is not reproducible.
- Is RulesLab deterministic given the same inputs and rule version?
- Does replay exist anywhere today?
- Who owns the DynamoDB table conformance reads from? Direct reads contend with live `STEP#` writes inside the 10-second budget. A throttled step write costs a credit decision; a delayed verdict costs nothing.
- Would a fine-tuned model in this path fall under model risk governance? Changes how much of Phase 3 is engineering and how much is process.
- May production applicant data reach a model at all? If not, the answer layer works on redacted records only.

---

## 9. Where things stand

**Done:** Solution Options & Recommendation document (three solutions, ADRs, spikes, risks). Discovery working document. UI options and backlog. Conformance layers section with the function at each layer. Three verbatim source transcriptions. Target-state architecture diagram, corrected.

**Not done:**
- Document 3 — feature flags / containment. Not started. Framing exists: conformance produces the proof, visualization is the read path, feature flags are the containment lever.
- The corrected Phase 1 ask, with build items estimated.
- LOE and capability-to-engineer mapping across 6 people — deferred until Q1 is answered.
- The read-contention comparison (direct read vs stream vs replica) written up properly.
- The two contracts — evidence bundle in, verdict record out — as JSON schemas. These are what Oracle and Func build against.

---

## 10. Working style notes

What has worked: producing artifacts, plain-English rewrites, one question at a time, correcting a diagram when the person spots an error rather than defending it.

What has not: opening several architectural threads in parallel, long multi-part answers, adding new ideas after a deliverable was agreed.

If the person starts cross-checking finished work against other tools rather than reading it, name it kindly and offer a shorter path — verify ten key claims rather than a full read.
