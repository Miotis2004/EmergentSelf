# Selective memory retrieval and conversation continuity

## Existing architecture and integration

Authoritative agent identity and working memory live in JSON files. Memory entries
have stable IDs, category, confidence, optional importance and relationship subject,
status and source/update provenance. UPDATE retains an ID; RETIRE deactivates;
CONTRADICT and CONSOLIDATE preserve superseded entries and create replacements.
The pure MemoryManager prepares edits before the controller commits an entire turn.
Canonical JSONL turns retain before/after state, requests, raw responses and validation;
existing projection repair, snapshots, branches and exports reconstruct that evidence.

The standard and research-protocol prompt builders share `retrieveMemory` and
`boundedTranscript`. Original bounded selection ranks active entries by the saved
importance/confidence/recency policy, with a separate extractive digest. Task history
has its own source-linked selector and budget. Modern delivered message records
already contain sender, exact historical recipients, scope, channel ID, turn and
timestamp. The channel ID serves as the conversation ID; no historical IDs are
rewritten. Angular already shows conversation and memory audit panels.

The selective implementation extends these selectors, the existing response schema,
the controller's pure preparation step and the existing canonical commit. It uses
`observe` for queries under agent-selected decisions. It adds no decision mode,
database, external service, extra inference loop or authoritative index. It does
not change scheduling, world rules, personalities, model settings or recovery policy.

## Configure a new run

Choose **Selective retrieval: agent queries** in the dashboard, or set:

```json
{
  "memoryConfig": {
    "mode": "enabled",
    "retrievalStrategy": "agent_query",
    "defaultMemoryEntries": 4,
    "defaultMemoryChars": 2500,
    "maxQueryResults": 10,
    "maxQueryChars": 8000,
    "conversationRecentMessages": 12,
    "conversationRecentChars": 8000,
    "allowConversationHistoryQuery": true,
    "taskHistoryChars": 1000
  }
}
```

Other existing memory limits still apply. Settings freeze with the run and survive
export, pause, resume and restart. Missing `retrievalStrategy`, or `bulk`, retains
the original behavior and original response schema. Old configurations do not gain
selective defaults implicitly; no persisted files are migrated. For selective runs,
working-memory querying requires `mode: enabled`; authorized conversation context
is independent of autobiographical memory. Explicit memory results are withheld
from memory-disabled conditions, including inherited contexts.

Identity, demeanor, numerical attributes, current operational state, world
observations, available capabilities and applicable rules remain on the existing
paths. Selective default memory has no overflow digest. Historical task context is
capped by the smaller of its saved budget and `taskHistoryChars`; task persistence
is unchanged. Existing current-world task observations are not replaced with old
memories. Explicitly retrieved memory IDs are excluded from default selection;
whole explicitly retrieved messages are excluded from the automatic transcript.

Recent conversation allocation rotates across experienced channels, taking newest
messages from each before older messages. This prevents many global messages from
displacing a smaller exchange merely through global turn count. Records are supplied
in original source order. Oversized bodies use labeled exact excerpts with continuation
offsets. Custom research templates omitting `{transcript}` receive authorized recent
messages in a separate data message. Existing bulk templates are unchanged.

## Metadata and autonomous queries

Selective response schemas allow optional `subjects` and `topics` on memory edits.
Subjects are `{ "type": "agent", "id": "stable-id" }`, with types `agent`,
`location`, `object`, `resource`, `task`, `project`, or `entity`. Topic labels are
trimmed, lowercased and deduplicated. Authored content is never rewritten. Existing
confidence, importance and provenance remain separate; confidence is not verification.
Legacy records need no new metadata and remain searchable through content fallback.

`retrieval_operations` is optional (at most two per turn). Example:

```json
{
  "decision": {"mode":"observe", "reason":"Recall my earlier discussion", "goal":null},
  "response":"",
  "memory_operations":[],
  "communication":null,
  "retrieval_operations":[{
    "action":"query_memory",
    "query":{"subjectAgentId":"phil", "topics":["inventory"], "limit":5}
  }]
}
```

Include the ordinary operational/world/social fields required by the run's schema.
No new field relaxes their validation. Memory query filters support `person` (exact
case-insensitive name or ID, unambiguous among known identities), `subjectAgentId`,
`subjects`, `topics`, `types`, `keyword`, `limit` and `offset`. Combined filters
are conjunctive; all specified topics/subjects must match. Metadata is preferred;
legacy content search is used when the relevant metadata is absent. Keywords are
case-insensitive substrings. Ranking is descending importance, descending update
time, then ascending ID; missing importance ranks as zero without adding a value
to the record. Confidence is returned unchanged and is not used as truth or ranking.

Queries search active entries in the requesting agent's frozen working state only.
An optional `ownerAgentId` must equal that agent. Naming a subject never opens that
subject's memory file. Invalid shapes, identifiers, limits, whitespace filters,
unauthorized ownership and disabled capabilities use existing rejection/retry paths.
No filesystem path is interpreted as a retrieval target.

Older messages can be retrieved with:

```json
{"action":"query_conversation", "query":{"conversationId":"the-exact-shown-id", "limit":10, "offset":0}}
```

`offset` indexes only authorized messages, oldest first. Follow `nextOffset`; for a
labeled excerpt, continue with its `nextContentOffset` as `contentOffset` at the
same message offset. Exact substrings preserve all original dialogue across pages.
There are no model-generated summaries. A `budget_exceeded` result leaves the
cursor unchanged if even record metadata or a complete memory entry cannot fit.
The saved configuration controls budget; it is not silently increased.

## Access, timing and persistence

Private, team, local and global access use the recipients captured at delivery.
Current location, team membership and current global permissions never expand old
audiences. The sender retains its own communications; authorized listeners retain
them after moving. Cross-team messages remain accessible to legitimate listeners.
Nonexistent and inaccessible conversation IDs yield the same generic denial, with
no private contents or counts. An empty authorized memory search is a valid result.

Legacy world records use captured `messageRecipients`; selective legacy speech
also freezes `conversationAudience`. Unscoped legacy records in the same immutable
non-world run can use that run's participants. Inherited legacy records lacking
historical audience evidence do not grant access to additional agents. Missing
permissions are not reconstructed from current teams or positions.

The controller freezes an authorized message projection and identity directory in
its pending context. Queries are executed against that context and original owned
state. Results and deterministic event IDs join the canonical accepted turn. Any
failed validation rejects all proposed effects and query results together. Existing
candidate journaling and idempotent projection repair handle crashes without rerunning
inference. Compact branch context retains owned query-result evidence and audience
metadata. Query results from another agent are never delivered as that agent's memories.

Results from the latest accepted turn by that agent arrive as a separate labeled
user-data message on its next inference. They are not system instructions, verified
world observations, new memories or automatic physical actions. Retries use the
same frozen context. A system-incomplete slot does not consume a pending result;
the next accepted agent turn replaces it. No additional inference is made to search.
Read-only research probes retain their explicit measurement lifecycle rather than
starting autonomous query turns.

## Budgets, events and research UI

`maxQueryResults` applies per query; `maxQueryChars` is shared across the turn's
serialized result-record arrays. Small status/provenance envelopes and the explicit
data label add separately measured prompt overhead. Recent conversation and default
memory budgets include their serialized records/headings. Prompt accounting records
identity/instructions, world/operational context, recent conversation, default memory,
explicit result envelope and task history in **characters**. Completion allowance
remains the saved model token setting. Actual prompt token usage is retained when
the server supplies it; no compartment token estimates are fabricated.

Canonical projections add `memory_query_requested`, `memory_query_completed`,
`conversation_query_requested`, `conversation_query_completed`, and
`retrieval_results_supplied`. They retain owner, filters, status, IDs/counts, source
references, turn and subsequent consumption evidence. Rejected-attempt inference
audit retains supplied-query references even when the turn does not commit. Query
contents remain in canonical owned results, not a global agent-visible search log.

The Angular timeline labels **Retrieved historical data (not newly created memory)**,
shows results/statuses separately from memory edits, and lists supplied-query IDs.
Researcher visibility follows the existing audit convention. Analysis sources for
selective runs include query counts/by-agent/progression, result IDs/status/counts,
committed consumption and measured prompt-token/character averages. Existing recovery
metrics still distinguish first attempts, corrections and incomplete turns. Relevance
can be assessed from original filters and source-linked results; the backend does
not invent a semantic relevance score or draw conclusions for an agent.

## Verification and limits

Regression tests cover person/topic/combined/legacy search, ownership, belief versus
truth, historical audiences after movement/team changes, late arrivals, cross-team
and private messages, bounded long conversations, exact message chunks, rejected
queries, restart/resume, deterministic replay, metadata revisions, prompt budgets,
original configurations, custom protocols, schema combinations, both output modes,
query measurements and single-inference execution. Angular tests cover old defaults,
selective settings, serialization, labels and active-run locking.

Search is deterministic in-process scanning of authoritative JSON state and JSONL
history; no cache or index is required. Very large histories still have filesystem
read costs. Explicit result budgets may require smaller pages, and a single oversized
memory record is reported as budget-exceeded rather than truncated. Missing historical
audiences cannot safely be invented. Live-model reasoning quality and llama.cpp grammar
acceptance require testing against the researcher's actual local model/server; mock
HTTP and AJV tests do not establish live decoder compatibility.

## Changed files

| Area | Files |
|---|---|
| Memory metadata, budgets and selection | `backend/src/memory/types.ts`, `retrieval.ts`, `querySchema.ts`, `selective.ts`, `metrics.ts` |
| Independent operation validation | `backend/src/agents/MemoryManager.ts` |
| Optional response capability | `backend/src/llm/agentTurnSchema.ts`, `LlmAdapter.ts`, `backend/src/interaction/execution.ts` |
| Transactional queries and prompt delivery | `backend/src/experiments/ExperimentController.ts` |
| Research protocols, probes and measurements | `backend/src/research/protocol.ts`, `ResearchService.ts`, `backend/src/analysis/analyze.ts` |
| Branch evidence | `backend/src/branches/context.ts` |
| Dashboard | `frontend/src/app/selective-memory-controls.component.ts`, `app.component.ts`, `app.component.html`, `services/experiment.service.ts` |
| Regression tests | `backend/test/selective-memory.test.cjs`, `frontend/src/app/selective-memory-controls.component.spec.ts` |
| Documentation | This guide and `docs/ERROR_RECOVERY.md` |

Final verification: **421 backend tests** pass, including **36 new selective
retrieval tests**, and the backend TypeScript build passes. **102 Chromium frontend
tests** pass, including four new controls tests; the final production Angular build
passes. Existing template and bundle/style budget warnings remain below error limits.
No live model endpoint was available at `127.0.0.1:8080`; local HTTP mocks exercised
both `json_schema` and `json_only`. Live llama.cpp grammar acceptance and a
long-running Ornith experiment remain unverified.
