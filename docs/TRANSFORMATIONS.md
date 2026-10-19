# Item transformations and verified task execution

World simulation now supports researcher-defined recipes, cooperative tasks, reservations, typed object changes, and provenance. Speech remains an unverified agent report. Only committed world operations and scheduler events establish that food was cooked, a valve was repaired, or an item was consumed.

## Configuration and compatibility

The optional `worldConfig.transformations` extension and its persisted state both use `version: 1`. The parent world format remains version 1. Omitting the extension retains legacy inventory behavior, clock semantics, and error diagnostics. No migration, overwrite, or normalization of archived configurations, agent files, or snapshots is performed. Unknown versions or incompatible restored state are rejected rather than repaired.

Copy the complete world configurations in:

- [`examples/transformations-residence.json`](../examples/transformations-residence.json): Helena/Clara, kitchen, stove lighting and four-serving oatmeal.
- [`examples/transformations-repair.json`](../examples/transformations-repair.json): Marcus/Gideon, maintenance workspace, repair kit, consumable seal, existing valve.

Create/select agents with matching IDs and define the named operational locations (and enable operational turns). These are world configurations, not whole experiment configurations. Agent IDs and locations are researcher configuration, not hardcoded behaviors.

The extension requires `recipes`, `workspaces`, `initialEnvironment`, `locationCapabilities`, `knowledgePolicy`, and `initialKnowledge`. Empty collections are valid. Configuration validation checks item/location/participant references, positive integer quantities, unique IDs, typed property changes, environmental keys, participant counts, and workspace ownership. Definitions are frozen with the experiment configuration.

Items retain the original required fields: `id`, `name`, `unit`, `stackable`, `consumable`. Optional fields are `description`, `category`, `durability`, `condition`, `properties` (string/number/boolean values), `usageRoles`, and `provenance`. Durability is a nonnegative integer. A modified object uses one globally unique, nonstackable item ID. Put its initial typed properties in `properties`, or use the top-level condition/durability attributes. Property changes retain its ID and provenance.

## Recipe schema

The authoritative JSON Schema is exported as `recipeSchema` in `backend/src/world/transformations.ts` and composed into the world configuration schema. Recipe fields:

| Field | Meaning |
| --- | --- |
| `id`, `name`, `description` | Stable ID and researcher description |
| `requiredLocation` (optional) | Exact operational location |
| `requiredCapabilities` (optional) | Required capabilities from the configured location map |
| `inputs` | `{itemId, quantity, consumeAt?}` consumed ingredients/parts |
| `requiredTools`, `catalysts` | `{itemId, quantity}` reserved and reusable resources |
| `outputs` | `{itemId, quantity}` products delivered to workspace inventory |
| `requiredEnvironment`, `environmentChanges` | String-valued environmental prerequisites and effects |
| `itemRequirements`, `itemChanges` | Item-ID maps of typed property prerequisites/effects |
| `durationMinutes` | Nonnegative integer simulated minutes; zero completes immediately |
| `minParticipants` | Required number of explicitly joined agents |
| `consumption` | Default input phase: `start` or `completion` |
| `interruption` | `continue` or `fail_if_participant_leaves` |
| `failurePolicy` | `return_unconsumed` |

Inputs may override the consumption phase individually with `consumeAt`. This supports partial consumption: materials spent at start remain spent after interruption; completion-phase ingredients remain in their original inventory if work fails or is cancelled. No compensating ADD operations restore spent resources. Reusable tools and catalysts never disappear. Resource roles must be disjoint; modification targets also require a reserved target contribution unless already reserved as a tool/catalyst.

The backend does not execute code, expressions, or LLM-defined recipes. Usage roles/category/description are metadata; resource roles and requirements in the recipe determine actual effects.

## Structured operations

Every operation is an independently schema-validated member of `world_operations` and requires `reason`. Existing limits (eight world operations per turn) remain unchanged; tasks can be prepared across turns.

| Operation | Additional fields |
| --- | --- |
| `discover_transformations` | None |
| `inspect_transformation` | `transformation_id` |
| `propose_transformation` | `transformation_id`, new `task_id`, `workspace_id` |
| `join_transformation` | `task_id` |
| `contribute_transformation` | `task_id`, `inventory_id`, `item_id`, positive `quantity`, `role` (`input`, `tool`, `catalyst`, `target`) |
| `start_transformation` | `task_id` |
| `inspect_task` | `task_id` |
| `cancel_transformation` | `task_id` (creator only) |
| `teach_transformation` | Known `transformation_id`, colocated `recipient_id` |

A normal sequence is propose → join/contribute → start → await verified completion → take/transfer output → consume. Starting requires all exact resource quantities, prerequisites and colocated participants. A returned `ready` state indicates complete resources and participant count; start still validates location, object and environmental prerequisites.

The inference-facing schema continues to be the existing derived projection of the strict validation schema: it omits large bounded string/array repetitions for llama.cpp compatibility. JSON Schema and JSON-only output modes remain supported. Nothing repairs malformed output or invents missing fields.

## Cooperation and lifecycle

Each workspace names a configured location inventory, its location, and authorized agents. Output access is also enforced for ordinary inventory operations. Shared resources must be physically local and authorized; private contributions can only be made by their owner. A colleague explicitly joins and voluntarily contributes their own supplies. Narrative agreements confer no permissions.

Contributions reserve quantities immediately, in their original inventories, preserving ownership. Normal transfers, consumption, scheduled removals and competing tasks cannot spend reserved stock. Starting freezes the participant/resource list. Cancellation and failure release unused reservations to their original owners; no physical return transfer is needed. Agents may move while a proposed task is being prepared but contributed resources must be at the workspace before start.

Lifecycle: `proposed` → `ready` → `in_progress` → `completed` / `failed` / `cancelled`. Task IDs cannot be reused. A creator may cancel before completion. A committed departure immediately fails a running `fail_if_participant_leaves` task, even if the participant later returns. Carrying reserved resources away also fails running work, including with `continue`; `continue` only permits participants without needed carried resources to leave. Tools remain locked until completion/cancellation/failure. Environmental/object prerequisites are rechecked at completion; invalid output capacity fails without partially applying outputs or modifications.

## Clock, persistence and recovery

Tasks use the same integer simulation clock, canonical world state, pure candidate preparation, writer lease and serialized inference loop as other world operations. Completion deadlines participate in event-driven wake selection; round-robin scheduling is unchanged. Arbitrary time jumps process task deadlines and configured occurrences chronologically. At equal minutes, task completions precede configured events; simultaneous tasks use task-ID order. Zero-duration recipes complete in the initiating transaction.

Completed/failed/cancelled tasks are never completed again. Reservations, typed object properties, FIFO item lots, knowledge and task deadlines persist inside `worldAfter` or scheduler checkpoints, hence snapshots/branches preserve them. Restored extension state validates its schema, references, resource reservations, deadline arithmetic and provenance quantities. Branches get independent copies, preserving source state and logs.

Rejected task operations throw `WorldError` with stable codes including `TRANSFORMATION_NOT_FOUND`, `MISSING_REQUIRED_INPUT`, `INSUFFICIENT_ITEM_QUANTITY`, `REQUIRED_TOOL_UNAVAILABLE`, `WRONG_LOCATION`, `ENVIRONMENT_REQUIREMENT_NOT_MET`, `UNAUTHORIZED_RESOURCE_ACCESS`, `RESOURCE_ALREADY_RESERVED`, `INVALID_TASK_STATE`, `TASK_ALREADY_COMPLETED`. The existing corrective retry flow records the raw proposal and reason, supplies private grounded feedback and retries the same uncommitted logical turn. There is no separate retry framework. Any invalid world operation rejects the entire proposed turn, including proposed memory/movement changes. Independent previously committed clock checkpoints remain committed.

The shared-protocol initial-state hash now includes configured logical world positions, matching the baseline actually persisted. This prevents new world-enabled shared runs from failing restart verification merely because their starting positions differ from agent-file locations. Existing configurations and baselines are not rewritten.

## Knowledge and audit

`all` initializes all recipes as known. `discover` permits explicit discovery or requirements inspection. `verified` starts from `initialKnowledge` and permits learning through the structured teaching operation or observation of a verified completion. Merely mentioning a recipe in speech grants nothing. Known recipes, accessible workspaces/tasks and visible object properties enter authorized world context; private transport guidance explains operations separately from conversation and memory.

The extension ledger and append-only research events record task proposal/join/contribution/start, reservations, input consumption, outputs, object/environment changes, release, completion/failure/cancellation and inspection/teaching. Records include deterministic IDs, simulation minute, task/recipe and actor where applicable, original proposals, before/after state or quantities and source contribution IDs.

Initial inventory lots identify their configured inventory/owner. Production lots reference the task and ingredient lot parents. Transfers preserve lot IDs; ordinary consumption records the precise lots consumed. Fungible stacks use deterministic FIFO allocation. For example, trace `item_consumed` by Clara to its production task, then to consumed oat/water lots and contributing agents. Reservations protect quantities rather than particular FIFO units. The immutable original configuration supplies initial ownership; runtime records never retrospectively change it. Completion observations contain verified output quantities and property/environment effects. Scheduler replay emits no duplicate effects or task audit records.

## Dashboard and implementation map

Experiment Setup exposes the advanced item catalog and a transformation JSON editor containing recipes, workspaces, initial environment/equipment and knowledge policy. Invalid JSON blocks Start; backend reference validation remains authoritative. Saved-run fields stay locked. Enter `null` in the optional transformation editor to remove the extension from a new experiment.

World State displays tasks, participants, status, completion time, reservations/contributions, item properties and the production/consumption audit. Verified transformation summaries appear with committed world events, separate from agent dialogue; conversation text is not rewritten.

- New `backend/src/world/transformations.ts`: configuration/operation/restored-state schemas, pure task engine, knowledge and FIFO provenance.
- `backend/src/world/simulation.ts`: optional item/state extension, protected stock, chronological completion and next-wake integration.
- `backend/src/recovery/recovery.ts`: stable task error codes routed into existing recovery.
- `backend/src/experiments/ExperimentController.ts`: matching logical-world initial hash and baseline.
- Angular `world-controls`, `world-state`, and conversation template: configuration and verified inspection.
- New `backend/test/transformations.test.cjs`, extended Angular world-controls tests: deterministic scenario, edge, recovery, persistence and display coverage.
- Two example configurations above; this document and README link describe usage.

## Validation and limits

Validation on this branch: **266 backend tests passed, 75 Angular tests passed, backend build passed, and frontend production build passed**. Frontend compilation retains the existing stylesheet budget/template warnings. The live nine-combination schema check could not connect to `127.0.0.1:8080/v1/models` (connection refused), so llama.cpp grammar compatibility and real-model task planning remain unverified. The deterministic tests exercise breakfast and repair, ownership, missing resources, reservations, invalid configuration, mixed-phase consumption, reusable tools, typed object identity, factual observations, FIFO provenance, interruption, chronological events, simultaneous tasks, replay, canonical recovery, branch isolation, restart and event-driven wake selection. The existing suites continue checking legacy/non-world experiments and scheduling.

A successful AJV check or mock-model experiment does not prove llama.cpp grammar compilation or real-model task planning. `npm run test:local-schema --prefix backend` submits all nine actual generated response-schema combinations sequentially when a local server is available. Report live compatibility as unverified if discovery cannot connect.

Current limits are deliberate: scalar object properties and string environment values; integer quantities/time; fixed-duration deterministic recipes; no physics, random failure, per-tick wear, recipe scripting, automatic NPCs, competition scoring or economy. Workspaces are researcher-defined shared location inventories, not dynamically created private containers. Equipment uses uniquely named nonstackable catalog IDs rather than a separate instance/object hierarchy. Inputs consume at start/completion, not continuously. A next extension could add validated per-instance wear or staged work while retaining the same transaction and audit contracts. Long-run ledger/state size should be profiled before large competitions; this change retains the existing full-state checkpoint model.
