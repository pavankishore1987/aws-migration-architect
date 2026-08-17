# Workflow Orchestrator Visualization — Solution Options & Delivery Backlog

**Team:** Workflow Arbiters
**Status:** Draft for alignment
**Purpose:** Scope, the two decisions that shape the build, and the decomposed work — spikes, POCs, refinements and build tasks — ready to load into Jira.

Companion to `IE_Framework_Options_and_Backlog.md`. Same shape, same task types.

A React Flow graph component already exists, plus high-fidelity design assets from Nov 2024. Everything else below is work to be created.

---

## 1. Goal

Any user — technical or not — opens the UI, searches one workflow execution, and understands what happened without asking an engineer.

Success means:

- **Compliance** can see whether a decision went through the steps it should have.
- **Business / intent owners** can see the outcome and why, without reading code.
- **Risk** can see which conditions and rules fired for a specific applicant.
- **Engineers** get step timing, inputs/outputs and a link to source — in the same tool, one level deeper, not a separate one.
- A tenant sees only their own decisions.
- The "why" is derived from declared intent. It is never generated freely at read time.

The last point is the whole difficulty. Everything else is a normal application.

---

## 2. Scope boundary

This document covers the **read path**: search, view, explain, export.

The platform notes ask for something larger — *"a single UI where users can do everything in one place — visualization, intent changes, approvals"* — plus English-language LDT plans, English test authoring, and AI-assisted test-plan generation.

That is a different product: an authoring and approval surface. It is captured here as **Epic U6, Phase 2**, and it needs a scope decision before it is estimated seriously. It also overlaps Oracle's pipeline.

**Not in this document:** the conformance engine itself (see the I=E backlog), the runtime database and API (Func), the workflow definition source (Oracle).

---

## 3. What already exists

| Asset | State | Gap |
|---|---|---|
| React Flow graph — nodes with status, duration, dependencies, inputs/outputs, node class, "View Code" | Built | Not bound to real trace data; no version binding |
| Design assets — tenant home, intent screen, workflow and rules screens, admin UI (tenants, access, audit trail, catalog) | Nov 2024, high fidelity | Not validated against current personas or data model |
| Execution trace — `EXECUTION_RECORD` + `STEP#` in tenant DynamoDB | Exists in the platform design | Read contract, latency and tenant scoping unconfirmed |
| Conformance verdict | Being built | Panel has nothing to display until I=E Epic 1–2 land |

---

## 4. High-level architecture

```
   WHO IS ASKING                    WHAT THEY GET

   identity + tenant claim
   + persona + justification
            │
            ▼
   ┌──────────────────┐
   │  ACCESS GATE     │   tenant scoping, persona gating,
   │  (server side)   │   PII redaction, access logged
   └────────┬─────────┘
            │
   ┌────────┴──────────────┬────────────────────┐
   ▼                       ▼                    ▼
┌─────────────┐    ┌──────────────┐    ┌────────────────┐
│ EXECUTION   │    │ INTENT       │    │ CONFORMANCE    │
│ TRACE       │    │ spec + BPMN  │    │ VERDICT        │
│ (Func)      │    │ at governing │    │ + violations   │
│             │    │ version      │    │ + seal (I=E)   │
└──────┬──────┘    └──────┬───────┘    └───────┬────────┘
       └──────────────────┼────────────────────┘
                          ▼
             ┌────────────────────────┐
             │  EXPLANATION RENDERER  │   deterministic
             │  declared intent only  │   no free generation
             └───────────┬────────────┘
                         ▼
       ┌─────────────────┴─────────────────┐
       ▼                                   ▼
  PLAIN-ENGLISH VIEW                 TECHNICAL VIEW
  what happened, in order,           graph, timings, payloads,
  and why — one paragraph            rules fired, source links
```

One data path. Two renderings of it. The technical view is the plain view with more depth revealed, not a different screen.

---

## 5. Decision 1 — where the "why" comes from

The requirement is explicit: the explanation must come from the declared source of truth this team owns, and must not invent explanations outside declared intent.

| | A · Templated from intent | B · Attested LLM text | C · LLM at read time |
|---|:---:|:---:|:---:|
| Cannot hallucinate | ✅ | ✅ frozen and signed | ❌ |
| Same execution, same words, every time | ✅ | ✅ | ❌ |
| Reads well in English | ⚠️ stiff | ✅ | ✅ |
| Needs business language in spec.md | ✅ yes | ✅ yes | ❌ |
| Human accountable for the words | ✅ spec author | ✅ attester | ❌ nobody |
| Survives a regulator asking "who wrote this" | ✅ | ✅ | ❌ |
| Cost per view | ✅ none | ✅ none | ❌ per render |

**A generates the paragraph** by filling a template per step from declared intent, then stitching the steps the execution actually took.

**B generates the paragraph once** — at authoring time, per intent version — has a human attest it, freezes it, and replays that same text for every execution of that version. AI drafts; a person signs; the record never changes afterwards.

**C generates on every view.** Ruled out. Two people could ask about the same decision and get different explanations, which is the failure mode the requirement was written to prevent.

**Recommendation: A for Phase 1, B as the Phase 2 enhancement, C ruled out.** This is the same rule as the engine — *AI finds and explains, code decides* — applied to the read path. Migration from A to B is cheap: the renderer is unchanged, only the source of each step's sentence moves from a template to an attested string.

**Dependency:** both A and B require spec.md to carry per-step business language. It may not. That is spike U3-S5, and it is a kill criterion — if the language is not there, an authoring step has to be added to Oracle's pipeline, and that is a cross-team commitment, not a UI task.

---

## 6. Decision 2 — how the UI reaches federated tenants

A central UI can read a centrally-hosted tenant's data. A federated tenant's execution data sits in their account, on their infrastructure.

| | 1 · Central UI, central tenants only | 2 · Central UI, federated evidence pushed | 3 · UI deployed per tenant |
|---|:---:|:---:|:---:|
| Serves central tenants | ✅ | ✅ | ✅ |
| Serves federated tenants | ❌ | ✅ | ✅ |
| One place to look | ✅ | ✅ | ❌ |
| Cross-account access needed | ✅ none | ✅ none — push, not pull | ✅ none |
| Tenant can silently stop publishing | ✅ n/a | ⚠️ yes | ⚠️ yes |
| Fleet upgrade story | ✅ easy | ✅ easy | ❌ hard |
| Time to first version | ✅ fastest | ⚠️ | ❌ |

**Recommendation: 1 for the pilot, 2 as the target.** The pilot tenant's model should be confirmed first — spike U1-S3. Option 2 shares a mechanism with the I=E federated diagnostics spike (E5-S9); the two should be run as one piece of work, not twice.

---

## 7. Delivery backlog

Task types, as before:

- **SPIKE** — answer a question. Timeboxed. Has a kill criterion.
- **POC** — prove something works. Has a success criterion.
- **REFINEMENT** — a decision made with named people. Produces a written decision.
- **BUILD** — delivery work.

---

### EPIC U1 — Prove the read path *(blocks everything)*

| ID | Type | Title | Detail | Est |
|---|---|---|---|---|
| U1-S1 | SPIKE | Execution data read contract | What does Func expose — API, stream, replica? Latency, tenant scoping, pagination, retention. **Kill criterion:** if there is no read path that does not touch the operational store, the UI inherits the I=E contention problem (E3-S6) and both need the same answer. | 2w |
| U1-S2 | SPIKE | Workflow definition at governing version | Can the UI render the definition that governed *this* execution, not merely the current one? Depends on I=E intent version resolution (E1-S3). **Kill criterion:** if not, the graph shows *a* workflow, not *the* workflow, and compliance cannot rely on it. | 1w |
| U1-S3 | SPIKE | Federated tenant reach | Confirm the pilot tenant's consumption model and whether federated executions can be surfaced centrally. Run jointly with I=E E5-S9. | 2w |
| U1-P1 | POC | One execution, end to end | Search by application ID, render the real graph with real step status, from real trace data, for one pilot workflow. **Success criterion:** an engineer can answer "what happened to APP-19282" using only the screen. | 3w |

---

### EPIC U2 — Access, isolation and redaction

The requirements that stop this being an ordinary dashboard.

| ID | Type | Title | Detail | Est |
|---|---|---|---|---|
| U2-R1 | REFINEMENT | Persona and field visibility matrix | Agree with compliance and risk: which persona sees which field. Every field is either visible, redacted or absent per persona. This document is the specification for U2-B2. | 1w |
| U2-S4 | SPIKE | Tenant identity and scoping mechanism | How does the platform already establish tenant identity, and can the UI inherit it? Build nothing new if an answer exists. | 1w |
| U2-R2 | REFINEMENT | Business justification | What counts as valid justification, is it captured free-text or from a list, does it block access or only get recorded, and who reviews it. | 1w |
| U2-B1 | BUILD | Tenant scoping enforcement | Server-side. Scoping is applied before data leaves the API, never in the browser. | 2w |
| U2-B2 | BUILD | Persona gating and PII redaction | Redaction happens on the server, driven by U2-R1. No SSNs, names or equivalent reach the client for any persona that is not entitled to them. | 3w |
| U2-B3 | BUILD | Access audit trail | Who viewed which decision, when, under what justification. This record is itself audit evidence. | 2w |
| U2-P2 | POC | Isolation negative test | Two tenants, two personas. **Success criterion:** an Acquisitions user cannot retrieve Collections data by any route, including direct API call with a valid token. | 1w |

---

### EPIC U3 — The explanation layer

| ID | Type | Title | Detail | Est |
|---|---|---|---|---|
| U3-R3 | REFINEMENT | Explanation source-of-truth policy | Ratify Decision 1 with the director and compliance. Written and signed off before U3-B4 starts. | 1w |
| U3-S5 | SPIKE | Business language in spec.md | Does the intent artifact carry per-step language a non-engineer can read? **Kill criterion:** if not, an authoring step must be added to Oracle's pipeline — cross-team commitment, escalate. | 1w |
| U3-B4 | BUILD | Explanation renderer | Deterministic. Takes governing intent + actual path + verdict, emits an ordered plain-English paragraph. Same inputs, same words, always. | 3w |
| U3-B5 | BUILD | Attested explanation store | Per intent version: the approved text, the attester, the timestamp, the hash. Frozen at attestation; corrections append. | 3w |
| U3-P3 | POC | Two views, one source | Same execution rendered plain and technical from a single data path. **Success criterion:** no sentence in the plain view is absent from declared intent. | 1w |

---

### EPIC U4 — Search and the execution view

| ID | Type | Title | Detail | Est |
|---|---|---|---|---|
| U4-B6 | BUILD | Search | By application ID, date range, outcome, verdict status. Tenant-scoped at the query, not filtered after. | 2w |
| U4-B7 | BUILD | Graph bound to real trace | Existing React Flow component bound to live execution data, at the governing definition version. | 3w |
| U4-B8 | BUILD | Rules view | Which rules fired for this applicant, at which rule version. Depends on RulesLab exposing per-execution rule detail. | 2w |
| U4-B9 | BUILD | Engineer depth layer | Step timing, inputs/outputs, node class, "View Code" resolving to the source at the governing commit — inside the same view. | 2w |
| U4-B10 | BUILD | Conformance verdict panel | PASS / FAIL / INDETERMINATE, violations, version bindings, seal. Blocked on I=E Epic 2. | 2w |

---

### EPIC U5 — Evidence export

| ID | Type | Title | Detail | Est |
|---|---|---|---|---|
| U5-R4 | REFINEMENT | Exhibit contents | What an exported record must contain to stand alone in front of a regulator. Test for inclusion: would its absence leave a question unanswerable? Align with I=E E4-R2 — same list. | 1w |
| U5-B11 | BUILD | Export | Produce the exhibit, hash-verifiable against the sealed record. Export is an access event and is logged. | 2w |

---

### EPIC U6 — Intent and test-plan surface *(Phase 2 — needs a scope decision)*

| ID | Type | Title | Detail | Est |
|---|---|---|---|---|
| U6-R5 | REFINEMENT | Single-UI scope | Is this a read-only window, or the one place where intent changes and approvals also happen? Decide with the director and Oracle. Everything below is unestimatable until this lands. | 1w |
| U6-S6 | SPIKE | LDT artifacts and ownership | Where do LDTs live, who generates them, and can they be rendered in English rather than Gherkin? | 1w |
| U6-B12 | BUILD | LDT plan and results view | Planned tests in English; results after QA/UAT execution. | 3w |
| U6-B13 | BUILD | English test-case capture | Intent owners add cases in English; they round-trip into Oracle's pipeline. | 3w |

---

## 8. Sequencing

```
  EPIC U1 ─────────────────────────►  read path proven
    │      (spikes parallel, POC after)
    ▼
  EPIC U2 ─────────────────────────►  access model — before any real data is shown
    │
    ├──► EPIC U4   search and views      (U4-B10 waits on I=E Epic 2)
    ├──► EPIC U3   explanation           (U3-S5 can start immediately)
    └──► EPIC U5   export
                                          EPIC U6 — after U6-R5 only
```

**Run first, before committing:** U1-S1, U1-S2, U3-S5. Each has a kill criterion, and U3-S5 may create a cross-team dependency that changes the plan.

**Do not show real decision data to anyone before Epic U2 is complete.** The POC in U1-P1 runs against pilot data with the team as the only audience.

---

## 9. Effort summary

| Epic | Items | Weeks |
|---|---:|---:|
| U1 Prove the read path | 4 | 8 |
| U2 Access, isolation, redaction | 7 | 11 |
| U3 Explanation layer | 5 | 9 |
| U4 Search and execution view | 5 | 11 |
| U5 Evidence export | 2 | 3 |
| **Phase 1 total** | **23** | **42** |
| U6 Intent and test-plan surface | 4 | 8 |
| **Total** | **27** | **50** |

6 spikes (11w), 3 POCs (5w), 5 refinements (5w), 13 build tasks (29w).

For comparison, the I=E backlog is 54 person-weeks. **The two together are roughly 96 person-weeks against a team of five.** They cannot both be Phase 1. That is a leadership conversation, not a sequencing exercise.

---

## 10. Jira import

| Epic | Key | Type | Summary | Est |
|---|---|---|---|---|
| Read path | U1-S1 | Spike | Execution data read contract | 2w |
| Read path | U1-S2 | Spike | Workflow definition at governing version | 1w |
| Read path | U1-S3 | Spike | Federated tenant reach | 2w |
| Read path | U1-P1 | POC | One execution end to end | 3w |
| Access | U2-R1 | Refinement | Persona and field visibility matrix | 1w |
| Access | U2-S4 | Spike | Tenant identity and scoping mechanism | 1w |
| Access | U2-R2 | Refinement | Business justification | 1w |
| Access | U2-B1 | Build | Tenant scoping enforcement | 2w |
| Access | U2-B2 | Build | Persona gating and PII redaction | 3w |
| Access | U2-B3 | Build | Access audit trail | 2w |
| Access | U2-P2 | POC | Isolation negative test | 1w |
| Explanation | U3-R3 | Refinement | Explanation source-of-truth policy | 1w |
| Explanation | U3-S5 | Spike | Business language in spec.md | 1w |
| Explanation | U3-B4 | Build | Explanation renderer | 3w |
| Explanation | U3-B5 | Build | Attested explanation store | 3w |
| Explanation | U3-P3 | POC | Two views one source | 1w |
| Views | U4-B6 | Build | Search | 2w |
| Views | U4-B7 | Build | Graph bound to real trace | 3w |
| Views | U4-B8 | Build | Rules view | 2w |
| Views | U4-B9 | Build | Engineer depth layer | 2w |
| Views | U4-B10 | Build | Conformance verdict panel | 2w |
| Export | U5-R4 | Refinement | Exhibit contents | 1w |
| Export | U5-B11 | Build | Export | 2w |
| Intent surface | U6-R5 | Refinement | Single-UI scope | 1w |
| Intent surface | U6-S6 | Spike | LDT artifacts and ownership | 1w |
| Intent surface | U6-B12 | Build | LDT plan and results view | 3w |
| Intent surface | U6-B13 | Build | English test-case capture | 3w |

---

## 11. Dependencies and open items

**Cross-team dependencies:**

| On | For | Risk if late |
|---|---|---|
| Func | Execution data read path and API layer | U1 stalls; nothing else starts |
| Oracle | Workflow definition at the governing version; business language in spec.md | Graph is unreliable; explanation layer needs a new authoring step |
| RulesLab | Per-execution rule firing detail and rule version | U4-B8 cannot be built |
| I=E (own team) | Verdict, violations, seal | U4-B10 has nothing to show |

**Open questions:**

1. Does spec.md contain business language, or only structure? *(U3-S5 — sharpest risk in this document.)*
2. Is the pilot tenant central or federated?
3. Who are the named personas, exactly, and who signs off the visibility matrix?
4. Does business justification block access or only get recorded?
5. Are the Nov 2024 designs still the intended direction, or reference only?
6. Is this a read-only tool or the single UI including intent changes and approvals? *(U6-R5 — largest scope risk.)*

**Shared work with the I=E backlog — run once, not twice:**

- U1-S3 with E5-S9 (federated reach)
- U1-S1 with E3-S6 (operational store contention)
- U5-R4 with E4-R2 (evidence record contents)
