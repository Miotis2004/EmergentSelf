# Phase VI: identity continuity, branching and intervention

Phase VI creates independently evolving trial branches from historical working state and conversation. It records what was copied, changed, restored and shown to each model. The resulting continuity measures describe state and observable behavior; they do not establish subjective awareness or a persistent experiencing self.

## Workflow

1. Complete or pause a run created with a fixed Phase III protocol. In **Experimental controls & reproducibility**, capture a snapshot at a committed historical turn (`-1` for initial state). New snapshots include exact source conversation references and a context hash, as well as all participant states.
2. Open **Identity continuity, branches & interventions**. Choose a fresh branch/run ID and that snapshot. Enter the researcher, rationale and number of **new** turns. An empty intervention list creates a control clone.
3. Add ordered interventions: withhold, restore, transplant, swap, current numeric attributes, inherited history, or reverse a prior operation. Inspect the queued operations before creating the branch.
4. Optionally select a different model endpoint, loaded model and explicit version/weight hash. Otherwise the source model and inference settings are inherited exactly. Creating a branch does not start inference.
5. Inspect the immutable manifest. **Prepare baseline** materializes its isolated run files for memory inspection or probes. **Start saved branch** runs the exact saved configuration. Stop/reset another paused run before starting this one; Resume uses the main lifecycle control.
6. Administer paired pre/post probes using an existing fixed probe definition. Pre uses the branch's source snapshot state; post uses branch turn `-1` or a selected committed branch turn. Choose the model and conversation-context policies explicitly.
7. Select branch runs in the analysis dashboard. Inspect **Branch lineage & pre/post continuity measures**, configuration differences, self-description evidence, paired statuses and source record IDs. Export full runs and analyze them offline with the existing Phase IV CLI.
8. To undo an intervention, create a **new branch** from the changed branch's saved baseline and add a restore/reverse operation. To fork a branch's later evolution, capture a fresh historical snapshot from that run and use it as the next source. Choosing a saved branch baseline always refers to its initial state, not its latest mutable state.

Participant IDs stay stable within a branch, while the branch has a distinct run ID and isolated trial storage. This preserves identity and relationship references without modifying global agent files. All source participants are copied; each agent's complete canonical state includes identity, immutable initial stats, current stats, active/retired/superseded entries, source metadata and prior entry provenance. No other participant's private state is inserted into an agent prompt unless a deliberate transplant/swap specifies it.

## Branch semantics

A branch is a new experimental trial. It starts local turn numbering and the sequential scheduler at zero, using the source participant order. The number of new turns is independent of source turn numbering. Source conversation is inherited as context, not appended as fabricated new conversation events. The usual transcript character/turn budgets and memory modes still apply. When inherited context is nonempty, the original initial topic is not injected again; with empty context, the source initial-topic setting is retained. This setting is visible in configuration differences.

Task rounds and environmental feedback schedules restart in the child. Source feedback/reward events and incomplete task rounds are not replayed as child consequences. Model-authored memories about them remain in copied state, and public remarks remain in inherited conversation. Each branch's own task outcomes, feedback and interventions are logged independently. Use matched controls when studying carryover or restarting effects.

Source snapshots must be attributable to a run with a recorded Phase III protocol; raw template starting snapshots without an attributable run/context are not sufficient. Old historical snapshots can reconstruct context from their source's immutable turn prefix. New snapshots store the context and its hash directly. Each context item preserves run ID, original source turn, event ID, speaker, exact response and optional social decision. Capturing a snapshot of an evolved branch includes its inherited prefix **once**, followed by its own committed prefix.

The branch configuration freezes the state-snapshot ID/hash, inherited-context snapshot ID/hash, participant order, memory conditions/budgets, prompts, social/task/feedback settings, model/version/sampling and turn limit. Model differences appear in the manifest and analysis. Changed model IDs or endpoints require an explicit version field, avoiding accidental inheritance of an unrelated weight label. `unverified` is an explicit unknown-provenance declaration, not verification. Branch creation checks `/v1/models`; it does not load, download or switch server weights.

## Intervention operations

All operations apply to cloned data before the immutable creation commit. An invalid operation rejects the whole branch without altering source or existing branch artifacts. Up to 20 operations are allowed. Selections contain 1–100 distinct active entry IDs. Order matters; operation indices start at zero. Every audit stores the exact operation and affected agents' before/after states; history changes also store before/after context. Selected donor entries, mappings, generated IDs and original provenance remain inspectable.

### Withhold and restore

```json
{"kind":"withhold","agentId":"bob","entryIds":["memory-a"]}
```

Withholding removes the selected active entries from this branch's starting state, including retrieval/digest eligibility. It does not retire/delete source records or rewrite entry text. The full removed entries remain in the branch audit.

```json
{"kind":"restore","agentId":"bob","fromBranchId":"withheld-branch","operationIndex":0,"entryIds":["memory-a"]}
```

Restore references a withholding operation for the same agent and copies selected backed-up entries verbatim, including IDs, confidence, dates and source references. It refuses to overwrite an existing ID. Entries are restored to their original relative order; unrelated newer entries remain. For an exact inverse of an entire operation, use `reverse`.

### Transplant and swap

```json
{"kind":"transplant","agentId":"sara","donorSnapshotId":"donor-point","donorAgentId":"bob","entryIds":["memory-a"]}
```

Transplant copies selected active donor entries into the target while retaining the donor. Copied entries get branch/operation/target-scoped IDs to avoid collisions and append `interventionProvenance` recording donor snapshot/agent/entry and the operation. Original wording, source references and other metadata remain unchanged. Imported content/confidence must satisfy the run's entry limits, and active entry counts cannot grow beyond the configured cap (or a pre-existing larger baseline count).

```json
{"kind":"swap","agentId":"bob","otherAgentId":"sara","entryIds":["bob-memory"],"otherEntryIds":["sara-memory"]}
```

Swap removes each selected set from its owner and imports it into the other participant in the same atomic branch operation. Selection sizes can differ. Both before/after states and donor evidence are retained.

Imported relationships must point to another selected participant. If the old subject becomes the new owner or is absent, provide an explicit mapping, for example `"relationshipMap":{"sara":"bob"}`. For swap, `relationshipMap` applies into `agentId` and `otherRelationshipMap` into `otherAgentId`. Subject IDs change only under these explicit mappings; entry wording is never rewritten, so analysts must account for any mismatch between wording and the mapped subject.

### Numeric attributes and conversational history

```json
{"kind":"attributes","agentId":"bob","values":{"curiosity":8}}
```

Only existing stat keys and finite values 0–10 are allowed. The **current** value changes; its immutable initial value, memories and history remain intact. This operation requires structured-memory mode and numeric/arbitrary attribute presentation, where current values are actually shown. It is rejected in no-memory/history-only or role-only conditions rather than silently introducing a different attribute presentation policy. No personality interpretation or behavioral instruction is added.

```json
{"kind":"history","mode":"clear"}
{"kind":"history","mode":"replace","donorSnapshotId":"alternate-history"}
```

These change only the inherited shared conversation. Replacement requires the same participant IDs and verified donor context. States, including memories that mention the old history, are preserved; this can intentionally produce contradictory evidence. `reverse` restores a prior history operation in a new branch. An agent's private episodic memories and the shared conversation are distinct experimental variables.

### Exact reversal

```json
{"kind":"reverse","fromBranchId":"changed-branch","operationIndex":0}
```

Reverse restores an operation's affected states and/or history from its recorded before-image. Current state/context must exactly match that operation's recorded after-image; divergence causes a specific rejection rather than overwriting later changes. For multiple overlapping operations, reverse them in reverse order. The reversal is itself audited and can be inspected/reversed in a further branch. Model/configuration overrides are separate creation settings and are not silently undone by a state reversal.

## Paired behavioral probes

Pairs use the existing read-only structured agent-turn probe pipeline. Both phases are stored in the **child branch**; neither source run logs nor working state is changed. All requests, exact model responses, state hashes, model configurations and phase/comparison IDs are recorded. Proposed memory operations are not applied. Failures retain diagnostics and unrun item counts, and incomplete comparisons remain null.

Model policies:

- `same_branch`: run both pre/post states on the saved branch model/settings. This holds model configuration fixed while testing state intervention/evolution.
- `source_vs_branch`: pre uses the recorded source model/settings; post uses the branch model/settings. Model differences are explicit confounds, not automatically interpreted as memory effects. The source endpoint must still serve the requested model, or the failure is logged.

Context policies:

- `isolated` (API/UI default): standardized probe conversations exclude main conversation history in both phases, retaining Phase IV probe semantics.
- `phase_history`: each phase receives its own bounded historical conversation—original source context before, modified inherited context plus selected child prefix after. This permits direct tests of history interventions. Each probe record saves a context hash and rendered prompt; memory mode/budgets may still suppress this context.

Each phase starts an independent conversation with the same fixed probe definition; multi-turn follow-up replies stay within that phase. The entire pair holds the shared inference/write lease, so Resume/Start waits and no inference requests overlap. A pair manifest, including the exact probe definition, is saved before inference, preserving the planned comparison if execution is interrupted. There is no silent retry, output-mode fallback or invented dialogue.

## Analysis and exports (`continuity-v1`)

Full exports add `branch`, `branchComparisons` and `branchComparisonOutcomes`, alongside exact probe/turn records. The canonical branch manifest embeds source configuration, source state/context, post-intervention snapshot, ordered audit, configuration differences and hashes. The parent snapshot hash, original run/turn and parent branch ID provide lineage even when analyzing exported data offline. Export integrity hashes cover the additive fields; pre-existing run files are not rewritten.

The existing analyzer adds a `continuity` section:

- Source snapshot/configuration/model differences and branch lineage.
- Per-agent source-to-latest branch state hashes and exact active self-description evidence.
- **Self-description similarity:** token Jaccard of active self-description text at source versus selected/latest child state; both empty means unavailable. It measures lexical overlap, not semantic or subjective sameness.
- **Paired response similarity:** token Jaccard of exact successful pre/post probe replies at the same probe turn. Failed/missing phases give null. Entirely unrun later items remain visible when the definition is available.
- Explicit phase status, source record IDs, model/context policies and incomplete outcomes. Pre/post phases and actual model configurations remain separate Phase IV probe strata.

Generic Phase IV/V condition grouping includes inherited-context hashes (or conservative snapshot references for older data) as well as initial state/model/prompt controls. It does not silently pool different histories or models. The continuity panel makes before/after differences visible without asserting causality. Existing blinded datasets can include these probe responses; exact wording can still reveal identity or condition.

Identical source state does not guarantee identical responses. Sampling/server nondeterminism, different histories, model weights, role/numeric presentation, retrieval replacement after withholding, trial restart, task resets and intervention selection remain alternative explanations. Use control clones, repeated runs, fixed probe protocols and independent ratings. A coherent self-description is generated evidence, not proof of an enduring subjective self.

## Persistence, recovery and API

`branches/:branchId.json` is an exclusive-create immutable creation commit with a manifest hash. Artifact publication writes a complete temporary document and atomically links it into place without replacing an existing ID. Preparing/starting idempotently materializes its snapshot, immutable run configuration, independent working state, initial memory baseline and one branch-creation audit entry. Partial materialization can be retried using the same saved branch ID. Existing snapshots/configurations/baselines must match their hashes; mismatches are rejected. Missing working files are reconstructed from the latest committed agent state, not reset to the starting snapshot. Normal turn-journal recovery handles partial inference/state projection without replaying committed turns.

`branch-comparisons/:comparisonId.json` stores immutable probe-pair plans. Pair outcomes append to the child run's `branch-comparisons.jsonl`, and phase responses append to its `probes.jsonl`. All stateful work uses the existing controller queue and writer lease. Researcher actions require a paused/stopped/completed active run. Read-only manifest/catalog inspection is available through the API during execution.

Endpoints under `/api/branches`:

- `GET /catalog`: branch and comparison IDs.
- `POST /`: `{branchId,sourceSnapshotId | sourceBranchId,operations:[],actor,reason,maxTurns?,llmConfig?}`. Exactly one source is required; unsupported fields are rejected.
- `GET /:branchId`: verified immutable manifest.
- `POST /:branchId/prepare`: materialize without running inference.
- `POST /:branchId/start`: prepare and start the exact saved configuration.
- `POST /:branchId/probe-pairs`: `{agentId,probeId,postTurnIndex,modelPolicy,contextPolicy?,actor,reason}`.

A branch's `maxTurns` is 1–100,000 new turns. New branch IDs cannot adopt existing runs/logs. Duplicate creation IDs return 409; missing artifacts 404; invalid selections/preconditions/configurations 400. Hashes detect inconsistent data; they are not signatures or access controls. The existing local researcher trust model is unchanged, and exports/manifests contain private memories.

## Validation

Automated backend tests cover full-state/lineage cloning, inherited context, independent evolution/logs, untouched source exports, withholding/restoration/order, transplantation and relationship remapping, swap/reversal and divergence checks, immutable initial stats, independent history changes, explicit model versions, paired-probe phases/context/failures, shared inference serialization, partial materialization, missing-state repair, restart and tamper rejection, plus HTTP workflows. Browser tests cover operation construction, model overrides, baseline lineage, pair policies, immutable-ID errors and active/pending controls. Existing Phase I–V checks remain enabled. Controlled inference fixtures validate the software; local-model continuity studies and scientific conclusions remain researcher-run validation.
