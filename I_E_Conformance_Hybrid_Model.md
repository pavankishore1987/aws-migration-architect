# I=E Conformance Platform — Hybrid Validation & Evidence Model

## 1. Objective

The goal of the **Intent = Execution (I=E) Conformance Platform** is to establish confidence that:

> The approved business intent was transformed into an approved design, that design was faithfully implemented, the approved implementation was what got deployed, and the runtime behavior continues to satisfy the original intent.

This should not rely on a single LLM judgment. The recommended approach is a **hybrid conformance model** that combines:

- **LLMs** for semantic reasoning and interpretation
- **Deterministic validation** for structure, identity, invariants, and executable behavior
- **Statistical / ML techniques** for drift and anomaly detection
- **Human-in-the-loop** for intent approval, ambiguity resolution, and risk-based exceptions
- **Evidence chain** for end-to-end traceability and proof

---

## 2. Core Principle

> **Use LLMs where the problem involves meaning.**  
> **Use deterministic checks where the problem involves structure, identity, execution, or invariants.**  
> **Use statistical methods where the problem involves distributions, deviations, and drift.**  
> **Use humans where intent or risk requires judgment.**

A useful additional rule is:

> **Do not ask an LLM to prove something that can be deterministically verified.**

---

## 3. End-to-End Conformance Flow

```text
Candidate PRD
      |
      v
+-----------------------------+
| Gate 0: PRD Refinement      |
| Ambiguity / Completeness    |
| Human Approval              |
+-------------+---------------+
              |
              v
        Approved PRD
              |
              v
+-----------------------------+
| Gate 1: Intent Extraction   |
| Requirements / Invariants   |
| Acceptance Criteria         |
+-------------+---------------+
              |
              v
     Structured Intent Model
              |
              v
+-----------------------------+
| Gate 2: Design Conformance  |
| PRD -> Spec + BPMN          |
+-------------+---------------+
              |
              v
      Approved Design
              |
              v
+-----------------------------+
| Gate 3: Implementation      |
| Spec/BPMN -> Java + ASL     |
| Conformance                 |
+-------------+---------------+
              |
              v
        Implementation
              |
              v
+-----------------------------+
| Gate 4: Verification        |
| Unit / Component / ATDD     |
| Contract / Integration      |
+-------------+---------------+
              |
              v
+-----------------------------+
| Gate 5: Behavioral          |
| Backtesting / Shadow        |
+-------------+---------------+
              |
              v
+-----------------------------+
| Gate 6: Release Provenance  |
| Source -> Build -> Deploy    |
+-------------+---------------+
              |
              v
          Production
              |
              v
+-----------------------------+
| Gate 7: Runtime Conformance |
| Expected vs Observed Paths  |
| Drift / Anomalies           |
+-----------------------------+
```

---

## 4. Validation Classes

| Validation Class | Question | Recommended Technique |
|---|---|---|
| Semantic validation | Does this preserve the intended meaning? | LLM + human review |
| Structural validation | Does the required workflow structure exist? | Graph/schema/AST checks |
| Invariant validation | Are required truths always preserved? | Deterministic rules/tests |
| Behavioral validation | Does execution produce expected outcomes? | Tests, backtesting, shadow testing |
| Artifact/provenance validation | Is this the exact approved artifact? | Hashes, signatures, version lineage |
| Runtime conformance | Did production follow an allowed path? | Runtime traces + graph comparison |
| Statistical validation | Is behavior changing unexpectedly? | Drift/anomaly detection |

---

## 5. Semantic Validation with LLMs

### What semantic interpretation means

Semantic interpretation means understanding whether two artifacts preserve the same **business meaning**, even when their wording or representation differs.

Example PRD requirement:

```text
High-risk applications must be manually reviewed and cannot be automatically approved.
```

Structured interpretation:

```text
Requirement: R-17

Input:
fraudScore

Condition:
fraudScore > 900

Required Action:
MANUAL_REVIEW

Forbidden Outcome:
AUTO_APPROVE

Invariant:
fraudScore > 900
  => decision != AUTO_APPROVE
  AND route == MANUAL_REVIEW
```

LLMs are useful for:

- requirement decomposition
- ambiguity detection
- contradiction detection
- requirement completeness checks
- semantic equivalence checks
- exception preservation
- negative requirement detection
- candidate invariant generation
- mapping requirements to spec/BPMN elements
- change-impact analysis
- conformance failure explanation
- root-cause hypothesis generation

LLMs should generally **produce evidence or structured assertions**, not simply return `PASS` or `FAIL`.

---

## 6. Deterministic Validation Checks

### 6.1 Structural Checks

Validate:

- required node presence
- required edge presence
- ordering constraints
- branch completeness
- reachability
- dead/unreachable nodes
- terminal-state completeness
- cycle restrictions
- bounded retry/loop behavior
- condition preservation
- allowed path validation

Example:

```text
Expected:
RiskCheck --HIGH--> ManualReview
RiskCheck --LOW--> FinalDecision
```

If the generated graph does not contain the `HIGH -> ManualReview` edge, conformance fails deterministically.

---

### 6.2 Parameter Checks

Validate exact design parameters such as:

- thresholds
- timeouts
- retry counts
- backoff policies
- wait durations
- endpoint references
- failure routes
- fallbacks
- concurrency/parallelism settings

Example:

```text
Spec: MaxAttempts = 3
ASL:  MaxAttempts = 5
```

Result: **FAIL**

---

### 6.3 Contract Checks

Validate consistency among:

- Spec data contract
- Java DTOs
- API schemas
- ASL payloads
- downstream service contracts

---

## 7. Invariant Validation

Invariants should become first-class conformance artifacts.

### Business Invariant

```text
fraudScore > 900
=> decision != AUTO_APPROVE
```

### Workflow Invariant

```text
FINAL_DECISION executes exactly once
```

### Ordering Invariant

```text
KYC_CHECK must occur before ACCOUNT_OPEN
```

### Data Invariant

```text
customerId != null
```

### Authorization Invariant

```text
MANUAL_OVERRIDE requires an authorized reviewer
```

### Temporal Invariant

```text
RETRY_DELAY >= 30 seconds
```

### Cardinality Invariant

```text
paymentCapture executes <= 1 time
```

Recommended hybrid pattern:

```text
Natural-language requirement
        |
        v
       LLM
        |
        v
Candidate invariant
        |
        v
Human/schema validation
        |
        v
Machine-executable invariant
        |
        v
Deterministic verification
```

---

## 8. Canonical Execution Graph

A strong architectural approach is to normalize executable/design artifacts into a common internal model.

Possible inputs:

- BPMN / XML
- Java graph implementation
- ASL / state machine
- Runtime execution traces

Normalize into:

```text
Canonical Execution Graph

Node:
- id
- type
- inputs
- outputs

Edge:
- from
- to
- condition

Rules:
- predicate
- expected outcome

Metadata:
- requirement IDs
- invariant IDs
- artifact versions
```

This enables comparisons such as:

```text
Approved BPMN Graph ~= Java Graph
Approved BPMN Graph ~= ASL Graph
Expected Allowed Path ~= Observed Runtime Path
```

The comparison should focus on **behaviorally significant equivalence**, not byte-for-byte identity.

---

## 9. Testing Gates

### Unit Tests
Verify individual functions/nodes.

### Component Tests
Verify the workflow/graph as a deployable component.

### Contract Tests
Verify downstream API/service assumptions.

### Integration Tests
Verify multiple components interacting together.

### ATDD / Business Scenario Tests
Generate scenarios directly from approved requirements and acceptance criteria.

### Negative Tests
Verify prohibited outcomes never occur.

### Boundary Tests
For a threshold such as:

```text
riskScore > 900
```

Test:

```text
899
900
901
null
invalid input
```

LLMs can generate tests, but the **test framework must determine PASS/FAIL deterministically**.

---

## 10. Backtesting

Backtesting evaluates the candidate implementation using historical data.

Example:

```text
Production Decision Distribution
Approve:  620K
Decline:  250K
Review:   130K

Candidate Decision Distribution
Approve:  590K
Decline:  255K
Review:   155K
```

The resulting delta is not automatically a conformance violation.

It must be classified as either:

- expected behavioral change caused by an approved requirement change
- unexplained implementation deviation
- data/population shift
- rule/configuration difference

---

## 11. Shadow Testing

Run the candidate implementation against live production inputs without affecting the actual production decision.

Example:

```text
Production:
Input X -> APPROVE

Candidate:
Input X -> MANUAL_REVIEW
```

Capture:

- outcome divergence
- path divergence
- rule differences
- invariant violations
- latency deviations
- downstream dependency differences

A difference is not automatically a defect; it may represent an intentional approved change.

---

## 12. Runtime Conformance

Production executions should emit trace data sufficient to reconstruct the observed execution path.

Recommended telemetry:

```text
executionId
workflowVersion
specVersion
requirementVersion
artifactVersion
input fingerprint
node IDs
node timestamps
conditions evaluated
rule versions
feature flag values
model versions
outputs
final decision
```

Reconstruct:

```text
Observed Runtime Path
A -> RiskCheck -> ManualReview -> REVIEW
```

Then compare it against the allowed paths and invariants in the approved design.

---

## 13. Conformance Anomalies and Drift

### Conformance Violation

Expected:

```text
HIGH_RISK -> MANUAL_REVIEW
```

Observed:

```text
HIGH_RISK -> AUTO_APPROVE
```

This is a true conformance violation.

### Execution Anomaly

Expected:

```text
A -> B -> C
```

Observed:

```text
A -> B -> ERROR
```

Potential cause: downstream timeout or operational failure.

### Decision-Path Anomaly

Expected:

```text
A -> B -> C -> D
```

Observed:

```text
A -> B -> E -> D
```

Possible causes:

- implementation defect
- input data issue
- rule/config change
- feature flag
- model version
- downstream response
- unexpected population
- runtime failure

### Drift

Drift is a persistent distributional change rather than a single event.

Example:

```text
Last Month
A -> B -> C : 70%
A -> B -> D : 30%

Current Month
A -> B -> C : 42%
A -> B -> D : 58%
```

Possible drift categories:

- population drift
- data drift
- rule drift
- model drift
- path drift
- outcome drift
- implementation drift

---

## 14. Additional LLM Opportunities

Beyond semantic PRD comparison, LLMs can support:

### Requirement Decomposition
Split large requirements into atomic, testable requirements.

### Ambiguity Detection
Identify vague terms such as:

- "high risk"
- "quickly"
- "where appropriate"
- "normally"

### Conflict Detection
Identify incompatible requirements or overlapping rule behavior.

### Test Scenario Generation
Generate positive, negative, edge, and boundary cases.

### Traceability Generation
Generate candidate links such as:

```text
R17
-> Spec 6.2
-> BPMN Gateway G4
-> Java RiskDecisionNode
-> ASL RiskDecision
-> Test TC32
```

### Change-Impact Analysis
Explain which requirements, invariants, flows, code artifacts, and tests are affected by a change.

### Failure Explanation
Translate deterministic failures and telemetry into engineer-readable explanations.

### Root-Cause Hypothesis Generation
Correlate:

- rule version
- feature flag
- input values
- model version
- deployment version
- downstream response

and rank likely causes for divergence.

The LLM should propose hypotheses, while deterministic evidence confirms causality where possible.

---

## 15. Human-in-the-Loop

Human approval should be risk-based.

Human involvement is most valuable for:

- final PRD approval
- ambiguity resolution
- conflicting requirements
- candidate invariant approval
- high-risk semantic mapping exceptions
- unexplained behavioral divergence
- release exceptions
- risk acceptance

Human review should not replace deterministic validation where automated proof is possible.

---

## 16. Evidence Chain

An evidence chain is a strong foundation for the conformance platform.

However, distinguish three related concepts.

### Traceability Chain

Answers:

> Where did this requirement go?

```text
Requirement R17
-> Spec 6.2
-> BPMN G14
-> Java Node17
-> ASL State17
-> Test T208
```

### Provenance Chain

Answers:

> Which versions produced which artifacts?

```text
PRD v4
-> Spec v7
-> BPMN v7
-> source commit abc123
-> build 457
-> image sha256:...
-> production deployment 884
```

### Conformance Evidence

Answers:

> What evidence proves that the transformations conform?

```text
Semantic check      PASS
Graph check         PASS
Invariant check     PASS
ATDD                 PASS
Backtest             PASS
Shadow               PASS
Runtime conformance  PASS
```

Together these form a **Conformance Evidence Chain**.

---

## 17. Conformance Evidence Chain Model

```text
Approved Intent
     |
     | Evidence E1
     v
Approved Design
     |
     | Evidence E2
     v
Approved Implementation
     |
     | Evidence E3
     v
Verified Build
     |
     | Evidence E4
     v
Production Artifact
     |
     | Evidence E5
     v
Observed Runtime Behavior
```

Every edge should have supporting evidence.

---

## 18. Requirement-Level Evidence Record

Example:

```text
Requirement: R-17

Intent:
High-risk applications cannot be automatically approved.

-----------------------------------
DESIGN EVIDENCE
-----------------------------------
Spec:             Section 6.4
BPMN:             RiskCheck Gateway
Invariant:        INV-14
Semantic Check:   PASS
Human Approved:   YES

-----------------------------------
IMPLEMENTATION EVIDENCE
-----------------------------------
Java:             RiskDecisionNode
ASL:              RiskCheckState
Graph Comparison: PASS
Invariant Mapping:PASS

-----------------------------------
TEST EVIDENCE
-----------------------------------
Unit:             PASS
ATDD:             12/12 PASS
Component:        PASS
Backtest:         1.8M cases
Unexplained Violations: 0
Shadow:           450K cases
Unexplained Violations: 0

-----------------------------------
DEPLOYMENT EVIDENCE
-----------------------------------
Source Commit:    abc123
Build Artifact:   sha256:xyz123
Production Image: sha256:xyz123
Provenance:       VERIFIED

-----------------------------------
RUNTIME EVIDENCE
-----------------------------------
Executions:       8.2M
Invariant Violations: 0
Unexpected Paths: 3
Classification:   Dependency failures
```

---

## 19. Recommended Platform Output

Avoid reducing conformance to only a global percentage or binary PASS/FAIL.

The platform should produce a **requirement-level evidence graph**:

```text
Requirement
    |
    v
Design
    |
    v
Implementation
    |
    v
Tests
    |
    v
Deployment
    |
    v
Runtime
```

Each relationship should be classified as one or more of:

- semantically justified
- deterministically verified
- statistically evaluated
- human approved

This makes the I=E claim inspectable, explainable, and auditable.

---

## 20. Summary Recommendation

The recommended I=E conformance architecture is a **hybrid validation model backed by a requirement-level conformance evidence chain**.

### LLM
Use for:
- semantic interpretation
- ambiguity analysis
- requirement decomposition
- invariant generation
- requirement/design mapping
- change-impact analysis
- failure explanation
- root-cause assistance

### Deterministic Validation
Use for:
- schema validation
- graph comparison
- AST/code structure checks
- invariant execution
- contract validation
- parameter comparison
- test execution
- artifact identity
- release provenance
- runtime path validation

### Statistical / ML
Use for:
- population drift
- data drift
- path drift
- outcome drift
- anomaly detection

### Human-in-the-Loop
Use for:
- PRD approval
- semantic ambiguity
- conflicting intent
- high-risk exceptions
- unexplained divergences
- risk acceptance

### Evidence Chain
Use to bind everything together from:

```text
Approved PRD
-> Approved Spec/BPMN
-> Generated Java/ASL
-> Verified Tests
-> Approved Build
-> Production Deployment
-> Runtime Behavior
```

The result is not simply "the LLM says the code conforms." It is a defensible chain of evidence showing **why the implementation and observed execution remain aligned with approved intent**.
