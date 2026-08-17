# Workflow Orchestrator I=E Conformance

*Verbatim transcription from 11 photographed pages (IMG_6994–IMG_7005). Google Doc titled "Conformance Intent Doc", labeled Internal. Adjacent browser tab visible: "I=E Hothouse Prep".*

---

## Problem Statement

As a financial services institution, we need to ensure that Intent = Execution for every single customer/applicant decision. Today, we rely on reactive controls and Business Analysts to identify I=E errors, but this is a manual and reactive process, meaning some I=E errors aren't caught for hours, days, months, or years later. This leads to a larger impacted population size, which has adverse impacts to our company from a regulatory, financial, and reputational perspective.

This need only continues to grow as the enterprise adopts AI tooling which accelerates intent delivery, so I=E conformance will be critical to ensure that quality is not compromised, even if the business is going faster.

## Desired Outcome

Every workflow execution produces a machine-generated, immutable conformance verdict — PASSED, FAILED, or INCOMPLETE — evaluated against both the path it took (did it follow the approved process flow, structurally) and the outcomes it produced (did the business logic match the approved invariants, semantically). The check runs asynchronously post-execution with no added latency to the business transaction. A HARD violation pages the tenant's own support team immediately; a SOFT violation logs for operational visibility without triggering alert fatigue. The governing principle — what the business approved is exactly what ran in production — becomes something the platform can prove on demand, continuously, rather than something anyone has to take on faith.

## Key Dependencies

- This intent will need to work closely with both The Oracle and The Func and the Furious
  - The Oracle owns the SDD/AI Authoring process and recommendations. As these artifacts are likely generated during that process, we need to ensure that we track that dependency
  - The Func and the Furious owns the managed runtime offering, will need to account for that in the design

## User Persona

- **Tenant Intent Owner**
  - "I need to sign-off/approve that the source of truth Intent that gets generated during development matches the desired business intent that we are trying to achieve, and I need this to be a permanent, versioned artifact that I can point to later on when auditors/regulators ask for it."
- **Tenant Software Engineer**
  - "I want to be paged when there is an I=E mismatch that my business team has defined as a critical failure, such that we can diagnose what is happening and why, and fix the issue before impacting additional applicants or customers."
- **Tenant Risk Manager**
  - "When a regulator or auditor asks me to prove whether a given decision was made/executed correctly, I need an immutable and guaranteed verdict that I can produce on demand."

## Product Requirements

### Design-Time (Going from PRD to Intent → spec.md and BPMN)

- As an intent owner documents their business requirements, the SDD process creates two artifacts:
  - BPMN to validate the structural process flow, order of operations, and conditional branching/gateways
  - spec.md to document the semantic source of truth for the business intent, inclusive of step mapping and invariant assertions
- As these artifacts are created, there is an automated structural completeness check that runs on the generated BPMN to ensure that:
  - All appropriate terminal states are present
  - Every conditional branch has a next step and is accounted for
  - Every step in spec.md resolves to a BPMN task
- There is a mandatory "human in the loop" sign-off on the two artifacts as they are created to ensure that they have been generated correctly and include the holistic list of requirements that the business needs

### Authoring-Time (Going from Intent to code)

- The generated code should be validated structurally by confirming that the process in the BPMN matches what the code is doing/does
- The generated code should be validated semantically via the creation and successful execution of the appropriate unit, component, and live dependency tests
- If a commit changes the spec or BPMN, a new version of the Intent should be generated, and the same automated and manual review gates from Design-Time should be run
- If an engineer were to update the source code directly, the Intent needs to be bi-directionally updated to reflect that change, or at least notify the engineer that they are updating the code without having updated the Intent

### Runtime Conformance (Validating Intent equals what actually executed)

- This must happen asynchronously and have zero impact on the latency of the workflow/decision
- The actually executed steps should be checked against the structure of the BPMN to confirm that it followed a valid path through the process. More specifically, no step should be taken out of order and every step should have a valid predecessor
- The actually executed steps should be checked against the spec.md's Invariants to confirm that every step conforms to the appropriate business logic/expectations
- In order for the execution to pass I=E conformance, both of the above layers must pass, it is not sufficient for just one to pass
- Persist the result of the I=E conformance check and alert the tenant based on how they specified they desire to be alerted

### Versioning

- Every spec.md and BPMN file that gets generated are version-controlled in Github alongside code. If a new commit is pushed to either of these files, it produces a new version

*(appears lower on the page, after a section break)*

- It will be important to confirm that the execution is checked against of the appropriate version of the Intent, this won't always be "latest"

## Relevant Context

- To Be populated

## Acceptance Criteria

### Design Time

GIVEN an Intent Owner defines business requirements in a document
WHEN our SDD process executes
THEN both a BPMN AND spec.md file are generated
AND every step in the spec.md matches a valid BPMN task

GIVEN a BPMN that has been generated
WHEN the automated structural check runs
THEN it fails if there are any structural integrity errors (i.e. missing terminal state) AND a human is not required to catch this kind of error

GIVEN a BPMN and spec.md file are generated via SDD
WHEN it has not yet been approved by the appropriate Tenant Intent Owner
THEN it is not yet the source of truth

GIVEN a BPMN and spec.md file are generated via SDD
WHEN the Tenant Intent Owner approves them as the source of truth for the Intent
THEN the Intent becomes versioned and immutable, and their approval is persisted with that Intent

### Authoring Time

GIVEN SDD generates code based off of the BPMN and spec.md
WHEN the authoring time check runs
THEN any structural violation is flagged to the tenant before they are able to merge

GIVEN SDD generates code and tests based off of the BPMN and spec.md
WHEN the authoring time check runs
THEN any semantic violation is flagged to the tenant before they are able to merge

GIVEN an Intent (spec.md and BPMN) has been approved
WHEN a tenant updates either of these files
THEN a new version of the Intent shall be generated, and the same Design time checks should run

GIVEN an Intent (spec.md and BPMN) has been approved
WHEN a tenant directly updates the source code
THEN the spec.md and BPMN are automatically updated OR the tenant is flagged that they are updating the code without having updated the intent

### Runtime Conformance

GIVEN a workflow reaches a terminal state
WHEN the runtime conformance executes
THEN it runs asynchronously and does not add any latency to the execution

GIVEN a workflow reaches a terminal state
WHEN the runtime conformance executes
THEN it validates the structural integrity of the execution by confirming all steps executed were taken in the appropriate order

GIVEN a workflow reaches a terminal state
WHEN the runtime conformance executes and checks the steps executed against the Invariants
THEN each invariant assertion is evaluated as pass/fail
AND any fail captures enough detail be take action

GIVEN a workflow is in terminal status
WHEN
THEN it has passed I=E conformance validation

### Versioning

*(header present in document; no acceptance criteria written beneath it — document appears to end here)*

---

## Transcription notes

- 11 images received; the sequence skips IMG_7000, confirmed by the author as not existing.
- Images overlap due to scrolling; overlapping regions were cross-checked and agree.
- **"AND any fail captures enough detail be take action"** — reproduced as written. Appears to be a typo for "enough detail to take action".
- **"checked against of the appropriate version"** — reproduced as written.
- **Runtime Conformance criterion 4** has an empty WHEN clause in the source document.
- **Versioning acceptance criteria** section is an empty header in the source document.
- Right-margin comments are visible but cut off on two pages (IMG_6994, IMG_6998). Content not captured.
- All body text was legible; nothing was inferred or reconstructed.
