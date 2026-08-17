# Workflow Orchestrator Visualization — Solution Options & Recommendation

**Status:** Draft for alignment
**Owner:** Workflow Arbiters
**Audience:** Director, Senior Architect, Product
**Purpose:** Three complete solutions for the visualization whitespace, wireframes, a recommendation, and the spikes that must succeed for it to hold.

Companion to `IE_Solution_Options_and_Recommendation.md`. Same structure, same task types.

---

## Summary

The write path is designed. The read path is not.

All three personas in the conformance requirements describe retrieval moments — *when a regulator asks*, *produce on demand*, *point to it later*. None of them can be served today. A verdict written into a tenant's DynamoDB store is not evidence anyone can use until a person can find it and understand it.

This document presents three solutions. They differ in **how much the tool explains, and to whom**. A recommendation follows, with wireframes, spikes, decision records, and the questions we need answered.

**Out of scope:** the conformance engine itself, the runtime data layer (Func), the workflow definition source (Oracle), and the feature flag capability.

---

## What already exists

| Asset | State |
|---|---|
| React Flow execution graph — nodes with status, duration, dependencies, inputs/outputs, class name, View Code link, Replay button | Built, not bound to real trace data or version-bound |
| Nov 2024 destination-state designs — home dashboard, tenant intent screen, workflow and rules screens, admin UI with tenants, access, audit trail, catalog | High fidelity, eighteen months old, predates the conformance work |
| Conformance verdict | Being built. Appears in none of the designs |

The Nov 2024 intent screen already captures a plain-English intent statement, a "why is this important" field, expected outcomes, version and owner. That is the business language an explanation layer needs — the design anticipated it.

---

## Goals & constraints

| ID | Description |
|---|---|
| G1 | Any user, technical or not, can find one application and understand what happened without asking an engineer |
| G2 | A tenant sees only their own decisions |
| G3 | The explanation is derived from declared intent and never generated freely at read time |
| G4 | The engineer's technical depth is a deeper level of the same tool, not a separate one |
| G5 | A risk manager can produce a defensible record for a regulator on demand |
| G6 | Every view is attributable — who looked at whose decision, and why |
| G7 | Onboarding a tenant to the UI requires no platform team involvement |
| C1 | Read-only. Never write to anything the decisioning path depends on |
| C2 | No applicant PII reaches a client that is not entitled to it. Redaction happens server-side |
| C3 | Works for federated and centrally-hosted tenants |
| C4 | Fail-safe. If the UI is unavailable, decisions continue |

---

## The four capabilities

Every solution is described against these. They are the same in all three; what differs is which are delivered.

| Capability | What it does |
|---|---|
| **V1** Find | Search and filter applications, scoped to the tenant |
| **V2** Show | Render the execution — path, timings, payloads, rules fired, verdict |
| **V3** Explain | State in plain English what happened and why, derived from declared intent |
| **V4** Prove | Export a record that stands on its own in front of a regulator |

---

# Solution A — Execution viewer

**One sentence:** bind the graph that already exists to real data, and give it to engineers.

## What is built

The existing React Flow frontend, connected to the runtime execution store through a read API. Search by application ID. Node detail with timings, payloads and a source link.

## Capability behaviour

| | |
|---|---|
| **V1 Find** | Search by application ID and date. Tenant scoping enforced at the query |
| **V2 Show** | Full technical view — graph, timings, payloads, class names, source links |
| **V3 Explain** | Not delivered. The graph is the explanation |
| **V4 Prove** | Not delivered. No verdict panel, no export |

## What it serves

Engineers diagnosing a paged failure. That is a real need and it is served well.

## What it cannot serve

Compliance, risk, or intent owners — the three personas the requirements were written for. A non-technical stakeholder looking at a DAG with Java class names is exactly the situation the problem statement describes.

**Every persona in the requirements except one is left asking an engineer.** That is the defining property.

## Assessment

| | |
|---|---|
| G1 anyone understands it | ❌ **Fails outright** |
| G2 tenant isolation | ✅ |
| G3 explanation from intent | ❌ n/a |
| G4 depth in the same tool | ⚠️ Only the deep level exists |
| G5 regulator-ready record | ❌ |
| G6 attributable views | ⚠️ Access logged, no justification captured |
| G7 self-service onboarding | ✅ |

**Effort:** ~10 person-weeks. **Time to first screen:** fastest.

---

# Solution B — Explanatory read path

**One sentence:** add the access gate, the plain-English layer and the verdict, so the people who need to verify a decision can do it themselves.

## What is built

Everything in Solution A, plus: the server-side access gate with persona gating and redaction, business justification capture, the plain-English explanation renderer, the conformance verdict panel, and the audit exhibit export.

## Capability behaviour

| | |
|---|---|
| **V1 Find** | As A, plus filters on outcome and verdict, and a per-workflow application list |
| **V2 Show** | As A, gated by persona. Payloads redacted server-side for roles not entitled to them |
| **V3 Explain** | **Delivered.** A paragraph and an ordered step list, rendered deterministically from the approved intent at the governing version. Toggle between plain and technical |
| **V4 Prove** | **Delivered.** Export an exhibit that verifies against the hash chain independently |

## What it serves

All four personas. Compliance sees whether the decision went through the steps it should have. Risk sees which rules fired. The intent owner sees the outcome and the reason. The engineer gets the technical layer underneath, in the same view.

## What it cannot serve

Anyone who wants to *change* something. Intent edits, test authoring and approvals all still happen elsewhere.

## Assessment

| | |
|---|---|
| G1 anyone understands it | ✅ |
| G2 tenant isolation | ✅ Enforced server-side |
| G3 explanation from intent | ✅ Deterministic, no generation at read time |
| G4 depth in the same tool | ✅ |
| G5 regulator-ready record | ✅ |
| G6 attributable views | ✅ Justification captured, views logged |
| G7 self-service onboarding | ✅ |

**Effort:** 28 person-weeks. See `IE_Capabilities_and_LOE.md` for the feature-level breakdown.

---

# Solution C — Single surface

**One sentence:** one place where a tenant reads decisions, writes intent, authors tests in English, and approves.

## What is built

Everything in Solution B, plus: the intent screen with plain-English authoring, LDT plans rendered in English, English test-case capture round-tripping into Oracle's pipeline, and the approval surface where attestation happens.

## Capability behaviour

As Solution B, plus a write path: intent editing, test authoring, and the attestation step that anchors the conformance evidence chain.

## What it serves

The platform ambition — *"a single UI where users can do everything in one place."* It also happens to be where C0 and C1 attestation would live, which is why it connects to the conformance recommendation.

## What it cannot serve

Delivery in any near horizon. It overlaps Oracle's pipeline substantially and requires their agreement on where authoring lives.

## Assessment

Same as Solution B on G1–G7, plus the attestation surface. The difference is scope and dependency, not capability gaps.

**Effort:** 28 person-weeks plus an unestimated authoring surface. Cannot be scoped until Q1 in the conformance document is answered.

---

# Compare & contrast

| Dimension | A · Viewer | B · Explanatory read path | C · Single surface |
|---|---|---|---|
| **Capabilities** | V1, V2 | V1–V4 | V1–V4 + authoring |
| Serves engineers | ✅ | ✅ | ✅ |
| Serves compliance | ❌ | ✅ | ✅ |
| Serves risk | ❌ | ✅ | ✅ |
| Serves intent owners | ❌ | ✅ | ✅ |
| Plain-English explanation | ❌ | ✅ | ✅ |
| Persona gating and redaction | ❌ | ✅ | ✅ |
| Business justification captured | ❌ | ✅ | ✅ |
| Verdict visible | ❌ | ✅ | ✅ |
| Regulator-ready export | ❌ | ✅ | ✅ |
| Attestation captured | ❌ | ❌ | ✅ |
| Dependency on Oracle | ⚠️ Definition rendering | ⚠️ Definition + intent language | ❌ High — pipeline overlap |
| Dependency on Func | ⚠️ Read path | ⚠️ Read path | ⚠️ Read path |
| Reversible if wrong | ✅ | ✅ Phase 1 = Solution A | ⚠️ |
| Effort | ~10 pw | 28 pw | 28 pw + unscoped |

## Why not A

It rebuilds the bottleneck the problem statement describes. The document is explicit: the people closest to the business or regulatory consequences of a decision are the least able to verify it. A tool only an engineer can read leaves that exactly as it is.

**Use it as a phase, not a destination.**

## Why not C yet

The authoring surface is a different product, it overlaps Oracle's pipeline, and it cannot be scoped until C0/C1 ownership is settled. Committing to it now commits to a negotiation that has not started.

## Why B

It is the smallest thing that satisfies the requirements as written. Every product requirement in the visualization intent document — tenant-scoped search, technical and plain-English toggle, explanation derived from declared intent, business justification, persona gating — lands in Solution B and none of them lands in A.

It is also the read path the conformance work needs. A verdict nobody can retrieve is not evidence.

---

# Recommendation

**Adopt Solution B, delivered in two phases, with Phase 1 built so that Solution C remains possible.**

## Phase 1 — find and show, gated

The access gate, tenant scoping, persona gating and redaction, business justification, search, the graph bound to real trace data at the governing version, and the verdict panel.

**No explanation layer in Phase 1.** It depends on the language question (S3 below), and the gate must exist before real decision data is shown to anyone.

**Exit:** a compliance reviewer finds one application and sees its verdict, with applicant identifiers hidden and the view recorded.

## Phase 2 — explain and prove

The explanation renderer, the plain/technical toggle, the audit exhibit export, and the rules view.

**Exit:** a regulator-shaped question answered end to end from the screen, and an exhibit that verifies independently.

## Kept open for Solution C

The intent screen already exists in design. Do not rebuild it — bind it. The attestation surface, if it becomes ours, plugs into the same access gate rather than needing a second one.

---

# Wireframes

The five wireframes below are the static reference. A working prototype of the same screens —
clickable navigation, filters, search, the plain/technical toggle, a role switcher and a tenant
switcher — is in `UI_Prototype_Interactive.html`. Open it in a browser; nothing needs to be installed.

Worth trying in the prototype, because these are the requirements as behaviour rather than prose:

- **Change the role** at the top right. Same application, four different screens. The intent owner loses the technical view; compliance sees no payload; the engineer sees an applicant identifier but never a name; export is enabled only for compliance.
- **Change the tenant.** Collections becomes readable and the Acquisitions workflows go dark.
- **Open APP-19279** — a hard failure, with the violated rule named and the offending step marked.
- **Open APP-19274** — incomplete, and the screen says plainly that it cannot tell you what happened.


## W1 — Workflows

```
┌────────────────────────────────────────────────────────────────────┐
│ Decisioning Platform   [Acme — Acquisitions ▾]   Viewing as [role ▾]│
├──────────┬─────────────────────────────────────────────────────────┤
│ BUILD    │ Workflows                                               │
│  Workflows│ Only deployed workflows have applications to inspect.  │
│  Decisions│                                                        │
│  Rules   │ ┌────────┐┌────────┐┌──────────┐┌────────────┐          │
│  Data    │ │Deployed││Apps 7d ││ Passed   ││Need attn.  │          │
│ OPERATE  │ │   4    ││312,481 ││  99.7%   ││    63      │          │
│  Executions└────────┘└────────┘└──────────┘└────────────┘          │
│  Monitoring                                                        │
│  Alerts  │ [All][Deployed][Draft][Has failures]      [search…]     │
│ GOVERN   │ ┌─────────────────────────────────────────────────────┐ │
│  Conformance│Workflow      Status   Intent  Apps   Conformance    │ │
│  Audit trail│Credit Dec.   Deployed v14     184k   99.9% passed → │ │
│  Access  │ │Onboarding    Deployed v9       86k   100% passed  → │ │
│          │ │Collections   Not visible — another tenant           │ │
│          │ │Fraud Review  Draft    —        Not deployed         │ │
│          │ └─────────────────────────────────────────────────────┘ │
└──────────┴─────────────────────────────────────────────────────────┘
```

Draft workflows show "not deployed" rather than a zero. Another tenant's workflow is listed but not retrievable — decide whether even that is acceptable (see Q3).

## W2 — Applications in one workflow

```
┌────────────────────────────────────────────────────────────────────┐
│ ⚠ Viewing as Compliance reviewer. Applicant identifiers hidden.    │
│   Every application you open is recorded.  Justification: FCA…     │
├────────────────────────────────────────────────────────────────────┤
│ Workflows › Credit Decision — Real Time                            │
│ Intent v14 · attested by J. Okafor, 14 Jun 2026 · rules v28        │
│ [Intent][Workflow][Rules][Applications•][Conformance][History]     │
│                                                                     │
│ ┌────────┐┌────────┐┌────────┐┌────────────┐                       │
│ │Apps    ││Passed  ││Failed  ││Incomplete  │                       │
│ │184,207 ││184,154 ││   41   ││    12      │                       │
│ └────────┘└────────┘└────────┘└────────────┘                       │
│                                                                     │
│ [All][Failed][Incomplete][Declined]            [search app ID…]    │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │Application  Started    Dur.  Decision   Conformance    Intent   ││
│ │APP-19282    09:41:07   1.2s  Decline    Passed         v14   →  ││
│ │APP-19279    09:40:31   2.4s  Decline    Failed — hard  v14   →  ││
│ │APP-19274    09:39:11   1.6s  —          Incomplete     v14   →  ││
│ │APP-19268    09:38:02   0.9s  Decline    Passed         v13   →  ││
│ └─────────────────────────────────────────────────────────────────┘│
│ Each application is checked against the version that governed it.  │
└────────────────────────────────────────────────────────────────────┘
```

The intent version column is the visible consequence of version binding. If that spike fails, this column is the first thing that breaks.

## W3 — One application, plain English

```
┌────────────────────────────────────────────────────────────────────┐
│ APP-19282   [Conformance passed]  [Decision: Decline]              │
│ 14 June 2026, 09:41:07 UTC · 1.22s · Credit Decision v14           │
│                                                                     │
│ [Plain English•][Technical]          ┌──────────────────────────┐  │
│ ┌────────────────────────────────┐   │ CONFORMANCE              │  │
│ │ What happened                  │   │ Passed                   │  │
│ │                                │   │ ✓ Path — valid predecessors│ │
│ │ The application was received…  │   │ ✓ Invariants — 6 of 6    │  │
│ │ A credit file was retrieved    │   │ ✓ Trace — complete       │  │
│ │ once. The score fell below the │   ├──────────────────────────┤  │
│ │ approved threshold, so it was  │   │ WHAT WAS IN FORCE        │  │
│ │ declined and the reason        │   │ Intent      v14          │  │
│ │ recorded.                      │   │ Attested by J. Okafor    │  │
│ │                                │   │ Code        4c1f7ab      │  │
│ │ ① Read application             │   │ Rules       v28          │  │
│ │ ② Retrieve credit file         │   │ Flag state  ff1a09c      │  │
│ │ ③ Assess against policy        │   │ Evaluator   v3           │  │
│ │ ④ Make decision                │   ├──────────────────────────┤  │
│ │ ⑤ Record and publish           │   │ [Export audit exhibit]   │  │
│ │ ─────────────────────────────  │   │ [Verify seal]            │  │
│ │ Written from the approved      │   └──────────────────────────┘  │
│ │ intent for v14, attested by    │                                 │
│ │ J. Okafor. Same wording every  │                                 │
│ │ time. Nothing generated now.   │                                 │
│ └────────────────────────────────┘                                 │
└────────────────────────────────────────────────────────────────────┘
```

The provenance line is the "no hallucination" requirement made visible to the reader.

## W4 — Same application, technical

```
┌────────────────────────────────────────────────────────────────────┐
│ [Plain English][Technical•]                                        │
│ ┌────────────────────────────────────────────────────────────────┐ │
│ │  ┌─────────┐   ┌─────────┐   ┌─────────┐                       │ │
│ │  │Read app │──▶│Credit   │──▶│Assess   │                       │ │
│ │  │ 412 ms  │   │file 318 │   │policy 96│                       │ │
│ │  └─────────┘   └─────────┘   └────┬────┘                       │ │
│ │                ┌─────────┐   ┌────▼────┐                       │ │
│ │                │Write    │◀──│Make     │                       │ │
│ │                │result   │   │decision │                       │ │
│ │                └─────────┘   └─────────┘                       │ │
│ ├────────────────────────────────────────────────────────────────┤ │
│ │ Step          Make decision                                    │ │
│ │ Class         com.acme.graphite.credit.node.MakeDecision       │ │
│ │ Source        View code at 4c1f7ab                             │ │
│ │ Predecessor   Assess policy — valid edge in BPMN v21           │ │
│ ├────────────────────────────────────────────────────────────────┤ │
│ │ { "applicantId": [hidden for your role],                       │ │
│ │   "applicantName": [hidden for every role],                    │ │
│ │   "score": 612, "policyThreshold": 620 }                       │ │
│ └────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

Redaction is shown, not silent. A blank field reads as missing data; a marked one tells the truth.

## W5 — Incomplete

```
┌────────────────────────────────────────────────────────────────────┐
│ APP-19274   [Conformance incomplete]                               │
│ ┌────────────────────────────────┐   ┌──────────────────────────┐  │
│ │ We cannot say what happened to │   │ Incomplete               │  │
│ │ this application. One step did │   │ — Path — not evaluated   │  │
│ │ not record what it did, so the │   │ — Invariants — not eval. │  │
│ │ check could not be completed.  │   │ ✕ Trace — 1 record missing│ │
│ │                                │   │                          │  │
│ │ This is not a finding that the │   │ Incomplete means the     │  │
│ │ workflow behaved incorrectly.  │   │ record was not good      │  │
│ │ It is a gap in the record.     │   │ enough to check. Criteria│  │
│ └────────────────────────────────┘   │ are not yet defined.     │  │
│                                       └──────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

**This screen is why INCOMPLETE has to be defined.** A verdict value with no criteria cannot be evaluated, displayed, or explained to a compliance officer.

---

# What must be true for this to work

| ID | Must be true | How we test it | Kill criterion | Est |
|---|---|---|---|---|
| **S1** | There is a read path to execution data that does not contend with live writes | Confirm the API, stream or replica with Func. Load-test under concurrent write | If reads must hit the operational table, the UI inherits the conformance contention problem and both need one answer | 2w |
| **S2** | The UI can render the workflow definition at the version that governed a given execution | Trace an execution to its spec commit through existing binding | If not, the graph shows *a* workflow, not *the* workflow, and compliance cannot rely on it | 1w |
| **S3** | spec.md carries per-step business language a non-engineer can read | Inspect the pilot's spec artifacts. Check whether the intent screen's plain-English statement survives into spec.md | If not, an authoring step must be added to Oracle's pipeline — cross-team commitment, escalate | 1w |
| **S4** | Tenant identity can be established from existing platform auth | Review the platform's auth model with Func | If no mechanism exists, the gate must build one, which materially changes Phase 1 | 1w |
| **S5** | Federated tenants' executions can be surfaced. Run jointly with the conformance federated spike | Confirm the pilot tenant's consumption model | If federated data cannot reach a central UI, the read path fragments per tenant | 2w |

## Phase 1 POCs

| ID | Proves | Success criterion | Est |
|---|---|---|---|
| **P1** | One execution end to end | An engineer answers "what happened to APP-19282" using only the screen | 3w |
| **P2** | Isolation holds | An Acquisitions user cannot retrieve Collections data by any route, including a direct API call with a valid token | 1w |
| **P3** | Two views, one source | The plain and technical views render from one data path, and no sentence in the plain view is absent from declared intent | 1w |

---

# Decision records

## UI-ADR-001 — The explanation is rendered deterministically from declared intent.

**Status:** Proposed
**Context:** The requirement states the "why" must derive from the declared source of truth this squad owns and must not hallucinate outside declared intent.
**Decision:** Phase 2 renders the explanation from a template filled with declared intent and the actual path. No model call at read time. A later enhancement may have AI draft the text at authoring time, which a human attests and which is then frozen per intent version.
**Rationale:** Two people asking about the same decision must get the same words. A model called at read time cannot promise that.
**Consequences:** The explanation is only as good as the language in spec.md. S3 decides whether that language exists.

## UI-ADR-002 — Redaction happens server-side and is shown, not hidden.

**Status:** Proposed
**Decision:** Fields a persona is not entitled to never leave the API. The client renders a visible marker where a value was removed.
**Rationale:** Client-side redaction is not redaction. And a blank field is indistinguishable from missing data, which invites the wrong conclusion.
**Consequences:** The persona and field visibility matrix is a specification, not a config. It needs compliance sign-off.

## UI-ADR-003 — Viewing is an auditable event.

**Status:** Proposed
**Decision:** Every retrieval of a decision records who, when, and under what justification. Exports are recorded separately.
**Rationale:** The requirement asks for business justification. A justification nobody records is a prompt, not a control.
**Consequences:** The access log is itself audit evidence with its own retention requirement.

---

# Risks

| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | spec.md may carry no business language | The explanation layer needs an authoring step inside Oracle's pipeline | S3 before Phase 2 |
| R2 | Intent version binding is unresolved in the conformance work | The graph cannot be shown at the governing version | Shared with conformance S2 |
| R3 | The Nov 2024 designs predate conformance and show no verdict | Designs may be reused without the thing the tool now exists to show | Confirm design direction before build |
| R4 | The persona matrix has no named owner. The requirements document's User Persona section is an empty header | The redaction specification cannot be written | Q1 below |
| R5 | Team capacity spans conformance, UI and feature flags | Both this and the conformance Phase 1 cannot run at full pace | Explicit phasing and a leadership decision |
| R6 | Reads contend with live executions | A throttled step write costs a credit decision | Shared with conformance S3 |

---

# Questions for this session

| # | Question | Who answers |
|---|---|---|
| **Q1** | Who are the named personas, and who signs off the field visibility matrix? The requirements document's persona section is empty | Product, Compliance |
| **Q2** | Does business justification block access, or is it only recorded? | Compliance, Product |
| **Q3** | Should another tenant's workflows be listed but unreadable, or hidden entirely? | Architect, Compliance |
| **Q4** | Are the Nov 2024 designs the intended direction, or reference only? | Director, Design |
| **Q5** | Is this a read-only tool, or the single surface including intent changes and approvals? | Director, Oracle |
| **Q6** | What defines INCOMPLETE, and what does the screen say when it happens? | Product, Architect |

---

# What we are asking for

**A decision on Phase 1 only** — find and show, behind the access gate. Roughly a third of a quarter with the team split across capabilities, and five spikes run first, three of which are shared with the conformance work and should be run once rather than twice.

Phase 2 is direction. Phase 1 leaves a coherent tool on its own: a compliance reviewer can find a decision and see its verdict, and every view is attributable.
