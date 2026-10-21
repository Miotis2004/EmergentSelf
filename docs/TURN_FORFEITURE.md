# Automatic incomplete turns after corrective exhaustion

New runs can set `recoveryConfig.onCorrectiveExhaustion` to
`record_idle_incomplete_and_advance` in Error Recovery. The default is `suspend`,
including for saved configurations that omit the field. Saved run settings remain
immutable across pause, resume, export and restart; old files are not migrated.

Only exhausted invalid-action or schema-validation corrections qualify. All
configured corrective retries run first. At least one corrective retry must fail:
a zero retry budget suspends the first rejection even with the automatic policy.
Technical failures, timeouts, server outages, configuration errors and unsafe
storage never cause forfeiture. Existing technical retry behavior is unchanged.

## Meaning and evidence

A forfeiture consumes one scheduled slot and the ordinary `minutesPerTurn` clock
increment. The timeline labels it **IDLE / INCOMPLETE**, explicitly imposed by the
system. Its canonical record has `turnOutcome: incomplete`,
`completionSource: system_fallback`, `displayAction: IDLE`,
`displayStatus: INCOMPLETE`, and
`forfeitureReason: corrective_retries_exhausted`.

There is no invented agent decision, speech, memory operation or idle operation.
The fallback is excluded from conversational context, including compact inherited
branch context. Rejected proposals and their original inference evidence remain
in the recovery audit. The `turn_forfeited` event references attempts and failure
codes and records state hashes, world hashes and clock progression. Audit links
in the timeline lead to the individual attempt records.

The agent's stored state and prior activity remain unchanged. Normal world-clock
processing can complete existing transformations or scheduled effects. Those
actual environmental events retain normal provenance; they are not attributed to
a rejected proposal. A legacy social scoring round with an incomplete participant
slot is recorded as `task_round_incomplete`, without fabricated decisions,
rewards or feedback.

## Persistence and scheduling

The final rejection and pending-forfeiture cursor are saved together. The system
uses the existing single execution loop and writer lease, freezes the same
scheduler selection, and journals the complete candidate before its canonical
append. Projection repair reuses that candidate and never requests another model
response. A terminal `turn_forfeited` projection marker is checked for matching
content and replayed idempotently. Unverifiable storage suspends execution.

Round-robin, team round-robin, seeded-random and event-driven schedules retain
their normal next-participant order. A forfeiture at the final slot completes the
run without extra inference. No prompts, schemas, model settings, personality,
retrieval algorithms or task rules change.

## Analysis and verification

Recovery analysis distinguishes scheduled slots, successful agent turns, valid
first attempts, corrected turns, explicit autonomous idle and incomplete system
turns. It includes validation-code frequencies, per-agent forfeiture rates and
slot progression. Incomplete responses have unavailable behavioral measurements,
rather than scores for fabricated speech. Attempt references retain timing and
token diagnostics when supplied by inference.

Regression coverage includes default and zero-budget suspension, exhausted
corrections, technical failures, all four schedules, final-slot completion,
rejected-operation atomicity, ongoing transformations and waits, scheduled world
effects, storage failures, process crashes, replay, old configuration preservation,
analysis, social scoring and identical inference payloads under either policy.
Frontend tests cover labels, audit links, configuration defaults and locking.

Verified in this change: backend TypeScript build and **385 backend tests** pass
(including 31 new forfeiture tests); **98 Chromium frontend tests** pass (including
four new UI tests); Angular production build passes. Existing Angular template
and bundle/style budget warnings remain. Validation used deterministic mock
inference and real subprocess crash/restart tests; no live-model experiment was
run, and server-side cancellation remains dependent on the model server.
