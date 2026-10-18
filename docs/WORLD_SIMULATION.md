# Deterministic world simulation

World simulation is opt-in via `ExperimentConfig.worldConfig.enabled`. It uses the existing operational location registry, immutable configuration, participant list, single inference/write lease, structured output contract and append-only research logs. Existing configurations without `worldConfig` execute unchanged; no migration or rewrite of existing agent files, snapshots, or logs is needed. Use a new run ID to change configuration.

## Time and scheduling

`initialMinute` is an integer number of minutes since simulation Day 1 00:00. It has no timezone, daylight saving, or connection to inference duration. `minutesPerTurn` defaults to 15 (1–10,080). The dashboard accepts an initial day and time and displays the same calendar. Accepted turns record their starting `simulationMinute` and complete `worldBefore`/`worldAfter` states.

A successfully committed turn advances the clock, executing all due occurrences ordered by minute, event ID (ASCII), then occurrence index. A rejected inference, operational batch, or world transaction commits no turn, memory, inventory, movement, or turn-related clock advance. Events due at the initial timestamp execute in a separate deterministic checkpoint before the first inference; these effects do not depend on that inference succeeding.

Each event has a stable `id`, absolute `atMinute`, `occurrences` (1–1,000), and optional positive `intervalMinutes`. There are at most 100 definitions and 10,000 total occurrences per run. An occurrence key is `eventId:index`; execution history prevents repeats across Pause, Resume, restart, and branches. An event can change an inventory with `inventoryId`, `itemId`, `quantityDelta`, or an environmental string value with `environmentKey`, `value`. Invalid environmental effects are recorded as rejected, execute once, and leave their affected inventory/environment unchanged. The scheduler never interprets narrative as an event definition.

`round_robin` retains the original strict participant order. `event_driven` rotates through eligible participants in that same saved order, skipping agents with accepted `wait_until` or `wait_for_event` operations. Active social tasks retain strict per-participant decision rounds even in event-driven mode; this eligibility is recorded as `task_decision`. Agents otherwise remain eligible unless they explicitly wait; an activity label alone does not force or prohibit speech. Time waits, relevant scheduled events, addressed colocated messages, and explicit researcher requests can wake agents. If everyone waits, the backend commits deterministic clock checkpoints to the next scheduled event or activity time without making filler inference requests. When no future wake source exists it pauses safely. Resume does not invent a wake event; request a participant's next turn from World State or explicitly advance time. There are no real-time timers or background inference workers.

## Catalog, inventories, and operations

Catalog definitions contain `id`, `name`, `unit`, `stackable`, and `consumable`. Quantities are discrete safe integers from zero to 1,000,000,000; nonstackable items have at most one unit per inventory. An inventory contains `id`, `ownerType` (`location`/`agent`), `ownerId`, `visibility` (`private`/`local`/`public`), `authorizedAgentIds`, and `quantities` keyed by catalog ID. References must name registered locations, participating agents, and known items.

Enabled world requests require `world_operations` (use `[]` when empty), alongside the existing response, memory, operational, and applicable social/task fields:

- `inspect_inventory`: `inventory_id`, `reason`.
- `take_item`, `deposit_item`, `transfer_item`: `source_inventory_id`, `destination_inventory_id`, `item_id`, positive integer `quantity`, `reason`.
- `consume_item`: `inventory_id`, `item_id`, positive integer `quantity`, `reason`.
- `wait`: `reason`; wait for an addressed message, waking event, or researcher request.
- `wait_until`: future absolute `until_minute`, `reason`.
- `wait_for_event`: `event_id` of a relevant unexecuted occurrence, `reason`.

Private inventories require ownership or explicit authorization even for inspection. Local inventories are visible at the owner's location; public visibility permits knowledge, not physical access. Transfers require access to both inventories at the agent's named location. Another agent's inventory additionally requires that agent's explicit inventory authorization and colocation. Take moves from a location inventory to the acting agent; deposit reverses that; transfer supports other authorized pairs. Consumption requires the acting agent's inventory and a consumable catalog entry. Transfers update both sides atomically. `unspecified` does not establish colocation.

Operational changes are validated first; a valid same-turn move supplies the location used for subsequent inventory validation. World operations run sequentially on an isolated candidate. A rejection discards the entire candidate, including preceding otherwise-valid actions. Speech and activity descriptions never create resources or verify outcomes. Transactions do not automatically change beliefs, relationships, or numerical attributes.

## Observations and communication

`observationPolicy: local` exposes colocated participant IDs; `self_only` omits them. Inventory visibility and explicit event recipients are independently enforced. Relevant events address configured `affectedAgentIds` and/or agents currently at `locationId`. Observations contain deterministic IDs, simulation timestamps, recipient lists, source labels, and authorized evidence. Context supplies the latest 50 authorized observations; the full history remains in world state/audit records.

`communicationPolicy: local` filters both standard and research-protocol transcript prompts by the recorded recipient list. Unattributed inherited/global messages are withheld in this mode. Speech can be heard by colocated participants without forcing their inference; explicitly addressed speech wakes the addressed eligible recipient. A recipient outside the permitted location rejects the transaction. `global` preserves researcher-controlled shared transcript experiments. Stored speech observations are explicitly agent reports with `verified: false`, separate from authoritative inventory effects.

## Commits, recovery, snapshots, and branches

A conversation JSONL record is the canonical write-ahead commit containing world state, requested operations, validation result, actual effects, observations, exact inference request/raw output, memory and operational projections, and immutable configuration hash. Only after that append succeeds does the controller advance its turn index and project editable agent/audit state. Recovery projects the saved state and deterministic transaction/event IDs, never reapplies the proposed actions. Projection failures pause after the committed turn; Resume repairs before another inference.

Clock jumps and researcher wake requests use append-only `world_checkpoint` records in the existing event stream, with their complete resulting world state and author/reason. World state is reconstructed by revision from canonical turn/checkpoint records rather than maintained in a second mutable world file. Snapshot capture at a selected committed turn includes its world state/hash; later idle checkpoints are outside that historical cut. Branches copy inventories, time, authorized observation history, wait state, and executed occurrence keys from the frozen snapshot. Subsequent effects are isolated per run. Operational location interventions synchronize branch world positions. Restored snapshots verify the world hash. Exported logs and starting snapshots contain the world evidence.

Researcher operations `POST /api/experiment/world/advance` (`minute`, `actor`, `reason`) and `/world/wake` (`agentId`, `actor`, `reason`) share the existing lease and require a paused/stopped/completed run. The World State panel exposes these controls, inventories, positions, and upcoming occurrences. Configuration stays in Experiment Setup and locks with the run.

## Schema and validation

The authoritative agent-turn schema adds action-specific world variants, integer limits and an eight-operation maximum. The inference schema is derived from it using the existing llama.cpp projection that omits upper bounded string/array repetitions. JSON Schema mode remains available and is never silently downgraded. Independent application validation and world authorization/transaction validation remain mandatory. `npm run test:local-schema --prefix backend` checks all six existing combinations plus world operational, world social-operational, and world task-social-operational against a configured local server; AJV acceptance alone is not proof of llama.cpp grammar compilation.

## Reproducibility and current limits

Identical initial state and accepted operations produce identical world transitions, occurrence ordering, and run-scoped transaction identifiers. Model sampling settings, seeds, raw responses and validation outcomes remain separate evidence; model output is not claimed deterministic. World facts never silently rewrite memories.

This is a discrete-turn research environment: moves are instantaneous registered transitions, without travel distances, crafting, markets, physics, or continuous time. Tasks continue using the existing task-decision mechanism; no new task solver is introduced. Observation context is bounded, but complete canonical states are retained for reproducibility, so long runs increase log size. Scheduler occurrences are bounded per run, not expanded indefinitely. The configuration UI uses validated JSON editors for catalogs, initial position maps, inventories and events; backend reference validation remains authoritative. The World State researcher panel is omniscient; agent contexts are not.

## Four-agent residence example

[`examples/world-residence.json`](../examples/world-residence.json) supplies four separate starting rooms, a supply room, kitchen, food catalog, private agent inventories, a shared store, seven daily bells/deliveries, and event-driven scheduling. Create the named agents (or consistently substitute their IDs), select the exact loaded model ID, and enter the operational/world sections in Experiment Setup or submit the configuration to the existing start endpoint. Model personalities and memories are not supplied or changed by this example. Agents decide whether and how to act or wait; the example does not script their conversations.

For local verification with a loaded llama.cpp model:

```sh
LLM_BASE_URL=http://127.0.0.1:8080/v1 LLM_TEST_MODEL=your-exact-model-id npm run test:local-schema --prefix backend
```

The checker performs sequential minimal constrained-generation requests and saves the generated schemas, requests, HTTP bodies and report to a temporary artifact directory. This tests decoder initialization separately from completed agent responses.

## Implementation map and verification

- `backend/src/world/simulation.ts`: world types, configuration/reference checks, pure deterministic clock/schedule/inventory/visibility/wake transitions, and operation schema.
- `backend/src/experiments/ExperimentController.ts`, `backend/src/storage/JsonlStorage.ts`, `backend/src/api/experiment.ts`: single-writer execution, canonical world reconstruction, transactional turns and explicit researcher controls.
- `backend/src/llm/{agentTurnSchema,LlmAdapter}.ts`: derived constrained-generation schema and strict independent validation of optional world capability.
- `backend/src/research/ResearchService.ts`, `backend/src/branches/{BranchService,context,interventions}.ts`: world snapshots/hashes, restoration checks, recipient-preserving history, branch positions, and read-only probes.
- `frontend/src/app/world-{controls,state}.component.ts`, `app.component.{ts,html}`, and `services/experiment.service.ts`: locked setup editors, simulation clock, transcript effects, World State inspector and researcher controls.
- `backend/test/world.test.cjs`, `backend/test/inference-schema.test.cjs`, `backend/scripts/local-schema-check.cjs`, and `frontend/src/app/world-controls.component.spec.ts`: unit/integration/browser/schema regressions and live decoder check.

Validation in the cloud workspace: 203 backend tests and 67 frontend browser tests pass; TypeScript backend and production Angular builds pass. Existing Angular template/style-budget warnings remain. Mocked browser checks at 1366×768 and 390×844 confirm the clock, locked world settings, World State inventory display, independently readable majority-height transcript, and no horizontal overflow or browser errors. No real LLM was used for these deterministic checks.

The live decoder check was attempted against `http://127.0.0.1:8080/v1` and model discovery failed with connection refused. Actual llama.cpp grammar compilation and a live residence experiment therefore remain **unverified**; run the documented command locally with the loaded model. No automatic output-mode fallback was added.
