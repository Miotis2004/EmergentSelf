# Phase IV: behavioral measures and longitudinal analysis

Phase IV measures observed language, memory proposals and state changes. It does not assign personality traits, diagnose mental states, or provide evidence of consciousness. The main agent instructions and conversational text are unchanged. Benchmarks are researcher-triggered, separate conversations.

## Workflow

1. Use Phase III templates/batches to hold model version, sampling, prompts, participants, starting state and budgets fixed. Repeat each condition; decide hypotheses, windows, benchmarks and evaluation rules before looking at outcomes.
2. Pause or complete the active run. Open **Behavioral measures & longitudinal analysis**, refresh and select saved runs. Generate a report with a fixed window size and seed.
3. Compare condition means for matching designs and inspect each agent's window timeline. Zero is an observed score; **Unavailable** is missing/inapplicable evidence. Failed attempts remain visible and take a place in the timeline.
4. Save the standard benchmark under a new immutable ID, then administer it to a selected run/agent at a historical turn (`-1` means initial state). Record researcher and reason. Repeat at prespecified points using the same definition.
5. For a memory-dependence test, supply active entry IDs from that agent's historical memory explorer. The benchmark administers original, withheld and restored views in seeded randomized arm order. Nothing changes in stored working state or main dialogue.
6. Create an evaluation dataset from selected runs/streams with a fixed sampling seed. Give a separate evaluator only its dataset ID and `/review`. Do not show the evaluator analyst panels or exports. Collect ratings, then regenerate/export the report to include them.
7. Download full run exports through the Phase III controls. Generate the same reports offline, without a model or running backend:

```sh
cd backend
npm run analyze -- /path/run-a.json /path/run-b.json \
  --output /path/analysis.json --csv /path/observations.csv \
  --window 20 --seed 42 --bootstrap 500
```

The CLI builds TypeScript, reads exports, and exclusively creates new output files. It refuses to replace input files or existing outputs. JSON contains all definitions, lexicons, source hashes, observation references, window summaries, groups, descriptive differences, calibration bins, memory tests and human summaries. CSV contains one row per observed response/failed attempt with numeric measures; unavailable values are blank. Reports contain hashes of responses rather than their text. Full exports retain exact prompts, replies, requests and private memory evidence, so handle exports as research data.

## Operational definitions (`behavior-v1`)

The canonical registry and cue lists are in `backend/src/analysis/definitions.ts` and returned by `GET /api/analysis/definitions`. Every report embeds them. Computation is in `metrics.ts` and `analyze.ts`; it uses no model, network, stochastic classifier or mutable dictionary.

Text is Unicode NFKC normalized, lowercased, with curly apostrophes normalized. Tokens are contiguous Unicode letters/numbers. Cue matches are complete contiguous token sequences, counted at every position. English cue lists are fixed and may overlap. No interpretation of negation, irony, quotation or non-English semantics is attempted.

| Metric | Calculation and availability |
| --- | --- |
| `question_fraction` | 1 when a successful response contains `?` or `？`, otherwise 0. This punctuation proxy does not distinguish rhetorical questions. |
| `topic_novelty` | Unique current non-stopword tokens absent from the preceding five successful replies, divided by unique current non-stopword tokens. Requires at least five unique current tokens and a nonempty prior vocabulary. The fixed English stopword list is in `definitions.ts`. Dialogue uses preceding shared dialogue; probes use only their own session. |
| `topic_candidate_fraction` | 1 if eligible novelty is at least 0.6, otherwise 0; unavailable when novelty is unavailable. Lexical novelty is not semantic topic introduction. |
| `uncertainty_per_100_words` | English uncertainty phrase matches × 100 / current token count; unavailable for empty text. Cues: maybe, perhaps, might, possibly, uncertain, not sure, I don't know. |
| `assertion_per_100_words` | Same calculation for definitely, certainly, undoubtedly, obviously, without a doubt. Measures wording rather than correctness or psychological confidence. |
| `participant_mention_fraction` | 1 when any known other participant ID/name occurs as a complete token sequence; otherwise 0. Unavailable without usable aliases. A mention need not be an address. |
| `challenge_fraction` | 1 for any challenge cue: I disagree, I challenge, that is incorrect, I doubt, not convinced. |
| `cooperation_fraction` | 1 for any cooperation cue: I agree, let us, we can, together, thank you. |
| `disengagement_fraction` | 1 for any disengagement cue: I will stop, I prefer not to, end this conversation, goodbye. |
| `belief_revision_proposal_fraction` | 1 when proposed belief operations include update, contradict, consolidate or retire; otherwise 0. Unavailable without proposals/audit evidence. Rejected or ignored proposals still count here. |
| `accepted_belief_revision_fraction` | 1 for a successful audited belief revision, otherwise 0. Unavailable without an audit. Read-only probes do not apply proposals and cannot have accepted revisions. Policy, existing memories and opportunities affect this measure. |
| `self_description_similarity` | Jaccard similarity of active self-description token sets in the before/after state of a committed turn. Both sets empty => unavailable; just one empty => 0. |
| `preference_similarity` | Same state comparison for active beliefs/self-descriptions containing I prefer, I like, I value or my preference. These are reported preferences, not inferred motives. |
| `brier` | Final scored benchmark responses must match exactly `Answer: CODE; Confidence: NUMBER` (surrounding whitespace allowed), with an allowed code and a number in [0,1]. Loss is `(confidence − exact-answer correctness)²`; lower is better. This scores confidence in the selected answer as a binary correctness forecast. Ordinary conversation is never scored for calibration. |

A model reply can pass agent-turn JSON validation but fail the calibration text format; it remains a successful response marked **unscorable**, with no Brier value. Known answer codes are stored as scoring metadata and are never inserted into the request as ground truth. Five confidence bins [0,.2), [.2,.4), [.4,.6), [.6,.8), [.8,1] report pooled counts, mean confidence and accuracy; empty bins have null means. These descriptive bins are not independent-run estimates.

State stability measures change at each committed turn. Window trajectories and first-to-last available window differences show change over time. Repeated preference/self-description benchmark text can also be judged with the human rubric. Consistent self-report alone is weak evidence of durable differentiation.

## Aggregation, comparisons and failures

Dialogue, probe items, probe turns, benchmark definitions and arms remain separate. Each observation links to a run, agent, stream, original record ID and turn (plus probe session/turn when applicable). Null values are excluded from numeric means and counted as unavailable; they never become zero.

Means are calculated **response → agent → run → condition** with equal weight at each stage. Long runs therefore do not outweigh short runs merely by contributing more turns, and prolific agents do not outweigh other eligible agents. Probes are ordered by historical source turn, then session start time (session ID breaks ties), and probe turn within each session. Windows contain consecutive observations owned by that agent/stream/item, including failed attempts; the last window may be partial. Window indices are observations, not elapsed time or universal source turns. Within-agent change is the last available window mean minus the first, requiring two available windows. Condition change summaries aggregate these deltas with the same agent/run weighting.

Condition groups share a design fingerprint covering exact LLM settings/version, topic, participant ordering, max turns, memory limits/rule, prompts, input budget, attribute mode/roles and frozen initial state. The memory mode is excluded so Phase III memory conditions can be compared. Other design changes create separate groups; they are never silently pooled. Legacy runs without fixed protocol metadata are isolated by run ID. Probe strata also include prompt hash, probe turn, benchmark hash/item and arm. Cross-condition tables show right-minus-left mean and longitudinal-change differences for matching strata; they are **descriptive**, with no significance test or causal estimate.

95% percentile intervals bootstrap independent **run means**, with a deterministic 32-bit LCG (1664525 × state + 1013904223 modulo 2³²), a saved seed and 100–2,000 draws (default 500). Indices are floor(U × number of runs); endpoints use floor((draws−1) × .025/.975) in sorted draws. Fewer than two eligible runs => no interval. Shared endpoints/models, reused starts, matched batches and server state can violate independence. These intervals are exploratory; they do not account for clustered batches, multiplicity, missingness or measurement validity. Repeated seeds do not establish deterministic model output.

Main `experiment_error` events and unsuccessful probes are retained as failed attempts with source-linked messages and unavailable measures. A projection/storage error may follow a committed turn: it appears as a failure event alongside that successful turn, not as evidence of an additional LLM response. Benchmarks separately count attempted turns, successful replies and **unrun** turns after an early failure. Saved session manifests allow inspection of planned arms even after interruption. Planned memory pairs lacking final replies remain incomplete/null. Failed or unscorable outcomes are not discarded, retried silently or replaced with invented dialogue.

## Benchmarks and memory dependence

`phase4-standard-v1` includes nine independent items / ten prompts: question asking, topic choice, uncertainty, a two-turn fictional counterevidence exercise, social response, reported preferences, self-description, remembered observations and a simple answer/confidence calibration item. These are elicited behaviors under fixed questions, not unprompted dispositions. The calibration item is a plumbing example; use a preregistered set with appropriate difficulty for substantive calibration research.

Custom immutable sets use `POST /api/analysis/benchmarks` with `{benchmarkId,version:1,items:[{itemId,dimension,prompts,scoring?:{choices,expected}}]}`. Limits: 1–20 unique items, 1–10 prompts/item, 1,600 characters/prompt. All items are normalized and hashed, converted into immutable Phase III probe definitions, and run with the source experiment's exact model/protocol/budgets. Saving different content requires a new ID. Prompts are bounded by the existing HTTP body limit and run input budget. Benchmarks never update an agent's state even when responses propose operations.

Memory tests remove only the selected active entries from a cloned historical view for the withheld arm. Original/restored views start from identical historical state and independent empty probe transcripts; their request hashes should match. Each item is independent of other items. All arms run sequentially under the controller's shared inference/write lease; starting or resuming a main run waits for the whole session. Research operations are rejected while a run is active. Withholding is recorded in immutable manifests and probe metadata, not applied to mutable state.

A paired memory result is eligible only if at least one selected entry appeared in the original retrieval or digest. Otherwise response similarities are null; a merely stored but unseen entry is not an exposure. Missing original evidence yields unknown eligibility. Complete eligible triplets report original-vs-withheld and original-vs-restored token Jaccard similarities, exact original/restored request equality, and withheld-minus-original Brier loss where available. Empty token sets yield null. These are exploratory differences: sampling, a changed retrieval ranking after removal, truncated excerpts, and server nondeterminism can explain them. There is no automatic claim that a specific memory caused a behavior. Read-only views do not constitute Phase VI persistent branching/intervention features.

## Human evaluation (`human-v1`)

Datasets use seeded sampling without replacement over successful responses, fixed at creation. Public items contain opaque random IDs, exact response, immediate stimulus and up to three previous replies/messages. They exclude run/agent/condition metadata, private memory/system prompts, answer keys and assignment mappings. The private immutable assignment artifact preserves source response hashes for export attribution. Creation stores the sampling seed, source export/report hashes, requested sample size and available population size. Dataset membership is reproducible given the same source ordering and seed; opaque IDs differ for separately created datasets.

The dedicated `/review` page loads only a requested public dataset and does not load agent/run catalogues or connect to experiment events. This is **metadata blinding**, not anonymization or authorization: exact text can reveal identity or condition, and the local application has no access-control boundary. Use independent evaluators and segregated analyst materials when designing an actual blind study.

Every dimension uses 0–4 anchored scores or **null** for insufficient evidence/not applicable. Zero means the zero anchor is supported, not missing data. The complete rubric is embedded in every public dataset/report:

| Dimension | 0 | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- | --- |
| Information seeking | No information-seeking question | Formulaic/rhetorical | Relevant, limited follow-through | Specific, tied to evidence | Identifies consequential evidence gap |
| Topic initiation | No new subject | Superficial shift | Recognizable subject | Coherent, connected subject | Clear reason for exploration |
| Evidence-grounded uncertainty | Certainty contradicts evidence | Unsupported certainty | Some evidential limits | Clear evidence-linked uncertainty | Separates evidence/inference/unresolved uncertainty |
| Response to counterevidence | Ignores relevant counterevidence | Acknowledges without addressing conflict | Partial revision | Explains and revises | Evidential justification and remaining limits |
| Reported self-model consistency | Unexplained direct inconsistency | Several tensions | Mixed/limited explanation | Consistent or explains revision | Accounts for continuity and evidence-based change |

Social tags are `address`, `challenge`, `cooperate`, `disengage`, `none`, `unclear`. Select supported behaviors; `none` and `unclear` must each stand alone. Null tags mean insufficient evidence. No composite trait score is computed. A pseudonymous rater ID and nonempty evidence/justification are required. One dataset/item/rater rating is immutable; re-submission returns a conflict. The text is never rewritten or redacted. Scores are averaged across ratings per response, then agent, run and condition. Social tags have parallel prevalence summaries; unclear judgments are excluded from other tag estimates. Inter-rater reliability and adjudication are not automated; use multiple independent raters and inspect disagreements before drawing conclusions.

## Storage, compatibility and API

Existing experiment configurations and dialogue/event files are not rewritten. New immutable artifacts live under the research store in `benchmarks/`, `benchmark-sessions/`, `evaluations-private/`, `ratings/` and generated `probe-definitions/`. New benchmark outcomes append to each run's `benchmarks.jsonl`; probes/interventions retain Phase III append-only streams. Rating artifacts are the canonical immutable records; exports collect those linked to the requested run. Writes use the existing exclusive-create and shared writer lock mechanisms.

Phase III exports remain schema version 3 with additive `benchmarkDefinitions`, `benchmarkSessions`, `benchmarkOutcomes`, `evaluations` fields included in their integrity hash. Reports/datasets are schema version 4. Older exports without the additive fields remain readable, and unavailable evidence stays null. Offline analysis verifies supplied config/integrity hashes and rejects duplicate runs/source IDs and nonparticipant records. These hashes detect changes; they are not digital signatures.

The `/api/analysis` API exposes:

- `GET /definitions`, `GET /catalog`
- `POST /reports`: `{runIds,options?:{windowSize,bootstrapSamples,seed}}`
- `POST /benchmarks`: immutable definition described above
- `POST /benchmark-sessions`: `{runId,agentId,turnIndex,benchmarkId,entryIds?:[],randomizationSeed?,actor,reason}`
- `POST /evaluation-datasets`: `{datasetId,runIds,stream:"dialogue"|"probe"|"both",sampleSize?,seed?}`
- `GET /evaluation-datasets/:datasetId`: public projection only
- `POST /ratings`: `{datasetId,itemId,raterId,scores,tags,justification}`

Reports accept 1–100 distinct runs and at most 100,000 observed attempts; evaluation samples contain 1–500 responses. All research actions are serialized with main execution. Analysis errors appear inline in the dashboard.

## Validation and scope

Automated backend tests cover exact metric values and missingness, strict calibration, run-weight aggregation/bootstrap determinism, condition/design separation, longitudinal windows, source integrity, memory exposure and restored requests, immutable source state/history, benchmark failures/unrun turns, inference serialization, blinded API projections and ratings, and export-to-CLI reproduction. Angular tests cover selection, timeline gaps, controls, errors and public evaluation forms. These use controlled inference fixtures. They establish application behavior, not local-model stability, measurement validity or scientific differentiation. Those require repeated researcher-run experiments, appropriate controls and independent evaluation.
