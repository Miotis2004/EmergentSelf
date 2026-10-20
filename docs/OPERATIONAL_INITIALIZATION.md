# Fresh-run operational state

## Root cause

`ExperimentController.start()` previously copied persistent working state into `memory-baseline.json` and replaced only its location when World Simulation was enabled. The previous activity and operational source therefore survived initialization. `buildPrompt()` then independently called `activeStorage.loadWorkingState()`, again overriding only location. Even changing the baseline alone would have left inference using the old canonical activity. Co-located observations loaded other agents the same way.

The first request could consequently describe an agent as currently waiting for oatmeal in a newly initialized workshop. This was a state-lifecycle defect; correcting it does not establish behavioral causality or guarantee more world operations.

## Solution and commit boundaries

New independent experiments with operational turns enabled receive a backend-owned `operationalInitializationVersion: 1` configuration marker. `freshOperationalState()` clones each participating working state and replaces only its operational section:

```json
{
  "location": { "id": "workshop", "name": "Workshop" },
  "action": { "type": "idle", "description": "No current activity.", "status": "completed" },
  "outcomeVerified": false
}
```

The location comes from validated `worldConfig.initialPositions`. A missing world position, or an operational run without a configured world, uses the existing `unspecified` location. Available destinations alone do not imply a starting location. The previous operational source is retained in initialization evidence rather than falsely attributing the neutral activity to an old agent decision.

Neutral activity represents absence of an inherited current task; it is not an instruction to remain idle and not a verified physical achievement. No personality, model setting, scheduling rule, memory retrieval rule, recipe, or inventory is changed. Non-operational experiments retain their existing behavior.

The projected states are persisted together in the existing `memory-baseline.json`. Baseline publication uses a complete temporary file and exclusive atomic link, preventing a partial baseline or replacement of existing history. Its optional `operationalInitialization` metadata records:

- Version and stable ID `<runId>:operational-initialization`.
- Run/participant IDs and backend-initialization source.
- Each participant's prior and neutral operational state.
- A hash of the initialized complete baseline states.
- `outcomeVerified: false`.

The same metadata is appended once as an `operational_initialization` event in the existing research event stream. It is neither an agent operation nor a transformation outcome; the task-history projector ignores it. Retry checks the durable event ID before appending. The saved configuration marker allows a failed creation to finish publishing its baseline on retry instead of treating the run as an unrelated legacy initialization.

**Canonical identity/memory files are not reset during creation.** `runWorkingState()` overlays run-local operational state on the normally loaded persistent state: the latest committed `stateAfter.operational` for that participant, or its immutable initial baseline if it has not committed a turn. Both the acting agent and authorized co-located observations use this path. The dashboard already displays baseline/committed run state through snapshots, so no Angular workaround or UI rebuild was required.

A successful turn projects its complete working state through the existing canonical commit/recovery mechanism. Thus a neutral activity may reach the canonical working file at that agent's first successfully committed turn; an invalid/aborted proposal cannot partially reset participants. Identity, traits, demeanor, all memory categories and archival metadata remain unchanged. Shared-protocol initial-state hashes use the same neutral baseline that inference and research inspection use.

## Lifecycle and compatibility

| Operation | Operational state |
| --- | --- |
| New independent operational run | Neutral baseline at configured initial location |
| Pause / Resume | Latest committed run activity retained |
| Backend recovery / restart of marked run | Recorded baseline plus committed turns; no new reset |
| Historical turn / snapshot inspection | Recorded historical activity |
| Snapshot-backed trial or branch | Inherited snapshot semantics retained |
| New independent run after a branch | A new neutral operational baseline |
| Existing legacy run without marker | Existing behavior and files retained |

Fresh-run markers are excluded from newly created snapshot-backed template/branch configurations. Their inherited states are not reset or rewritten. A snapshot is an explicit frozen-state continuation, not an implicit request to reset its operational activity.

No historical migration is performed. Existing experiment configurations, baseline files, conversation/audit records, snapshots and verified task-history records remain readable and are not rewritten to retrofit neutral activities. In particular, reopening the existing `task-history-validation-05` run does not change its historical initialization. Use a **new run ID** to exercise the fix.

## Files changed

- `backend/src/operations/state.ts`: pure neutral-state projection.
- `backend/src/experiments/ExperimentController.ts`: versioned fresh baseline, shared initial hash, idempotent initialization evidence and run-local inference/observation loading.
- `backend/src/storage/JsonlStorage.ts`: atomic, exclusive publication of the existing memory baseline.
- `backend/src/branches/BranchService.ts`, `backend/src/research/ResearchService.ts`: avoid inheriting a fresh-run marker into explicit snapshot continuation configurations.
- `backend/test/fresh-operational-state.test.cjs`: nine lifecycle, persistence and compatibility regressions.

The task-history projection rules, `JsonStorage` canonical persistence, Angular components, recipes and LLM adapter are unchanged.

## Local verification with Diane, Miriam and Owen

1. Stop any active experiment and Reset the dashboard to configure another run. Do not delete agent records or old research files.
2. Choose `agent-06`, `agent-07`, and `agent-08`. Select a fresh run ID, such as `workshop-operational-validation-06`.
3. Enable operational turns and configure Workshop as a location. Enable a newly initialized world with all three initial positions mapped to that location. Configure the intended two red/two blue components and kit recipes normally; this fix does not modify them.
4. Start the independent run, without selecting an old snapshot continuation. Initial sidebar/snapshot activities should read **No current activity.**, at Workshop. Inspect the initial baseline and the single backend initialization audit for all participants.
5. Inspect the first inference audit: `operationalContext.own` must be neutral, and co-located agents must have the correct run-local activities. Prior cooking/assembly memories and verified history may still appear explicitly as historical evidence.
6. Commit a chosen in-progress action, pause and resume, and recover the same run after backend restart. That action must remain current. Its baseline and initialization-event count must remain unchanged.
7. Compare historical task records and old snapshots with their originals. Old successes do not create kits or other resources in the new world.

Automated tests establish correct initialization and lifecycle handling. Actual behavioral effects require a subsequent local-model experiment.

Validation: **301 backend tests passed (including nine new regressions), 83 frontend tests passed, and both backend and frontend builds passed**. The frontend build retains its existing stylesheet budget/template warnings. No live-model behavioral improvement was tested or established.
