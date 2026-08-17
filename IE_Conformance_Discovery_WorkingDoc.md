# I=E Conformance — Discovery Working Document

**Owner:** Workflow Arbiters
**Status:** Draft for alignment — not a design proposal
**Purpose:** Surface the open questions, unknowns and risks in the I=E Conformance intent so that leadership, architecture and product can converge on concrete scope.

**Sources of truth for this document**
1. *Workflow Orchestrator I=E Conformance* — Conformance Intent Doc (product requirements)
2. *I = E Architecture* — Conformance Validation Hothouse (ideation deck)

Everything in the two sections below marked **[SRC]** is stated in one of those documents. Everything marked **[INF]** is an inference drawn during discovery and needs confirmation. Nothing here contradicts either source; where a source is silent, this document says so rather than filling the gap.

---

## 1. What we are building — as stated

**[SRC]** Every workflow execution produces a machine-generated, immutable conformance verdict — PASSED, FAILED or INCOMPLETE — evaluated against both the path it took (structural) and the outcomes it produced (semantic). The check runs asynchronously post-execution with no added latency to the business transaction. HARD violations page the tenant's own support team; SOFT violations log for operational visibility. The governing principle is that what the business approved is exactly what ran in production, provable on demand and continuously.

**[SRC]** Validation is described across three timing stages — Design Time, Authoring Time, Post Execution — with named components: `BpmnParser`, `SpecMarkdownParser` and `WorkflowConformanceValidator`.

**[SRC]** Intent is the pair (BPMN XML, specs.md). Execution is DynamoDB state containing `EXECUTION_RECORD`, per-step `STEP#` records and `CONFORMANCE#` records. Neither intent artifact alone is sufficient.

---

## 2. Why — as stated

**[SRC]** Today I=E errors are identified by reactive controls and Business Analysts. The process is manual and reactive, so some errors are not caught for hours, days, months or years. This leads to a larger impacted population size, with adverse regulatory, financial and reputational impact.

**[SRC]** The need grows as the enterprise adopts AI tooling that accelerates intent delivery. I=E conformance is what keeps quality from being compromised as the business moves faster.

**[INF]** Two things follow from the problem statement that the requirements do not currently address. First, the stated grievance is *impacted population size* — a blast-radius problem — but the specified response to a violation is an alert to a single execution's owner. Second, all three personas describe a moment of *retrieval* ("when auditors ask", "I want to be paged … so we can diagnose", "produce on demand"), but the requirements describe the write path in detail and the read path not at all. Both are raised as open questions in §4.

---

## 3. Where things stand today — gap analysis

### 3.1 What the two documents together already settle

| Area | Position | Source |
|---|---|---|
| Verdict values | PASSED / FAILED / INCOMPLETE | Requirements + deck |
| Two-layer check | Structural (path) and semantic (invariants); **both must pass** | Requirements + deck |
| Latency posture | Asynchronous, post-execution, zero impact on workflow latency | Requirements + deck |
| Trigger point | Workflow reaches terminal state / I=E validation step | Requirements AC + deck |
| Trace substrate | DynamoDB `WorkflowPersistenceStore`, keyed by `workflowExecutionId` | Deck |
| Record types | `EXECUTION_RECORD`, `STEP#`, `CONFORMANCE#` | Deck |
| Deployment pattern | Rejected: centralised async service. Adopted: triggered as a terminal state, injected via CDK, running outside the execution container | Deck (both federated and central variants) |
| Severity model | HARD → Compliance Queue + PagerDuty; SOFT → Operational Monitoring Queue | Deck |
| Alerting ownership | Routes to the tenant/intent team, not a central team | Deck design principles |
| Opt-in/opt-out | Workflow authors need granular configuration; `IEValidationConfig { enableStructural, enableSemantic, skipInvariants[] }` | Deck design principles + POC 5 |
| Design-time validation | Hybrid — automated structural completeness checks plus **mandatory** human sign-off, written into specs.md frontmatter at that specVersion | Deck |
| Intent versioning | specs.md and BPMN version-controlled in GitHub alongside code; a commit produces a new version | Requirements + deck |
| POC slate and order | POC 1 → 2 → 4 → 3 → 5; POC 1 is a foundational milestone blocking 2–5 | Deck |

### 3.2 Where the sources are explicitly incomplete

These are not inferences. Each is a place where the source document itself says the work is unfinished.

| # | Gap | Evidence in source |
|---|---|---|
| G-1 | **Code-to-spec linking mechanism is undefined** | Deck, Versioning slide: *"The exact code-to-spec linking mechanism is out of scope, though multiple options have been discussed"* — bundled in the deployable artifact, or stored separately but accessible from the runtime |
| G-2 | **Versioning strategy is unresolved** | Deck carries an explicit callout: *"Spike: Define versioning strategy"* |
| G-3 | **Versioning acceptance criteria are absent** | Requirements doc: `Versioning` heading under Acceptance Criteria with no criteria beneath it |
| G-4 | **One runtime acceptance criterion is incomplete** | Requirements doc: *"GIVEN a workflow is in terminal status / WHEN / THEN it has passed I=E conformance validation"* — the WHEN clause is blank |
| G-5 | **Relevant Context not written** | Requirements doc: *"To Be populated"* |
| G-6 | **INCOMPLETE is never defined** | Named as a verdict value in the Desired Outcome and in `CONFORMANCE#`; no criteria anywhere in either document. `INCOMPLETE_TRACE` appears in the deck as a distinct term without reconciliation |
| G-7 | **Authoring-time structural validation is a stub** | Deck slide "How are we doing Authoring time validation?" — Layer 1 has one bullet plus one empty bullet; Layer 2 says only *"This is mostly covered in unit, component, LDT etc."* |
| G-8 | **Shadow testing and backtesting are one bullet** | Deck lists them under Post-execution Layer 2 with no elaboration anywhere in the deck |
| G-9 | **No design for the read/retrieval path** | Both documents describe writing and persisting verdicts; neither describes how any of the three personas obtains one |
| G-10 | **No response beyond alerting** | Deck defines routing and paging for HARD/SOFT; neither document describes rollback, kill-switch, gating or any containment action |

### 3.3 Reviewer comments raised in the hothouse and not visibly answered

**[SRC]** Six comments were raised on the deck on Aug 5 by one reviewer (Tabryn Palmer). All are marked resolved; no replies are visible in the captured material. They form a single coherent argument and overlap directly with G-7 and G-10, so they are recorded here as input rather than as dissent.

| Time | Substance |
|---|---|
| 10:06 | Clarifying: are intent contracts programmatically generated from spec and BPMN, and does the validator check at runtime as opposed to deployment/test time? |
| 10:09 | Why check constantly at runtime instead of once during deployment/test? Concern that this produces production incidents that should have been pipeline failures or automated rollbacks |
| 10:15 | Little discussion of deployment-time validation. Would hope most or all I=E errors are caught before live traffic — during backtesting/shadow testing, ideally in the CI/CD pipeline |
| 10:20 | Concern that PagerDuty is named as the response to a conformance failure. I=E should be validated before a component receives live traffic; failures should result in pipeline failure or automated rollback rather than a high-priority page |
| 10:26 | Ideally conformance is enforced in the code itself, failing the workflow execution immediately rather than being picked up as a side-effect in another process |
| 10:29 | Not clear why a separate side-car container is needed, given business requirements are known before code is generated |

**[INF]** The reviewer's position and the deck's position are not straightforwardly opposed. Some checks are decidable without runtime data and could gate; some are only decidable against real production data and cannot. Neither document distinguishes between these two classes. That distinction is proposed as Question Q-3.

---

## 4. Value to the platform teams

I=E conformance is framed in both source documents as a control. It is also a **feedback instrument for the two teams building the platform**, and this section states that value explicitly so the work is not read as a tax on their delivery.

The ordering principle we propose: *serve the two platform teams first, extend beyond them second.* Nothing in Phase 1 should require Oracle or Func and the Furious to do work that does not also benefit them.

### 4.1 Value to The Oracle — the SDD, SDK and CDK team

**[SRC]** The deck's own POC 1 note reads: *"Validate that the SDD-generated instrumentation actually produces the trace structure the validator expects."* That is, in substance, a test of Oracle's code generation.

| What conformance gives Oracle | Why it matters to them |
|---|---|
| **Codegen correctness signal** | The deck states that if the SDD framework generates code that breaks the trace prerequisites, the result is `INCOMPLETE_TRACE` or false FAILED records at execution time **[SRC]**. Conformance turns that into a measurable defect rate for the generator rather than an unexplained runtime symptom |
| **Structural conformance as a codegen regression test** | Comparing BPMN topology to the generated ASL and Graphite DAG detects when a generator change silently alters produced structure. This is the authoring-time Layer 1 that the deck currently leaves as a stub (G-7) |
| **Evidence that the human sign-off held** | The deck makes product-owner sign-off mandatory and non-automatable **[SRC]**. Conformance verdicts are the downstream proof that what was signed off is what ran — which is what makes the sign-off worth asking for |
| **Invariant coverage feedback** | Surfacing which PRD requirements have no invariant guarding them tells Oracle where PRD→spec generation is losing meaning. This is a direct quality signal on the SpecKit pipeline |
| **Intent version semantic diff** | When a commit regenerates Intent, Oracle's own requirement is that the design-time gates re-run **[SRC]**. A semantic diff between versions tells reviewers what business meaning changed, which git diff cannot |

**In one line:** Oracle currently has no way to know whether generated code faithfully implements generated intent, beyond tests it also generated. Conformance is that independent check.

### 4.2 Value to The Func and the Furious — the managed runtime team

**[SRC — precap]** A stated platform requirement is *robust observability so any issues found can be easily figured out using self-service with minimal platform team involvement*, supporting both technical and non-technical users.

| What conformance gives Func and the Furious | Why it matters to them |
|---|---|
| **The self-service debugging surface they are required to provide** | The trace schema, the verdict, and the read path (G-9) are the mechanism by which a tenant answers "what happened to my application" without escalating to the platform team. This requirement is theirs; the surface is ours |
| **A runtime health metric they do not have today** | An INDETERMINATE / `INCOMPLETE_TRACE` rate is a direct measure of runtime instrumentation quality — dropped `STEP#` writes, persistence failures, ordering violations. POC 4 exists precisely to exercise this **[SRC]** |
| **Tenant onboarding confidence** | `IEValidationConfig { enableStructural, enableSemantic, skipInvariants[] }` is part of their CDK surface **[SRC]**. Conformance gives a new tenant a demonstrable answer to "how do I know my workflow is behaving" on day one |
| **Multi-tenant isolation validation** | POC 5 exercises Tenant A at full I=E and Tenant B structural-only with no shared infra dependency **[SRC]** — which is also a test of their tenancy model |
| **Alerting that routes to the right team by construction** | The deck's Localized Alerting principle keeps conformance failures off the central platform team's pager **[SRC]**. Building it this way protects their on-call |

**In one line:** the runtime team is required to deliver self-service observability. Conformance produces the data that makes self-service possible, and the read path is where it becomes usable.

### 4.3 Value to the pilot

**[SRC — precap]** The personal loans pilot exists to prove the framework thesis — that business intent can be turned reliably into correct execution through SDD.

The evidence that the thesis held is precisely what conformance produces. Without it, the pilot can be asserted to have worked; with it, it can be demonstrated. This places conformance on the pilot's critical path rather than adjacent to it, and it is the strongest reason to sequence Phase 1 alongside the pilot rather than after it.

### 4.4 Extension beyond the two teams

The following are consequences of building the above properly. They are stated as target-state direction, not as Phase 1 commitments.

- **Domain-neutral engine, domain-confined use.** BPMN and specs.md are two notations for two general ideas — a statement of permitted order and a statement of permitted values. If the evaluation core reads a canonical model produced by format adapters, a future tenant expressing intent differently is an adapter, not a rewrite. Our domain stays credit decisioning; the engine need not.
- **One evidence model, many surfaces.** The three personas in the requirements each need a different artifact from the same underlying record — an approval artifact, a diagnosis, an exhibit. Designing the record once serves all three and is where the visualisation capability attaches.
- **Aggregate posture across tenants.** Per-execution verdicts answer "was this one correct". The same corpus answers "which intent versions are drifting, and since which change" — a question no other team is positioned to answer, and the one that speaks directly to the problem statement's concern with impacted population size.
- **A control that scales with AI-accelerated delivery.** The problem statement names this explicitly **[SRC]**. As intent generation accelerates, a machine-evaluable control is what allows the platform to keep onboarding tenants without adding proportional human review.

### 4.5 What we need from them in return

Stated plainly so the exchange is visible rather than implied.

| From | What we need | Corresponding unknown |
|---|---|---|
| Oracle | Confirmation that SDD-generated instrumentation emits the trace structure the validator expects | U-4, and the deck's own POC 1 note |
| Oracle / Func | Per-node evaluation detail in `STEP#` at the granularity invariants assert over | U-1 |
| Func | A resolvable binding from a running execution to its governing specVersion | U-2, G-1 |
| Architect / Leadership | A decision on whether RulesLab converges into Graphite | U-3 |

Each is a small contract, not a workstream, and each is required by every option in §9.

---

## 5. Questions to clarify

Ordered by how much they change the shape of the work. Q-1 to Q-4 are blocking.

### Blocking

**Q-1 — Which of the three timing stages does Workflow Arbiters own and build?**
Both documents describe Design-time, Authoring-time and Post-execution as one intent, with no owner split. Design-time checks run inside SpecKit and Authoring-time checks run in the pipeline — both Oracle surfaces. Post-execution is unambiguously ours. Without an answer, scope and LOE are unbounded.
*Answers: Director, Architect, Oracle lead*

**Q-2 — How does an execution resolve the intent version it ran under?** (G-1, G-2)
The requirements state that execution must be checked against the appropriate version of the Intent and that this will not always be "latest". The deck marks the linking mechanism out of scope. Every verdict asserts conformance to a specific specVersion; if that binding cannot be established, the verdict cannot be relied upon. The deck lists two candidate mechanisms.
*Answers: Architect, Oracle, Func and the Furious*

**Q-3 — Is conformance a gate, a monitor, or both — and on what principle is that decided?** (G-7, G-10, reviewer comments)
The deck adopts post-execution monitoring. The reviewer argues for pre-traffic gating. The requirements contain both Authoring-time (pre-merge, gating language: *"flagged to the tenant before they are able to merge"*) and Runtime (post-execution) requirements without reconciling them.
*Answers: Director, Architect, Product*

**Q-4 — What happens after a HARD violation, beyond the page?** (G-10)
The problem statement's stated harm is impacted population size. The specified response is an alert. Neither document describes any action that stops or limits further executions.
*Answers: Product, Director*

### Scope-shaping

**Q-5 — What does each persona receive when they need it?** (G-9)
All three personas describe a retrieval moment. Neither document specifies the artifact, the surface, or the latency of retrieval.
*Answers: Product*

**Q-6 — What is the definition of INCOMPLETE, and how does it relate to `INCOMPLETE_TRACE`?** (G-6)
*Answers: Director, Architect*

**Q-7 — Where do backtesting and shadow testing sit?** (G-8)
Listed under post-execution semantic validation in the deck; the reviewer places them pre-deployment. They are separately estimable and may be a distinct capability.
*Answers: Director, Product*

**Q-8 — What are the retention requirements for `CONFORMANCE#` and `STEP#` records?**
Neither document states a retention period. The Risk Manager persona implies a regulatory horizon.
*Answers: Product, Compliance*

**Q-9 — What does "immutable" require mechanically?**
The word appears in both documents for both Intent and verdict. Neither specifies a mechanism.
*Answers: Architect*

**Q-10 — Are Design-time and Authoring-time conformance results themselves persisted as evidence?**
The deck persists only the execution verdict. The Intent Owner persona asks for a permanent versioned artifact to point to; the sign-off is recorded in specs.md frontmatter, which is in GitHub, not in the evidence store.
*Answers: Product, Architect*

### Dependency

**Q-11 — Does the Graphite JIT decision service emit per-node evaluation detail into `STEP#` records?**
Semantic invariants are evaluated against step response payloads. If Graphite's internal DAG evaluation is not represented at the granularity the invariants assert over, semantic conformance is bounded by what is emitted.
*Answers: Oracle, Func and the Furious*

**Q-12 — Will RulesLab converge into Graphite, or remain a separate rule engine?**
POC 2 exists to pin RulesLab versions to specVersion, which implies rules version independently of Intent today. If RulesLab remains separate, rule version becomes a third versioned input to every verdict.
*Answers: Leadership, Architect*

**Q-13 — How are concern-suspended executions handled?**
Per the platform design, the state machine holds position while Axon owns concern resolution, resuming via webhook. Runtime conformance triggers at terminal state, so verdicts for concern-bearing applications are delayed by the concern duration. Neither document addresses this.
*Answers: Architect, Product*

**Q-14 — Is the `WorkflowConformanceValidator` a library, a deployed component, or both?**
The deck describes it as *"a stand alone post-execution audit library"* and also as injected via CDK into a terminal node, reading DynamoDB and triggering alerts. These are different things and the distinction determines whether the evaluation logic can later be invoked from a pipeline.
*Answers: Architect*

---

## 6. Knowns

**K-0 — DECISION MADE: conformance is mandatory; tenants cannot opt out.**
Recorded during discovery. Every workflow built on the framework is checked. This **supersedes K-9 below**, which reflects the position stated in the source deck.
Rationale: a control a tenant can disable cannot support the claim that every decision on the platform is verified.
Consequences: conformance becomes a fixed part of the CDK constructs rather than a configurable add-on; tenant configuration governs alerting preferences, not whether checks run; tenant onboarding and conformance onboarding become the same activity; the INDETERMINATE rate becomes a platform-wide quality metric with no hidden population.
Open follow-on: whether a reduced mode is permitted during tenant onboarding, and who approves it.

**K-1** The intent artifact pair is BPMN XML (structural) and specs.md (semantic, containing `## Intent` and `## Invariants`). **[SRC]**

**K-2** Invariants are expressed as Boundary / Condition / Expected behavior / I=E check, and are machine-evaluable. Six worked examples exist (INV-001 to INV-006). **[SRC]**

**K-3** The execution trace schema is defined: `EXECUTION_RECORD` (status, timestamps, specVersion), `STEP#` (stepInputs, timing, evaluated response payload), `CONFORMANCE#` (status, violations[]). **[SRC]**

**K-4** Trace records are written before the next step runs — a stated prerequisite for the validator finding a complete trace. **[SRC]**

**K-5** The deployment pattern is decided for both federated and central models: triggered as a terminal state, injected via CDK, running outside the execution container. Centralised async service was considered and rejected. **[SRC]**

**K-6** Both layers must pass for CONFORMANCE = PASSED. A workflow can pass structural and fail semantic. **[SRC]**

**K-7** Design-time validation is explicitly hybrid; the human sign-off is mandatory and cannot be automated, because `## Intent` and `## Invariants` represent business meaning that cannot be machine-verified against a PRD. **[SRC]**

**K-8** specs.md and BPMN are versioned in GitHub alongside code; a commit to either produces a new Intent version and re-triggers the design-time checks. **[SRC]**

**K-9** Tenants require granular opt-in/opt-out of I=E validation via CDK config. **[SRC]** — **SUPERSEDED by K-0.** Retained here because it is the position stated in the source deck and POC 5; the decision to mandate conformance changes it, and POC 5's `IEValidationConfig` surface needs revisiting as a result.

**K-10** The platform is pre-launch, piloting with personal loans. The current decisioning platform runs on Go and Step Functions and holds production data. **[SRC — precap]**

**K-11** Team capacity is 5 engineers plus a lead. **[SRC — precap]**

---

## 7. Unknowns

Each is tagged by impact: **[K]** could kill or invalidate an option · **[E]** changes effort materially · **[N]** nice to know.

| # | Unknown | Impact | Owner |
|---|---|---|---|
| U-1 | Whether Graphite emits per-node DAG evaluation detail into `STEP#` | **[K]** | Oracle / Func |
| U-2 | Whether execution records can resolve to the governing specVersion (G-1) | **[K]** | Architect / Func |
| U-3 | Whether RulesLab converges into Graphite or stays separate | **[K]** | Leadership |
| U-4 | Whether SDD-generated instrumentation actually produces the trace structure the validator expects — the deck's own POC 1 note | **[K]** | Oracle |
| U-5 | Whether the Go-platform production corpus can be translated to the new schema with defensible fidelity | **[K]** | Us / Data |
| U-6 | Whether production consumer credit data may be used for backtesting, or de-identification is required | **[E]** | Compliance |
| U-7 | Retention requirement for conformance evidence | **[E]** | Compliance / Product |
| U-8 | Whether Axon concern data is required in the audit record, and who joins it | **[E]** | Architect / Axon team |
| U-9 | Whether shadow testing means live traffic mirroring or captured replay | **[E]** | Director / Product |
| U-10 | Whether the same evaluation logic must run in more than one host (pipeline, runtime, backtest) — depends on Q-3 and Q-14 | **[E]** | Architect |
| U-11 | Feature flag state at execution time is not represented in any intent artifact or trace record | **[E]** | Us |
| U-12 | Expected execution volume and verdict corpus growth rate | **[E]** | Product |
| U-13 | Number of tenants expected in the first year, and how many are external-partner-backed | **[N]** | Product |
| U-14 | Whether design-time and authoring-time conformance results are persisted (Q-10) | **[N]** | Product |

---

## 8. Risks

| # | Risk | Consequence | Mitigation |
|---|---|---|---|
| R-1 | **Verdicts are meaningless without version binding.** The deck marks code-to-spec linking out of scope while the requirements make version-correct evaluation mandatory | Every `CONFORMANCE#` record asserts conformance to a version we cannot prove governed the running code | Resolve Q-2 before Phase 1 exit; treat as a Phase 1 dependency rather than a later concern |
| R-2 | **Semantic conformance is bounded by instrumentation we do not own.** If `STEP#` payloads do not carry the fields invariants assert over, semantic checking degrades silently | Half the verdict is unreliable while appearing to work | POC 1 must exercise real invariants against real emitted traces, not synthetic ones. Kill criterion below |
| R-3 | **AI-generated invariants validated against AI-generated intent.** The human sign-off is the only break in the loop, and its quality is unmeasured | Conformance passes while the intent itself is wrong; false assurance | Make invariant coverage explicit and reviewable; state plainly that I=E proves execution matched approved intent, not that intent was correct |
| R-4 | **Detection without containment does not address the stated harm.** Population size grows between detection and human response | The programme delivers verdicts but not the outcome named in the problem statement | Resolve Q-4; if containment is out of scope, record that decision explicitly |
| R-5 | **Requirements are unfinished in a specific pattern.** G-3 to G-6 all cluster around time, version and state | Building against these produces rework | Use this document to close them before build |
| R-6 | **Concern-suspended executions delay verdicts by days.** Terminal-state triggering collides with the Axon flow | The most scrutinised applications are the last to get a verdict | Resolve Q-13 |
| R-7 | **Scope for five engineers is unbounded.** Three timing stages, three capabilities, plus backtesting and shadow testing | Committed scope exceeds capacity; nothing lands well | Resolve Q-1 and Q-7; phase explicitly |
| R-8 | **No corpus exists yet.** The platform is pre-launch | Anything depending on accumulated verdicts cannot be built or validated in Phase 1 | Sequence corpus-dependent work after pilot traffic exists |
| R-9 | **Feature flags change runtime behaviour with no corresponding intent artifact** | An execution can diverge from BPMN legitimately, and conformance has no way to know | Raise U-11 as a design input to the feature flag capability |
| R-10 | **`WorkflowConformanceValidator` conflates a library and a deployed component** (Q-14) | If evaluation logic is embedded in the runtime host, later gating becomes expensive | Separate evaluation core from host in Phase 1 regardless of which option is chosen |

---

## 9. Solution options

All three options use the same three components named in the deck — `BpmnParser`, `SpecMarkdownParser`, and the conformance evaluation logic. They differ in **where that evaluation is invoked**, which is the axis Q-3 asks leadership to decide.

### Option A — Post-execution only *(the deck as written)*

```
  BUILD ──────► DEPLOY ──────► EXECUTE ──────► [verdict] ──► alert
  (existing)    (existing)     (10s SLA)           │
                                              async, terminal state,
                                              outside the container
```

Evaluation runs only after execution, reading the DynamoDB trace and writing `CONFORMANCE#`. Exactly the adopted deployment pattern in the deck.

**Pros**
- No change to Oracle's pipeline or Func's deploy process — lowest cross-team dependency
- No risk to the 10-second SLA
- Catches violations that are only decidable against real applicant data, real downstream responses and real rule evaluations
- Fastest route to POC 1 and a demonstrable result
- Matches the deck exactly; no re-litigation of settled decisions

**Cons**
- Every violation means an applicant has already been affected — does not address the population-size grievance
- No containment; the response is a page (G-10)
- Systemic defects surface one execution at a time
- Leaves the reviewer's comments unanswered
- Authoring-time requirements in the product doc remain unbuilt (G-7)

**Spikes required**
- **S-1 · Trace fidelity spike (2 wks).** Take a real pilot workflow; confirm `STEP#` payloads contain the fields INV-001..006-style invariants need. *Kill criterion: if payloads do not carry decision-relevant fields, semantic conformance cannot be delivered as specified and Q-11 must be escalated before any build.*
- **S-2 · Version resolution spike (1 wk).** Determine whether a running execution can resolve its governing specVersion today, and which of the deck's two candidate mechanisms is viable. *Kill criterion: if neither is available in the pilot timeframe, verdicts must be labelled version-unbound and the limitation stated.*
- **S-3 · Evaluation core separation spike (1 wk).** Prove the evaluation logic can be invoked with a trace from a source other than the live runtime.

---

### Option B — Pre-traffic gating *(the reviewer's position)*

```
  BUILD ──►[gate]──► DEPLOY ──►[gate]──► EXECUTE ──► [thin verdict]
             │                    │
     structural conformance   replay against
     of generated code vs     historical corpus
     BPMN/spec                (backtest / shadow)
             │                    │
       fail = block PR      fail = block deploy
```

The heavy checking moves before live traffic. Authoring-time structural conformance becomes a real gate (closing G-7); backtest and shadow become deployment gates (closing G-8 in the reviewer's sense). Runtime retains a minimal verdict for audit evidence.

**Pros**
- Errors caught before any applicant is affected — directly addresses the stated harm
- Containment is inherent: a gate blocks
- Answers the reviewer's comments
- Uses the existing Go-platform production corpus as the proof mechanism
- Builds out the Authoring-time requirements that the product doc contains and the deck leaves as a stub

**Cons**
- Hard dependency on Oracle's pipeline and Func's deploy process, neither of which we control
- Cannot catch violations that only manifest against real production data, real downstream behaviour, or post-deploy changes such as flag flips and rule updates
- Slower to first demonstrable result
- Depends entirely on backtest translation fidelity, which is unproven (U-5)
- Departs from the deployment pattern already decided in the deck

**Spikes required**
- **S-4 · Static conformance spike (2 wks).** Can BPMN topology be compared to the generated ASL state machine and Graphite DAG deterministically? *Kill criterion: if the generated artifacts do not preserve node identity from BPMN, static comparison is not possible and Option B loses its main gate.*
- **S-5 · Backtest translation spike (3 wks).** Translate a bounded slice of Go-platform production decisions into the new schema, replay, and classify every mismatch as expected-policy-change or defect. *Kill criterion: if translation fidelity cannot be established to a defensible standard, backtesting cannot serve as a deployment gate.*
- **S-6 · Pipeline integration spike (1 wk).** Confirm with Oracle and Func whether a gate can be inserted, who owns it, and what the failure semantics are.

---

### Option C — Staged conformance across the lifecycle

```
  BUILD ──►[gate]──► DEPLOY ──►[gate]──► EXECUTE ──► [verdict]
             │           │                    │
             └───────────┴────────────────────┘
                         │
              one evidence model, one
              evaluation core, four
              conformance points
                         │
              aggregate view ──► signal ──► platform's own levers
                                            (flags, gates, rollback)
```

The same evaluation core is invoked at whichever lifecycle points are available. Checks that are decidable without runtime data gate; checks that require real data run post-execution. All results land in one evidence model. Aggregation across verdicts enables containment through mechanisms the platform already owns.

**Pros**
- Distinguishes gateable from non-gateable checks on a technical principle rather than a preference, which resolves Q-3 substantively
- Addresses both the deck's position and the reviewer's without choosing between them
- Closes G-7, G-9 and G-10 within one architecture
- One evidence model serves all three personas, which is where the visualisation capability attaches
- Degrades gracefully: if a gate dependency is not ready, that check runs post-execution instead
- Phase 1 is deliberately identical to Option A, so it is not a bigger near-term bet

**Cons**
- Largest overall surface; only credible if phased explicitly
- Depends on unknowns spanning three teams (U-1, U-2, U-3)
- Risks appearing unbounded to leadership unless the phase boundaries are stated plainly
- Requires the evaluation core / host separation (Q-14, R-10) to be done properly in Phase 1

**Spikes required**
- All of S-1, S-2, S-3 (Phase 1, same as Option A)
- S-4, S-5, S-6 deferred to Phase 2, gated on Phase 1 outcomes
- **S-7 · Evidence model spike (2 wks).** Determine whether conformance results from multiple lifecycle stages can share one record model and one store, given the federated infrastructure constraint in the deck's design principles.

---

### Comparison

| Dimension | A — Post-execution | B — Pre-traffic gating | C — Staged |
|---|:---:|:---:|:---:|
| Matches deck's adopted deployment pattern | ✅ Exactly | ❌ Departs | ✅ Phase 1 identical |
| Builds the Authoring-time product requirements | ❌ No | ✅ Yes | ✅ Phase 2 |
| Catches data-dependent violations | ✅ Yes | ❌ No | ✅ Yes |
| Catches errors before applicant impact | ❌ No | ✅ Yes | ✅ Phase 2 |
| Addresses population-size harm | ❌ No | ⚠️ Partly | ✅ Phase 2 |
| Provides containment (G-10) | ❌ No | ✅ Gate blocks | ✅ Phase 2 |
| Answers reviewer comments | ❌ No | ✅ Yes | ✅ Yes |
| Cross-team dependency | ✅ Low | ❌ High | ⚠️ Medium, phased |
| Time to first demonstrable result | ✅ Fastest | ❌ Slowest | ✅ Same as A |
| Risk to 10s SLA | ✅ None | ✅ None | ✅ None |
| Fit to 6 people | ✅ Comfortable | ⚠️ Tight | ⚠️ Only if phased |
| Reversible if wrong | ✅ Contained | ❌ Pipeline changes are sticky | ✅ Phase 1 = Option A |

---

## 10. Recommendation for the alignment session

**This document does not recommend an option.** Options A and B each address part of what the requirements ask for and neither addresses all of it; Option C is only viable if leadership accepts explicit phasing. The choice depends on answers to Q-1, Q-3 and Q-4, which are leadership and product decisions rather than architectural ones.

**What we propose to do regardless of the option chosen**, because it is required by all three and is cheap now and expensive later:

1. Run **S-1** and **S-2**. Both are Phase 1 dependencies under every option, and both have kill criteria that would materially change scope.
2. Separate the evaluation core from its host (R-10, Q-14), so that the choice between A, B and C remains open rather than being foreclosed by implementation.
3. Treat **POC 1** as the deck defines it — a foundational milestone — and extend it minimally to exercise the core through two invocation paths rather than one, which validates the portability the other options depend on.

**What we need from the session:**

| Decision | Who |
|---|---|
| Q-1 — which timing stages Workflow Arbiters owns | Director, Architect |
| Q-2 — ownership of the code-to-spec binding gap | Architect, Oracle, Func |
| Q-3 — gate, monitor, or both | Director, Architect, Product |
| Q-4 — whether containment is in scope | Product, Director |
| Q-7 — where backtesting and shadow testing sit | Director, Product |

Ownership decisions matter more today than design decisions. Q-1 and Q-2 unblock everything else.

---

## 11. Open items for this document

- LOE and capability-to-engineer mapping — deferred until Q-1 is answered, as scope is currently unbounded
- Relevant Context section — depends on G-5 being populated in the source requirements
- Retention, evidence integrity mechanism, and verdict record schema — noted as design decisions (Q-8, Q-9), out of scope for discovery
- Two right-margin comments on the requirements document were not captured and may contain reviewer input not reflected here

---

## Appendix A — Target-state sketch (working, not committed scope)

This appendix records the target-state model developed during discovery. It is direction, not Phase 1 scope. Phase 1 remains C4 plus minimum version binding, per §9.

### A.1 Staged conformance model — technique per stage

```
                         INTENT
                           │
                           ▼
                          PRD
                           │
        ┌──────────────────┴──────────────────┐
        │ C1 DESIGN CONFORMANCE               │
        │                                     │
        │ LLM (advisory)                      │
        │ • semantic requirement comparison   │
        │ • ambiguity detection               │
        │ • missing requirement detection     │
        │ • PRD ↔ Spec meaning alignment      │
        │                                     │
        │ DETERMINISTIC (verdict-forming)     │
        │ • schema validation                 │
        │ • BPMN structural validation        │
        │ • DAG topology validation           │
        │ • required-field checks             │
        │ • traceability completeness         │
        └──────────────────┬──────────────────┘
                           ▼
            SPEC + BPMN + DAG + ATDD
                           │
        ┌──────────────────┴──────────────────┐
        │ C2 GENERATION CONFORMANCE           │
        │                                     │
        │ LLM (advisory)                      │
        │ • Spec ↔ code semantic comparison   │
        │ • missing implementation            │
        │ • orphan implementation             │
        │ • changed conditions/constraints    │
        │                                     │
        │ DETERMINISTIC (verdict-forming)     │
        │ • compile/type checking             │
        │ • AST checks                        │
        │ • JSON/XML/schema validation        │
        │ • BPMN ↔ ASL structural mapping     │
        │ • artifact hashes/signatures        │
        └──────────────────┬──────────────────┘
                           ▼
             JAVA + ASL + JSON + CONFIG
                           │
        ┌──────────────────┴──────────────────┐
        │ C3 VERIFICATION CONFORMANCE         │
        │                                     │
        │ DETERMINISTIC (verdict-forming)     │
        │ • unit tests                        │
        │ • component tests                   │
        │ • integration tests                 │
        │ • live dependency tests             │
        │ • acceptance tests                  │
        │ • synthetic E2E                     │
        │ • differential/reference testing    │
        │ • backtesting                       │
        │                                     │
        │ LLM (advisory)                      │
        │ • generate edge cases               │
        │ • explain test failures             │
        │ • categorize backtest differences   │
        │ • analyze shadow mismatches         │
        │                                     │
        │ ML (optional, advisory)             │
        │ • cluster failure patterns          │
        │ • identify unusual backtest groups  │
        └──────────────────┬──────────────────┘
                           ▼
                    DEPLOYED SYSTEM
                           │
        ┌──────────────────┴──────────────────┐
        │ C4 RUNTIME CONFORMANCE              │
        │                                     │
        │ DETERMINISTIC (verdict-forming)     │
        │ • expected vs actual path           │
        │ • deployed artifact verification    │
        │ • version/hash checks               │
        │ • rule evaluation verification      │
        │ • state transition validity         │
        │ • schema/data-contract validation   │
        │                                     │
        │ ML (advisory)                       │
        │ • input-data anomalies              │
        │ • population drift                  │
        │ • path-frequency anomalies          │
        │ • outcome drift                     │
        │ • latency/error anomalies           │
        │ • sequence anomalies                │
        │                                     │
        │ LLM (advisory)                      │
        │ • root-cause correlation            │
        │ • explain application decision      │
        │ • summarize evidence                │
        │ • classify probable failure domain  │
        └──────────────────┬──────────────────┘
                           ▼
                APPLICATION OUTCOME
```

**Verdict boundary rule.** In every stage, only the DETERMINISTIC rows form the pass/fail verdict. LLM and ML rows produce advisory findings — they route to the human attester (C1–C2), to engineers (C3), or to investigation and containment surfaces (C4). No AI output is ever part of a conformance verdict. This is what keeps the verdict reproducible in front of a regulator.

### A.2 Exemplar provenance record

The target shape of a single application's evidence, assembled by walking the spine backwards:

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
Flag state       hash ff1...      ← required for replayability
Evaluator        v3               ← required for replayability
Attestation      ATT-2041 (J. Okafor, 2026-06-14)  ← anchors the chain

Observed path:   A → B → D → F
Expected path:   A → B → D → F

Decision:        DECLINE
Conformance:     PASS
Seal:            hash(all of the above)
```

Every pin is a hash or version resolvable from one of the four data holders (git, CI store, deploy log, tenant store). If any pin cannot be filled, the verdict is INDETERMINATE, not PASSED.

### A.3 Determinism contract

`verdict = f(intent, trace, context)` where:
1. **f is pure** — no clock, network, randomness, or AI; all inputs arrive as arguments
2. **Inputs are frozen and content-addressed** — intentHash, traceHash, ruleVersion, flagStateHash, codeSHA
3. **The evaluator versions itself** — every verdict records evaluatorVersion; old versions stay runnable
4. **Corrections append, never overwrite** — a superseding verdict references the original with a reason
5. **Replay is a standing test** — periodically re-run f on sealed inputs and assert identical output

### A.4 Evidence inventory — what the spine must hold

Trace + verdict (designed in the deck) **plus**: frozen intent artifacts at specVersion; attestation as a sealed record (who, when, what artifact hash, generation lineage: PRD revision, toolchain and model version); the C3/C4 binding record (artifact ↔ spec ↔ rules ↔ flags); Axon concern records for suspended applications; and the tamper-evident seal. Test for inclusion: *would its absence leave a regulator question unanswerable?* If no, it is observability, not evidence.

### A.5 Data holders

Each stage writes only within its own trust zone; records are hash-linked; the spine index is read-only and rebuildable from sources.

| Stage | Holder | Record |
|---|---|---|
| C1 | Git (commit SHA) | Attested spec + BPMN + generation lineage |
| C2 | CI artifact store | Generation conformance report, keyed to code SHA + specVersion |
| C3 | CI/deploy records | Test and verification results; deploy binding (artifact ↔ versions ↔ flags) |
| C4 | Tenant WorkflowPersistenceStore | Trace + sealed CONFORMANCE# verdict |

No assurance-plane component holds a write path into production; no production component can alter the evidence chain.

### A.6 C3 verification mechanics — shadow, backtest, CI ladder

**Shadow testing** — candidate version evaluated against live traffic with zero customer exposure; the candidate outcome is discarded, never returned:

```
              Live application
                     │
              ┌──────┴──────┐
              ▼             ▼
       ACTIVE VERSION   SHADOW VERSION
              │             │
        actual outcome   candidate outcome
              │             │
              ▼             ▼
           Customer      discarded
                            │
                            ▼
                         Compare
```

**Backtesting** — both workflows run over the same historical corpus; outcomes compared at population scale:

```
     Historical application dataset
                   │
            ┌──────┴──────┐
            ▼             ▼
     Old workflow     New workflow
            │             │
            ▼             ▼
     Old outcome      New outcome
            └──────┬──────┘
                   ▼
               Compare
```

Worked example — 100,000 historical applications:

```
Old:  Approved 71%   Declined 25%   Review 4%
New:  Approved 69%   Declined 27%   Review 4%
```

The deliverable is not "2% of outcomes differ." It is the **classification of every differing application into *intended policy change* vs *defect***. A backtest that reports only the aggregate shift is uninterpretable; the classification is what makes it a deployment gate. (LLM-assisted categorization, human-adjudicated — per the C3 advisory rows in A.1.)

Dependencies: the Go-platform corpus and schema translation (U-5), data permissions (U-6), and shadow mode selection — mirroring vs replay (U-9).

**CI verification ladder** — the deterministic gate sequence, largely existing in Oracle's pipeline today; C3 assembles these results into the evidence chain rather than rebuilding them:

```
Unit tests → Component tests → Integration tests
    → Live dependency tests → Acceptance tests → End-to-end tests
```
