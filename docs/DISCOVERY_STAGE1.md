# Discovery Stage 1: configuration and evidence

Stage 1 extends the existing operational registry, transactional world engine, scheduled environmental changes and transformation knowledge. It adds no competition scoring or winner selection. Agents retain control of their activities, speech and sharing.

## Locations JSON editor

In **Location & activity**, enable operational turns and paste a complete document into **Locations JSON**:

```json
{
  "version": 1,
  "locations": [
    {"id": "start", "name": "Starting Room", "description": "A gathering room."},
    {"id": "search", "name": "Search Room", "description": "A room with storage."},
    {"id": "workshop", "name": "Assembly Workshop", "description": "A shared workbench room."}
  ]
}
```

Click **Validate JSON**. Syntax errors retain your draft. Backend validation reports paths such as `/locations/1/id: duplicate location identifier`. Starting an operational experiment is blocked while an edited draft is unvalidated. **Copy JSON** copies the entire editor text, including an invalid draft if you wish to save it externally. Validation alone does not save a run; Start saves locations through the existing immutable experiment configuration. Saved runs reload their original locations; active configuration stays locked. Older location arrays require no migration.

IDs contain 1-120 letters, digits, underscores or hyphens. Names are nonblank and at most 200 characters. Optional descriptions are strings up to 1,000 characters. Empty arrays are valid. Up to 1,000 researcher-defined rooms are supported, plus the reserved `unspecified` location. Do not redefine that reserved location. This finite ceiling bounds configuration size; it is not a required room count. Item catalogs and inventory registries each support up to 2,000 entries. HTTP JSON requests are bounded to 2 MB.

## Complete runnable configuration

[examples/discovery-stage1.json](../examples/discovery-stage1.json) is a complete two-agent, three-room configuration, including all recipe, workspace, inventory, environmental and communication fields. Create/select `bob` and `sara`, replace `llmConfig.model` with the loaded model ID and choose a new run ID. Through the dashboard, paste its locations document as above and its world sub-values into the corresponding World Simulation JSON editors. The API accepts the complete run object at `POST /api/experiment/start`.

The example starts both agents at minute 540 (09:00), without recipes or components in their room. A scheduled event at minute 600 (10:00) changes `access` from `locked` to `open`. The search room contains an unlabeled instruction sheet and two components. The workshop contains a shared assembly inventory. Each agent has an initially empty private bag for normal take/deposit operations. This is a small acceptance scenario, not a full 100-recipe competition. The backend test exercises the complete sequence deterministically using proposed operations, without prescribing agent behavior in the app.

## Connectivity and access gates

The **Optional room connectivity and movement locks** editor accepts this complete value for `worldConfig.exploration`:

```json
{
  "version": 1,
  "connections": [
    {"from": "start", "to": "search", "bidirectional": true, "requiredEnvironment": {"access": "open"}},
    {"from": "search", "to": "workshop", "bidirectional": true}
  ]
}
```

Use this with the matching locations, initial environment and unlock event in the complete example. Environmental gate keys must be declared by initial environmental state, scheduled events or configured recipe changes. A gate opens only when all required string values match authoritative state. Existing scheduled-event ordering determines when the change takes effect; merely naming a future time in dialogue does nothing. A rejected turn does not advance the clock. Use successful turns or the existing researcher time-advance control to reach scheduled events.

Connections can be directed (`bidirectional: false`). Optional `authorizedAgentIds` restricts an edge to selected participants; omitted means all participants, an empty array means none. Endpoints must be distinct registered locations. Duplicate directed edges, including overlapping bidirectional edges, are rejected. There is a maximum of 10,000 connections. Agents see outgoing exits, their own authorization and gate requirements, not remote inventory contents.

An omitted exploration value preserves legacy unrestricted moves between registered rooms. `null` in the editor removes the optional value. A present object with an empty connection array permits staying in place but no room changes. A registered location does not by itself imply reachability. Only a committed `set_location` changes position. Movement uses state before the candidate turn's operations, then inventory access and local communication use the accepted destination. No pathfinding or multi-edge movement occurs automatically.

Failures distinguish `LOCATION_NOT_REACHABLE`, `MOVEMENT_NOT_AUTHORIZED` and `CONNECTION_LOCKED`. Unknown registry destinations are rejected by operational validation (direct world calls with an explicit registry also report `INVALID_LOCATION_REFERENCE`). Invalid movement rejects the whole candidate: memory, activity, inventory, knowledge and clock changes are not partially applied. Existing corrective retry and exhausted-retry policy remain in effect.

## Physical recipe objects and private knowledge

The complete example uses `worldConfig.transformations.knowledgePolicy: "verified"`, empty `initialKnowledge`, and the optional `recipeObjects` association list:

```json
[
  {"itemId": "sheet", "revealsRecipeId": "hidden-recipe", "discoveryAction": "inspect"}
]
```

Paste that list inside the transformation object, not into item properties. Each item and referenced recipe must exist; an item has at most one association. Ordinary items need no association. Catalog names/descriptions are researcher-authored visible labels: do not put secret recipe definitions in those labels or public topics if the experiment requires secrecy.

An agent inspects an accessible physical object with:

```json
{
  "action": "inspect_recipe_object",
  "inventory_id": "search-stock",
  "item_id": "sheet",
  "reason": "Examine the sheet found here."
}
```

This belongs in `world_operations` and is an inspection, allowed by compatible decision modes. The backend checks positive stock, inventory ownership/visibility, physical colocation, workspace authorization and the configured association. Own bags are accessible; another agent's bag requires explicit authorization and colocation. The operation does not consume the sheet. A valid inspection adds the recipe only to the inspector's experiment knowledge. Repeat inspections record evidence but do not duplicate knowledge. Later failure in the same proposal rolls back acquisition.

With verified knowledge, guessing IDs cannot inspect or propose unknown recipes. `discover_transformations` exposes only known recipes. Unknown and nonexistent recipe IDs receive the same unavailable-recipe error, avoiding a hidden-ID oracle. `RECIPE_OBJECT_NOT_ACCESSIBLE` covers absent, remote or unauthorized objects; `INVALID_RECIPE_OBJECT` covers accessible objects without a valid association. No invalid operation grants knowledge or emits a successful committed discovery.

When exploration or physical objects are enabled, prompt inventory/catalog and item-property context are limited to accessible local resources, own possessions and known recipe requirements. The physical item-to-recipe association is not exposed in the ordinary catalog. Unknown local tasks are omitted from the physical-discovery prompt unless the agent participates. Researcher configuration and audits still contain full definitions; those are not agent observations.

Existing public `all` and `discover` knowledge modes remain available. For hidden discovery, use `verified`. Executable knowledge persists in the run's authoritative transformation state, survives Resume/restart and is included in snapshots/branches through the existing world-state machinery. It is distinct from subjective memory and from present inventory.

## Deliberate teaching and existing assembly

An informed agent can use the existing `teach_transformation` operation with `transformation_id`, `recipient_id` and `reason`. The recipient must be colocated. In a physical-object run, transfer also requires an enabled private, local, global or shared-team communication scope; team-only communication cannot teach another team. Scope permissions do not authorize distant physical teaching. Speech about a recipe does not itself grant executable knowledge. Finding or completing a recipe does not automatically teach other colocated agents in physical-object runs.

Once informed, agents use unchanged proposal, explicit join, contribution, reservation, tools, start, interruption and completion rules. Components still require physical inventory transfers. Recipe knowledge does not create items, waive workspace permissions or establish completed work.

## Research records and exports

Committed graph movement produces `world_location_changed` with source/destination, run, agent and simulation time. `recipe_object_discovered` includes event ID, run ID, agent, time, room, inventory, object, recipe, original operation, validation/commit status and knowledge before/after. Repeated inspection sets `newlyLearned: false`. `transformation_taught` adds teacher, recipient, authorized transfer context and recipient knowledge change. Only the inspector receives a discovery observation. The teacher does not receive the recipient's other private recipe knowledge.

The conversation turn's environmental event details display these authoritative records. Existing append-only turn/event logs and research export preserve the events and saved configuration; there is no separate discovery database or incompatible export format. World checkpoints permit reconstruction of knowledge and locations after commits. The existing error/recovery panels and audit records preserve rejected proposals and validation reasons. A failed candidate's diagnostic evidence is not a successful discovery. Resume retries the failed turn without duplicating earlier commits. Researcher JSON exports contain privileged data and must not be fed to agents as observations.

[Stage 2](USER_GUIDE.md#18-team-competitions-commitments-verified-victory-and-termination) now provides optional competition management and verified termination. The large recipe dataset remains a Stage 3 task. Stage 1 deliberately supplies no scoring, winner adjudication, physics or autonomous path planner. Live local-model choices and trajectories remain researcher experiments; automated tests use a mock inference endpoint and do not claim a real model explored or won.

## Implementation map

New files:

- `backend/src/world/exploration.ts`: optional connection schema, reference validation, exits and authoritative movement checks.
- `backend/test/discovery.test.cjs`: acceptance, privacy, failure atomicity, persistence/export, scale and endpoint regressions.
- `examples/discovery-stage1.json`: complete minimal run configuration.
- `docs/DISCOVERY_STAGE1.md`: configuration and evidence guide, including this implementation map.

Modified files:

- `backend/src/operations/state.ts`: location document adapter, field diagnostics and registry ceiling.
- `backend/src/api/experiment.ts`: read-only location validation endpoint.
- `backend/src/index.ts`: bounded request size suitable for large configuration documents.
- `backend/src/world/simulation.ts`: optional connectivity, local context, movement events and discovery integration.
- `backend/src/world/transformations.ts`: recipe-object schema/execution, private knowledge and authorized teaching evidence.
- `backend/src/interaction/execution.ts`: physical recipe inspection classified as an inspection.
- `backend/src/experiments/ExperimentController.ts`: supplies run, registry and communication permissions to the existing candidate transaction.
- `backend/test/operational.test.cjs`: diagnostic expectations accept new field-specific errors.
- `frontend/src/app/operational-controls.component.ts` and `.spec.ts`: JSON editor, backend validation, draft/copy/lock tests.
- `frontend/src/app/world-controls.component.ts`: optional connectivity editor and discovery field guidance.
- `frontend/src/app/services/experiment.service.ts`: location validation client.
- `frontend/src/app/app.component.ts` and `.html`: Start validity guard and authoritative event details.
- `README.md` and `docs/USER_GUIDE.md`: entry points and updated setup instructions.

Locations use a Set during validation; catalog/recipe associations use indexed membership checks during configuration validation. Per-turn context filters inventories once and includes local/known information instead of serializing the whole catalog. No new persistent cache or database migration is required. The scale regression covers 12 agents, 100 locations, 100 hidden recipes and 600 catalog objects, with bounded starting context. It is a functional scale check, not a throughput benchmark.

Verification for this implementation:

- Backend `npm test`: 471 tests passed, including 29 Stage 1 regressions; this command also builds TypeScript.
- Frontend headless Chromium tests: 109 passed.
- Frontend production build: passed, with existing Angular optional-chain and bundle/style budget warnings.
- Existing User Guide JSON configurations, coffee transformation sequence, scheduled competition gate and local links validated.
- Stage 1 full run and documentation JSON examples validated against the actual backend configuration adapters.
- No live local-model exploration run was performed. Automated inference checks use a mock model; no claim is made about a specific model's autonomous discovery behavior or performance.
