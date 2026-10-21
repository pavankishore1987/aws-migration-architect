# Runtime investigation protocol

For a user operation, trace its lifecycle in chronological order:

1. **Entry point:** UI, IDE, CLI, or API that receives the request.
2. **Session state:** initialization, project instructions, accessible skills and tools, prior conversation, relevant repository files.
3. **Context assembly:** exactly which messages, tool definitions, loaded skill text, and retrieved content are provided to each model request; do not imply undisclosed internal details are known.
4. **Inference boundary:** API request, model processing, and generated text or structured tool-use intent.
5. **Tool authorization and execution:** the host runtime applies approvals/policies, dispatches eligible tools, and collects outcomes.
6. **Continuation:** runtime appends or summarizes results, creates another inference request when necessary, and eventually stops, pauses, or reports failure.
7. **Durable state:** files, Git changes, workflow state, audit logs, and externally persisted memories, if any.

For every step, identify actor, input, processing, output, whether a model request occurs, and what is deterministic versus uncertain.

## Important boundaries

- Model != inference server != agent runtime != operating system.
- Model output requesting a tool != actual tool execution.
- A skill's description or index != full loaded skill content.
- A slash command or skill's Markdown != shell command or program execution.
- Instructions to require approval != deterministic approval gates.
- Conversation context != durable memory != model weights != server KV cache.
- OpenSpec CLI validation != automatic semantic truth or verified business conformance.

## Evidence labels

Use **Documented fact**, **Source-code observation**, **Observed behavior**, **Architectural inference**, or **Hypothesis** where those distinctions are material. Include version/environment if they change behavior. Prefer official docs and inspected code over guessing. Where information is unavailable, propose a minimal reproducible experiment instead of inventing implementation details.

## Running SDLC example

A user requests: "Create a refund API where refunds greater than $500 require manager approval." Trace intent → PRD → spec → BPMN → technical design → tasks → implementation → tests → conformance. Identify generation, deterministic checks, human review, and enforced workflow gates. For an implementation change, begin instead with repository inspection and impact analysis.
