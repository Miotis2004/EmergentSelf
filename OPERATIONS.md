# Operational state and agent-initiated actions

Operational state is an optional field of the existing schema-version-2 WorkingState,
separate from identity and structured memory:

```json
{
  "operational": {
    "location": {"id":"unspecified","name":"Unspecified location"},
    "action": {"type":"idle","description":"Idle","status":"planned"},
    "outcomeVerified": false
  }
}
```

New agents persist this deterministic default. Existing state files, snapshots and
historical records remain unchanged; absent operational state has this effective
default when displayed or used in an enabled run. Accepted changes add a `source`
with run ID, turn index and operational event ID. Identity saves retain this state;
starting demeanor remains immutable. No migration or automatic memories are added.

## Implementation map

- `backend/src/operations/state.ts`: types, defaults, registry validation, schema,
  transactional preparation, visibility and operational prompt context.
- `memory/types.ts`, `memory/history.ts`, `memory/retrieval.ts`: optional working-state
  field, historical differences, and explicit no-speech transcript presentation.
- `storage/JsonStorage.ts`, `storage/JsonlStorage.ts`: state validation, journal
  projection, recovery, historical timeline and audit preservation.
- `experiments/ExperimentController.ts`, `llm/agentTurnSchema.ts`, `llm/LlmAdapter.ts`:
  frozen configuration, capability-dependent response contract, context and turn commit.
- `api/agents.ts`, `api/experiment.ts`, `research/ResearchService.ts`,
  `social/environment.ts`: agent defaults/views, configuration transport, isolated
  trials/read-only probes and explicit silent social-task abstention.
- `branches/BranchService.ts`, `branches/interventions.ts`: recorded operational
  interventions using the frozen source registry and existing reverse workflow.
- Angular `operational-controls.component.ts`, `app.component.ts/html`,
  `memory-inspector.component.ts`, `branch-panel.component.ts/html` and services:
  configuration, validated state/turn/audit display, history and branch controls.
- `backend/test/operational.test.cjs`, Angular operational/app/branch tests,
  `INSTALLATION.md`, and this document: regression coverage and usage instructions.

Backend relative paths above are beneath `backend/src`; Angular files are beneath
`frontend/src/app`. Existing memory-content/relationship validation is reused intact.

## Experiment configuration

New dashboard experiments enable operational turns by default. Older run/configuration
files that omit `operationalConfig` remain disabled and retain their original response
schema and prompting. Disable the checkbox to use conversation-only behavior.
Configuration is frozen with each run/template, inherited by trials and branches,
and retained across Pause/Resume/restart.

```json
{
  "operationalConfig": {
    "version":1,
    "enabled":true,
    "locations":[
      {"id":"garden-outer-rows","name":"Outer planting rows","description":"Researcher-defined planting area"},
      {"id":"irrigation","name":"Irrigation beds"}
    ],
    "observationPolicy":"self_only"
  }
}
```

There are at most 30 researcher-defined locations; `unspecified` is always available
and reserved. IDs are unique, stable, and contain 1–120 letters, numbers, underscores
or hyphens. Names have 1–200 characters, optional context up to 1,000. A location
registry authorizes recorded transitions only: it specifies no paths, distances,
physical reachability, resources, geography or environmental outcomes. An existing
location persists even if a later experiment omits it; only available destinations
can be selected for a new move. To set a named initial location without overwriting
a baseline, create an explicit operational branch intervention before running.

## Structured responses and transition semantics

Enabled runs extend the existing JSON Schema/JSON-only contract with required
`operational_operations` (an empty array is valid). Existing memory, relationship,
transport and social validation remain in force. Both prompt paths show the acting
agent's own operational state, available locations and authorized observations.
Default turn prompts allow choosing speech, action or silence; explicit researcher
turn prompts and initial topics remain intact.

```json
{
  "response":"",
  "memory_operations":[],
  "operational_operations":[
    {"action":"set_location","location_id":"garden-outer-rows","reason":"Choosing my assigned area"},
    {"action":"set_action","activity_type":"working","description":"Preparing planting beds","status":"in_progress","reason":"Beginning the agreed work"}
  ]
}
```

`set_action` supports idle, moving, working, interacting and observing; status is
planned, in_progress, completed or failed. Descriptions must be nonempty (up to
1,000 characters); reasons must be nonempty (up to 2,000). To stop, set activity_type
idle. To continue, send no operations. The model can combine speech and actions,
send action-only turns, or deliberately send both empty speech and empty operations.
These are committed successful turns, labelled `speech`, `speech_and_action`,
`action_only`, or `intentional_noop`. Raw model speech stays unchanged.

Statuses completed/failed are **agent reports**, never verified external results.
No elapsed-turn rule completes work, consumes resources, grants trust or changes
attributes/confidence. Repeated promises are not independent evidence of fulfillment;
this distinction is explained to the model without rewriting its proposed beliefs.
The `outcomeVerified:false` boundary is reserved for a future environment-resolution
interface, rather than granting the model authority over external facts.

Schema validation uses existing complete-object `anyOf` patterns. Runtime validation
checks destination membership, non-whitespace descriptions/reasons and conflicts.
Only one location change and one activity change are permitted per turn; duplicate
or contradictory changes reject the entire operational batch. The model cannot
supply an agent selector or environmental fields. Invalid structure rejects the
response; semantic operational rejection pauses before committing speech, memory
or operational changes. The original proposals, raw response, and rejected-batch
audit remain in the error event. Resume retries that turn without replaying earlier
committed turns. No failed operation is reinterpreted.

Social/task runs retain their speak/decline rules. Silent operational turns explicitly
use social.action decline, empty response, null recipient and empty memory operations;
they abstain from the social task while still allowing operational changes. Speaking
task turns retain the existing required task decision. This does not settle physical
work: the pre-existing abstract social-task scoring remains a separate mechanism.

## Visibility, audit, persistence and intervention

`self_only` supplies no other agent's operational state. The optional `co_located`
policy supplies selected participants' recorded states with the same non-unspecified
location ID. This is an explicit record-based policy, not simulated senses or proof
of task success. Unspecified location never implies co-location. Public conversation
visibility is unchanged, and another agent's speech remains a claim. Supplied own
state, destinations, policy and observations are recorded in `operationalContext`
and in actual inference requests. Read-only historical probes use historical states,
record operational proposals, and never apply them.

Accepted operations have distinct event IDs, original proposals, status, before/after
state, actor, run, turn, timestamp and `outcomeVerified:false`. The containing turn ID
links these events to the same turn's memory-operation provenance. This supports
attribution without automatically creating episodic, belief or relationship entries.
Operational state and audit are committed using the existing turn journal before
projection; recovery reapplies saved state and IDs, never inference or proposals.
Operational changes persist even in no-memory/history-only conditions, independently
of withheld memory proposals. Shared runs affect shared state; trial runs affect only
their isolated working store.

Snapshots, clones, exports and branch manifests retain complete working state. A
branch intervention `{kind:"operational", agentId:"...", operations:[...]}` uses the
source run's frozen location registry and records before/after evidence. The existing
reverse intervention restores the captured original state. Source artifacts stay
immutable. The branch panel supports entering these operation arrays explicitly.

The dashboard shows persisted/validated locations and actions, intentional silence,
accepted transitions and rejected proposals. The memory inspector shows historical
operational state and differences; no display is inferred from speech. Agent cards
use the active run's journal/snapshot state, including isolated trials.

## Validation and next experiment

Run `npm test` in backend and Angular tests/build as described in INSTALLATION.md.
Regression tests cover defaults and old data, schema modes, transactions and recovery,
silent turns, scheduler serialization, social abstention, memory-independent persistence,
visibility, historical probes, snapshots, clones, branches and exports. Existing memory,
relationship, demeanor and publication tests remain required.

For local-model validation, define the garden locations, choose two participants and
run the original garden scenario with operational mode enabled and self_only visibility.
Inspect actual requests, raw responses, action-only/no-op turns and rejected operations.
Confirm that work remains in_progress until the agent explicitly changes its reported
status, no environmental success is inferred, and Resume retains prior event IDs.
Then repeat with an isolated trial and explicit co_located observations. Actual model
compliance, repetitive dialogue and interpretation of reported outcomes require this
local run; mock-model tests do not establish behavioral effectiveness. There is no
world simulation, verified-outcome resolver or physical movement validation in this phase.
