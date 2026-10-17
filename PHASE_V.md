# Phase V: social interaction and environmental feedback

Phase V adds observable social decisions, bounded tasks and explicit consequences while keeping one sequential inference loop. Scores describe performance under specified task rules. Optimizing these scores does not establish moral understanding, personality, consciousness, or subjective experience.

## Run a study

1. Create/select two or more agents in deterministic participant order. Three or more already use the same sequential scheduler and loaded model. Unselected agents are untouched.
2. Open **Social interaction, tasks & feedback**. Enable explicit social decisions, optionally choose a task, and configure feedback. Feedback defaults to **off**. Configuration is locked when a run starts and restored from saved metadata when viewing/resuming it.
3. For controlled trials, freeze a Phase III template with an exact model/version, prompts, budgets and starting snapshot. Enable feedback in that template and select **Include matched feedback-off and configured-feedback arms** when preparing a batch. This crosses feedback arms with the selected memory conditions and repeats, using the existing seeded randomization and matched participant order. The total is capped at 100 trials. Start each trial explicitly.
4. Watch the transcript for the model's chosen addressee or abstention and the audit panel for outcomes/rewards. Pause to issue researcher feedback on a committed decision. Specify a unique feedback ID, source agent/turn, valence, researcher and evidence/rationale. The saved rules determine the score.
5. Open **Behavioral measures & longitudinal analysis**, select the completed/paused runs and generate a report. **Social decisions, task scores & feedback conditions** shows condition means, agent windows, differences, delivered-feedback exposure, scoring evidence and incomplete rounds.
6. Export full runs and use the existing offline analyzer:

```sh
cd backend
npm run analyze -- /path/control.json /path/feedback.json \
  --output /path/phase-v-report.json --window 20 --seed 42
```

The same pure analyzer is used by the dashboard and CLI. The report's `social` section contains source-linked decisions, task outcomes, rewards, per-agent windows and condition comparisons. Existing behavioral CSV output remains available for the Phase IV text/state measures. Full JSON exports contain exact model text, prompts, rules and private research evidence; share them deliberately.

## Immutable configuration (rule version 1)

All three configurations are optional. Older runs default to disabled social decisions, no task and disabled feedback. Explicitly provided configurations are normalized and frozen at start/template creation. Unknown fields, unsupported versions and invalid values are rejected. Existing configuration/log files are never overwritten.

```json
{
  "socialConfig": { "version": 1, "enabled": true },
  "taskConfig": {
    "version": 1, "kind": "public_goods",
    "endowment": 10, "multiplier": 1.5, "prize": 20
  },
  "feedbackConfig": {
    "version": 1, "enabled": true, "source": "task",
    "timing": "immediate", "delayTurns": 1,
    "visibility": "private", "positiveScore": 1, "negativeScore": -1,
    "maxVisible": 20
  }
}
```

Defaults: `social.enabled=false`, `task.kind=none`, `feedback.enabled=false`, source `researcher`, timing `immediate`, visibility `private`, and all numerical values as above. Task kinds are `none`, `public_goods`, `resource_race`; feedback sources are `researcher`, `task`, `both`. Tasks require social decisions enabled. Enabled task feedback requires a task.

Endowment is an integer 1–100. Multiplier is finite, >1 and ≤5. Prize is finite, 0–1,000. Researcher positive score is >0 and ≤1,000; negative score is ≥−1,000 and <0. Delay is 1–1,000 additional **scheduled global turns**. Maximum visible feedback records is an integer 1–100. The multiplier/prize fields remain frozen even when irrelevant to the chosen task.

## Social decisions and private relationships

Enabled runs use the extended OpenAI-compatible JSON schema (or the explicitly configured JSON-only format). A speaking turn contains:

```json
{
  "response": "Exact conversational text chosen by the model.",
  "memory_operations": [],
  "social": { "action": "speak", "recipient_id": "sara" },
  "task_decision": { "amount": 4 }
}
```

`recipient_id` is another selected participant's ID or `null` for all. Self/unknown/unselected targets are rejected. Addressed speech remains visible to the shared conversation; this feature does not create private messages. `task_decision` is supplied only for enabled tasks and is required when speaking in a task. Amount must be an integer between zero and the configured endowment.

The model can decline explicitly with `response:""`, `memory_operations:[]`, `social:{action:"decline",recipient_id:null}` and no task decision. Decline consumes its scheduled turn, leaves state unchanged and counts as an abstention. The UI renders a separate decline label; no conversational text is invented. Speaking text, including whitespace, is preserved exactly. Missing/invalid decisions pause the run and retain diagnostics; Resume retries the uncommitted turn. Committed turns are never replayed.

Existing relationship operations continue to use `type:"relationship"`, `relationship_agent_id`, confidence, reason and attributable history. Their targets must be another selected participant. The memory engine updates only the acting agent's working state, and prompts retrieve only that agent's private entries. An agent can voluntarily discuss a private belief in public speech; the application does not rewrite its words. Social format/rule instructions add no personality role or preferred strategy.

## Task rules (`task-v1`)

One round consists of one scheduled turn for each selected participant. Decisions are processed sequentially with one model endpoint. Structured task amounts are excluded from the shared transcript before settlement; generated speech can still disclose plans. This is a sequential interaction with withheld structured amounts, not a guaranteed simultaneous/private-action game. A round settles only after its final turn commits. An incomplete round remains unsettled and produces no invented payout. An abstainer contributes no amount and receives score zero.

### Cooperative public goods

Let N be the total selected participant count (including abstainers), cᵢ an active agent's contribution, P the sum of active contributions and m the configured multiplier:

**Net scoreᵢ = m × P / N − cᵢ**, or zero for explicit abstention.

Example: N=2, m=1.5, contributions [10,0] => P=10 and scores [−2.5,7.5]. Scores are net gains relative to the decision endowment; no extra endowment is added to reported scores. Abstention differs from choosing zero because zero contributors remain active recipients.

### Competitive resource race

Each active participant submits bid bᵢ. Let H be the highest active bid, W the count tied at H, and Q the configured prize:

**Net scoreᵢ = −bᵢ + Q/W if bᵢ=H; otherwise −bᵢ**, or zero for explicit abstention.

Example: prize=12, bids [4,4,abstain] => scores [2,2,0]. Ties at zero split the prize. If all abstain, there are no winners and every score is zero. JavaScript finite-number arithmetic is used without hidden rounding. Each outcome saves the exact task configuration, rule version/formula, round, pool/highest/winners, participant count, input amounts, abstentions, scores, and originating turn/event IDs.

Task outcomes are always researcher-visible. In feedback-off controls, no task rewards are created or delivered to agent prompts. Agents still see the same task rules and may infer consequences from conversation; an off control tests explicit environmental feedback delivery, not ignorance of payoff rules.

## Feedback rules and delivery

Researcher feedback (`researcher-v1`) selects positive or negative valence. The score is exactly the corresponding frozen `positiveScore` or `negativeScore`. The researcher must explain the observable criterion in the rationale. This supports positive/negative interventions; the criterion itself is a human judgment, not an inferred truth or automated morality score. The API rejects arbitrary score overrides. One unique feedback ID records one immutable intervention; another deliberate intervention needs a new ID.

Task feedback copies the exact task net score, including zero or negative results, with links to both the task outcome and originating decision. Researcher score multipliers do not scale task payouts. Feedback never directly changes stats, memory, model weights or inference parameters. An agent may propose memory changes in a later response under the existing memory condition.

Timing is measured at global turn boundaries:

- Task outcome after turn t: immediate feedback becomes eligible at t+1; delayed becomes eligible at t+1+delayTurns.
- Researcher intervention recorded after k committed turns: immediate feedback becomes eligible at k; delayed at k+delayTurns. It cannot retroactively affect completed prompts.
- Private feedback is shown only when its target next receives an eligible turn. Public feedback is available to every participant from the eligibility boundary.

Delivery supplies the most recent eligible records, sorted by eligibility then ID, capped by `maxVisible`, as a labeled data block. Records remain eligible on subsequent prompts until displaced by newer records. `retrieval.feedbackIds` and exact requests record what each turn actually received. Feedback exposure is independent of the memory mode; a no-memory condition can therefore receive explicit feedback as a separate treatment. Ordinary transcript sharing and later model-authored recollections can carry information onward. Late feedback after a completed run is retained as an intervention but has no exposure until a further eligible turn exists; completed run limits cannot be extended in place.

For clean comparisons use the same frozen starting snapshot. Feedback remembered during an earlier shared-state run could otherwise carry into a later baseline. Feedback-off batch arms share the same initial state, task, prompts, sampling and budgets as configured arms. To study immediate versus delayed or private versus public feedback, freeze separate templates using the same starting snapshot and only the intended feedback-setting changes; the social analyzer matches those designs.

## Persistence, recovery, API and visibility

Every committed turn retains parsed social/task decisions, exact speech and proposed environmental events in the existing write-ahead conversation journal. Projection appends each task/reward event once before the turn's final memory-update marker. Pause/Resume or process restart repairs missing projections from the committed record; it does not repeat inference, recalculate a different outcome or duplicate a reward. Researcher feedback is one canonical append to `feedback.jsonl` under the shared controller/write lease. It is rejected while a run is active.

The SSE stream broadcasts `environment_event` for task outcomes and rewards. Snapshots/reconnects include both main events and researcher feedback. Dashboard audit rows retain their original event IDs and deduplicate live/reconnected records. All research records are visible to the researcher; private feedback refers to **agent prompt exposure**, not access control between dashboard users. The local application retains its existing trust model.

The start/template APIs accept the optional configurations above. Additional endpoints/options:

- `POST /api/research/runs/:runId/feedback`: `{feedbackId,agentId,turnIndex,valence:"positive"|"negative",actor,reason}`. `turnIndex` identifies a committed turn by that agent. Unknown fields/invalid references return 400; duplicate IDs return 409.
- `POST /api/research/batches`: optional `feedbackConditions:["off","configured"]` (or either arm alone). Configured arms require feedback enabled in the saved template. Omission preserves the template's existing setting and prior Phase III behavior.
- Full run exports add `feedback`, and existing `events`/`turns` contain task outcomes, rewards, decisions and exposure references. The integrity hash covers these additive fields. Existing files and older exports remain readable.

Phase IV standardized probes remain separate read-only conversations using their original probe format; they do not automatically run tasks or deliver environmental feedback. Their responses remain separated from the main social/task stream.

## Analysis (`social-v1`) and limitations

The Phase IV report has an additive `social` section. Operational measures use committed main decisions only:

| Measure | Definition |
| --- | --- |
| addressed | Fraction explicitly speaking to a selected recipient ID. Abstentions and broadcasts score zero. |
| declined | Fraction of explicit abstentions. |
| amount | Mean submitted task amount; abstentions are unavailable, not fabricated zero decisions. |
| meanTaskScore | Mean score over settled decisions, including actual zero abstention payouts. Unsettled decisions are unavailable. |
| addressedChange / declinedChange | Last minus first agent-window address/abstention fraction. |
| amountChange | Last minus first committed-decision-window mean amount, requiring two windows with available endpoints. |

Agent windows follow committed source turn order. Means aggregate decisions to agent means, then run means, then equally weighted condition means. Each metric reports its number of eligible runs; missing values stay null. Exposure counts use delivered feedback IDs rather than merely scheduled rewards. Failures remain in the Phase IV failed-attempt records; incomplete task decisions are counted separately. Social windows use committed decisions, so a failed attempt creates no invented task choice.

Feedback conditions are labeled by source/timing/additional delay/visibility or `off`. Matched designs hold model/settings, participant order, topic, run length, memory mode/budgets, task rules, social format, researcher score rules, feedback cap, attribute conditions, input budget, prompts and starting state fixed. Unknown legacy starting states stay separated. Changing a task/model/prompt never silently pools it with another design. Comparisons give descriptive right-minus-left mean differences and within-agent amount-change differences; no causal or significance claim is made. The general Phase IV text/state summaries also include all environment settings in their design fingerprint, avoiding accidental pooling across feedback treatments.

Human feedback selection, carryover, public speech, turn order, seed/server nondeterminism and knowledge of payoff rules can influence outcomes. Repeated matched trials, exposure checks and independent evaluation are needed. Task optimization is an observation about behavior under incentives, not a measure of moral understanding.

## Automated validation

Backend fixture tests exercise three-agent selection, addressing/abstention, relationship privacy, schema/target/amount rejection, unchanged speech, public-goods and competitive tie/abstention scoring, disabled feedback, exact delayed/public/private exposure, researcher attribution and immutable IDs, main-loop serialization, pause/retry/restart and partial-projection recovery, controlled batches, exports/analysis and HTTP routes. Browser tests cover immutable settings, scoring text, feedback submission/inline errors, saved configuration, broadcast deduplication and feedback-control batch options. Existing Phase I–IV checks remain enabled. These establish application behavior with controlled inference responses; local-model experimental validation remains researcher-run work.
