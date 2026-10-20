# Decisions, scheduling, teams and channels

## Architecture review and migration plan (before implementation)

The controller owns one serialized execution loop and writer lease. A pending turn freezes its inference context; its canonical conversation record commits before mutable working-state projections. Recovery reprojects an already committed record rather than inferring twice. JSON configuration is immutable and research JSONL is append-only.

Currently participant-index round robin is used outside worlds. Worlds also support event-driven eligibility, waits and deterministic clock advancement. Social task settlement assumes original participant rounds. Operational transitions, structured memory and world transformations each validate a candidate before commit. Speech is currently filtered by world colocation or global policy; snapshots compact transcripts and protocol prompts consume the same history filtering path. World observations contain separate agent reports and authoritative outcomes. Own memory retrieval and task-history evidence are separate from dialogue.

Integration will extend these existing response, context and commit paths. New configuration is versioned and installed only when creating a new independent run. Missing fields on saved runs retain legacy behavior. No migration rewrites agent documents, snapshots or logs. New scheduling evidence and original message audiences will be embedded in canonical turn records, making retries and replay reuse the same decisions. Branch continuation will inherit the recorded cursor at its source boundary. Legacy social reward tasks retain their original round boundaries: incompatible scheduling is rejected rather than changing settlement.

New channel visibility must be enforced before transcript/window construction, including compact snapshot context and probes. Researcher audit remains complete. Other agents' unverified activity descriptions must not become a bypass around scoped speech.

## Implemented configuration

These fields are frozen in the existing experiment configuration. The backend fills defaults for new independent runs and new research templates. Explicit `unrestricted` without scheduling/channel fields requests the previous transport and scheduling behavior; adding channel configuration still enables channel validation. Missing fields in saved runs and old snapshot continuations keep legacy behavior. No historical configuration or log is rewritten.

Actual new configuration fields (alongside existing runId, agentIds, maxTurns and llmConfig):

```json
{
  "decisionConfig": {
    "version": 1,
    "mode": "agent_selected",
    "availableModes": ["plan", "observe", "act", "idle", "change_location", "communicate", "reflect"]
  },
  "schedulingConfig": {
    "version": 1,
    "mode": "team_round_robin",
    "seed": 12345,
    "algorithm": "mulberry32-fisher-yates-v1",
    "teamSelection": "round_robin",
    "memberSelection": "round_robin",
    "teams": [
      {"id": "team-a", "name": "Team A", "agentIds": ["agent-05", "agent-06"]},
      {"id": "team-b", "name": "Team B", "agentIds": ["agent-07", "agent-08"]}
    ]
  },
  "communicationConfig": {
    "version": 1,
    "defaultScope": "team",
    "allowPrivateMessages": true,
    "allowTeamMessages": true,
    "allowLocalMessages": false,
    "allowGlobalMessages": false
  }
}
```

Without teams the backend defaults to local communication when a world is enabled, otherwise global communication. Local channels require an enabled world and a named authoritative sender position. Private and team channels can cross locations. Default scope is an advertised suggestion: each nonempty response still requires an explicit permitted scope. Private recipients are explicit; team/local/global require an empty recipient array because the backend derives their audience. No field or operation is silently repaired.

Actual minimal modern response:

```json
{
  "response": "Would you like to discuss our plan?",
  "memory_operations": [],
  "decision": {"mode": "communicate", "reason": "Exchange information", "goal": null},
  "communication": {"scope": "private", "recipientAgentIds": ["agent-05"]}
}
```

Existing enabled capabilities still require their original fields (`social`, applicable `task_decision`, `operational_operations`, `world_operations`). Silence uses `response: ""` and `communication: null`. The output contract derives from the response schema and is attached to every request in both JSON Schema and JSON-only modes. Decoder schemas retain the existing unbounded-repetition projection; independent validation retains all backend bounds.

## Primary-intent compatibility

| Primary intent | Permitted supporting behavior |
| --- | --- |
| plan | Speech, memory proposals, read-only inspection/waits, planned activity status; no location or physical mutation |
| observe | Speech, existing inspections/discovery, waits, observing/idle activity status; no memory edits or physical mutation |
| act | Validated world and operational operations, memory proposals, speech; no mandatory planning turn |
| idle | Silence or speech, waiting, stopping activity; no memory edits, movement, inspection or active activity |
| change_location | Requires explicit validated set_location; permits speech, memory, inspection/waits and supporting activity status; no unrelated physical operations |
| communicate | Speech or silence, memory, inspection/waits, interacting/idle status; no location or physical mutation |
| reflect | Memory proposals, speech or silence, inspection/waits, interacting/idle status; no location or physical mutation |

All modes allow silence. A requested location still passes the operational validator; physical actions still pass world, inventory, transformation and task validators. Plans and reported activity never become verified outcomes. Rejection preserves the parsed proposal and reason in the existing attempt/error audit; the entire candidate remains uncommitted. Accepted decision, memory, operation, request/raw-output and diagnostics evidence is in the canonical turn record.

## Scheduling and recovery

`round_robin` preserves original participant ordering and historical wait semantics. Modern round-robin snapshots additionally carry the next cursor for branch continuation. `event_driven` retains the world's next-ready/clock-advance machinery, including existing task-round behavior in legacy runs.

`randomized` uses unsigned Mulberry32 and Fisher–Yates, version `mulberry32-fisher-yates-v1`. IDs sort by JavaScript's stable code-unit ordering before each shuffle. Cycle seed is `(seed + imul(cycle, 0x9e3779b9)) >>> 0`. Each cycle captures eligible participants once; waiting members are removed from its unserved remainder, newly eligible members join the next cycle. A completed cycle gives each continuously eligible member one opportunity. An all-waiting world advances through existing deterministic wake deadlines or pauses. Idle alone never changes eligibility.

Team scheduling rotates configured team order, then that team's configured member order. It skips waiting members and fully waiting teams. Unequal teams receive equal team opportunities, not equal per-member frequency. Membership must be nonempty, nonduplicated and cover every selected participant when team scheduling or team messages are enabled. Team IDs and names are static; physical positions remain separate.

Every committed modern selection records sorted eligible IDs, chosen actor/team, seed, algorithm, and before/after cursor state. Scheduler and agent-decision events have separate types from world outcomes. Cursor state is reconstructed from canonical records and frozen in pending retry context: failed inference does not advance it, and projection/append recovery reuses the commit candidate. There is still one writer lease and one inference loop.

Historical snapshots capture only the cursor at or before the selected source turn. Branches hash and inherit it with existing immutable context and world state. Old snapshots without a cursor start from the initial modern cursor if new modern settings are explicitly provided; absent settings retain legacy branch behavior. Configuration and original message audiences are never recalculated during replay. Legacy public-goods/prize settlement assumes original participant rounds; new non-round-robin configurations with these tasks are rejected rather than changing their reward semantics.

## Communication and privacy

The canonical turn contains an immutable `message` with messageId, runId, turnIndex, senderAgentId, scope, recipientAgentIds, channelId, content, simulationMinute and timestamp, or null for silence. IDs derive from the run and logical turn. Channel identity derives from run, scope and sorted private group, saved team ID, local location ID, or global group. Local audience can vary over time; each message's original audience is retained. Channel identity starts a new run namespace in branches, while inherited messages retain their original identities.

Filtering uses recorded audiences before recent windows, bounded transcripts, protocol rendering, branch continuation and comparison probes. Compact snapshot context preserves message metadata. Modern transcript entries label message/run/channel/speaker/audience and `agent_report`; bounded windows omit whole entries rather than cut off their labels. World speech observations are generated for authorized recipients directly. Private/team messages do not pass through the old local broadcast path.

Scoped runs omit other agents' unverified activity descriptions from operational context, and strip model-authored reasons from shared world observation payloads. Authoritative physical positions, resources and task facts remain governed by existing world authorization. Own structured memory and verified task history remain separate retrieval paths; another agent's private memory is not automatically shared. Voluntary disclosure is possible through a new authorized message or supported explicit world operation. Researcher audit/export/SSE intentionally retain complete evidence. UI filters are inspection tools, not the security boundary.

No automatic belief editing, personality changes, memory resets, world outcomes from speech, schema repairs or new datastore were introduced. Fresh independent-run operational initialization remains intact; resumed/branched activities are preserved.

## Dashboard

Setup exposes policy/mode checkboxes, four schedules and seed, a static team editor with unassigned/duplicate validation, allowed scopes and default scope. Saved configuration remains locked. Legacy settings remain labeled and use the original world scheduling/communication selectors; modern configuration uses the new controls. Conversation records label primary intent, private/team/local/global scope, original audience, message/channel identity, alongside existing operation/rejection/status/outcome panels. Researcher filters select scope, conversation channel and sender without modifying records.

## Researcher validation experiments

Stop/reset any active run first. Discover and select the actual loaded local model, preserve its version/hash and JSON Schema output mode. Create a distinct run ID for every condition; never edit completed-run configuration. Leave legacy social reward tasks disabled for these schedules. Use the existing kitchen world/location/item configuration with operational turns enabled. Do not add instructions requiring particular substantive dialogue or physical accomplishments.

1. **A — Randomized coffee conversation.** Select Diane (`agent-06`), Miriam (`agent-07`), Owen (`agent-08`), choose Randomized, seed `12345`, no teams, and a permitted local channel. Use an optional coffee topic. Run at least 100 turns. Inspect/export each turn's schedulerDecision/stateAfter. Reproduce actor order with the same seed, participant IDs and eligibility history; pause/resume and restart partway through a second run to check the remaining order. Real model behavior may change waits, so seed alone does not guarantee identical behavioral eligibility.
2. **B — Two private teams.** Select Charles (`agent-05`), Diane (`agent-06`), Miriam (`agent-07`), Owen (`agent-08`). Choose Team Round Robin; create Team A with Charles/Diane and Team B with Miriam/Owen. Enable team/private, default team; disable local/global. Verify scheduling Charles → Miriam → Diane → Owen. Inspect saved request messages and original audience metadata: opposite-team speech must be absent, even when the researcher can see it. Check continuing same-team messages retain their channel ID. Agents remain free to be silent or choose another permitted activity.
3. **C — Colocated, separate conversations.** Save a new run with the same teams and all four agents at one named kitchen location. Enable only team messages, default team; local/global/private disabled. Confirm physical colocation does not expose opposite-team speech. Save/export the condition, then create a distinct second run with local messages additionally enabled. Visibility changes only when an agent explicitly chooses local; team messages stay private. Compare request/audience evidence rather than treating the researcher's combined timeline as shared agent knowledge.

The automated 100-turn experiment uses a mock model; it is not evidence of local-model behavioral stability or llama.cpp grammar compilation. Run `npm run build --prefix backend`, then `node backend/scripts/local-schema-check.cjs` with LLM environment configuration for a live sequential grammar-initialization check. This checks all nine existing capability combinations and nine with decisions/channels; its one-token requests test acceptance, not completed-response validity.

## Validation results

- `npm test --prefix backend`: **330 passed, 0 failed**, including TypeScript build. The new interaction suite contributes 29 tests; existing fresh operational initialization, memory, transformation, recovery, branching, research and SSE regressions pass. Existing legacy fixtures now explicitly request unrestricted transport; publication API coverage supplies the new response fields when testing new-template defaults.
- Angular headless Chromium suite: **93 passed**, including 10 new configuration/channel tests.
- `npm run build --prefix frontend`: production build passed. Warnings: existing NG8107 stats optional chains, NG8102 world JSON-editor coalescing, existing app stylesheet at 3.95 kB versus 2.05 kB warning budget, and initial bundle at 524.77 kB versus 512 kB warning budget. Hard build budgets passed. Backend test output also contains the existing `punycode` deprecation warning.
- Live sequential schema check attempted at `http://127.0.0.1:8080/v1/models`: **ECONNREFUSED**. Actual llama.cpp grammar acceptance and real-model behavioral stability remain **unverified**. The checker writes all 18 schema artifacts before connecting, and its mock HTTP regression distinguishes grammar acceptance from valid completed response output.
- The 100-turn mock run preserves raw conversational text and records schema validation/request/raw output alongside decisions and scheduler evidence. Maximum concurrent inference was one. Privacy checks include bounded windows, compact/replayed records, current prompts, own memory isolation, world report audiences, restarted runs, historical snapshot branches and read-only inherited-context probes.

One intermediate test run exposed an import-order problem from eagerly subclassing the recovery error in the schema policy module. Error construction now occurs at validation time; the complete final suite passes in all existing module entry orders. Other intermediate fixture failures were resolved by explicitly selecting legacy transport, testing a permitted local scope in the physical-action case, and simulating a paused persisted restart rather than attempting Resume on a stopped run. No failed final checks remain; the live-server limitation above is outstanding.
