# Stage 2 implementation and verification

The complete workflow, schema, operations, boundary semantics, monitoring, troubleshooting and full two-team example are in [User Guide chapter 18](USER_GUIDE.md#18-team-competitions-commitments-verified-victory-and-termination). The exact runnable configuration is [examples/competition-stage2.json](../examples/competition-stage2.json).

## Architecture

Competition is an optional `worldConfig.competition` extension. Team membership comes solely from immutable scheduling configuration. The authoritative world snapshot stores a derived membership snapshot, commitments, ownership references, evaluation cursor, event history and final result. Restore validates these against the saved source configuration. Existing worlds require no new fields or migration.

The existing candidate world transaction applies commitments, ownership and assembly changes. Failure rejects the entire candidate. Resource reservations remain in the transformation engine. Optional `transformations.workspaces[].capacity` counts running tasks and releases through terminal task status.

Clock advancement evaluates real completion events at ordered simulated boundaries and evaluates every eligible completion at the earliest minute before finalizing shared victory. Completion evidence captures the valid commitment at completion, including when a later operation explicitly replaces it within the same atomic candidate. The result is a frozen snapshot. Automatic termination is applied after canonical commit and projection, before selecting another inference. Restart repairs existing committed projections and recognizes terminal world state even if the process exited before writing a completed lifecycle checkpoint.

Agent context includes only own-team commitments, backend permissions and legitimately known eligible recipes. Researcher status and export retain full progress and evidence. Legacy requests without competition omit new commitment schema variants, preserving their existing transport contract and recorded input budgets. Pure competition schemas and a dependency-free shared world error class avoid cold-start import-order cycles.

## Added files

- `backend/src/competition/schema.ts`: version-1 competition and operation schemas.
- `backend/src/competition/competition.ts`: configuration/reference checks, commitments, ownership, eligibility, deterministic evaluation, progress and restore validation.
- `backend/src/competition/report.ts`: read-only authoritative export projection and failure/resource evidence.
- `backend/src/world/errors.ts`: shared WorldError identity without engine initialization dependencies.
- `backend/test/competition.test.cjs`: competition regression, integration, restart, branching and cold-start tests.
- `frontend/src/app/competition-controls.component.ts`: JSON configuration editor using backend schema/reference validation.
- `frontend/src/app/competition-status.component.ts`: privileged live/final status and supporting evidence.
- `frontend/src/app/competition-controls.component.spec.ts`: configuration and final-status tests.
- `examples/competition-stage2.json`: four agents, two teams, three rooms, two physical recipes, shared bench.
- `docs/COMPETITION_STAGE2.md`: this implementation report.

## Modified files

- `backend/src/api/experiment.ts`: read-only `POST /api/experiment/validate-competition`.
- `backend/src/experiments/ExperimentController.ts`: saved team validation, transaction permissions, initialization, exact-time terminal state, rejection evidence and manual/turn-limit outcomes.
- `backend/src/llm/agentTurnSchema.ts`: competition operation variants appear only in enabled request contracts; strict validation remains.
- `backend/src/world/simulation.ts`: optional configuration/state, contextual permissions, transactional commitment operations, boundary advancement and deterministic wake times.
- `backend/src/world/transformations.ts`: ownership references, participant checks, capacity and completion-time commitment evidence.
- `backend/src/world/exploration.ts`: imports the shared error class, preserving movement behavior.
- `backend/src/storage/JsonlStorage.ts`: derives competition membership from saved teams and validates restored state; forks scope new events to their own run.
- `backend/src/research/ResearchService.ts`: validates team references and adds optional competition report/state to existing exports.
- `frontend/src/app/app.component.ts`, `.html` and `.spec.ts`: setup validation guard, controls, monitoring and explicit world-dependency regression.
- `frontend/src/app/services/experiment.service.ts`: competition validation request.
- `README.md`, `docs/USER_GUIDE.md`, `docs/DISCOVERY_STAGE1.md`: current capabilities, complete competition chapter and updated stage cross-references.

## Verification coverage

Automated tests cover configuration/reference failures; absent/disabled compatibility; initial knowledge and discovery; duplicate/conflicting team commitments; explicit replacement/cancellation; persistent assembly locks; atomic rollback; ownership and workspace checks; mixed teams; contention and reservation conflicts; capacity release on failure/cancellation/completion; earliest and simultaneous completion; deadline equality; no-winner outcomes; event-driven wake/deadline handling; frozen results; researcher time advancement; no further inference after victory; Resume/restart; active snapshot branches; cold imports; hard process exit after winning canonical commit; raw rejection evidence; report derivation; editor validity, locks, stale requests and saved final status.

The end-to-end test uses four independently scheduled mock-model agents, two teams, three rooms and two discoverable recipes. They discover, commit, transport components, propose an owned task, contribute, join and start assembly. Victory commits at minute 652; the controller makes 11 inference requests and never starts a twelfth. Winning output remains present. The losing team's proposed task and contribution remain visible in final progress. Export and restart retain the same completion evidence exactly once.

## Limits and Stage 3 dependencies

Only the `first_verified_transformation` objective and `shared_victory` policy are implemented. Preparation commitments are allowed; competition proposals and assembly before start are prohibited. Eligible recipes use IDs rather than categories. Mixed-team collaboration, when explicitly enabled, retains creator-team ownership and reports actual participants. A per-commitment active-task limit prevents overlapping task bypasses, while the configured active-commitment limit can range from 1 to 10.

Workspace capacity is optional and does not impose a queue or choose strategies. The result uses an inclusive completion deadline. Technical failures pause through existing recovery rather than masquerading as terminal defeat or victory. `terminateOnFirstCompletion: false` closes winner attribution but allows the ordinary run and already-running physical tasks to continue; it does not reopen commitments.

The example's model identifier is a researcher-replaced placeholder. No live local-model competition was run. Tests use a mock OpenAI-compatible endpoint; they establish backend semantics, not autonomous strategy quality or llama.cpp grammar acceptance. Stage 3 must still design, generate and validate the large room/recipe/resource dataset, final team roster and actual local-model experiment. No such dataset, automatic strategy, winner narration or full Discovery Challenge run is included here.

## Executed verification

- Backend `npm test`: **527 passed**, zero failures, including **56 competition tests**. This command builds backend TypeScript before testing.
- Angular headless Chromium suite: **118 passed**, zero failures, including the competition editor/status and world-dependency regressions.
- Frontend production `npm run build`: passed. Angular reports optional-chain and existing configured bundle/style budget warnings; these do not fail the build.
- Eight User Guide JSON blocks validated, including four complete run configurations. The new full example matches the checked-in example file exactly and passes actual backend schema, membership and restore checks.
- Existing coffee example executed through four cycles, producing 16 servings while retaining reusable tools; its scheduled-gate example still completes correctly.
- Checked 78 local documentation links/anchors across README, User Guide and both stage guides; all resolve. The User Guide contains no em dashes.
- `git diff --check`: passed.

Frontend cloud verification used Chromium with the environment's headless no-sandbox Karma configuration. No dependency was added to the application's package manifests.
