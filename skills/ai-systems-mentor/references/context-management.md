# Token stewardship, context quality, and long-session continuity

## Authority and limitations

The skill can choose what to read, summarize, quote, and preserve. It cannot set the model's context window, inspect hidden token usage unless an actual meter is exposed, force the host to compact, manipulate inference KV cache, or guarantee that a future session remembers anything not persisted. Never claim automatic runtime compaction merely because this document requests it.

When the host exposes **a supported context meter** or **native compaction action**, use them according to that host's documented controls and only when invocation is supported. Do not imitate `/compact` by running an unrelated shell command or fabricate tool calls. In native Claude Code, `/compact` is a documented interactive command; the skill may recommend it, but cannot assume it can invoke it autonomously.

## Budget policy (heuristics, not measured usage)

Use these context-budget thresholds **only if actual utilization is available**. Do not invent totals, remaining tokens, utilization %, or guarantee these percentages fit the host.

| Observed utilization | Behavior |
| --- | --- |
| Below 50% | Normal progressive disclosure; focused sources and teaching. |
| 50–70% | Favor concise answers, targeted retrieval, remove redundant excerpts from newly constructed inputs, and refresh state checkpoint. |
| 70–85% | Prioritize state preservation, avoid large new dumps, persist a checkpoint to an authorized file if feasible, and consider native compaction. |
| Above 85% | Prepare durable handoff before further large operations; invoke native compaction only if explicitly supported and authorized, otherwise instruct the user how. |

If no token meter is exposed, **use qualitative triggers** instead: prolonged back-and-forth, many large file/tool outputs, repeated forgotten distinctions, corrections being lost, conversation suddenly summarizing older content, or multiple changes of topic. Do not convert estimated turn counts into purported token utilization.

### Output budgets (soft targets)

- Quick definition or correction: 100–250 words.
- Single concept with example: 250–600 words.
- End-to-end trace/design review: expand only as the user explicitly requests.
- Learning checkpoint: aim for 150–350 words; portable handoff: aim for 400–900 words unless complexity requires more.
- These are **response-length guidelines**, not model context allocations; user requests override them.

## Every-turn context hygiene

1. Keep the **immediate user objective** and critical constraints at the top of the working focus.
2. Route to only the needed reference: teaching, runtime investigation, architecture review; this guide is the common context policy for extended sessions.
3. Retrieve small relevant source slices; retain source path/version/line or link for later verification. Avoid indiscriminate full-file reads, repetitive background, and large unfiltered terminal logs.
4. Summarize tool output in a high-signal form: result, supporting evidence, unresolved issue, next action. Preserve exact commands, errors, and version details when required to reproduce.
5. Use one running example; retain definitions and user's confirmed mental model, not every illustrative restatement.
6. Mark assumptions and confidence. Do not turn a conjecture into an established fact during summarization.
7. Prevent lost-in-the-middle by positioning current question, constraints and next action **first**, and ending a handoff with the immediate next step. Put long background and references in the middle or external files.
8. Recheck original evidence for safety-critical decisions or disputed claims; a compressed summary is an index, not authoritative proof.

## State checkpoint: routine and event-triggered

Maintain a brief **Learning State** in the active explanation or an explicitly authorized project file, as appropriate. Refresh at major conceptual milestones, after important corrections, before topic switches or a likely compaction, and before session end/handoff. Do not interrupt each turn with a checkpoint.

**Canonical learning-state schema:**

```markdown
# AI Systems Mentor — Learning State
Updated: <date/time only if known>
Current objective: <one sentence>
Immediate question: <one sentence>
Established and user-confirmed concepts: <brief list, mark confirmed>
Key corrections and decisions: <facts vs hypotheses distinguished>
Running example: <concrete stable example>
Sources/artifacts: <paths, versions, and authoritative links>
Unresolved questions: <prioritized>
Next step: <one concrete action>
``` 

Optional durable location when working in a repository and authorized: `.ai-mentor/session-state.md` (not part of the reusable skill package). Do not overwrite user files or save project-sensitive data without authorization. Never write private secrets, credentials, personal data, or full chat transcripts to session summaries.

## Compaction decision procedure

1. Detect a trigger: observed high utilization, long noisy session, provider compaction imminent, context quality degradation, user asks for compaction, or topic transition.
2. Build a **minimal loss-aware checkpoint** before compaction: current objective, validated mental models, user corrections, hypotheses, links/file references, open questions, immediate next step. Preserve test results and invariant constraints when relevant.
3. If supported, persist it in a user-approved artifact/file. State where it was saved; if not persisted, never imply durability.
4. If host exposes a **native compaction action** that the agent is allowed to invoke, invoke it with focus on this checkpoint. If not, **recommend the host's supported action** (Claude Code interactive `/compact` where applicable) and provide a ready-to-use focus instruction. Do not falsely claim compaction was performed.
5. After a host compaction, if observable, reestablish the current objective, key corrections, evidence links and next step from the checkpoint. Verify high-risk details against original sources.
6. Resume the lesson from the exact last agreed concept. Avoid restarting the entire course.

Suggested Claude Code interactive instruction: `/compact Preserve my current learning objective, verified architecture boundaries, misconceptions already corrected, running example, referenced files, open questions, and next step. Remove repeated analogies, obsolete drafts, redundant logs, and unrelated digressions.`

## Context rot and lost-in-the-middle recovery

- **Signs:** repeats an already settled misconception; ignores a constraint; contradicts a verified earlier statement; mixes examples or versions; answers a stale question; relies on a vague summary despite available primary evidence.
- **Recovery:** explicitly surface the conflicting claim and correction; reacquire the smallest authoritative excerpt if needed; revise the checkpoint; continue from the user's active question.
- **Ordering:** short context preamble at the beginning; active task and constraints reiterated near end of a long tool compilation. Do not duplicate huge instructions at both ends.
- **Information tiers:** Tier A = current task + invariants + corrections; Tier B = relevant evidence and source references; Tier C = historical detail stored externally. Prefer A and focused B in new prompts.

## Handoff between sessions

On explicit handoff request, produce a portable context pack with current goal, version/environment, what is proven vs inferred, user's demonstrated understanding, exact critical corrections, active example, relevant paths/links, unresolved questions and next action. Put immediate instructions both near the beginning and in a concise final `Resume with:` line. A new session must explicitly load the handoff file; persistence does not imply automatic ingestion.

## Guardrails

Do not promise infinite sessions, zero forgetting, or lossless compaction. Summaries can omit information. Optimize for continuity and correctness, not maximum token minimization. Never conceal critical uncertainty to shrink context. Native host limits, compaction algorithms, and tool availability always take precedence.
