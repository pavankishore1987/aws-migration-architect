# Centrally Managed Runtime Deployment Options

*Verbatim transcription from 12 photographed pages (IMG_7008–IMG_7020; IMG_7012 not present). Google Doc, two tabs — Tab 1 is the options analysis, Tab 2 is "New tenant onboarding to centrally managed runtime". Captured as a format reference for the Workflow Arbiters discovery documents.*

---

**Status:** Draft for review

## Summary

This document explores some of the product requirements from the [Workflow Orchestrator Managed Runtime] doc.

The deployment pattern discussed in this document does not include all product requirements (e.g. exchange onboarding, prod support, etc).

A couple of options for the centrally managed Workflow Orchestrator runtime are discussed and the comparison and recommendations are given at the end of the document.

## Goals & constraints

| ID (G: goal, C: constraint) | Description |
| --- | --- |
| G1 | Maximal tenant autonomy — independent deploy/rollback per tenant. WO team does not need to know or assist any tenant deployment |
| G2 | A single shared API surface (one hostname, one ALB) for all tenants. Requests to the API layer are correctly routed to the tenant workflows |
| G3 | Each tenant has a separate workflow execution history table by default, and has the choice to use a shared execution history table. Tenants must have their own separate graph execution history tables. |
| G4 | Avoid noisy neighbor issue, and enable tenant cloud cost chargeback |
| C1 | Single shared AWS account owned and managed by WO teams |
| C2 | API layer IAM policy cannot have resource wildcard (AC-3.AWS.39) to access tenant workflow step functions |

---

## Option 1: Shared ALB

### Architecture

*Diagram: A Client connects to a Shared ALB. The ALB listener rule is based on header: X-Tenant-Id. The ALB fans out to three identical per-tenant lanes. Each lane is: API Lambda → Tenant Workflow SFN → Tenant Graphite Service → Graph Execution History (datastore) → Workflow Execution History (datastore).*

```
                                    ┌──────────────────────────────────────────────────────────────────┐
                                    │  API Lambda → Tenant Workflow SFN → Tenant Graphite Service →     │
                                    │  (Graph Execution History) → (Workflow Execution History)          │
                                    └──────────────────────────────────────────────────────────────────┘
                  Shared ALB        ┌──────────────────────────────────────────────────────────────────┐
  ┌────────┐      ┌───────┐         │  API Lambda → Tenant Workflow SFN → Tenant Graphite Service →     │
  │ Client │ ───→ │  ALB  │ ──────→ │  (Graph Execution History) → (Workflow Execution History)          │
  └────────┘      └───────┘         └──────────────────────────────────────────────────────────────────┘
                  ALB listener      ┌──────────────────────────────────────────────────────────────────┐
                  rule based on     │  API Lambda → Tenant Workflow SFN → Tenant Graphite Service →     │
                  header:           │  (Graph Execution History) → (Workflow Execution History)          │
                  X-Tenant-Id       └──────────────────────────────────────────────────────────────────┘
```

### Components

- **Shared ALB (deployed by WO team)**
  - ALB + HTTPS listener
  - Route53 A-record for the shared hostname
  - [Nice to have] Catch-all rule at the highest priority number (evaluated last): a small Router Lambda returning 400 UNKNOWN_TENANT in the standard error schema when X-Tenant-ID is missing/unrecognized (nicer than ALB's raw fixed response).
  - Listener ARN, ALB security-group id — for tenant stacks to import.

- **Per-tenant stack (deployed by tenants)**
  - The API Lambda (the workflow-engine-api artifact)
  - Its target group and its listener rule, attached to the imported shared listener.
  - Tenant's step function + graph service
  - The tenant's execution store (DynamoDB)

### Request Routing

Routing keys on the **X-Tenant-ID** header (AND-ed with the path prefix to scope to this API). Each tenant stack adds one rule to the shared listener.

#### Listener-rule priority allocation

ALB requires unique priorities per listener. Because tenant header-conditions are mutually exclusive, *[text continues beyond capture]*

---

## Option 2: Shared Central API Layer

### Architecture

*Diagram: Client → ALB → Shared API Layer. The Shared API Layer contains endpoints Execute, Resume, Cancel, Get, Search, which feed a Router. The Router reads from a Workflow Registry, annotated `(tenant, workflow) → (SFN_ARN, DDB_ARN)`. The Router fans out to three per-tenant lanes: Tenant Workflow SFN → Tenant Graphite Service → Graph Execution History → Workflow Execution History.*

```
                             Shared API Layer
                          ┌───────────────────┐        ┌────────────────────────────────────────────┐
                          │ Execute           │        │ Tenant Workflow SFN → Tenant Graphite      │
                          │ Resume            │   ┌──→ │ Service → (Graph Exec Hist) → (Workflow    │
  ┌────────┐   ┌─────┐    │ Cancel   ┌────────┤   │    │ Exec Hist)                                 │
  │ Client │→  │ ALB │ →  │ Get      │ Router ├───┼──→ │ ... (identical lane)                       │
  └────────┘   └─────┘    │ Search   └────┬───┤   │    │ ... (identical lane)                       │
                          └───────────────┼───┘   └──→ └────────────────────────────────────────────┘
                                          │
                                   ┌──────┴───────┐
                                   │   Workflow   │
                                   │   Registry   │
                                   └──────────────┘
                          (tenant, workflow) → (SFN_ARN, DDB_ARN)
```

### Components

- **Shared API Layer (ALB + Lambda, deployed by WO team)**
  - ALB + HTTPS listener
  - Route53 A-record for the shared hostname
  - The central API Lambda
  - The "router": a function built into the API endpoints to route the requests to proper workflows using the "registry table"
  - The registry table: stores the mapping between tenant ID/workflow name, and step function ARN / execution table ARN
  - One lambda IAM role (with wildcard) that must be able to invoke every tenant's state machines.

- **Per-tenant stack (deployed by tenants)**
  - Tenant's step function + graph service
  - The tenant's execution store (DynamoDB)

### Request Routing

Routing happens in the Lambda, not at the ALB. The ALB sends all requests to the shared Lambda. The Lambda resolves per request:
- Use X-Tenant-Id and workflow name to look up the step function ARN and execution table ARN
- Process the request using the ARNs

### IAM Role and Policy [ **Blocker** ]

The expectation is that the tenant deployment of a new step function should not trigger a redeployment of the shared lambda. Therefore, the IAM role/policy used by the shared Lambda must invoke state machines it doesn't know in advance. Every viable mechanism needs a resource wildcard, all rejected by AC-3.AWS.39 (validated in the Avenue UI):

| Approach | Policy resource | Result |
| --- | --- | --- |
| Direct prefix invoke | states:StartExecution on stateMachine:graphite-wf-* | ❌ AC-3.AWS.39 — wildcard banned. UTEP is needed to make it work |
| Assume-role per tenant | sts:AssumeRole on role/graphite-wf-tenant-* | ❌ AC-3.AWS.39 + AC-3.AWS.6971 (path mismatch) + role-must-exist. UTEP may work (?) |
| Enumerate tenant ARNs on central role | per-machine (no wildcard) | ✅ passes IAM, ❌ defeats G1 — redeploy of shared Lambda when a new tenant workflow deployment happens |

There is no configuration of a single shared role that both passes the Avenue guardrail and avoids a redeploy of shared Lambda on tenant onboarding.
The only way to make Option 2 work is to apply for a UTEP on the wildcard used in the IAM policy.

### Execution store

Each tenant owns its own execution history DynamoDB table. This gives each tenant autonomy for independent throughput/rollback.
The graph execution history table must be separate for each tenant. Workflow execution history tables could potentially be shared. Need to see a use case to understand the reason for sharing, for example, why a tenant wants to perform a across-tenant search in workflow execution history table?

---

## Compare Option 1 & 2:

| Dimension | Option 1 (shared ALB) | Option 2 (shared central API layer) |
| --- | --- | --- |
| Tenant onboarding | • Tenant self-deploys stack + priority allocation<br>• No WO team assistant needed | • Tenant self-deploys stack + registry table write<br>• No WO team assistant needed |
| Autonomy (deploy/rollback) | High (own stack: API + SFN + Graphs + DB) | High (own stack: SFN + Graphs + DB) |
| IAM guardrail AC-3.AWS.39 | ✅ Passes (per-machine grants, validated) | ❌ Blocked (no wildcard-free path, UTEP is needed) |
| Routing | ALB X-Tenant-ID header rule | In-Lambda registry table lookup |
| ALB listener rule priority coordination | Per-tenant unique priority (registry in ct-graphite repo) | None |
| Lambdas to operate | N (one per tenant) | 1 |
| Blast radius | Contained per tenant | Largest — issues in the shared lambda could impact all tenants |
| Noisy neighbor & cloud cost chargeback | ✅ Only ALB is shared. No issue for noisy neighbor and chargeback | ⚠️ Share Lambda function could cause noisy neighbor issue. As the Lambda handles traffic from all tenants, chargeback is *[text continues beyond capture]* |

---

## Recommendation

- Although both options provide autonomy for tenants in terms of deployment and rollback, **Option 1 is recommended** mainly based on the following rationale:
  - Option 2 has a larger blast radius. The shared lambda function could become the failure point for all tenants. Although option 1 has a shared component (ALB) as well, option 1 shares only ALB where only configs exist and no code logic is deployed.
  - Option 1 has a simple routing method.
  - Option 2 has a blocker of creating a generic lambda IAM policy that could be used to invoke tenant SFN. The feasibility of a UTEP is unknown.

- A POC for Option 1 needs to be created to validate it thoroughly.

- The possibility of UTEP for wildcard use for Option 2 needs to be explored to determine if we want to create a POC for Option 2.

*(End of Tab 1)*

---

# Tab 2 — New tenant onboarding to centrally managed runtime

## Self-service registration

- **Product requirement**

  GIVEN I am a prospective tenant of Workflow Orchestrator
  WHEN I submit my tenant registration through a self-service portal
  THEN my registration completes without any platform team involvement
  AND provisioning begins automatically
  AND I can start building immediately

- **Constraints & Options**

  Tenants needs the following to start contribute to deployment repo and approve pipeline deployment:
  - CI component under WO ASV
  - Deployment repo with write access
  - Managed OnePipeline
  - Added in WO ServiceNow Assignment Group
  - Added to a SN PAR approver group
  - AllAccess provisioned to access WO AWS accounts

  Existing manual/automated process obtain the above:
  - DevNavHub provides a [UI based template workflow] to create new CI component and a new deployment repo
  - DevNavHub provides MCP server for new CI component and a new deployment repo creation

  *[intervening content not captured]*

  - To research if AllAccess support programmatically granting AWS account access

## Exchange App access

- **Product requirement**

  Can we build this in a way where we as the platform team do not need to be on the critical path for every single Exchange app access request like we are for DOrch? I.e. of tenant A needs access to API ABC, they should be able to request that access, and not be dependent on us

- **Constraints & Options**

  Constraints:
  - Currently Exchange API access request and approval are manual process

  Options:
  - **Tenants bring their own exchange app.**
    Tenants will request necessary exchange access to downstream services for their graphs and workflow orchestrator. Tenants will configure their exchange app credentials in the graphs and WO code per deployment environment.
  - **Tenants use WO's exchange app.**
    The WO team will request exchange access to downstream services for tenants graphs and workflow orchestrators.

- **Potential Gaps & remediation**
  - If a tenant chooses to use WO's exchange app, Wo team needs to apply for downstream access, which is a manual process.
    Research: is there a way to delegate the request access to the tenant team?

---

## Format observations (not part of the source document)

Structural conventions worth carrying into the Workflow Arbiters discovery documents:

1. **Status line at the top** — "Status: Draft for review". Sets expectations immediately.
2. **Summary states scope AND explicit non-scope** — names which product requirements are *not* covered by the document.
3. **Goals & constraints as an ID'd table** — G1..Gn for goals, C1..Cn for constraints. These IDs are then referenced by name in the comparison table ("defeats G1") and in the recommendation. This is the single most reusable device in the document.
4. **Each option follows the same skeleton** — Architecture (diagram) → Components (grouped by who deploys them) → mechanism sections (Request Routing, Execution store) → blockers.
5. **Blockers are labelled inline in the heading** — "IAM Role and Policy [ **Blocker** ]" rather than buried in prose.
6. **Approach/Result tables for dead ends** — each attempted mechanism, the specific thing it violates, and a ✅/❌ verdict. Failed approaches are documented rather than omitted.
7. **Comparison table is dimension-by-dimension**, same rows for both options, with ✅ / ❌ / ⚠️ markers.
8. **Recommendation names one option and gives numbered rationale**, then states what POC work is needed to validate it and what research is needed to keep the rejected option alive.
9. **Open questions are embedded as direct questions in prose** — "Need to see a use case to understand the reason for sharing, for example, why a tenant wants to perform a across-tenant search...?"
10. **Requirements are quoted in GIVEN/WHEN/THEN form** directly from the product doc, then followed by Constraints & Options and Potential Gaps & remediation.

Notable absences relative to what the Workflow Arbiters documents need: no LOE or estimation section, no spike/POC register with kill criteria, no explicit knowns/unknowns split, no risk register. The comparison and recommendation sections carry the decision weight instead.
