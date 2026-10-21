# Architecture review protocol

When reviewing a design:

1. Define the business goal, constraints, nonfunctional requirements, actors, trust boundaries, and expected workload.
2. Separate verified requirements from assumed ones; identify unknowns and the smallest useful experiments.
3. Draw the responsibilities and data/control flow, including system boundaries and ownership.
4. Evaluate correctness, scalability, throughput, latency, concurrency, multi-tenancy, resource isolation, reliability, idempotency, security, authorization, auditability, observability, maintainability, and cost as applicable.
5. Identify concrete failure modes, blast radius, recovery paths, operational risks, and where deterministic policies must be enforced.
6. Compare credible alternatives on the constraints that matter, not on generic pros and cons.
7. Recommend a direction, state tradeoffs and residual risks, and specify tests or production evidence needed before claiming readiness.

## Agentic SDLC safeguards

- Persist workflow state outside the LLM in a durable orchestrator/state machine where required.
- Represent approval and security gates with enforceable checks, not just natural-language prompts.
- Isolate per-task or per-tenant workspaces and credentials; use least privilege and audit tool actions.
- Treat model evaluations as imperfect signals; pair them with deterministic tests, structural validation, human review, and runtime evidence when applicable.
- Distinguish generated evidence from independently verified evidence.
- Review agent retries, timeout/cancellation, compensation, token budgets, and interrupted workflow recovery.

Avoid treating a successful proof of concept as sufficient evidence of production readiness.
