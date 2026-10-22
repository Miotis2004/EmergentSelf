# EmergentSelf User Guide

This guide describes the implemented Angular dashboard and Node.js backend, including selective retrieval and automatic turn forfeiture. It separates ordinary dashboard workflows from advanced API and command-line operations. Older design sketches in the README and development roadmap are not a list of current controls.

## Contents

1. [Introduction](#1-introduction)
2. [Installation and startup](#2-installation-and-startup)
3. [Creating and managing agents](#3-creating-and-managing-agents)
4. [Creating an experiment](#4-creating-an-experiment)
5. [Decision modes](#5-decision-modes)
6. [Scheduling and communication](#6-scheduling-and-communication)
7. [World Simulation](#7-world-simulation)
8. [Transformations, recipes, and workspaces](#8-transformations-recipes-and-workspaces)
9. [Agent memory](#9-agent-memory)
10. [LLM configuration and inference](#10-llm-configuration-and-inference)
11. [Error recovery and failed turns](#11-error-recovery-and-failed-turns)
12. [Running and monitoring experiments](#12-running-and-monitoring-experiments)
13. [Experiment reports and research data](#13-experiment-reports-and-research-data)
14. [Exporting and analyzing results](#14-exporting-and-analyzing-results)
15. [Example experiments](#15-example-experiments)
16. [Troubleshooting and FAQ](#16-troubleshooting-and-faq)
17. [Verification and implementation references](#17-verification-and-implementation-references)

## 1. Introduction

EmergentSelf is a local experimental environment for studying observable identity, memory revision, self-description and interaction among LLM agents. Agents share a model endpoint but have separate identities and private working states. The controller sends one inference request at a time. A turn can contain speech, operational intentions, world operations, memory proposals, or an intentional absence of these.

The Angular dashboard configures and monitors runs. The Express backend validates proposals, schedules participants and commits accepted turns. A local OpenAI-compatible server generates model outputs. JSON files hold current agent state and immutable research artifacts; JSONL files preserve turn and event evidence. No database or vector service is required.

Use three distinct evidential categories:

| Category | Example | Interpretation |
|---|---|---|
| Agent report | “I assembled the lantern.” | Generated speech, not proof of assembly |
| Recorded operational state | `set_action`, `working`, `completed` | The agent's reported activity; `outcomeVerified` remains false |
| Authoritative world outcome | A backend transformation completes and produces an item | Verified within the configured simulation, not a claim about the physical world |

A memory can record a mistaken observation or belief. Confidence expresses the agent's confidence, not factual verification. A verified historical achievement does not imply that its resources exist in the next experiment. Self-descriptions and behavior do not establish consciousness, feelings or subjective experience.

## 2. Installation and startup

### Requirements and working directories

Use Node.js **22.22.1**, the version pinned in `.nvmrc`, with npm. Angular 18 and backend TypeScript dependencies are in the two package manifests and lockfiles. A compatible local model server must expose model discovery and chat completions and, preferably, JSON Schema output. The repository does not include model weights or provision an inference server.

From the repository root, install and build with the actual package scripts:

```bash
npm ci --prefix backend
npm ci --prefix frontend
npm run build --prefix backend
npm run build --prefix frontend
```

If nvm is installed, `nvm use` at the root selects the pinned version. Run the backend **from its directory**, because default storage paths depend on `process.cwd()`:

```bash
cd backend
npm run dev
```

For a compiled backend, use `npm run build` and then `npm start` from `backend/`. In a second terminal:

```bash
cd frontend
npm start
```

Open `http://localhost:4200`. The API defaults to `http://localhost:3000`. `frontend/src/app/services/agent.service.ts` and `experiment.service.ts` contain fixed localhost API URLs, including research requests through the experiment service. There is no general frontend API URL environment selector. A backend port change therefore also requires corresponding development configuration/source adjustments; changing `PORT` alone does not retarget the dashboard.

### Backend configuration

The backend calls `dotenv.config()`. You may create `backend/.env`; no tracked `.env.example` is required or supplied. These are supported environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | API listener |
| `LLM_BASE_URL` | `http://127.0.0.1:8080/v1` | OpenAI-compatible base URL |
| `LLM_MAX_TOKENS` | `2048` | Default completion allowance |
| `LLM_OUTPUT_MODE` | `json_schema` | `json_schema` or `json_only` |
| `LLM_REQUEST_TIMEOUT_MS` | `600000` | HTTP timeout; valid range 10 through 900,000 ms |
| `LLM_DEBUG_CONTENT` | disabled | `true` permits readable truncated diagnostic excerpts; use cautiously with private research data |

Saved per-run inference settings take precedence over environment defaults. There is no environment variable that selects a loaded model automatically in place of discovery. With the documented backend working directory, agent records are under `model_memories/agents/` and research data under `researcher/`. Do not start from a different directory and assume the same storage will be used.

### Check the connection

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/llm/config
curl http://127.0.0.1:8080/v1/models
curl http://localhost:3000/api/llm/models
```

Health checks the API, not model quality. In **Experiment Setup > Local model**, enter **API base URL**, click **Discover models**, and select the exact **Loaded model** identifier. A discovery failure is displayed inline. Model discovery does not establish that the server can compile the response grammar or that the model follows the contract.

Optional live-server diagnostics, from `backend/`, use the actual scripts `npm run test:local-schema` and `npm run test:local-model`. Set the script-specific `LLM_TEST_MODEL` to the discovered identifier when needed. The schema check submits minimal sequential requests to test decoder initialization; HTTP acceptance is not independent response-validation evidence. The model check performs real inference with isolated temporary research data. Stop active experiments before either check to avoid concurrent server requests from separate processes. These live checks were not run to validate this documentation.

See [Installation](../INSTALLATION.md), [llama.cpp compatibility](../LLAMA_SCHEMA_COMPATIBILITY.md) and [operations](../OPERATIONS.md). The API has no authentication boundary and enables CORS. Keep private research services on a trusted local interface/network; the separate review page is not a security mechanism.

## 3. Creating and managing agents

1. Return the dashboard to **idle**, using **Reset** after preserving any existing run.
2. In the left **Agent Setup > Create New Agent** card, enter an **ID** and **Name**.
3. Set **Curiosity (0-10)** and **Sociability (0-10)**. Creation stores identical `initial` and `current` values. Numeric attributes are prompt data, not application-enforced behavioral effects.
4. Choose **Starting Demeanor**, or leave **Unspecified (existing behavior)**. Available presets are Helpful and Cooperative, Solitary and Reserved, Analytical and Scientific, Ritualistic and Tradition-Oriented, Skeptical and Questioning, and Assertive and Competitive. **Custom** reveals a nonempty description limited to 1,000 characters.
5. Click **Create Agent**. Duplicate IDs are rejected; IDs use letters, numbers, underscores and hyphens.

A new agent begins with empty legacy memory/belief collections and initial operational state. There is no creation form for arbitrary beliefs or relationships. Existing agents are displayed in **Available Agents**, with creation attributes, demeanor and operational state. Use **Memory & self-model** and **Task History** to inspect their histories, as described in Chapter 13.

Starting demeanor is immutable creation metadata, not a requirement to remain the same. The ordinary UI has no general identity, demeanor or memory editor. Create a new agent for a different initial identity, or use the explicit research snapshot/branch interventions for controlled state changes. The backend agent-creation endpoint can accept other numeric stat keys, but the ordinary creation form exposes only curiosity and sociability.

### Reusing, cloning, archiving and resetting

| Operation | State implications |
|---|---|
| Select an existing agent for a new ordinary run | Reuses persistent memory and current numeric attributes; verified task experience can supply historical context |
| Create another agent with another ID | Starts a distinct identity with empty memory, not an implicit copy |
| Clone from a historical snapshot | Explicit research workflow with provenance; distinguish the clone from an independently initialized agent |
| Trashcan beside an available agent | Opens “Are you sure you want to delete this agent?” with **REMOVE** and **CANCEL** |
| **REMOVE** | Persists `archived: true`, hides future selection, preserves the entire record and all historical references |
| **CANCEL**, or closing without confirmation | Changes nothing |
| **Reset** experiment | Clears the controller's active run view/settings for a new run; does not erase agents, memories, task history or append-only experiment logs |

Archiving is blocked for a participant in a running experiment. Backend errors leave the agent visible. There is no Archived Agents/Restore interface; archived identities still resolve by ID in historical records. Missing archive fields mean visible, unarchived agents.

Independent operational runs initialize fresh idle activity; world runs use their new configured positions. This does not turn an earlier task into a current activity or delete its historical record. Resume and source-linked branches have their own continuity behavior. See [operational initialization](OPERATIONAL_INITIALIZATION.md) and [task history](TASK_HISTORY.md).

## 4. Creating an experiment

Select the **Experiment Setup** tab in the middle workspace. The header retains lifecycle controls, **Run ID**, **Max turns**, status and progress. The Conversation tab and research/audit panels share this state.

| Section | Required and optional choices |
|---|---|
| Run identification | Required unique Run ID using letters/numbers/underscores/hyphens; use at most 120 characters for research-tool compatibility. Max turns is a positive safe integer; branch controls cap it at 100,000 |
| Participants | Select at least two existing, unarchived agents using **Include … in Next Experiment**; startup selection is empty |
| Conversation Topic | Optional, trimmed, up to **8,000 characters** in the current implementation; supplied on turn zero only |
| Decisions, scheduling and communication | At least one enabled mode for Agent-selected; valid scheduler, teams if needed, and an enabled default communication scope |
| Verified task-history context | Optional historical evidence selection; enabled by default with its own bounded counts/characters |
| Local model | Discover/select a loaded model; set completion allowance and structured-output mode |
| Memory condition | Structured editable memory, No memory, or Conversation history only; additional storage/retrieval limits |
| Memory retrieval and conversation continuity | Original bounded selection or opt-in selective agent querying; separate budgets |
| Error Recovery | Enable automatic recovery, retry/backoff settings, and explicitly choose what happens after exhausted corrections |
| World Simulation | Optional; requires enabled operational turns, valid locations and compatible configuration blocks |
| Location & activity | Enable operational turns, define location IDs/names/context and observation policy |
| Social interaction, tasks & feedback | Optional addressing, public-goods/resource-race tasks, feedback source/delivery/visibility |
| Research panels | Optional fixed templates, batches, snapshots, probes, branches, analysis, studies and publication |

Participant ordering comes from the displayed saved turn order, not the order you clicked checkboxes. More than two participants are supported. Unselected agents receive no turns or agent-state modifications from that run. The scheduler can change which selected participant goes next; it cannot add an unselected participant.

Once started, the saved configuration is frozen, including participants, topic, model and recovery policy. Changing draft checkboxes does not change an active run. Pause/Resume retain the same configuration. Use **Reset** and a **new Run ID** to create a differently configured ordinary experiment. Merely pressing Resume does not adopt new draft settings or switch a run from suspension to automatic forfeiture.

The ordinary start validator does not impose the same 120-character run-ID cap as research APIs, nor a universal 100,000-turn cap. Staying within those bounds avoids incompatibility with later research workflows. Analysis has its own observation-count limits.

There is no ordinary JSON-file import button for full run configurations. The complete examples in Chapter 15 can be transcribed into the actual fields or submitted using **backend API** `POST /api/experiment/start`. Each example labels what to paste into each JSON editor. Required fields in a complete API start request are `runId`, `agentIds`, `maxTurns` and `llmConfig`; the resolvers fill supported omitted defaults, not missing resource references or nonexistent participants.

### Social tasks, feedback and historical evidence

**Social interaction, tasks & feedback** is optional and separate from physical recipes. **Enable explicit addressing and decline decisions** adds a speak/decline contract; addressing alone is not private routing. Modern communication scopes still determine delivery. A decline requires empty speech, no recipient, no memory operations and no task amount.

Choose Task `none`, `public_goods`, or `resource_race`. A non-none task requires social interaction and original round-robin scheduling. **Decision endowment** is an integer 1-100 (default 10). Speaking task participants choose a validated integer amount from zero to that endowment. **Pool multiplier** is greater than one and at most five (default 1.5). Public-goods net score is multiplier times total contributions divided by selected participant count, minus own contribution; decline scores zero. **Prize** is 0-1,000 (default 20). Resource-race net score is minus own bid plus an equal share of the prize for highest bidders; a zero-bid tie still splits the prize. Outcomes settle after a complete participant round. These scoring tasks are unrelated to the competition recipe example.

**Enable environmental feedback** is off by default. **Feedback source** is Researcher, Task outcomes or Both; task-based sources require an enabled social scoring task. **Delivery** is Immediate (next eligible turn) or Delayed by 1-1,000 additional scheduled turns. **Visibility** is Private to target agent or Public to participants. Positive researcher score is greater than zero and at most 1,000 (default 1); negative score is from -1,000 to below zero (default -1). **Maximum visible feedback records per prompt** is 1-100 (default 20). Scores are data, not automatic memory/stat updates.

For manual feedback, pause and use **Researcher feedback on a saved decision**: unique Feedback ID, Agent ID, committed decision turn, positive/negative valence, researcher and evidence/rationale, then **Record immutable feedback**. The saved run must enable researcher feedback. Task feedback uses the task formula, not researcher score scaling.

**Verified task-history context** separately controls `enabled`, `recentCompleted` (default 6), `recentAdverse` (4), `recentAttempts` (3), `relevant` (4), and `maxChars` (6,000). Count fields allow 0-100 and the character budget 0-32,000. Selective memory can apply its smaller task-history cap without changing these persisted task records.

For reproducible controlled studies, use **Experimental controls & reproducibility** to freeze a template rather than repeatedly reconstructing manual settings. Do not confuse that panel's researcher-defined roles or fixed prompts with the ordinary agent-creation fields.

## 5. Decision modes

The **Decision policy** is `agent_selected` or `unrestricted`. Agent-selected exposes the seven supported mode checkboxes. Unrestricted retains operation validation but does not impose the selected-mode compatibility table. There is no separate `recall` mode.

| Mode | Permitted intent and important constraints |
|---|---|
| `communicate` | Optional speech and memory edits; no location change or physical world mutation; operational activity may be interacting or idle |
| `idle` | Optional speech/waiting, with no active inspection, memory edit or location change; activity must be idle if changed |
| `observe` | Authorized inspections and selective retrieval queries; no memory edits, movement or physical resource changes; observing/idle activity |
| `act` | Valid physical world operations, operational transitions and memory edits; permissions and required resources still apply |
| `plan` | Memory proposals and inspections; no physical mutation/movement; non-idle operational activity must have `status: planned` |
| `reflect` | Memory proposals and inspections; no movement/physical mutation; interacting/idle activity |
| `change_location` | Requires an explicit accepted `set_location`; permits memory edits and inspections, but not physical world mutations such as transfers |

All modes permit optional speech and world waiting when enabled. At most one `set_location` and one `set_action` are accepted per turn. A longer plan is not a multi-location itinerary to execute in one turn. With operations disabled, `change_location` cannot satisfy its execution requirements; do not enable it in a speech-only experiment.

A decision is a proposal, not a commitment. Schema, mode, communication, memory, location, world and task validation all precede commit. Incompatible output rejects the whole turn and invokes configured recovery. Valid fields from the rejected proposal are not partially executed.

For a conversation where agents may stop speaking, enable **communicate and idle**, leave operational/world features off, and allow a suitable scope such as global. Restricting the experiment to communicate does not itself force speech, because speech is optional; Idle nevertheless gives an explicit alternative. Neither Idle nor silence automatically ends the entire experiment. Max turns or researcher controls determine termination.

See [decision contracts](DECISIONS_TEAMS_CHANNELS.md) and [validation/recovery](DECISION_RECOVERY.md).

## 6. Scheduling and communication

### Scheduling

| UI scheduling option | Ordering and requirements |
|---|---|
| Round Robin | Cycles the saved participant order |
| Randomized | Seeded shuffled cycles; seed is unsigned 32-bit; saved algorithm is `mulberry32-fisher-yates-v1` |
| Team Round Robin | Alternates saved teams and rotates members within each team |
| Legacy Event Driven | Requires a world; waiting agents are suppressed until a deterministic wake condition |

Use **Static teams > Create team** to enter stable team IDs, names and participants. Each participant must belong to exactly one team when team scheduling or team communication is enabled. Membership is independent of current location. Removing a team does not automatically make an invalid remaining default scope valid; review the controls afterward. Legacy public-goods/resource-race scoring requires original round-robin scheduling.

A schedule seed controls ordering, not model responses. Saved scheduler decisions/cursors provide evidence for replay. Each committed normal world turn advances the configured interval. A system-imposed forfeiture also consumes that scheduled interval. Corrective/technical retries do not advance simulation time. Event-driven scheduling can advance to the next known wake time; if every agent waits with no known wake, execution pauses as **Waiting for world events**.

### Scopes and actual delivery

| Scope | Authorized audience |
|---|---|
| `private` | Sender and explicit valid recipient IDs, excluding sender from the requested list |
| `team` | Backend-resolved team members at message creation; proposed recipients must be `[]` |
| `local` | Backend-resolved agents at the sender's authoritative location after an accepted move; requires a world and named location |
| `global` | Backend-resolved selected participants; proposed recipients must be `[]` and global messages must be enabled |

Mentioning someone by name does not deliver a message to them. A team message saying “Phil, please help” remains team-only if Phil is on another team. The researcher can inspect all channels without granting those channels to agents. Default scope is configuration metadata; a speaking agent must still return an explicit compatible communication object.

Silence requires `response: ""` **and** `communication: null`. A non-null team object with empty response is rejected as `INVALID_COMMUNICATION`. `recipientAgentIds: []` is the correct backend-resolved audience marker for speaking team/local/global messages, not a way to make a silent message valid.

Modern message records retain sender, scope, `messageId`, `channelId` and historical recipients. Channel IDs serve as conversation IDs for selective retrieval. Previously authorized listeners retain access after moving or changing teams. Later arrivals do not gain earlier local conversations. New configuration does not retroactively expand old global audiences. Legacy records without audience evidence are handled conservatively, as explained in [selective retrieval](SELECTIVE_RETRIEVAL.md).

A complete four-participant scheduling/communication configuration appears in Example C. Do not paste its entire run object into the teams field; the teams UI edits the `schedulingConfig.teams` array through its own controls.

## 7. World Simulation

World Simulation provides deterministic state transitions within a configured environment. It does not provide navigation/pathfinding, physics, autonomous resource generation or a general-purpose planner.

### UI configuration blocks

Enable **Location & activity > Enable operational turns**, add locations, then enable **World Simulation > Enable deterministic world simulation**. Initial day/time becomes absolute `initialMinute`: day one midnight is zero, 09:00 is 540. **Minutes per successful turn** maps to `minutesPerTurn` (1-10,080); forfeitures consume the same interval despite not being successful agent responses.

| JSON editor | Value to paste | Assembled backend field |
|---|---|---|
| Initial agent locations | Object mapping selected agent IDs to defined location IDs | `worldConfig.initialPositions` |
| Item catalog | Array of item definitions | `worldConfig.items` |
| Initial inventories | Array of inventory definitions | `worldConfig.inventories` |
| Scheduled events | Array of scheduled event definitions | `worldConfig.events` |
| Transformation rules, workspaces, environment and knowledge | Full extension object, or `null` to remove it | `worldConfig.transformations` |

The UI assembles these into a version-1 world object. Do not wrap each editor value in another `worldConfig` object. Copy the exact sub-values from Example B or C. Location definitions belong in **Location & activity**, not the world JSON editors. Unknown extra configuration fields are rejected.

### Catalog, inventories and access

Each item requires `id`, `name`, `unit`, `stackable` and `consumable`. Optional implemented properties are `description`, `category`, `durability`, `condition`, `properties` (typed scalar map), `usageRoles` (IDs), and `provenance` (text). These are metadata or transformation properties, not automatic behavioral affordances.

A stackable item uses integer quantities. A nonstackable item cannot have quantity greater than one in a single inventory. Use separate stable IDs for distinct cups/chairs; globally unique nonstackable identities are required for items modified through recipes. `consumable` controls ordinary `consume_item`, while recipe inputs follow recipe consumption rules. Tools are reusable because of their recipe role, not merely their catalog label.

Each inventory requires `id`, `ownerType` (`location` or `agent`), a corresponding `ownerId`, `visibility` (`private`, `local`, `public`), `authorizedAgentIds`, and `quantities`. All referenced agents/items/locations must exist in that run. Quantities are nonnegative integers. Explicitly define agent inventories needed for receiving/consuming resources.

Visibility is not unrestricted transfer permission. Inspecting a private inventory requires ownership or explicit authorization. Modern execution also rejects remote inventory inspection even when an inventory is visible: an actor may inspect their own inventory or authorized inventories at their authoritative location. Taking/depositing/transferring requires appropriate ownership/access and colocation. Contributions cannot seize another agent's private supplies. Reserved quantities cannot be spent twice.

World operations are `inspect_inventory`, `take_item`, `deposit_item`, `transfer_item`, `consume_item`, supported transformation operations and waiting. Movement is a separate `operational_operations` location change, validated before world operations. There is no walking route, duration-by-distance, seating operation or automatic pouring action.

### Events, environment and observations

Every scheduled event requires `id`, `atMinute`, `occurrences`, `affectedAgentIds`, `observation`, and `wake`. Repeated events also require positive `intervalMinutes`. Optional inventory effects require the complete triple `inventoryId`, `itemId`, `quantityDelta`. Optional environmental effects require both `environmentKey` and string `value`; `locationId` can include colocated listeners. Limits include 100 event definitions, 1,000 occurrences per definition and 10,000 total occurrences. Event times cannot precede the world's initial minute.

Occurrences execute once, ordered by minute, event ID and occurrence index. An invalid scheduled stock effect is recorded as rejected without partially applying it. A scheduled announcement is not an automatic win condition. Environment is a string map initialized by the transformation extension and changed by supported events/recipes.

World observation policy is `local` or `self_only`, separate from operational `self_only`/`co_located`. Observations distinguish authoritative changes from unverified agent reports. The researcher World State inspector shows more than any one agent is entitled to see. When modern communication controls are present, they govern channels; legacy world `communicationPolicy` and `schedulingMode` fields remain in the saved object for compatibility.

See [World Simulation](WORLD_SIMULATION.md). Chapter 15 contains complete schema-checked worlds rather than isolated catalog snippets.

## 8. Transformations, recipes, and workspaces

### The required extension wrapper

The entire **Transformation rules, workspaces, environment and knowledge** editor value must be an object with **all seven top-level fields**: `version`, `recipes`, `workspaces`, `initialEnvironment`, `locationCapabilities`, `knowledgePolicy`, `initialKnowledge`.

This complete empty extension is schema-valid; it intentionally defines no work:

```json
{
  "version": 1,
  "recipes": [],
  "workspaces": [],
  "initialEnvironment": {},
  "locationCapabilities": {},
  "knowledgePolicy": "all",
  "initialKnowledge": {}
}
```

`Invalid world configuration: /transformations required` means the extension object is missing a required property. The error path identifies the object; it does not mean you should add another nested `transformations` property inside it. A recipe alone or a bare recipes array is not the extension. Use the complete `worldConfig.transformations` value from Example B. `null` in the UI removes the optional extension; `{}` is invalid.

### Complete recipe fields

| Field | Meaning and constraints |
|---|---|
| `id`, `name`, `description` | Required stable recipe ID and nonempty descriptive text |
| `requiredLocation` | Optional existing location ID |
| `requiredCapabilities` | Optional array of capability IDs supplied by `locationCapabilities` |
| `inputs` | Required array of `{itemId, quantity}`; each may additionally specify `consumeAt: start` or `completion` |
| `requiredTools` | Required array of `{itemId, quantity}`; reserved and released, not consumed |
| `catalysts` | Required array of reusable requirements; disjoint from tools and inputs |
| `outputs` | Required array of `{itemId, quantity}` produced into the workspace inventory |
| `requiredEnvironment` | Required string map of conditions that must hold |
| `environmentChanges` | Required string map of completion changes |
| `itemRequirements` | Required map: nonstackable item ID to typed property requirements |
| `itemChanges` | Required map: nonstackable item ID to typed completion changes |
| `durationMinutes` | Required nonnegative integer; completion is tied to simulated time |
| `minParticipants` | Required integer 1-100, no greater than selected participants |
| `consumption` | Required `start` or `completion`; per-input `consumeAt` overrides this |
| `interruption` | Required `continue` or `fail_if_participant_leaves` |
| `failurePolicy` | Required literal `return_unconsumed` |

An empty array/map is still required where indicated. Requirements must reference catalog items; nonstackable requirements have quantity one. A recipe's input/tool/catalyst item roles must not conflict. Targets for property modification require stable existing reusable nonstackable objects, appropriate contributions, defined properties and compatible types. Outputs do not silently create new catalog definitions.

A workspace requires `id`, `inventoryId`, `locationId`, and a nonempty `authorizedAgentIds` list. Its inventory must be location-owned at the same location, unique to that workspace, and accessible to contributors. Workspace authorization and inventory authorization are separate checks. `locationCapabilities` maps existing locations to capability ID arrays.

Knowledge policy `all` gives participants all recipes; `discover` supports discovery of recipes available at the current location; `verified` restricts initial knowledge to configured `initialKnowledge` and knowledge acquired through supported teaching/verified completion. `initialKnowledge` maps participant IDs to valid recipe IDs. Knowledge does not waive recipe, workspace or resource requirements.

### Actual lifecycle

1. An agent inspects/discovers a known recipe with `inspect_transformation` or `discover_transformations`.
2. `propose_transformation` supplies a new `task_id`, known `transformation_id`, authorized `workspace_id`, and `reason`. The creator joins the participant list.
3. Other agents explicitly consent with `join_transformation`; speaking agreement does not join a task.
4. Participants use `contribute_transformation` with `task_id`, `inventory_id`, `item_id`, positive `quantity`, `role` (`input`, `tool`, `catalyst`, `target`) and `reason`.
5. The backend reserves contributions so competing tasks cannot reuse the same units. Required contributions, participants, location/capabilities and conditions must be satisfied.
6. `start_transformation` validates readiness and begins the clock-based task. The task ID is used for inspection, start and cancellation.
7. Time advancement checks due completions. Accepted turns, forfeitures and explicit permitted researcher time advancement can progress an already running task.
8. Completion consumes remaining inputs, releases reusable resources, applies permitted changes and records outputs with provenance. A failed/cancelled task releases unconsumed reservations; already consumed inputs are not recreated.

Only the creator can cancel a task. Leaving can interrupt a task under `fail_if_participant_leaves`; `continue` preserves its configured progression. Operational `set_action: completed` and conversational claims cannot complete a recipe. `teach_transformation` requires known recipe and a colocated recipient.

In World State, inspect **Verified transformations**, **Contributions and reservations**, and **Verified production, consumption and modification audit**. Use actual completion/effect records, task status and final inventory to establish success. [Transformations reference](TRANSFORMATIONS.md) documents the operation contract and provenance ledger.

The full four-agent coffee world is in [Example B](#example-b-morning-coffee). One maker and one pot are reusable tools, grounds/water/filters cover four cycles, and each completion yields four servings. Cups/chairs/table are represented as objects; the engine has no dedicated pouring, sitting or cup-filling mechanic. Coffee can be transferred and consumed using ordinary inventory operations, without claiming physical beverage handling was simulated.

## 9. Agent memory

Structured entries are `episodic`, `belief`, `self_description`, or `relationship`; legacy operation type `memory` aliases episodic. Every entry has an ID, original content, confidence, status and source/update provenance. Importance is optional and separate from confidence. Relationships carry `relationship_agent_id`. Selective retrieval supports optional subjects (agent/location/object/resource/task/project/entity references) and normalized topics. Legacy entries remain readable without rewritten metadata.

| Operation | Meaning |
|---|---|
| `add` | Creates an entry; no target ID is needed |
| `update` | Revises an active entry of the same category using its exact `target_id` |
| `retire` | Deactivates an existing active target |
| `contradict` | Creates a conflicting replacement and preserves the superseded original |
| `consolidate` | Combines at least two distinct active targets using `target_ids` |

An opinion expressed in dialogue does not prove a corresponding stored belief exists. A newly formed belief can be added instead of attempting an update to an invented ID. Relationship additions need another valid participant's exact ID, and revisions retain the subject. Stat updates use exact existing stat names, range 0-10; initial values remain immutable. Invalid memory proposals reject a controller turn; they are not automatically converted into additions.

### Conditions and budgets

| Condition | Default historical behavior |
|---|---|
| Structured editable memory (`enabled`) | Current attributes, bounded stored memories/digest, transcript and validated memory edits |
| No memory (`none`) | Original memory selector/transcript withheld, initial attributes, proposed edits ignored |
| Conversation history only (`history`) | Transcript but no structured memory supply/editing; initial attributes |

Verified task history is separately configurable. Do not assume selecting No memory automatically disables that separate historical-evidence channel. For a strict history-free study, inspect all recorded prompt channels and configure task history accordingly.

Original memory settings under **Retrieval and memory limits** are:

| Field | Default; allowed range | Meaning |
|---|---|---|
| `maxActiveEntries` | 200; 1-1,000 | Active stored entry cap; consolidate/retire before further growth |
| `maxOperations` | 20; 1-50 | Memory proposals per turn |
| `maxEntryChars` | 2,000; 1-8,000 | Stored content length |
| `retrievalEntries` | 24; 0-100 | Full/excerpt records in automatic selection |
| `retrievalChars` | 12,000; 0-32,000 | Automatic selection character budget |
| `entryChars` | 1,000; 1-8,000 | Content characters per retrieved entry |
| `summaryChars` | 2,000; 0-8,000 | Extractive digest budget for additional entries |
| `transcriptTurns` | 10; 0-100 | Original recent transcript window |
| `transcriptChars` | 8,000; 0-32,000 | Original transcript budget |
| `retrievalRule` | `importance` or `recent` | Importance/confidence/recency ordering, or update-recency ordering |

Omitted stored entries remain in state/history; a digest is extractive, not newly invented recollection. Selective retrieval replaces the automatic memory/digest/transcript budgets with its separate controls; stored-entry and operation limits still apply.

Choose **Selective retrieval: agent queries** for new runs to use smaller defaults and agent-controlled recall. Defaults are four memory entries/2,500 characters, up to ten results per query, 8,000 shared query-record characters per turn, twelve recent authorized messages/8,000 characters, older conversation access enabled, and historical task context capped at 1,000 characters. No overflow memory digest is supplied in this strategy. Limits and strategy freeze with the run; older runs do not switch automatically.

Selective controls record `retrievalStrategy: agent_query`. Their fields and allowed ranges are `defaultMemoryEntries` (0-100), `defaultMemoryChars` (0-32,000), `maxQueryResults` (1-100), `maxQueryChars` (256-32,000), `conversationRecentMessages` (1-100), `conversationRecentChars` (256-32,000), `allowConversationHistoryQuery` (boolean), and `taskHistoryChars` (0-8,000). Query-record budgets cover original serialized result arrays; small delivery/status envelopes add separately measured prompt overhead. An oversized complete memory record can return `budget_exceeded` rather than silently truncating the authored memory.

Agent-selected queries use Observe and optional `retrieval_operations`, at most two per turn. `query_memory` supports `subjectAgentId`, unambiguous known `person`, `subjects`, `topics`, `types`, `keyword`, `limit`, `offset`, and optional `ownerAgentId` equal to the requester. Filters are conjunctive; query ranking uses importance, update time and stable ID. Content fallback keeps older untagged entries searchable. Naming another agent searches memories **about** them, not their private memory file.

`query_conversation` uses the exact experienced `conversationId`, `limit` and `offset`; exact labeled message excerpts can continue via `contentOffset`. Accepted results are frozen with the turn and supplied on that owner's next inference, without another inference during the query turn. Failed turns gain no committed results. Empty searches are valid. An inaccessible or unknown conversation yields a generic denial with no private counts.

Recent authorized conversations are automatic, distinct from autobiography. Selective conversation continuity is independent of working-memory mode; memory-disabled selective conditions still cannot query or inherit private memories. Explicit results are labeled historical data, not system instructions or verified facts. Inspect actual prompt budgets and returned IDs rather than assuming all stored entries were seen. See [Selective retrieval](SELECTIVE_RETRIEVAL.md) for bounds, pagination, replay and older-audience limitations.

To examine belief development, distinguish: the actual backend event, the memory entry/source recorded by an agent, and the interpretation expressed in subsequent speech. The application does not rewrite beliefs to match omniscient world knowledge.

## 10. LLM configuration and inference

| Setting | Where configured | Meaning |
|---|---|---|
| Base URL, loaded model, max completion tokens, output mode | Local model in Experiment Setup | Required endpoint/model, saved per run |
| Temperature, top-p, model version/weight hash, declared context window, optional seed/server support | Experimental controls template form | Controlled-model metadata/sampling configuration |
| `requestTimeoutMs` | Backend environment or API configuration | No ordinary timeout editor; range 10-900,000 ms |
| Input character limit and system/turn templates | Experimental controls > Fixed prompt and input budget | Recorded protocol limits, not tokenizer measurements |

Temperature defaults to 0.7 and accepts 0-2; optional `topP` accepts 0-1. Sampling seed is unsigned 32-bit and requires explicit `seedSupported: true`. Declared context tokens must accommodate completion allowance. Server support and model-version declarations are researcher responsibilities. Increasing completion allowance does not reduce input context, and very large settings can exceed the actual server context.

`json_schema` is preferred. The decoder receives the compatible inference-facing schema, with large upper repetition bounds relaxed to avoid llama.cpp grammar expansion failures; independent backend validation retains application limits. `json_only` requests a JSON object for servers lacking schema support but does not waive schema/operation validation. Output contracts accompany every inference. The application never silently switches modes during a run or repairs malformed JSON into invented dialogue.

| Diagnostic | Interpretation |
|---|---|
| `httpStatus` | Transport/server response; HTTP 200 alone does not establish valid output |
| `requestedModel`, `model` | Requested and reported identifiers; preserve exact values |
| `finishReason: stop` | Normal generation finish, still subject to JSON/schema/action validation |
| `finishReason: length` | Truncated completion; rejected with specific output-limit diagnostic |
| `contentPresent`, `contentLength`, excerpt | Envelope/content diagnostics; console excerpt is safely capped and normally obscured |
| `usage.prompt_tokens` | Server-reported input tokens, if available |
| `usage.completion_tokens` | Server-reported output tokens, if available |
| `elapsedMs` | Wall-clock duration, not simulated minutes |
| `llmValidation` | Transport/JSON/schema/boundary validation stage, outcome and schema hashes |
| `turnValidation`, memory/world/decision audits | Later application validity; a schema-valid response can still fail here |

Raw requests, outputs and validation evidence are available in research records, not merely console excerpts. Exact prompts can contain sensitive memories. Missing usage is unavailable, not zero. `stop` plus `llmValidation: passed` can still lead to rejected `INVALID_COMMUNICATION`, because schema structure and execution consistency are distinct checks.

## 11. Error recovery and failed turns

### Settings

| `recoveryConfig` field | Default | Range/meaning |
|---|---|---|
| `enabled` | true for newly resolved runs | Automatic recovery; legacy saved policies can differ |
| `correctiveRetries` | 3 | 0-20 retries after the initial candidate |
| `onCorrectiveExhaustion` | `suspend` | Explicit alternative `record_idle_incomplete_and_advance` |
| `technicalRetries` | 5 | 0-20 short technical retries |
| `initialBackoffMs` | 2000 | 1-60,000 ms |
| `maxBackoffMs` | 60000 | 1-300,000 ms, at least initial backoff |
| `persistentConnectivityRecovery` | true | Continue periodic recovery after short technical budget |
| `persistentRetryIntervalMs` | 60000 | 1,000-3,600,000 ms |
| `auditRejectedAttempts` | true | Detailed inference evidence; essential rejection evidence remains even when off |

A retry is not another scheduled participant turn. Invalid proposals receive private corrective feedback, with the same original context and only the latest complete correction included in inference. Technical failures use bounded exponential backoff and optional periodic reconnection. Pause/Stop interrupt client requests and timers; server-side cancellation depends on the model server.

**Automatic continuation is opt-in.** In Error Recovery, select **Record IDLE / INCOMPLETE and continue** before starting the new run. The default **Suspend experiment** pauses after exhausted corrections. Existing immutable configurations retain their policy after upgrade, restart and Resume. With zero corrective retries the first rejection suspends even under continuation, because at least one corrective retry must fail before forfeiture.

| Result | Meaning |
|---|---|
| Agent-selected Idle | A valid autonomous decision; may preserve activity or supply permitted idle/wait behavior |
| `IDLE / INCOMPLETE` | System-imposed fallback after exhausted correctable failures; no fabricated agent decision, speech or idle operation |
| Technical/configuration/storage suspension | Not automatic forfeiture; inspect cause and repair before Resume |

A forfeiture records `turn_forfeited`, consumes one slot/time interval and advances to the next scheduled participant. Rejected movement, memory, messages and resource changes remain uncommitted. Existing activity and independently advancing world processes remain intact. The final allowed forfeiture reaches the ordinary turn limit. An affected legacy social scoring round becomes `task_round_incomplete` with no invented abstention, reward or feedback.

Persistence failures use candidate hashes/canonical logs and projection repair, not another invented action. Unsafe or ambiguous storage suspends. **Resume** retries a paused failed logical turn with its prior context/history and new short recovery allowance; it does not duplicate completed turns or change the policy. **Reset** is for leaving that run and configuring another, not continuing the same suspended turn.

See [Error recovery](ERROR_RECOVERY.md) and [Turn forfeiture](TURN_FORFEITURE.md). The troubleshooting table in Chapter 16 maps actual codes to checks.

## 12. Running and monitoring experiments

1. Check selected participants/order, exact loaded model, enabled capabilities, resource references and the saved-policy intention. Use a new Run ID.
2. Click **Start**. Read inline configuration/model errors before assuming the run began.
3. On **Conversation**, inspect each turn's primary decision, reason/goal where present, scope/recipients, speech and operational changes. Reasons are model explanations, not independently established causes.
4. Watch the thinking indicator and recovery status. A correcting/reconnecting run can remain on the same logical turn for many wall-clock minutes without advancing simulated time.
5. Inspect committed world operations and transformation effects, then compare World State inventories/task status. Distinguish planned/completed agent activity from verified task completion.
6. Open memory/audit inspectors for before/after changes, query results and rejected proposals. A system fallback is distinctly labeled IDLE / INCOMPLETE.
7. Use **Pause** to inspect or export a consistent view; **Resume** continues the same run. Researcher actions that would invalidate a frozen pending turn, such as time advancement, are blocked until it is finished or explicitly Reset.
8. **Stop** interrupts execution and saves lifecycle evidence. The ordinary **Resume** control is for paused runs; a stopped run is not a blank new experiment. Preserve/export it and use Reset/new ID for a fresh ordinary run, or a supported saved trial/branch workflow.
9. At Max turns, status becomes completed. Memory remains persistent. Export before resetting the dashboard if you need convenient access to that run ID.

Conversation and Experiment Setup are tabs, not independent experiments. Channel filters affect researcher display, not delivery or participant knowledge. SSE reconnect loads a snapshot plus live events; refreshing the browser does not reset backend execution. Recovery-aware backend startup restores the latest unambiguous persisted lifecycle/checkpoint, including paused status. Multiple conflicting active candidates or unverifiable storage cause suspension rather than guessing.

Wall-clock timestamps (ISO timestamps in records) describe actual execution. Simulation time is an integer-minute calendar, displayed as Day N HH:MM. Retry latency, token-generation speed and browser refreshes do not themselves advance it. Researcher time advance and wake controls require actor/reason and appropriate non-running, safe lifecycle state; their audit remains separate from agent behavior.

## 13. Experiment reports and research data

There is no single report that proves every claim in a conversation. Use the following inventory of implemented views and exports.

### Dashboard evidence views

| View and how to open it | Contents and evidential source | Preservation |
|---|---|---|
| Conversation tab | Saved ordered turns, model speech, decisions/reasons/goals, scope/recipients, operational changes, committed world/recipe events | Run export contains full turn records, not just rendered text |
| Channel filters on Conversation | Researcher scope/channel/message selection | Display state only; original audience remains in messages |
| IDLE / INCOMPLETE turn card | System fallback reason, attempt references/failure codes, preserved activity and clock progression | Canonical slot and `turn_forfeited` event |
| Retrieved historical data details | Memory/conversation query status, original results, IDs and supply references | Canonical `queryResults` and query/supply events |
| Recovery status and rejected-attempt audit | Retry phase/count, violation paths, original rejected proposal, proposed operations and expandable inference evidence | `recovery_attempt` plus execution checkpoints in run export |
| Research Audit panel | Current run event evidence, accepted memory operation reasons and failed operation diagnostics | `events.jsonl` and per-turn audit trails; screen formatting is not the complete archive |
| Memory & self-model | Enter Run ID and agent, click Inspect run; select latest/historical state or -1 initial baseline, optionally Compare with another turn | Reconstructed state, category entries, confidence, importance, IDs, sources, diff, operational changes and retrieval timeline in export |
| Task History | Enter agent ID, optional run/status, Inspect task history, Previous/Next | Source-linked task/report/proposal records; authoritative/agent_reported/absent verification, roles, inputs/outputs, contributions and effects |
| World State | Locations/waits, inventories, environment, task states, contributions/reservations, properties, production/consumption/modification ledger | Canonical world snapshots/checkpoints and events; not merely agent reports |

Task history statuses are planned, attempted, in_progress, completed, failed, cancelled and interrupted. A rejected proposal is an attempted/rejected proposal with no verified physical achievement. A technical timeout is not a failed physical task. Inputs shown as configured requirements are not proof they were consumed; read recorded effects. Historical state inspectors require recorded versioned baselines/turns; absent legacy evidence cannot be reconstructed by inventing it.

### Experimental controls and reproducibility

Open **Experimental controls & reproducibility** in Setup:

1. **Freeze current configuration as template** saves a unique Template ID, optional starting snapshot, exact model version/sampling declarations, attribute condition (named numeric, arbitrary q-labels or researcher role descriptions), fixed system/turn prompts and maximum input characters.
2. **Prepare batch** uses a saved template, Batch ID, repeats, randomization seed, optional matched participant-order randomization and selected none/history/enabled memory conditions. A feedback-enabled template can add matched feedback-off/configured arms. Trials are prepared, not automatically all run; use **Start trial** for each saved trial. Trial working state is isolated from shared persistent agents.
3. Historical controls record researcher notes, capture a snapshot at the chosen run/turn, clone an agent from it, define fixed probe prompts separated by blank lines, or run a read-only probe. Actor/reason identify interventions. Probes may propose operations in output but never apply them to source state.
4. **Compare configurations** shows field differences and hashes for two saved runs. Prompting metadata may be absent for legacy runs; equality of a few visible fields is not full design matching.
5. **Download selected run and audit data** exports the selected saved run as JSON. Pause active execution first.

### Behavioral measures and longitudinal analysis

Open **Behavioral measures & longitudinal analysis**, refresh saved runs, select source runs, set observations per agent window and analysis seed, then **Generate report**. It does not request a new model answer. The view contains:

- Run/response/failure/human-rating totals, versioned measure definitions and matched design groups.
- Agent timelines with per-window means, source turn ranges, valid/unavailable counts and gaps for missing values.
- Matched-condition mean and first-to-last-window change differences, reported as right minus left.
- 95% run-bootstrap intervals where at least two eligible runs exist; no interval is manufactured from one run.
- Calibration eligibility, scored/unscorable outcomes, confidence bins and Brier loss on explicit answer/confidence benchmark items only.
- Memory-dependence exposure checks, original/restored request equality and lexical response comparisons for withheld/restored arms.
- Social addressing/decline, task amounts/scores, feedback exposure, unsettled decisions and matched feedback groups.
- Branch lineage, configuration interventions, pre/post source IDs, self-description and response lexical continuity.
- Failed/unrun benchmark outcomes and human-score summaries.

Implemented behavioral metric IDs are `question_fraction`, `topic_novelty`, `topic_candidate_fraction`, `uncertainty_per_100_words`, `assertion_per_100_words`, `participant_mention_fraction`, `challenge_fraction`, `cooperation_fraction`, `disengagement_fraction`, `belief_revision_proposal_fraction`, `accepted_belief_revision_fraction`, `self_description_similarity`, `preference_similarity`, and `brier`. Most are punctuation, English cue or token-overlap proxies. A high cooperation-cue score is not verified cooperation. Lexical self-description stability is not subjective identity. Null is unavailable; zero is observed zero.

The downloadable analysis JSON also carries source-linked recovery summaries for applicable forfeiture runs and retrieval summaries for selective runs: scheduled/successful/incomplete slots, correction outcomes, failure codes, per-agent forfeiture rates/progression, query counts/results/supply evidence, measured prompt tokens and separate character budgets. These added summaries do not have dedicated dashboard charts. Audit detailed `recovery_attempt` records for corrections that do not appear as separate failed-response rows in every legacy summary. Incomplete slots have unavailable behavioral measures, not invented dialogue scores.

**Repeatable behavioral benchmarks** saves the standard versioned set under an immutable Benchmark ID and runs it against a selected historical agent state. The nine items/ten prompts cover questions, topics, uncertainty, counterevidence, social response, preferences, self-description, memory and one answer/confidence item. Optional active memory IDs produce original/withheld/restored read-only arms. Each item starts an independent conversation. Failed and unrun prompts remain distinct. Use a researcher ID, rationale and historical turn (-1 is the initial baseline); selected memory IDs must have appeared in the original retrieval to support an exposure-based memory-dependence comparison. Custom benchmark definitions exist through the API, not a free-form benchmark editor in this panel.

### Blinded human evaluation

Under **Prepare blinded human evaluation**, choose selected source runs, a new dataset ID, dialogue/probe/both stream and sample size (1-500), then **Create seeded evaluation sample**. Open **Open blinded review page**, or `/review`, and provide the evaluator only the dataset ID. The review page loads the public projection without the ordinary agent catalog/SSE.

Evaluators give a pseudonymous rater ID, anchored scores 0-4 or unavailable, social tags and a nonempty evidence/justification. Ratings are immutable per dataset/item/rater. Dimensions are information seeking, topic initiation, evidence-grounded uncertainty, response to counterevidence and reported self-model consistency. Tags are address, challenge, cooperate, disengage, none and unclear. Zero is not “missing.” Analyst exports retain source mappings; exact text can reveal identity. This is metadata blinding, not anonymization, access control or automatic inter-rater adjudication.

### Identity continuity, branches and interventions

Open **Identity continuity, branches & interventions**. Source runs require fixed Phase III protocol metadata. Capture a historical snapshot first, then create a new branch/run ID from that snapshot or a saved branch baseline, specify new turns, actor/rationale, optionally change the model/version, and add ordered interventions or leave them empty for a control clone.

Supported interventions are selected-memory withholding/restoration, transplant from donor snapshot, swap, recorded operational changes, current numeric-attribute changes, inherited-history clear/replace, and reversal. Relationship remappings are explicit where imported subjects would be invalid. Initial stats remain immutable. Branches copy isolated state; they do not overwrite parent histories or shared agents.

Saved execution controls are **Inspect**, **Prepare baseline**, and **Start saved branch**. Lineage/configuration-difference/before-after details are inspectable. A source branch baseline means its saved initial state, not its latest evolved state; capture a fresh snapshot for later evolution. Paired pre/post probes select agent/definition/post turn, source-versus-branch or same-branch models, and isolated versus phase-history context. Inspect paired outcomes and generate an analysis report for continuity results. Model changes are confounds, not evidence of memory effects by themselves.

### Research synthesis and publication readiness

Open **Research synthesis & publication readiness**. First prepare planned trials/branches. Select intended runs and enter Study ID, title, research question, researcher, prospective or retrospective registration, sampling plan, randomization/seed policy, blinding/evaluator procedure, exclusion/missing-outcome rules, stopping rule, analysis/multiplicity/interpretation plan, operational hypotheses (IDs, metric/domain, left/right conditions, prediction, meaningful effect and stream/probe stratum), primary window/bootstrap/seed, sensitivity windows and any prespecified exclusions/rationales. **Save immutable registration** freezes the plan.

Prospective registration is rejected if planned runs already have observations; local checksums do not constitute externally certified preregistration. **Inspect registration** reads the saved protocol; **Generate synthesis** shows every planned trial, observed/missing/incomplete/excluded counts, configuration deviations, matched contrasts and sensitivity analyses. Read the ledger, source IDs and intervals, not just a descriptive status label.

**Publication artifact** creates an immutable publication ID with **Aggregate only** or **Private full reproduction**, then permits downloading the saved package. Aggregate excludes raw text, prompts, memory and source IDs and uses aliases; it cannot reproduce raw-text analyses and does not guarantee anonymity. Private includes sensitive source evidence and archived analysis code. Both retain dictionary, methods, limitations and integrity information appropriate to their profile. See [Phase VII](../PHASE_VII.md).

The selected-run bundle includes baselines and available snapshot evidence, but it is not a complete backup of every agent's cross-run task-history projection or unrelated artifacts. Back up both storage roots when preserving an entire research installation.

### Canonical storage and reconstruction

Current agent state is in `model_memories/agents/<agentId>/state.json`, with creation/legacy `identity.json`, `memory.json` and `beliefs.json` compatibility files and archival visibility in `visibility.json`. The canonical state takes precedence; editing legacy files is not an audited memory-update workflow.

For a run, `researcher/experiments/<runId>/config.json` is fixed configuration; `conversation.jsonl` is the canonical scheduled-slot journal, including incomplete slots; `events.jsonl` records state/projection, scheduler, world, recovery and lifecycle evidence. Versioned baselines, task-history projections and research streams supplement them. Artifact directories include templates, batches, snapshots, probe-definitions, benchmarks, benchmark-sessions, private evaluations, ratings, branches, studies and publications. Task-history projections are reconstructible, unlike invented missing source events.

Reconstruct an incident in this order: config and baseline; canonical turn index/event ID; original prompt and actual request; raw/parsed output and LLM validation; independent rejection/operation audits; canonical state/world after commit; source-linked task/production effects; later projections and recovery checkpoints. A projection error can follow an already committed action. Do not count it as a second action merely because it has a separate error event. Hashes detect changes, but are not digital signatures or proof of scientific validity.

## 14. Exporting and analyzing results

### Export inventory

| Export | UI or command | Format/content |
|---|---|---|
| Selected run and audit data | Experimental controls panel | JSON bundle: config/hash, turns, full events/checkpoints, baseline, interventions, probes and available template/snapshot/batch/branch/benchmark/feedback/evaluation evidence, integrity hash |
| Reproducible analysis | Behavioral analysis > Download reproducible analysis JSON | Report JSON with definitions, source fingerprints, observations, groups/windows, comparisons and available social/continuity/recovery/retrieval summaries |
| Observation CSV | Offline `analyze` script, `--csv` | Flat observation/metric source data alongside analysis JSON; no ordinary dashboard CSV button |
| Publication package | Publication panel, choose saved publication, download | Aggregate or private JSON package; archived analysis code and complete raw evidence only for private profile |
| Raw JSON/JSONL backup | Filesystem, outside the app UI | Full agent/research directories, including immutable artifacts and source logs; not a dedicated download-all button |

The backend maintenance script `npm run rebuild:task-history -- RUN_ID`, run from `backend/`, reconstructs a derived task-history index under its writer lease and preserves original run files. Omitting RUN_ID rebuilds all runs. Its optional `RESEARCH_DIR` overrides the script's research root, not the server's storage configuration. This is maintenance, not a dashboard export; back up evidence and stop conflicting writers before using it.

There is no ordinary transcript-only PDF, Excel report, automatic competition scoreboard, separate task-history export button, or agent-facing omniscient report. Use the run bundle and source IDs for these analyses, or external tooling. Run exports contain more than the conversation screen and can contain private memories. Store an unchanged original and create separate analysis derivatives.

The selected-run download corresponds to backend `GET /api/research/runs/:runId/export`. To preserve a paused run using the API (replace the URL's run ID with an existing ID):

```bash
curl --fail http://localhost:3000/api/research/runs/coffee-morning-01/export -o coffee-morning-01.json
```

Do not overwrite your only evidence copy. The following commands use actual backend scripts, run from `backend/` after installing dependencies. Input filenames denote exports you have saved; output files must be new:

```bash
npm run analyze -- /path/to/run-a.json /path/to/run-b.json --output /tmp/report.json --csv /tmp/observations.csv --window 20 --seed 42 --bootstrap 500
npm run synthesize -- --study /path/to/study.json --profile private --output /tmp/publication.json /path/to/run-a.json /path/to/run-b.json
npm run verify-publication -- /tmp/publication.json --recompute
```

A self-contained synthetic pipeline is supplied for checking computation without claiming model results:

```bash
npm run example:publication -- --check
npm run synthesize -- --study ../examples/phase-vii/study.json --profile private --output /tmp/guide-synthetic-publication.json ../examples/phase-vii/synthetic-none-1.json ../examples/phase-vii/synthetic-none-2.json ../examples/phase-vii/synthetic-enabled-1.json ../examples/phase-vii/synthetic-enabled-2.json
npm run verify-publication -- /tmp/guide-synthetic-publication.json --recompute
```

For a private publication created with another code version, the verifier also supports `--extract-code NEW_DIRECTORY`. It refuses to overwrite an existing directory. Reconstruct the archived backend and dependencies before claiming exact recomputation; a current-code hash mismatch is meaningful evidence, not a reason to edit the package. Aggregate packages have no code archive and cannot use raw-data recomputation.

`npm run replicate` is an advanced local-model study workflow, not a passive report viewer. It creates research artifacts/agents and can execute inference when requested; read [Phase VII](../PHASE_VII.md) before using it. Custom benchmarks, advanced request timeouts, direct historical-memory/task filters, and lower-level study/branch APIs are backend capabilities, not additional ordinary setup buttons. The exact route definitions are in [backend API sources](../backend/src/api/).

### Practical analysis workflow

1. Freeze a template/starting snapshot; record exact model/version, prompts, memory strategy/budgets, participant order, schedule, channels and starting world.
2. Prepare repeated conditions and prospective plans where appropriate. Reusing shared agents changes initial history; isolated trials/branches make that difference explicit.
3. Export every run, including failed, stopped and incomplete runs. Preserve model usage/timing if available and report missing measurements.
4. For communication, use delivered message scope/audience and source wording; a participant mention is not delivery or cooperation.
5. For resource use, join contribution/reservation/consumption/output/transfer events to task and inventory IDs. Requirements and reports are not actual consumption.
6. For completion, locate terminal verified tasks and output-production events, including failures/cancellations. For an assigned-product contest, match recipe and participants, then compare authoritative finish minutes.
7. For adaptation/memory dependence, compare matched initial states and repeated conditions, inspect retrieval exposure, and use read-only withheld/restored probes. Lexical differences and model sampling remain alternative explanations.
8. For relationships, self-descriptions and beliefs, inspect source-linked category revisions and before/after content. Do not equate confidence with truth or interpret a memory change as proof of subjective development.
9. Separate rejected attempts from committed turns and system-incomplete slots. Compare correction/forfeiture rates as outcomes, not merely discarded “bad” samples.
10. Generate blinded samples and independently justified ratings where needed, then produce an appropriately disclosed publication package.

Design hashes separate incompatible configurations; run-level bootstrap intervals are descriptive and depend on independence assumptions. English cue measures, token overlaps, repeated endpoints, shared starts, selection effects, missing outcomes and multiple comparisons limit interpretation. No automatic report establishes consciousness, causal memory influence, moral understanding or a stable personality.

## 15. Example experiments

All three examples use **existing agents** `agent-a`, `agent-b`, `agent-c`, `agent-d`; create them first using Chapter 3. Use names Alice, Ben, Cara and Dev if desired, initial curiosity/sociability 5, and unspecified demeanor for a minimally primed comparison. Reuse preserves their histories; use fresh IDs or an explicit source snapshot for independently initialized replications.

Each complete JSON object is a backend start request, not a purported file-import UI. Replace `your-loaded-model-id` with the exact discovered model and adjust the endpoint for your server before submitting. Change run IDs rather than overwriting existing data. The examples define opportunities and validate engine mechanics; autonomous agents are not guaranteed to choose the intended actions or finish a task.

### Example A: Self-Perception

Select the four agents. Leave teams/world/operational turns disabled. Enable communicate and idle, global delivery, structured memory, and an optional starting self-description question. The example explicitly opts into automatic continuation after three failed corrections; keep the default suspension instead if you want to inspect every exhausted turn.

After starting, inspect delivered self-descriptions in Conversation and actual `self_description` additions/revisions in Memory & self-model. A spoken self-description is not necessarily a stored entry. Use historical comparison, probes and exports to distinguish them. Idle does not automatically end the run; stop or reach its turn limit.

```json
{
  "runId": "self-perception-01",
  "agentIds": [
    "agent-a",
    "agent-b",
    "agent-c",
    "agent-d"
  ],
  "maxTurns": 100,
  "initialTopic": "How would each of you describe yourself, and what experience supports that description? You may speak or remain silent.",
  "llmConfig": {
    "baseUrl": "http://127.0.0.1:8080/v1",
    "model": "your-loaded-model-id",
    "maxTokens": 2048,
    "outputMode": "json_schema"
  },
  "memoryConfig": {
    "mode": "enabled"
  },
  "decisionConfig": {
    "version": 1,
    "mode": "agent_selected",
    "availableModes": [
      "communicate",
      "idle"
    ]
  },
  "schedulingConfig": {
    "version": 1,
    "mode": "round_robin",
    "seed": 0,
    "algorithm": "mulberry32-fisher-yates-v1",
    "teamSelection": "round_robin",
    "memberSelection": "round_robin",
    "teams": []
  },
  "communicationConfig": {
    "version": 1,
    "defaultScope": "global",
    "allowPrivateMessages": true,
    "allowTeamMessages": false,
    "allowLocalMessages": false,
    "allowGlobalMessages": true
  },
  "recoveryConfig": {
    "enabled": true,
    "correctiveRetries": 3,
    "onCorrectiveExhaustion": "record_idle_incomplete_and_advance"
  }
}
```

### Example B: Morning Coffee

This noncompetitive example begins at Day 1 09:00 with four agents in a kitchen. It provides one coffee maker, one pot, four individually identified cups, a table and four chairs. Four units of grounds, sixteen units of water and four filters support **four brewing cycles**, each producing four servings, for sixteen total possible servings.

In Location & activity, add `kitchen` (Kitchen). In World Simulation paste the matching `initialPositions`, `items`, `inventories`, `events` and the entire `transformations` value from this complete configuration into their respective editors. Set initial time 09:00 and five minutes per turn. Configure local/private/global channels as shown; no teams or social scoring task is enabled.

Agents may discover/inspect the recipe, propose a uniquely named brewing task, reserve one grounds/four water/one filter as inputs, reserve maker/pot as tools, and start it. Five simulated minutes complete it; supplies are consumed and tools released. Cups, table and chairs are deliberately not recipe inputs. There are no seating or pouring operations. For drinking, the supported abstraction is to transfer coffee servings to the agent's defined inventory and `consume_item` there; the engine does not track cup contents or posture.

Monitor World State for task completion, four produced servings per cycle, released tools and remaining supplies. Read rejected-attempt evidence if participants omit tools or attempt to use already reserved resources. The prompt does not force four cycles; the quantity calculation describes capacity, not a promised agent outcome.

```json
{
  "runId": "coffee-morning-01",
  "agentIds": [
    "agent-a",
    "agent-b",
    "agent-c",
    "agent-d"
  ],
  "maxTurns": 100,
  "initialTopic": "You share a kitchen this morning. Coffee-making resources and a brewing recipe are available. There is no competition. Choose freely whether to talk, make coffee, or do something else permitted by the environment.",
  "llmConfig": {
    "baseUrl": "http://127.0.0.1:8080/v1",
    "model": "your-loaded-model-id",
    "maxTokens": 2048,
    "outputMode": "json_schema"
  },
  "memoryConfig": {
    "mode": "enabled"
  },
  "decisionConfig": {
    "version": 1,
    "mode": "agent_selected",
    "availableModes": [
      "plan",
      "observe",
      "act",
      "idle",
      "change_location",
      "communicate",
      "reflect"
    ]
  },
  "schedulingConfig": {
    "version": 1,
    "mode": "round_robin",
    "seed": 0,
    "algorithm": "mulberry32-fisher-yates-v1",
    "teamSelection": "round_robin",
    "memberSelection": "round_robin",
    "teams": []
  },
  "communicationConfig": {
    "version": 1,
    "defaultScope": "local",
    "allowPrivateMessages": true,
    "allowTeamMessages": false,
    "allowLocalMessages": true,
    "allowGlobalMessages": true
  },
  "recoveryConfig": {
    "enabled": true,
    "correctiveRetries": 3,
    "onCorrectiveExhaustion": "record_idle_incomplete_and_advance"
  },
  "operationalConfig": {
    "version": 1,
    "enabled": true,
    "locations": [
      {
        "id": "kitchen",
        "name": "Kitchen"
      }
    ],
    "observationPolicy": "co_located"
  },
  "worldConfig": {
    "version": 1,
    "enabled": true,
    "initialMinute": 540,
    "minutesPerTurn": 5,
    "initialPositions": {
      "agent-a": "kitchen",
      "agent-b": "kitchen",
      "agent-c": "kitchen",
      "agent-d": "kitchen"
    },
    "items": [
      {
        "id": "coffee-maker",
        "name": "Coffee Maker",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "coffee-pot",
        "name": "Coffee Pot",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "cup-1",
        "name": "Cup 1",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "cup-2",
        "name": "Cup 2",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "cup-3",
        "name": "Cup 3",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "cup-4",
        "name": "Cup 4",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "table",
        "name": "Table",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "chair-1",
        "name": "Chair 1",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "chair-2",
        "name": "Chair 2",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "chair-3",
        "name": "Chair 3",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "chair-4",
        "name": "Chair 4",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "grounds",
        "name": "Grounds",
        "unit": "unit",
        "stackable": true,
        "consumable": true
      },
      {
        "id": "water",
        "name": "Water",
        "unit": "unit",
        "stackable": true,
        "consumable": true
      },
      {
        "id": "filter",
        "name": "Filter",
        "unit": "unit",
        "stackable": true,
        "consumable": true
      },
      {
        "id": "coffee",
        "name": "Coffee",
        "unit": "unit",
        "stackable": true,
        "consumable": true
      }
    ],
    "inventories": [
      {
        "id": "kitchen-shared",
        "ownerType": "location",
        "ownerId": "kitchen",
        "visibility": "local",
        "authorizedAgentIds": [
          "agent-a",
          "agent-b",
          "agent-c",
          "agent-d"
        ],
        "quantities": {
          "coffee-maker": 1,
          "coffee-pot": 1,
          "cup-1": 1,
          "cup-2": 1,
          "cup-3": 1,
          "cup-4": 1,
          "table": 1,
          "chair-1": 1,
          "chair-2": 1,
          "chair-3": 1,
          "chair-4": 1,
          "grounds": 4,
          "water": 16,
          "filter": 4,
          "coffee": 0
        }
      },
      {
        "id": "agent-a-bag",
        "ownerType": "agent",
        "ownerId": "agent-a",
        "visibility": "private",
        "authorizedAgentIds": [],
        "quantities": {}
      },
      {
        "id": "agent-b-bag",
        "ownerType": "agent",
        "ownerId": "agent-b",
        "visibility": "private",
        "authorizedAgentIds": [],
        "quantities": {}
      },
      {
        "id": "agent-c-bag",
        "ownerType": "agent",
        "ownerId": "agent-c",
        "visibility": "private",
        "authorizedAgentIds": [],
        "quantities": {}
      },
      {
        "id": "agent-d-bag",
        "ownerType": "agent",
        "ownerId": "agent-d",
        "visibility": "private",
        "authorizedAgentIds": [],
        "quantities": {}
      }
    ],
    "events": [],
    "observationPolicy": "local",
    "communicationPolicy": "local",
    "schedulingMode": "round_robin",
    "transformations": {
      "version": 1,
      "recipes": [
        {
          "id": "brew-coffee",
          "name": "Brew four servings of coffee",
          "description": "Brew four servings of coffee using configured resources.",
          "requiredLocation": "kitchen",
          "inputs": [
            {
              "itemId": "grounds",
              "quantity": 1
            },
            {
              "itemId": "water",
              "quantity": 4
            },
            {
              "itemId": "filter",
              "quantity": 1
            }
          ],
          "requiredTools": [
            {
              "itemId": "coffee-maker",
              "quantity": 1
            },
            {
              "itemId": "coffee-pot",
              "quantity": 1
            }
          ],
          "catalysts": [],
          "outputs": [
            {
              "itemId": "coffee",
              "quantity": 4
            }
          ],
          "requiredEnvironment": {},
          "environmentChanges": {},
          "itemRequirements": {},
          "itemChanges": {},
          "durationMinutes": 5,
          "minParticipants": 1,
          "consumption": "completion",
          "interruption": "fail_if_participant_leaves",
          "failurePolicy": "return_unconsumed"
        }
      ],
      "workspaces": [
        {
          "id": "kitchen-workspace",
          "inventoryId": "kitchen-shared",
          "locationId": "kitchen",
          "authorizedAgentIds": [
            "agent-a",
            "agent-b",
            "agent-c",
            "agent-d"
          ]
        }
      ],
      "initialEnvironment": {},
      "locationCapabilities": {},
      "knowledgePolicy": "all",
      "initialKnowledge": {}
    }
  }
}
```

### Example C: Team Competition

Two static teams of two start at Day 1 09:00, one hour before the announcement at minute 600. Team 1 (`agent-a`, `agent-b`) is assigned **Water Filter**; Team 2 (`agent-c`, `agent-d`) is assigned **Weather Station**. All four component recipes remain available: Portable Lantern, Navigation Compass, Weather Station and Water Filter. Each uses four named inputs, two participants and fifteen simulated minutes at the workshop.

Create `lounge` and `workshop` locations. The shared workshop inventory has one set of each recipe's components. Both teams may use one authorized workspace; resource reservations still prevent double spending. Team scheduling gives alternating team opportunities. Local and private channels allow legitimate cross-team exchanges; team-only messages remain within the sender's team.

The scheduled event changes `competition` from `preparation` to `started`. Every recipe requires `competition: started`, so the backend, rather than announcement text alone, prevents early assembly starts. The assignment and winner rule are researcher protocol in the initial topic, not access-control restrictions on which recipe an autonomous agent may propose.

There is **no automatic assigned-product winner detector**. After running, find the first authoritative completed `water-filter` task involving the assigned Team 1 participants and the first completed `weather-station` task involving Team 2 participants. Compare their `finishedMinute`/completion event simulation minutes and check output production. Earliest qualifying minute wins by this stated protocol; equal minutes are a tie. Completion order within a single equal-minute event batch is not a fair hidden tie-breaker. Other recipes remain possible but do not qualify. Record the assessment and evidence IDs as a researcher note.

```json
{
  "runId": "team-competition-01",
  "agentIds": [
    "agent-a",
    "agent-b",
    "agent-c",
    "agent-d"
  ],
  "maxTurns": 200,
  "initialTopic": "Team 1 (agent-a and agent-b) is assigned Water Filter. Team 2 (agent-c and agent-d) is assigned Weather Station. You have one hour of preparation before the competition-start event at minute 600. The first verified completed assigned product by its assigned two-person team wins; equal completion minutes are a tie. Four recipes remain available. The researcher will assess authoritative task completion and output evidence; no automatic winner detector is configured. Choose your own preparations and actions.",
  "llmConfig": {
    "baseUrl": "http://127.0.0.1:8080/v1",
    "model": "your-loaded-model-id",
    "maxTokens": 2048,
    "outputMode": "json_schema"
  },
  "memoryConfig": {
    "mode": "enabled"
  },
  "decisionConfig": {
    "version": 1,
    "mode": "agent_selected",
    "availableModes": [
      "plan",
      "observe",
      "act",
      "idle",
      "change_location",
      "communicate",
      "reflect"
    ]
  },
  "schedulingConfig": {
    "version": 1,
    "mode": "team_round_robin",
    "seed": 0,
    "algorithm": "mulberry32-fisher-yates-v1",
    "teamSelection": "round_robin",
    "memberSelection": "round_robin",
    "teams": [
      {
        "id": "team-1",
        "name": "Team 1",
        "agentIds": [
          "agent-a",
          "agent-b"
        ]
      },
      {
        "id": "team-2",
        "name": "Team 2",
        "agentIds": [
          "agent-c",
          "agent-d"
        ]
      }
    ]
  },
  "communicationConfig": {
    "version": 1,
    "defaultScope": "local",
    "allowPrivateMessages": true,
    "allowTeamMessages": true,
    "allowLocalMessages": true,
    "allowGlobalMessages": false
  },
  "recoveryConfig": {
    "enabled": true,
    "correctiveRetries": 3,
    "onCorrectiveExhaustion": "record_idle_incomplete_and_advance"
  },
  "operationalConfig": {
    "version": 1,
    "enabled": true,
    "locations": [
      {
        "id": "lounge",
        "name": "Lounge"
      },
      {
        "id": "workshop",
        "name": "Workshop"
      }
    ],
    "observationPolicy": "co_located"
  },
  "worldConfig": {
    "version": 1,
    "enabled": true,
    "initialMinute": 540,
    "minutesPerTurn": 5,
    "initialPositions": {
      "agent-a": "lounge",
      "agent-b": "lounge",
      "agent-c": "lounge",
      "agent-d": "lounge"
    },
    "items": [
      {
        "id": "lantern-housing",
        "name": "Lantern Housing",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "led-module",
        "name": "Led Module",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "battery-pack",
        "name": "Battery Pack",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "power-switch",
        "name": "Power Switch",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "compass-housing",
        "name": "Compass Housing",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "magnetic-needle",
        "name": "Magnetic Needle",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "pivot-pin",
        "name": "Pivot Pin",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "marked-dial",
        "name": "Marked Dial",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "thermometer-module",
        "name": "Thermometer Module",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "humidity-sensor",
        "name": "Humidity Sensor",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "display-panel",
        "name": "Display Panel",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "sensor-housing",
        "name": "Sensor Housing",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "filter-housing",
        "name": "Filter Housing",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "ceramic-cartridge",
        "name": "Ceramic Cartridge",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "collection-reservoir",
        "name": "Collection Reservoir",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "outlet-valve",
        "name": "Outlet Valve",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "portable-lantern",
        "name": "Portable Lantern",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "navigation-compass",
        "name": "Navigation Compass",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "weather-station",
        "name": "Weather Station",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      },
      {
        "id": "water-filter",
        "name": "Water Filter",
        "unit": "unit",
        "stackable": false,
        "consumable": false
      }
    ],
    "inventories": [
      {
        "id": "workshop-shared",
        "ownerType": "location",
        "ownerId": "workshop",
        "visibility": "local",
        "authorizedAgentIds": [
          "agent-a",
          "agent-b",
          "agent-c",
          "agent-d"
        ],
        "quantities": {
          "lantern-housing": 1,
          "led-module": 1,
          "battery-pack": 1,
          "power-switch": 1,
          "compass-housing": 1,
          "magnetic-needle": 1,
          "pivot-pin": 1,
          "marked-dial": 1,
          "thermometer-module": 1,
          "humidity-sensor": 1,
          "display-panel": 1,
          "sensor-housing": 1,
          "filter-housing": 1,
          "ceramic-cartridge": 1,
          "collection-reservoir": 1,
          "outlet-valve": 1
        }
      },
      {
        "id": "agent-a-bag",
        "ownerType": "agent",
        "ownerId": "agent-a",
        "visibility": "private",
        "authorizedAgentIds": [],
        "quantities": {}
      },
      {
        "id": "agent-b-bag",
        "ownerType": "agent",
        "ownerId": "agent-b",
        "visibility": "private",
        "authorizedAgentIds": [],
        "quantities": {}
      },
      {
        "id": "agent-c-bag",
        "ownerType": "agent",
        "ownerId": "agent-c",
        "visibility": "private",
        "authorizedAgentIds": [],
        "quantities": {}
      },
      {
        "id": "agent-d-bag",
        "ownerType": "agent",
        "ownerId": "agent-d",
        "visibility": "private",
        "authorizedAgentIds": [],
        "quantities": {}
      }
    ],
    "events": [
      {
        "id": "competition-start",
        "atMinute": 600,
        "occurrences": 1,
        "affectedAgentIds": [
          "agent-a",
          "agent-b",
          "agent-c",
          "agent-d"
        ],
        "observation": "The competition has started. Team 1 is assigned Water Filter; Team 2 is assigned Weather Station.",
        "wake": true,
        "environmentKey": "competition",
        "value": "started"
      }
    ],
    "observationPolicy": "local",
    "communicationPolicy": "local",
    "schedulingMode": "round_robin",
    "transformations": {
      "version": 1,
      "recipes": [
        {
          "id": "portable-lantern",
          "name": "Assemble portable lantern",
          "description": "Assemble portable lantern using configured resources.",
          "requiredLocation": "workshop",
          "inputs": [
            {
              "itemId": "lantern-housing",
              "quantity": 1
            },
            {
              "itemId": "led-module",
              "quantity": 1
            },
            {
              "itemId": "battery-pack",
              "quantity": 1
            },
            {
              "itemId": "power-switch",
              "quantity": 1
            }
          ],
          "requiredTools": [],
          "catalysts": [],
          "outputs": [
            {
              "itemId": "portable-lantern",
              "quantity": 1
            }
          ],
          "requiredEnvironment": {
            "competition": "started"
          },
          "environmentChanges": {},
          "itemRequirements": {},
          "itemChanges": {},
          "durationMinutes": 15,
          "minParticipants": 2,
          "consumption": "completion",
          "interruption": "fail_if_participant_leaves",
          "failurePolicy": "return_unconsumed"
        },
        {
          "id": "navigation-compass",
          "name": "Assemble navigation compass",
          "description": "Assemble navigation compass using configured resources.",
          "requiredLocation": "workshop",
          "inputs": [
            {
              "itemId": "compass-housing",
              "quantity": 1
            },
            {
              "itemId": "magnetic-needle",
              "quantity": 1
            },
            {
              "itemId": "pivot-pin",
              "quantity": 1
            },
            {
              "itemId": "marked-dial",
              "quantity": 1
            }
          ],
          "requiredTools": [],
          "catalysts": [],
          "outputs": [
            {
              "itemId": "navigation-compass",
              "quantity": 1
            }
          ],
          "requiredEnvironment": {
            "competition": "started"
          },
          "environmentChanges": {},
          "itemRequirements": {},
          "itemChanges": {},
          "durationMinutes": 15,
          "minParticipants": 2,
          "consumption": "completion",
          "interruption": "fail_if_participant_leaves",
          "failurePolicy": "return_unconsumed"
        },
        {
          "id": "weather-station",
          "name": "Assemble weather station",
          "description": "Assemble weather station using configured resources.",
          "requiredLocation": "workshop",
          "inputs": [
            {
              "itemId": "thermometer-module",
              "quantity": 1
            },
            {
              "itemId": "humidity-sensor",
              "quantity": 1
            },
            {
              "itemId": "display-panel",
              "quantity": 1
            },
            {
              "itemId": "sensor-housing",
              "quantity": 1
            }
          ],
          "requiredTools": [],
          "catalysts": [],
          "outputs": [
            {
              "itemId": "weather-station",
              "quantity": 1
            }
          ],
          "requiredEnvironment": {
            "competition": "started"
          },
          "environmentChanges": {},
          "itemRequirements": {},
          "itemChanges": {},
          "durationMinutes": 15,
          "minParticipants": 2,
          "consumption": "completion",
          "interruption": "fail_if_participant_leaves",
          "failurePolicy": "return_unconsumed"
        },
        {
          "id": "water-filter",
          "name": "Assemble water filter",
          "description": "Assemble water filter using configured resources.",
          "requiredLocation": "workshop",
          "inputs": [
            {
              "itemId": "filter-housing",
              "quantity": 1
            },
            {
              "itemId": "ceramic-cartridge",
              "quantity": 1
            },
            {
              "itemId": "collection-reservoir",
              "quantity": 1
            },
            {
              "itemId": "outlet-valve",
              "quantity": 1
            }
          ],
          "requiredTools": [],
          "catalysts": [],
          "outputs": [
            {
              "itemId": "water-filter",
              "quantity": 1
            }
          ],
          "requiredEnvironment": {
            "competition": "started"
          },
          "environmentChanges": {},
          "itemRequirements": {},
          "itemChanges": {},
          "durationMinutes": 15,
          "minParticipants": 2,
          "consumption": "completion",
          "interruption": "fail_if_participant_leaves",
          "failurePolicy": "return_unconsumed"
        }
      ],
      "workspaces": [
        {
          "id": "workshop-workspace",
          "inventoryId": "workshop-shared",
          "locationId": "workshop",
          "authorizedAgentIds": [
            "agent-a",
            "agent-b",
            "agent-c",
            "agent-d"
          ]
        }
      ],
      "initialEnvironment": {
        "competition": "preparation"
      },
      "locationCapabilities": {},
      "knowledgePolicy": "all",
      "initialKnowledge": {}
    }
  }
}
```

## 16. Troubleshooting and FAQ

| Symptom/error | What to check and do |
|---|---|
| Start does nothing useful | Read inline error; select at least two agents, exact loaded model, valid unique run ID and positive turn limit; check backend health |
| Agents are not selected | Startup deliberately deselects all agents; use Participants in Experiment Setup |
| Archived agent disappeared | REMOVE archives it; history/identity remain. No restore UI currently exists |
| Topic stops influencing later turns | Topic is a first-turn stimulus, not a permanent instruction. Conversations/memories can carry later influence |
| `INVALID_COMMUNICATION` with empty response | Require `communication: null`; an empty team/local recipient array is only correct when actual speech exists. Do not silently rewrite the rejected output |
| A named agent does not respond to a message | Check captured scope/recipient IDs. Mentioning someone outside a team does not deliver that team message |
| `INVENTORY_NOT_ACCESSIBLE` | Inspect authoritative post-move location, inventory ownership and authorization. Public visibility does not imply remote inspection/transfer permission |
| `UNAUTHORIZED_RESOURCE_ACCESS` | Check workspace participants and inventory permissions/colocation for contribution or other transformation access |
| `REQUIRED_TOOL_UNAVAILABLE` | Contribute the required reusable tool/catalyst and check that contributed private resources remain at the workspace |
| `MISSING_REQUIRED_INPUT` | Check all required input/tool/catalyst contributions and positive quantities, not only quantities visible somewhere in the world |
| `RESOURCE_ALREADY_RESERVED` | Another active task reserves those units. Inspect contributions/reservations; do not duplicate resources to hide the conflict |
| `WRONG_LOCATION` | Validate configured location/capability and current participant location; speech or planned movement does not move an agent |
| `ENVIRONMENT_REQUIREMENT_NOT_MET` | Inspect actual environment strings, scheduled event execution and recipe conditions |
| `INVALID_TASK_STATE` or `TRANSFORMATION_NOT_FOUND` | Check exact task/recipe/workspace IDs, valid lifecycle and recipe knowledge; do not use a recipe ID where a task ID is required |
| `/transformations required` | Supply all seven extension wrapper fields, with recipes/workspaces inside it; see Chapter 8 |
| “Unknown inventory ID” | Use a configured inventory ID, not an item name, location name or invented bag ID |
| Invalid JSON/schema output | Check raw content, applicable required arrays/decision/channel fields and schema validation. Try an explicitly configured compatibility mode only in a new run if necessary |
| `finishReason: length` | Output was truncated. Select a suitable completion allowance in a new run and check actual server context limits; no malformed output is automatically repaired |
| `INFERENCE_TIMEOUT`, connection/server failures | Check model availability, recorded timeout, technical retry policy/backoff and persistent reconnection. Technical outages do not forfeit turns |
| Exhausted retries still suspend | Check **saved** `onCorrectiveExhaustion`, not a draft selection. Default is suspend. Resume does not change it. Zero retry budget also suspends first rejection |
| `COMMIT_SAFETY_UNVERIFIED` or `RECOVERY_AUDIT_UNAVAILABLE` | Repair storage/permissions/free space and inspect canonical records before Resume. Never delete logs to force a retry |
| Update missing a memory target | Inspect active exact ID/category/subject. Add a genuinely new belief; do not invent an ID or convert an invalid update automatically |
| Agent “remembers” resources that are absent | Compare subjective memory/history with current world inventory. Previous-run achievement is not present stock |
| Agents seem inactive | Inspect status: model generation, correction, technical waiting, planned Idle, system-incomplete slot, all-agents-waiting, paused or completed are different states |
| Work was described but no product appeared | Look for accepted transformation start and actual due completion/effects; operational `completed` is only a report |
| World time did not advance | Rejected attempts do not tick. A pending frozen turn also blocks researcher time intervention. A world must be enabled for a simulation clock |
| Setup is locked | The current run's configuration is immutable. Export/preserve it, then Reset/new ID, or create an explicit research branch |
| Port/storage seems different after restart | Start backend from `backend/`; inspect the fixed frontend API URL and working-directory-relative storage roots |
| No confidence interval/comparison | Need eligible repeated runs and matched design/probe strata. Null is unavailable, not a hidden zero |
| A download contains private memories | Full run/private publication exports intentionally preserve exact evidence. Use reviewed disclosure profiles for sharing |

For a stuck run: (1) preserve Run ID and status; (2) check API/model health; (3) distinguish wall-clock delay from simulation time; (4) inspect latest recovery phase/code/action and saved policy; (5) inspect the original rejected proposal without applying it; (6) check pending waits, required participants, workspace and reserved inputs; (7) check disk/commit evidence; (8) export a paused consistent record; (9) Resume only after the cause is understood, or Reset/new configuration for a different experiment. Do not “fix” scientific history by editing prior logs.

## 17. Verification and implementation references

This guide is documentation only. Its JSON examples are checked with the actual operational, world/transformation, scheduling/communication, memory, recovery, social and LLM configuration validators. A deterministic engine exercise checks four brewing cycles, tool reuse and sixteen coffee servings, and the competition's start gate/completion behavior. These checks establish configuration/engine compatibility, not that a particular local model will choose the actions.

Documentation verification completed successfully: four parsed JSON blocks (three full run configurations and one complete empty transformation extension); four deterministic brewing cycles, sixteen servings and preserved reusable tools; the competition gate and verified filter completion at minute 615; 64 local Markdown links/anchors and the README link; supported script-name checks; and no em dashes. The backend TypeScript build and 72 existing transformation, world, publication and analysis tests passed. The documented synthetic publication check, publication generation/recomputation, analysis JSON and observation CSV commands also passed. Live-model behavior and browser-driven execution of the example agent choices remain outside these checks.

Primary implementation references: [dashboard](../frontend/src/app/app.component.html), [world controls](../frontend/src/app/world-controls.component.ts), [API routes](../backend/src/api/), [experiment controller](../backend/src/experiments/ExperimentController.ts), [world engine](../backend/src/world/simulation.ts), [recipe schema/engine](../backend/src/world/transformations.ts), [analysis definitions](../backend/src/analysis/definitions.ts), [run export service](../backend/src/research/ResearchService.ts), and [publication service](../backend/src/publication/StudyService.ts).

Specialist documentation: [installation](../INSTALLATION.md), [Phase IV measures](../PHASE_IV.md), [social/feedback](../PHASE_V.md), [branches](../PHASE_VI.md), [synthesis/publication](../PHASE_VII.md), [world](WORLD_SIMULATION.md), [transformations](TRANSFORMATIONS.md), [task history](TASK_HISTORY.md), [selective retrieval](SELECTIVE_RETRIEVAL.md), [recovery](ERROR_RECOVERY.md), and [forfeiture](TURN_FORFEITURE.md).
