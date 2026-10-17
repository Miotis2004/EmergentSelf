# Emergent Self: Development Roadmap

This roadmap describes an incremental, research-first implementation of **Emergent Self**. Each phase produces a usable artifact and avoids introducing additional complexity until it enables a specific research question.

## Guiding decisions

- **Stack:** Angular, Node.js/TypeScript, local llama.cpp-compatible model, JSON and JSONL files.
- **Compute:** One model endpoint shared by agents; inference is sequential, never parallel by default.
- **Agent state:** Independent and persisted across turns and restarts.
- **Research data:** Append-only evidence is separate from editable working memories.
- **Scientific scope:** Measure observable behavior and functional self-modeling without equating either with consciousness.
- **Phase gates:** Do not advance merely because an interesting conversation occurred. Each phase has specific acceptance criteria.

## Phase I: Two-agent conversational prototype

**Goal:** Build two initially configurable agents that converse using one local model, retain separate editable memories, and display their dialogue in Angular.

### Features

1. **Project skeleton:** Angular frontend; Node.js/TypeScript backend; shared types or documented API schemas.
2. **Local model adapter:** Configurable endpoint (default `http://127.0.0.1:8080`), health/model check, request timeouts, friendly failure reporting, and configurable inference settings.
3. **Agent creator:** Create two agents with unique IDs, names, and numeric attributes such as `curiosity`, `confidence`, and `sociability` (0–10); store both initial and current values.
4. **Neutral initialization:** Send stats as data, without instructions interpreting their values or specifying a personality.
5. **Turn scheduler:** Alternate agents sequentially; build each prompt from its own state and a bounded shared transcript; ensure agents are clearly identified.
6. **Conversation UI:** Live transcript with agent names, sequence numbers, timestamps, and visible run status.
7. **Working memory:** Each agent has editable JSON memory. Model responses can propose bounded, structured memory operations (add/update/retire); validate and apply them on the server.
8. **Storage:** Save identities and current memory as JSON; append conversation and memory-change events as JSONL. Use atomic replacement for mutable JSON state.
9. **Lifecycle controls:** Start, pause after the active turn, resume, stop, and maximum-turn limit. Preserve the run across restarts without repeating committed turns.
10. **Researcher visibility:** Inspect current agent state and export transcript, configuration, and audit history.

### Phase I exclusions

No database, online model retraining, reward/punishment, external web access for agents, tools beyond conversation/memory updates, autonomous background scheduling, or formal claims of emergent selfhood.

### Phase I deliverables

- Working Angular + Node application.
- Two agents able to alternate on a shared local LLM.
- Separate persisted stats and editable memories.
- Immutable, attributable conversation and state-change logs.
- README setup instructions, sample agent fixtures, and basic automated tests.

### Acceptance criteria

- [ ] Both agents can be created and survive a server restart with their own states intact.
- [ ] The system successfully connects to a local model and displays meaningful connection errors.
- [ ] Agents complete at least **100 total turns** with no cross-agent memory leakage or concurrent inference requests.
- [ ] Each turn is attributed to exactly one agent, recorded once, and associated with its model/configuration metadata.
- [ ] Agent-proposed memory revisions persist and produce inspectable before/after audit events.
- [ ] Pause stops *before the next turn* while allowing the active turn to finish; resume does not replay a committed turn.
- [ ] An exported run contains enough information to reconstruct what agents were shown and how their state changed.

## Phase II: Memory and self-model evolution

**Goal:** Study how working memory, beliefs, and self-description develop independently for each agent.

### Features

- Separate episodic observations, beliefs/opinions, self-description, and relationships with other agents.
- Add confidence, source turn, creation/update time, and optional importance to memory entries.
- Allow revisions, contradiction handling, consolidation, and retirement without deleting audit history.
- Add bounded retrieval and summarization so long runs fit within the model's context window.
- Display memory timelines and differences between historical snapshots.
- Add a deliberate *no memory* condition for later comparison.

### Acceptance criteria

- [x] Agents can revise earlier beliefs with identifiable source events.
- [x] The application can reconstruct each agent's working state at a selected turn.
- [x] Summarization does not erase original events from the audit record.
- [x] Memory limits and retrieval rules are configurable and logged.

**Implementation evidence:** Phase II acceptance behavior is covered by automated memory-evolution, history/API, recovery, and Angular explorer tests. Inference fixtures validate the application workflow; actual local-model research runs remain a separate validation step. See [INSTALLATION.md](INSTALLATION.md#phase-ii-memory-and-self-model-evolution) for schemas, memory conditions, limits, and reconstruction semantics.

## Phase III: Experimental controls and reproducibility

**Goal:** Make results suitable for controlled comparison rather than anecdotal interpretation.

### Features

- Experiment templates with fixed prompts, model/version, sampling settings, seeds when supported, and maximum turns.
- Named trial conditions: no memory, conversation history only, and structured editable memory.
- Repeated runs, randomization, snapshots, cloning, and run/agent IDs.
- Attribute conditions: explicit role description, named numeric attributes, and semantically arbitrary labels.
- Standardized probe conversations administered outside the agents' main interaction.
- Export structured trial data for analysis; track researcher interventions separately.

### Acceptance criteria

- [x] Two runs can be compared with their configuration differences visible.
- [x] All prompts, responses, memory changes, and interventions can be traced to a run and turn.
- [x] Researchers can reproduce the same *configuration* even when sampling makes output nondeterministic.
- [x] Experimental conditions do not silently differ in context budget, model, or prompting.

**Implementation evidence:** Immutable templates and seeded batch manifests, isolated trial state, explicit attribute/memory conditions, source-linked read-only probes and interventions, configuration comparison, and checksummed JSON export are covered by automated backend/HTTP and Angular tests. Local-model behavior and scientific reproducibility still require researcher-run validation. See [INSTALLATION.md](INSTALLATION.md#phase-iii-controlled-trials-and-reproducibility).

## Phase IV: Behavioral measures and longitudinal analysis

**Goal:** Determine whether agents exhibit measurable, durable behavioral differentiation.

### Measures

- Question-asking and topic introduction (potential operational measures of curiosity).
- Uncertainty language, assertion strength, and calibration (possible confidence measures).
- Response to contradiction and willingness to revise beliefs.
- Choice to address, challenge, cooperate with, or disengage from another agent.
- Stability of reported preferences and self-descriptions across time.
- Dependence of behavior on specific memories through withheld/restored-memory tests.

### Implementation

- Build repeatable benchmark/probe sets and metrics dashboards.
- Support blinded human evaluation and document scoring rubrics.
- Compare change **within an agent over time** and **between experimental conditions**, not just raw trait scores.
- Record failures and null results; avoid interpreting eloquent self-reports as evidence of consciousness.

### Acceptance criteria

- [ ] Each reported metric has an operational definition and reproducible computation.
- [ ] Analysts can generate condition-level summaries from exported run data.
- [ ] Probe responses are distinguishable from agent-to-agent training/conversation turns.

## Phase V: Social interaction and environmental feedback

**Goal:** Examine the effects of consequences and other-agent responses on persistent behavior.

### Features

- Expand from two to three or more agents without requiring multiple loaded LLMs.
- Allow agents to address specific others, decline to speak, and retain private relationship beliefs.
- Add optional researcher-controlled positive/negative feedback and documented scoring rules.
- Introduce constrained cooperative or competitive tasks with observable outcomes.
- Test immediate versus delayed feedback, and private versus public feedback.
- Log all rewards, penalties, task outcomes, and their links to decisions.

### Acceptance criteria

- [ ] Feedback can be disabled for a clean baseline condition.
- [ ] A researcher can explain precisely how each reward or penalty was calculated.
- [ ] The system can compare changes under feedback versus no-feedback conditions.
- [ ] Task optimization and moral understanding are not treated as equivalent.

## Phase VI: Identity continuity, branching, and intervention

**Goal:** Test the roles of remembered history and configuration in preserving or changing observable identity.

### Features

- Clone an agent's full state into an independently evolving branch.
- Withhold, restore, transplant, or swap selected memories under controlled conditions.
- Alter numeric attributes while preserving history, and vice versa.
- Compare pre- and post-intervention behavioral probes and self-descriptions.
- Allow branching experiments using the same or different local model versions, with model differences made explicit.

### Acceptance criteria

- [ ] A cloned branch has an auditable provenance linking it to the source snapshot.
- [ ] Branches have isolated state and logs after cloning.
- [ ] Memory interventions are reversible in a separate trial branch and fully logged.
- [ ] Conclusions are limited to measurable identity continuity and behavior, not subjective awareness.

## Phase VII: Research synthesis and publication readiness

**Goal:** Consolidate the system and results into a replicable research artifact.

### Features

- Formal hypotheses and preregistered procedures where feasible.
- Trial metadata manifest, dataset dictionary, and analysis scripts.
- Statistical comparisons with uncertainty estimates and sensitivity analyses.
- Written threats-to-validity analysis, including prompt contamination, model dependence, seed limitations, and evaluator bias.
- Reproducible anonymized example data and documented experiment protocols.

### Acceptance criteria

- [ ] Another researcher can run the documented protocol with a compatible local model.
- [ ] Each major result traces back to raw event data and analysis code.
- [ ] Alternative explanations and limitations are stated explicitly.

## Cross-cutting engineering requirements

**Data integrity:** Use schema validation, stable IDs, versioned schemas, atomic JSON writes, and append-only JSONL logs. For a lightweight single-process design, serialize writes and prevent two workers from mutating the same run simultaneously.

**Turn integrity:** Commit each turn and its proposed memory operations transactionally at the application level where practical, or use a journal/recovery strategy to avoid replaying partially committed work after a crash.

**Boundaries:** Prevent agents from accessing one another's private working-memory files, executing arbitrary code, browsing the internet, or writing outside the experiment data directory unless a later experiment explicitly grants scoped capabilities.

**Observability:** Preserve the rendered prompt, model reply, parsed memory operations, validation results, timing, and errors. Make automatic summarization visible rather than silently rewriting state.

**Resource control:** Set model timeouts, context size, per-run token/turn limits, and explicit user-triggered start/stop controls.

**Scientific interpretation:** Remember that shared pretrained knowledge can create apparently similar or sophisticated behaviors even when agents have different memories. A compelling conversation is not, by itself, a controlled experiment.

## Suggested order of work for Phase I

1. Verify the local LLM endpoint and implement the backend adapter.
2. Define agent identity, stats, working memory, and event-log schemas.
3. Implement JSON persistence and append-only JSONL logging.
4. Build the one-at-a-time scheduler and response/memory-operation validation.
5. Create the Angular agent editor and live conversation screen.
6. Add lifecycle controls, exports, restart recovery, and tests.
7. Run a documented 100-turn smoke test; inspect memory evolution and data integrity.

**Definition of success for Phase I:** a robust, observable two-agent conversation engine whose independent evolving memories can be inspected and reconstructed. No claim of personality emergence is required to pass Phase I.
