# Phase VII: research synthesis and publication readiness

Phase VII provides immutable study plans, explicit trial accounting, source-linked statistical summaries, sensitivity analyses and reproducible publication artifacts. It consolidates the Phase III–VI tools without changing agent personality instructions, rewriting generated conversations or making claims of consciousness.

## Local replication protocol

Requirements: a full repository checkout, Node.js matching `.nvmrc` (Node 22), locked backend/frontend dependencies, a running backend/dashboard and a local OpenAI-compatible llama.cpp endpoint with a loaded model. Follow [INSTALLATION.md](INSTALLATION.md) and record the server build, model weights/quantization, chat template, context window and compatible structured-output mode. A researcher-supplied version/hash is a declaration; the application does not independently verify weights.

The following command prepares neutral agents, a frozen template, balanced seeded trial order and a **prospective local registration** before any inference:

```sh
cd backend
npm run replicate -- --study-id local-replication-01 \
  --model-version YOUR_WEIGHT_HASH_OR_VERSION \
  --model YOUR_LOADED_MODEL_ID --llm-url http://127.0.0.1:8080/v1 \
  --repeats 3 --turns 100
```

The backend defaults to `http://localhost:3000`; override with `--api`. The loaded model can be inferred only when discovery returns one model. Use a fresh study ID up to 80 characters; existing agents/artifacts are not overwritten or adopted. The script defaults to **prepare/register only**. Start each saved trial from the dashboard, or add `--execute` to a new invocation with a **new study ID** to explicitly run its prepared trials sequentially. It stops on paused/failed runs and never silently resumes or changes settings. Use the dashboard to inspect errors and explicitly resume the failed turn; remaining trials can then be started manually. Do not invoke the preparer again with an existing ID to retry inference.

The reference protocol has two neutral agents (numeric curiosity/sociability=5, no role interpretation), empty initial memory, fixed prompts, no feedback/task treatment, and two conditions: `none` and `enabled`. It prepares 3 runs per condition by default and 100 total committed turns per run. Randomization seed 42 controls trial order, not sampling. Sampling temperature is 0.7; no unsupported completion seed is invented. The backend's chosen output mode/token limit is frozen. Each repeat uses the same initial snapshot and model configuration. Server nondeterminism and shared starts may violate independence; repeated outputs must not be treated as independent merely because their run IDs differ.

The example hypothesis concerns a punctuation proxy: structured memory produces a higher **question-marker fraction** than no memory, with minimum absolute effect 0.05. The primary estimator averages responses within agent, agents within run, then runs within condition. It compares right (`enabled`) minus left (`none`), with 500 bootstrap draws/seed 42 and window sizes 10/40 for sensitivity around the primary size 20. No exclusions or extensions are automatic. These defaults demonstrate the workflow; they are not a validated curiosity measure, a justified power calculation or a confirmatory research design. Define an appropriate hypothesis, sample size, independence/multiplicity strategy and stopping rule before conducting a substantive study.

The script limits repeats to 2–50 per condition and the whole reference study to 100,000 planned turns, matching the report limit. For other conditions, use the dashboard registration with existing Phase III batches or Phase VI branches. Neither registration nor synthesis starts inference.

## Study registration

Open **Research synthesis & publication readiness**. Prepare batches/branches first, select every planned run, enter study/question/researcher, and provide:

- Sampling plan and intended independent replications.
- Randomization/seed procedure.
- Blinding and evaluator procedure.
- Exclusion and missing-data rules.
- Stopping rule.
- Analysis, multiplicity and interpretation plan.

Specify 1–20 operational hypotheses. Each has a stable ID, prose question, registered metric, distinct conditions, prediction (`greater`, `less`, `different`) for **right minus left**, minimum absolute effect, and exact stream/stratum. Behavioral metrics use `none`, `history`, `enabled`; social metrics use `off` or the Phase V source/timing/delay/visibility label. Probe hypotheses require an exact Phase IV probe stratum key; first explore its schema with separate pilot data rather than inspect the planned outcomes and call that prospective. Hypotheses are study metadata and are never inserted into agent prompts.

Analysis fields freeze primary window size, 100–2,000 bootstrap draws, uint32 seed, 1–5 sensitivity window sizes, and any prespecified excluded run IDs/reasons. The engine implements the method below; free-text analysis plans do not select a different estimator. A plan requiring paired/clustered models or multiplicity-adjusted inference needs an explicitly registered external analysis in addition to these exploratory summaries.

A **prospective** registration checks that none of its planned runs has committed turns, probe records or experiment-error events. Existing data require an explicit **retrospective** registration. Plans can reference prepared, not-yet-started batches or branch baselines. Registrations freeze complete planned configurations and hashes, registration-time evidence, local timestamp, code revision/dirty status and code digest. The same study ID cannot be edited; deviations or amendments need a new versioned registration, with their timing explained.

This is a local preregistration aid, not an external registry, certified timestamp or proof that the researcher never saw related data. Inherited branch history is flagged, and a researcher may have observed ancestors, pilot runs or external results. Publish that provenance and describe amendments honestly.

## Synthesis and statistical interpretation (`synthesis-v1`)

Generate synthesis for a saved study after pausing/completing active execution. Every planned run remains in the trial ledger, including runs without an export, incomplete runs, failures and exclusions. Ledger fields include planned/actual configuration hashes, export hash, committed count/limit, error/probe-failure counts, exclusion rationale and configuration deviation. `observed` counts supplied exports (including a prepared zero-turn baseline), not independent successful observations; each contrast separately reports eligible run counts. Missing outcomes are never imputed as zero.

Behavioral contrasts use Phase IV metric definitions and the registered stream/exact probe key. Social contrasts use Phase V definitions, including task amounts/scores and within-agent change. Means are computed **response → agent → run** with equal weight at each stage. Conditions are compared only within a matching design fingerprint. Different models, prompts, starting states, context hashes, budgets and other controlled settings create separate results. An absent condition or entirely unavailable metric produces a null estimate. Changing a planned configuration is flagged, not silently accepted as an unchanged trial or automatically excluded.

The effect is right minus left. Percentile intervals independently bootstrap the two sets of **run means**, using the saved seed/draw count and deterministic 32-bit LCG. Each draw resamples with replacement within each arm, then subtracts means. Sorted endpoints use floor((draws−1)×.025/.975). Fewer than two eligible runs in either arm yields no interval. Runs, not turns or agents sharing a conversation, are the inferential resampling unit.

These are unadjusted exploratory 95% intervals. Shared snapshots, matched batches, repeated seeds, model/server state and other dependencies can violate the independent-run assumption. The implementation does not silently use paired resampling, mixed models, a significance test, p-values or multiple-comparison adjustment. Those require an appropriate prespecified external procedure. Low run counts and the finite bootstrap count further limit interval interpretation.

Descriptive labels distinguish `unavailable`, `observed_zero`, `direction_and_threshold_met` and `direction_or_threshold_not_met`. A direction/threshold label concerns the point estimate only; it does **not** mean a confirmed hypothesis or significant effect. `intervalIncludesZero` is reported separately. A zero or direction failure remains an explicit result rather than being rewritten as a narrative success.

The primary result is retained alongside every prespecified window analysis and an **all planned observed** analysis including excluded exports. Sensitivity results do not replace the primary estimate, and no preferred window is automatically chosen. Window sensitivity often leaves overall text-fraction estimates unchanged; it affects longitudinal measures/differences where windowing matters. Exclusion rules are researcher decisions: the engine does not infer eligibility from prose or drop a failed run merely because it failed.

Every behavioral result includes source run/agent/record/turn references and response hashes; social results link decision and task-outcome IDs. The private package includes the exact source exports and analysis report. Inspect evidence, missingness, exposure and design differences before making claims.

## Dataset dictionary and threats to validity

The versioned dictionary and structured threat register are returned by `GET /api/studies/defaults` and embedded in each package. The complete operational metric definitions, cue lists, rubric, analysis options and source hashes remain in the Phase IV–VI report. Important threats and reporting requirements:

| Threat | Report / mitigate |
| --- | --- |
| Prompt contamination | Preserve exact role/numeric/arbitrary initialization, probe wording, conversation context and context budgets; distinguish elicited responses from spontaneous dialogue. |
| Model dependence | Record model identifier, declared weight/version/quantization, llama.cpp build/chat template and sampling support; replicate across models without pooling changed designs. |
| Seed limits / dependence | Distinguish scheduling/randomization seeds from completion seeds; inspect identical runs; do not assume shared-model agents or repeated starts are independent. |
| Evaluator bias | Use the metadata-blinded review page, fixed rubric and independent raters; wording can reveal identity/condition; inspect disagreements and retain null judgments. |
| Construct validity | Punctuation/cue/Jaccard proxies and fluent self-report do not establish curiosity, confidence, semantic identity, moral understanding or consciousness. |
| Selection / missingness | Disclose every planned trial, incomplete/failing run, exclusion, stopping decision and amendment; publish null results and inclusion/window sensitivity. |
| Statistical inference | Explain independence, sampling/power and multiplicity; the built-in unadjusted run bootstrap does not resolve clustered or matched dependence. |
| Disclosure | Exact conversations, memories, prompts and free-text notes can identify people/conditions; hashes and aliases can be linked; review intended public artifacts. |

Task optimization, coherent self-description and conversational differentiation are observations about behavior under recorded conditions. Alternative explanations remain in the package rather than being replaced by claims of subjective awareness.

## Publication profiles

Create a new immutable publication ID for each snapshot of a study. Later data do not overwrite an older package. Creation writes only local research artifacts; it does not upload/publish to an external service.

**Private full reproduction** includes registration/plans, every supplied raw export (including exclusions), synthesis, the full analysis, dictionary/threat register, source/lockfile archive and provenance. Exact generated text and memory are preserved. The archive includes backend source, scripts, tests, TypeScript configuration, package/lockfile and anonymous synthetic fixtures. File digests use UTF-8 SHA-256; object digests use canonical sorted-key JSON SHA-256. The overall `bundleHash` covers all package fields except itself. Git revision and dirty status identify the checkout, while the archived file digest identifies exact contents; hashes are not signatures.

**Aggregate only** uses an explicit allowlist: numeric estimates/intervals/counts/statuses, controlled condition/metric labels, and opaque trial/hypothesis/design aliases. It omits raw dialogue, prompts, memory, model endpoints/identifiers, source IDs, study title/question, researcher prose and exclusion reasons. Code file hashes/runtime/revision remain for analysis provenance. It cannot reproduce raw-text calculations because the evidence is intentionally absent. It is a limited-disclosure aggregate view, **not a guarantee of anonymity**: rare patterns/counts and external knowledge can still link results. Downloading a public-facing artifact never rewrites or redacts original model speech.

Before sharing a package, inspect its profile and contents. The local application's existing researcher trust model is unchanged; the API is not an access-control boundary. Keep private packages in private research storage. The repository's teaching example is synthetic and contains no real conversations or personal memories.

## Offline generation, verification and reconstruction

Download the immutable study registration and full run exports through the API/dashboard. Generation requires no running backend or model:

```sh
cd backend
npm run synthesize -- --study /path/study.json --profile private \
  --output /path/new-private-package.json /path/run-a.json /path/run-b.json
npm run verify-publication -- /path/new-private-package.json --recompute
```

Use `--profile aggregate` for the limited-disclosure view. Output files are created exclusively; input data and existing outputs are never overwritten. Verification checks the package hash, code manifest and archived source contents. `--recompute` reruns synthesis and full analysis from the supplied immutable study/exports and requires an exact current code digest. It rejects aggregate-only recomputation and code mismatches rather than claiming reproduction with different code.

To reconstruct an archived analysis checkout without executing archived code automatically:

```sh
npm run verify-publication -- /path/private-package.json \
  --extract-code /path/NEW-analysis-checkout
cd /path/NEW-analysis-checkout/backend
npm ci
npm run verify-publication -- /path/private-package.json --recompute
```

The extractor validates relative paths, writes only into a newly created directory and refuses existing targets. Review archived code/dependencies before building it. Use the recorded Node version; no LLM is needed for reanalysis. The full backend source archive also contains regression tests and synthetic fixture inputs. A package generated from a dirty tree remains reproducible by its archived contents, but should not be described as matching a clean release commit.

## Reproducible anonymous teaching example

[examples/phase-vii](examples/phase-vii) contains four wholly synthetic runs, a retrospective study registration and expected synthesis. Participant names/IDs are generic, text is authored teaching data and the synthetic model identifier is explicitly not an inference result. There is a retained failure/retry and unavailable measures. The expected question-marker contrast is exactly 0.5, with the example independent-run interval [1/3, 2/3]. This verifies computation, not a scientific effect.

```sh
cd backend
npm run example:publication -- --check
npm run synthesize -- --study ../examples/phase-vii/study.json \
  --profile private --output /tmp/example-publication.json \
  ../examples/phase-vii/synthetic-none-1.json \
  ../examples/phase-vii/synthetic-none-2.json \
  ../examples/phase-vii/synthetic-enabled-1.json \
  ../examples/phase-vii/synthetic-enabled-2.json
npm run verify-publication -- /tmp/example-publication.json --recompute
```

Use a new output filename if it already exists. `example:publication` without `--check` only creates new fixture files; it refuses to overwrite existing examples. The generator and expected output are tracked for review.

## API, compatibility and validation

Endpoints under `/api/studies`:

- `GET /defaults`, `GET /catalog` (including prepared/unstarted run IDs).
- `POST /`: immutable registration protocol described above.
- `GET /:studyId`: verified registration with frozen trial plans.
- `POST /:studyId/report`: synthesis with full planned-trial ledger.
- `POST /:studyId/publications`: `{publicationId,profile:"private"|"aggregate"}`.
- `GET /publications/:publicationId`: integrity-verified local package.

Records are schema version 7; `synthesis-v1` and `publication-v1` version their computations/dictionary. New artifacts live in `studies/` and `publications/` under the research store. Existing configurations, append-only logs, branches and exports are not rewritten. Registration/report/package operations share the controller queue/write lease and require the active experiment paused/stopped/completed. They make no inference calls. Duplicate immutable IDs return 409; missing artifacts 404; invalid protocols or retrospective evidence conflicts 400.

Automated tests cover prospective timing, immutable plans, retrospective rejection, exact effects/intervals, missing/null/zero outcomes, exclusions and sensitivity, configuration deviations/design separation, raw evidence links, private reproduction, aggregate disclosure filtering, tamper detection, archive reconstruction, source/input preservation, HTTP workflows, and the documented replication script using controlled inference fixtures. Browser tests cover registration, planned selection, profile choices, missing/zero displays and active/pending controls. Earlier Phase I–VI checks remain enabled. Actual local-model replication and substantive research validity remain researcher validation, not claims established by these tests.
