# Synthetic Phase VII reproduction fixture

These files contain wholly synthetic, anonymous teaching data. No local model or real conversation produced the text. They demonstrate traceability and computation, not behavioral findings.

- `study.json`: immutable retrospective protocol and four planned configurations.
- `synthetic-*.json`: two runs per memory condition, six committed turns each, including one explicit failed attempt before a successful retry.
- `expected-synthesis.json`: complete deterministic result, evidence references and sensitivity outputs.

The question-marker effect (enabled minus none) is 0.5. The illustrative independent-run bootstrap interval is [1/3, 2/3]. Other unavailable measures remain null.

From `backend/`, run `npm run example:publication -- --check`. See [PHASE_VII.md](../../PHASE_VII.md) for offline package generation, exact reproduction and a separate local-model research protocol.
