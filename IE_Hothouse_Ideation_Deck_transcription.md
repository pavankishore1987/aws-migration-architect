# I = E Architecture — Conformance Validation Hothouse

*Verbatim transcription from 37 photographed images (IMG_6956–IMG_6992). Google Slides deck. Several images are duplicates of the same slide at different zoom levels or scroll positions; these have been merged. Audience comments captured from the right-hand comment pane are reproduced in place.*

---

## Slide — Title

**I = E Architecture**

Intent Equals Execution — Conformance Validation Hothouse

---

## Slide — Problem statement

As a financial services institution, we need to ensure that I=E for every single customer/applicant decision. Today, we rely on reactive controls and Business Analysts to identify I=E errors, but this is a manual and reactive process, meaning some I=E errors aren't caught for hours, days, months, or years later. This leads to a larger impacted population size, which has adverse impacts to our company from a regulatory, financial, and reputational perspective.

---

## Slide — The Governing Principle

What the business approved is exactly what ran in production. Always, continuously, and traceable.

---

## Slide — I=E Design Principles

- **Shift-Left Quality Assurance:** Catching specification and structural errors early during design and build phases before runtime execution.
- **Dual Conformance Requirements:** Must validate both *step order/topology* (Structural) and *data/business logic outcomes* (Semantic).
- **Deterministic Test Automation:** Reliance on machine-evaluable invariants (specs.md) and process graphs (.bpmn) rather than subjective manual review.
- **Auditability & Immutability:** Regulated decisioning requires version-pinned, signed-off intent contracts that can be audited historically.
- **Spec-Driven Development (SDD) Alignment:** Leveraging standardized tooling (SpecKit, OpenSpec, BMAD etc) to automate design and authoring checks deterministically.
- **Runtime Efficiency:** Post execution checks must run asynchronously and deterministically post-execution against trace payloads without introducing execution latency.

---

## Slide — Source of Truth for I=E validation

*Diagram:* PRD branches into **Spec** and **BPMN (viz)**; both converge into **Code**. Code connects by a dashed line to **Deployed Code**. **Inputs** flow into Deployed Code; Deployed Code produces **Steps** and **Outputs**.

*Legend:*

**BPMN (XML) - Structural**
- Process Graph Topology
- Node Order & Routing
- Gateways & Sequence Flows

**specs.md - Semantic**
- Business Intent
- Step Mapping
- Invariant Assertions

---

## Slide — Spec.md - ## Invariant section

*Code block contents:*

```
## Invariants

Invariants are conditions that must hold true at every observable boundary of the workflow — before execution, after each node, and in the final
response. Use these for I=E (implementation equals expectation) validation: for each invariant, write a test or assertion that verifies the condition
directly against a running graph.

### INV-001 — `applicantId` is never null at graph entry

**Boundary:** Seed data population (`HardPullContext.Payload.populateSeedData`)
**Condition:** If the caller omits `applicantId` or passes `null`, the graph MUST reject the request before any node executes.
**Expected behavior:** `BadSeedDataException` is thrown; `XdsService` is never called.
**I=E check:** POST with `{}` or `{"applicantId": null}` → assert HTTP 4xx and no XDS call recorded.

---

### INV-002 — `applicantId` flows through without mutation

**Boundary:** `HardPull.execute` → `HardInquiryReport` → `HardPullDecision` response
**Condition:** The `applicantId` value in the final `HardInquiryReport` MUST equal the value supplied in the request payload — no transformation,
trimming, or substitution occurs in the graph.
**Expected behavior:** `response.hardInquiryReport().applicantId()` equals the input string byte-for-byte.
**I=E check:** POST with `applicantId = "applicant-42"` → assert `response.applicantId == "applicant-42"`.

---

### INV-003 — `HardPull` always delegates to `XdsService` exactly once

**Boundary:** `HardPull.execute`
**Condition:** For every successful graph execution, `XdsService.performHardInquiry` MUST be called exactly once with the seed `applicantId`. It must
never be called zero times (skipped) or more than once (retried silently).
**Expected behavior:** One XDS call per graph invocation.
**I=E check:** Use a mock/spy `XdsService` → verify `performHardInquiry` invocation count equals 1 after a single graph execution.
```

*Accompanying table — "What it guards":*

| ID | |
| --- | --- |
| INV-001 | `applicantId` null rejection before any node runs |
| INV-002 | `applicantId` passes through unmodified to the response |
| INV-003 | `XdsService` is called exactly once per execution |
| INV-004 | `hardInquiryReport` is never null on a 2xx response |
| INV-005 | `inquiryType` equals `"HARD"` (right inquiry path taken) |
| INV-006 | XDS failure surfaces as an error, never a partial response |

---

## Slide — I=E Validation timing

- Design Time
- Authoring time
- Post Execution

**BPMN Parser :** It verifies that the sequence of steps actually executed — as recorded in the STEP# records — follows a valid path through the BPMN process graph, meaning every step that ran had a legitimate incoming edge from its predecessor and no step appeared out of order or from a branch that shouldn't have been taken.

**SpecMarkdownParser :** It reads the ## Invariants block in specs.md, converts each rule into a boolean assertion, and evaluates those assertions against the actual response payloads stored in the STEP# records — checking that the business outcomes of the execution (the data, not just the path) matched what the business intent contract.required.

**WorkflowConformanceValidator :** The WorkflowConformanceValidator is a stand alone post-execution audit library that reads a workflow's DynamoDB execution trace, evaluates it against the version-pinned BPMN and specs.md intent contract, and writes an immutable PASSED/FAILED/INCOMPLETE conformance verdict — without blocking or modifying any business logic outcome.

> **Comment — Tabryn Palmer, 10:06 AM Aug 5**
> Just to make sure I'm understanding this fully:
> 1. intent contracts are programmatically generated from the spec and BPMN
> 2. `WorkflowConformanceValidator` checks execution at RUNTIME (as opposed to deployment/test time) for conformance to those contracts?

> **Comment — Tabryn Palmer, 10:09 AM Aug 5**
> If my understanding is correct, why check constantly at runtime instead of once during deployment/test? I would hope that our CI/CD pipeline tests would be sufficient to confirm I=E before anything goes to production.
>
> I worry that this solution may result in production incidents that should have just been CI/CD pipeline failures or automated rollbacks.

---

## Slide — Execution Trace Schema

Persisted in DynamoDB WorkflowPersistenceStore keyed by `workflowExecutionId`

**EXECUTION_RECORD** — `SortKey: EXECUTION`
Captures global lifecycle context, status (IN_PROGRESS, COMPLETED, FAILED), timestamps, and specVersion.

**STEP#** — `SortKey: STEP#...`
One record per step. Stores stepInputs, execution timing, and evaluated response payload.

**CONFORMANCE#** — `SortKey: CONFORMANCE`
Immutable audit verdict storing status (PASSED, FAILED, INCOMPLETE) and specific violations[].

---

## Slide — Stage 1 : Design time validation of I=E

*Diagram — "Design Time I=E Validation":*

| Intent | Execution |
| --- | --- |
| PRD | BPMN (Structured) |
| | Spec.md (Semantic) |

---

## Slide — How are we doing Design time validation ?

SpecKit reads the PRD and generates the dual-artifact contract.

Validation here is **hybrid** — not purely automated:

- **Automated:** SpecKit runs structural completeness checks (does the generated BPMN have terminal states, are all gateway branches accounted for, do the specs.md step names resolve to BPMN task node IDs?)
- **Human-in-the-loop (mandatory):** A product owner reviews and signs off on the generated specs.md.
  (The ## Intent and ## Invariants blocks represent business meaning that cannot be machine-verified against a PRD — someone has to attest that the generated invariants accurately capture regulatory and business requirements.)
- The sign-off metadata is written into specs.md frontmatter and becomes part of the immutable artifact at that specVersion.

---

## Slide — Stage 2 : Authoring time validation of I=E

*Diagram — "Authoring Time I=E Validation":*

| Intent | Execution |
| --- | --- |
| BPMN | Code |
| Spec.md | |

---

## Slide — How are we doing Authoring time validation ?

**Layer 1: Structural Validation**
- Structure, flows, terminal points, functional & non-functional rules captured.
- *(second bullet present but empty)*

**Layer 2: Semantic Validation**
*"Does generatdd code meeting all requirements?"* *(sic)*
- This is mostly covered in unit, component, LDT etc.

---

## Slide — Stage 3 : Post execution validation of I=E

*Diagram — "Post Execution":*

| Intent | Execution |
| --- | --- |
| BPMN | Deployed Code |
| Spec.md | Execution Steps |
| | Execution Data |

---

## Slide — How are we doing Post execution time validation ?

**Layer 1: Structural Validation**
*"Did execution follow the correct graph path?"*
- Parses BPMN XML graph using BpmnParser.
- Verifies predecessor edges for executed steps.
- Recalculates choice gateway conditions against actual runtime payload.

**Layer 2: Semantic Validation**
*"Were business rules true during execution?"*
- Parses ## Invariants block via SpecMarkdownParser.
- Evaluates boolean rules against step response JSONPath.
- Ensures decision payloads conform strictly to domain intent.
- Shadow testing, Backtesting

> **Critical Distinction:** A workflow can PASS Layer 1 (followed valid graph edges) but FAIL Layer 2 (violated business invariants). Both must pass for CONFORMANCE = PASSED.

---

## Slide — How are we doing Post execution time validation ? (Prerequisite)

**Prerequisite :**
Every step in workflow automatically:
- Executes the business logic
- Captures stepInputs, response payload, and timing
- Writes the STEP#\<stepName\> record to DynamoDB before the next step runs

When the workflow reaches the I=E validation step, it triggers the WorkflowConformanceValidator async. This then finds a complete, structurally correct trace and runs both layers against it.

If SDD framework generates code that breaks any of these, you get INCOMPLETE_TRACE or false FAILED records at execution time, not at authoring time.

*Margin note on slide:* `** POC 1 — Validate that the SDD-generated instrumentation actually produces the trace structure the validator expects.`

*(Slide number 15 visible)*

---

## Slide — Deployment of I=E Validation

**Design Principles**

- **Federated Infrastructure Boundaries:** Framework must not require provisioning central infrastructure to validate federated tenant workflows.
- **Trace Freshness & Synchronous Context:** Validation must execute when the execution trace records are fresh and complete - immediately after execution.
- **Localized Alerting & Ownership:** Conformance failures and operational alerts must route naturally to the tenant/intent team operating the specific workflow.
- **Workflow Flexibility:** Workflow authors require granular opt-in/opt-out configuration for I=E validation
- **Evidence Sink:** Conformance verdicts (CONFORMANCE#\<execId\>) must land consistently in the Tenant's WorkflowPersistenceStore.

---

## Slide — Where and when Does Validation Run (Federated model)?

**✗ Rejected: Centralized Async Service**
Drawbacks: Requires central infrastructure provisioning, introduces eventual consistency lag, and complicates cross-account alert forwarding.

**✓ Adopted: Triggered as a Terminal State outside execution container**
Benefits: Injected via CDK into the workflow's terminal node. Triggered within Tenant boundaries but runs outside the container with guaranteed trace freshness.

**Key Architectural Advantages:**
- **Zero Overhead:** No central service team maintenance required.
- **Native Alerting:** Violations directly trigger tenant's CloudWatch / PagerDuty pipelines.
- **Trace Integrity:** Validation executes only when all STEP# trace writes are complete.

> **Comment — Tabryn Palmer, 10:15 AM Aug 5**
> I'm not seeing much discussion here of deployment-time validation. Preferably we would catch most or all I=E validation errors in the pipeline before any real execution occurs. Although maybe this execution container would be part of the pipeline tests?
>
> I would really hope that most/all I=E errors would be caught before anything starts accepting live traffic, i.e. during backtesting/shadow testing, which, preferably, would be part of the production deployment process in the CI/CD pipeline.

> **Comment — Tabryn Palmer, 10:29 AM Aug 5**
> Not sure I'm fully understanding the need for a separate side-car container to validate I=E conformance.
>
> We know the business requirements before we generate any code, so it seems like we could probably build the verification into the workflow/code itself?

---

## Slide — Where and when Does Validation Run (Central Platform model)?

**✗ Rejected: Centralized Async Service**
Drawbacks: Requires central infrastructure provisioning, introduces eventual consistency lag, and complicates cross-account alert forwarding.

**✓ Adopted: Triggered as a Terminal State outside execution container**
Benefits: Injected via CDK into the workflow's terminal node. Triggered within Platform boundaries but runs outside the container with guaranteed trace freshness.

**Key Architectural Advantages:**
- **Some Overhead:** This is a  central service where team maintenance required.
- **Native Alerting:** Violations directly trigger tenant's CloudWatch / PagerDuty pipelines.
- **Trace Integrity:** Validation executes only when all STEP# trace writes are complete.

---

## Slide — What happens when I=E validations fail post-execution

**Hard vs Soft Violations**

| Severity | Definition & Example | Engine Response & Routing |
| --- | --- | --- |
| HARD | **Critical Business Breach** — Example: Step executed following a Declined signal. | Status: FAILED, Severity: HARD. Routes trace to **Compliance Queue**. Triggers PagerDuty / High-priority alert |
| SOFT | **Payload & Non-Critical Drift** — Example: Missing optional telemetry step or minor field payload mismatch. | Status: FAILED, Severity: SOFT. Logs lower-priority operational metrics. Routes trace to **Operational Monitoring Queue** |

> **Comment — Tabryn Palmer, 10:20 AM Aug 5**
> I'm probably being a broken record at this point, but the fact that PagerDuty alerts are mentioned specifically as the response to an I=E conformance failure makes me nervous.
>
> I think that wherever possible, I=E should be validated BEFORE a component receives any live production traffic. This validation doesn't HAVE to be via CI/CD pipeline, but it needs to exist somewhere. In the rare cases where I=E conformance fails, this should result in an automated rollback of whatever was deployed.
>
> Point being, as an engineer, I would REALLY hope that I=E failures result in a pipeline failure and/or automated rollback, not a high priority PagerDuty alert that wakes me up in the middle of the night.

> **Comment — Tabryn Palmer, 10:26 AM Aug 5**
> In a perfect world, I would also hope that I=E conformance is enforced in the code itself, and that a lack of conformance would result in an immediate failure in the workflow execution, not a side-effect that's picked up in another process.
>
> The workflow itself should know whether or not it's conforming to the business intent.

---

## Slide — Versioning

*Callout tag on slide: **Spike: Define versioning strategy***

Versioning and lifecycle management of these three phases is accomplished in the following way:

**Design-time I=E** — *Spec vs PRD Validation*
PRDs generally are not kept in version control, so managing Design-time I=E is not a concern as the spec generation from PRD is typically a one-time activity.

**Authoring-time I=E** — *Code vs Spec + BPMN*
Specs and BPMNs are versioned in GitHub alongside code. Commits trigger a new version of Intent for both Authoring and Execution-time.
The existing automated, Human-in-the-loop, and ATDD testing checks must be re-performed with the new spec version.

**Execution-time I=E** — *Outputs vs Spec + BPMN*
Once deployed, the conformance validator must read the version of the spec and BPMN corresponding to the active code.
*The exact code-to-spec linking mechanism is out of scope, though multiple options have been discussed, including*
- *bundled spec and BPMN in the deployable artifact*
- *spec and BPMN versioned and stored separately from the deployable artifact, but accessible from the execution runtime*

---

## Slide — POCs

*(Section divider — title only, no body content)*

---

## Slide — POC 1 — Happy Path End-to-End

> **Foundational Milestone:** Must complete successfully before POCs 2–5 can begin.

**Workflow Component**
- BpmnParser + SpecMarkdownParser wired in CDK terminal state.
- STEP# records written to DynamoDB upon step completion.
- WorkflowConformanceValidator writes audit verdict.

**RulesLab & Criteria**
- Single RulesLab-sourced invariant in specs.md.
- Conforming execution produces CONFORMANCE = PASSED.
- Deviating execution produces FAILED with detailed violations[].

---

## Slide — POC 2 — RulesLab Binding

> **Resolves Open Technical Debt (ADR-004):** Pins RulesLab versions directly to specVersion.

**Version Pinning**
Links RulesLab rules declaratively to specs.md ## Invariants, binding them strictly to a Git SHA specVersion.

**CI Gate Enforcement**
Fails the build automatically if a rule is mutated without an explicit specVersion bump and re-approval.

---

## Slide — POC 3 — Hard Violation Alerting

**Operational Alert Chain**
- Evaluates explicit NEVER invariants in terminal state.
- Triggers high-priority CloudWatch / PagerDuty alerts.
- Routes trace directly to the **Compliance Queue**.

**Parallel Soft Routing**
- Soft violations route quietly to **Operational Monitoring**.
- Prevents alert fatigue while preserving audit records.
- Non-blocking: business execution completes uninterrupted.

---

## Slide — POC 4 — Trace Completeness

**Missing Trace Scenario**
Simulates a step execution where DynamoDB persistence fails or drops a STEP# record during execution.

**Guarded Classification**
Classifies record as INCOMPLETE_TRACE (not FAILED). Skips semantic invariant evaluation to ensure accurate attribution.

---

## Slide — POC 5 — Multi-Tenant CDK

**Tenant Isolation**
Enables Tenant A (full I=E) and Tenant B (structural only) to run independent configurations without shared infra dependencies.

**CDK Config Surface**
Exposes IEValidationConfig: `{ enableStructural: bool, enableSemantic: bool, skipInvariants: [] }` directly in CDK constructs.

---

## Slide — POC Sequence & Priority

| Priority | POC | Name | Rationale |
| --- | --- | --- | --- |
| 1st Priority | POC 1 | E2E Happy Path | Foundational skeleton unblocking all other POCs. |
| 2nd Priority | POC 2 | RulesLab Binding | Resolves critical open technical debt. |
| 3rd Priority | POC 4 | Trace Completeness | Small scope, high precision attribution guarantee. |
| 4th Priority | POC 3 | Hard Alerting | Operational readiness and compliance queue integration. |
| 5th Priority | POC 5 | Multi-Tenant CDK | Runs in parallel with POCs 3 & 4 for tenant adoption. |

---

## Slide — The I=E Framework Overview

> Neither artifact alone is sufficient — together they form the complete contract for static verification and dynamic runtime conformance.

**Intent (I):** BPMN XML (Structural flow & gateways) + specs.md (Semantic invariants & business assertions).

**Execution (E):** DynamoDB state containing EXECUTION_RECORD, per-step STEP# records, and CONFORMANCE# records.

**Validator Engine:** Embedded WorkflowConformanceValidator executing automated static & dynamic checks.

---

## Transcription notes

- 37 images received (IMG_6956–IMG_6992). Several are duplicate captures of the same slide at different zoom or scroll positions and have been merged: 6957/6958 (Problem statement), 6964/6965 (I=E Validation timing), 6974/6975 (Post execution prerequisite), 6965/6966 (comment thread continuation), 6979/6980 (comment thread continuation).
- Typos reproduced as written: "Does generatdd code meeting all requirements?"; "what the business intent contract.required"; "This is a  central service where team maintenance required."
- The Authoring-time validation slide contains an empty second bullet under Layer 1.
- The POCs slide is a section divider with no body content.
- All five audience comments are from the same reviewer (Tabryn Palmer) on Aug 5, timestamps 10:06, 10:09, 10:15, 10:20, 10:26, and 10:29 AM. All are marked resolved in the document. No replies were visible in any capture.
- Comments are anchored to specific slides; anchoring has been preserved where the capture made it unambiguous.
- The invariant code block was legible at full zoom and is transcribed in full. Line breaks in the original wrap differently; content is verbatim.
- INV-004 through INV-006 appear only in the summary table, not as full invariant definitions.
- No slide in the captured set defines the INCOMPLETE verdict criteria, and no slide addresses the concern/suspension (Axon) flow.
