# Emergent Self

**A local, multi-agent experimental platform for studying artificial identity, memory, and behavioral development.**

## Overview

Emergent Self is a research-oriented application in which two or more artificial agents converse using a **single shared local language model**. Each agent has its own persistent state, including numeric attributes, memories, beliefs, and a self-description. The application invokes the model **sequentially**, loading the appropriate agent's context for each turn so that a single local inference server can support multiple independent agent identities.

The motivating question is whether agents using identical model weights can develop **stable, distinguishable patterns of behavior** through different histories of interaction, without being assigned detailed personalities in advance.

The project investigates **functional identity and behavioral adaptation**. It does **not** assume that the agents are conscious, and observed self-descriptions are not evidence of subjective experience.

## Research questions

1. Can agents with identical underlying models develop distinguishable behavioral characteristics through conversation and persistent memory?
2. How do numeric, minimally explained initial attributes influence behavior relative to subsequent experience?
3. Do editable memories and beliefs support durable changes in behavior and self-description?
4. How do agents represent their relationships with one another, and how do these representations evolve?
5. What changes when memory is withheld, restored, copied, or experimentally modified?
6. How does explicit feedback or reinforcement affect learned behavior in later phases?

## Core design principles

- **Shared model, separate state.** Agents use one local LLM but never share private memory files implicitly.
- **Sequential inference.** Only one agent is sent to the model at a time.
- **Minimal personality priming.** Avoid instructions such as "you are a curious investigator." Initial traits are numeric fields (for example, `"curiosity": 2`) without application-enforced effects.
- **Agent-editable working memory.** Agents may propose additions, revisions, consolidations, or retirement of memories and beliefs.
- **Immutable research history.** Conversation turns, state changes, researcher interventions, and model settings are recorded in append-only logs. An agent can revise its working state, not erase what happened.
- **Researcher control.** Runs must support pause, resume, stop, export, and reproducible configuration.
- **Interpretation with restraint.** Behavior can establish adaptation or functional self-modeling; it cannot alone establish subjective consciousness.

> Attribute labels are not semantically neutral to a pretrained LLM. The word `curiosity` and the number `2` already carry learned associations. Later studies should compare named attributes with arbitrary labels and explicit personality descriptions.

## Technology stack

| Layer | Initial choice |
|---|---|
| Interface | Angular |
| Backend and orchestration | Node.js + TypeScript |
| Local model | llama.cpp-compatible OpenAI-style API, default `http://127.0.0.1:8080` |
| Persistence | JSON state files and append-only JSONL logs |
| Live updates | Server-Sent Events (SSE), with WebSockets optional later |
| Later analysis | Python with exported JSONL/CSV |

No external database, cloud inference, or multi-agent framework is required for Phase I.

## Conceptual architecture

```text
                  Angular research dashboard
                             |
                       Node.js API
                             |
                  Experiment controller
                             |
           +-----------------+-----------------+
           |                 |                 |
      Turn scheduler     Memory manager    JSON/JSONL store
           |
       LLM adapter
           |
    Shared local model (127.0.0.1:8080)
           |
   One inference per scheduled agent turn
```

For each turn, the controller loads one agent's independent state and relevant conversation context, generates a reply using the local model, validates proposed memory changes, saves state, appends audit events, and advances to the next agent.

## Proposed repository structure

```text
emergent-self/
├── client/                       # Angular dashboard
├── server/
│   └── src/
│       ├── api/                  # REST and live event endpoints
│       ├── agents/               # Agent runtime and scheduler
│       ├── llm/                  # Local model adapter
│       ├── storage/              # JSON persistence and audit logs
│       └── experiments/          # Runs, configuration, lifecycle
├── data/
│   ├── agents/<agent-id>/
│   │   ├── identity.json         # Identity and numeric attributes
│   │   ├── memory.json           # Editable working memory
│   │   └── beliefs.json          # Beliefs and self-description
│   └── experiments/<run-id>/
│       ├── config.json           # Fixed settings and model metadata
│       ├── conversation.jsonl    # Append-only turn records
│       └── events.jsonl          # Append-only state/intervention log
├── README.md
└── DEVELOPMENT.md
```

Runtime data should be excluded from Git by default, with anonymized sample fixtures optionally committed for tests.

## Agent state

An agent has a stable identifier, a display name, and numeric stats (initial and current values). Initial attributes are **data**, not hardcoded behavioral rules.

Example `identity.json`:

```json
{
  "id": "agent-a",
  "name": "A",
  "stats": {
    "curiosity": { "initial": 2, "current": 2 },
    "confidence": { "initial": 5, "current": 5 },
    "sociability": { "initial": 5, "current": 5 }
  }
}
```

Working memory may include noteworthy events, changing beliefs about other agents, and a self-description. Agent-proposed revisions are validated by the backend. Every accepted change is preserved in an audit record with the run, turn, agent, before/after values, and stated reason. This is separate from an agent's currently active memory.

## Phase I: minimum viable experiment

The first release supports:

- Creation and configuration of **two agents** using a shared local model.
- Numeric initialization stats with no application-defined behavioral effects.
- Automatic **turn-taking** and a live, readable conversation display.
- Separate persistent **editable JSON memories** for each agent.
- Agent-proposed, backend-validated memory updates with append-only audit logging.
- Start, pause, resume, and stop controls; a configurable maximum-turn limit.
- Persistence across server restarts and basic export of conversation and state.

Phase I deliberately excludes formal personality scoring, reward/punishment, simulation environments, databases, and claims about consciousness.

## Research cautions

- **Role prompts can contaminate results.** Keep instructions neutral and record the exact prompts sent to the model.
- **Sampling causes variation.** Record model identifiers, temperatures, seeds when supported, and other inference settings. A seed may not guarantee full determinism.
- **Memory proposals are model outputs.** Store raw responses and validation outcomes, not just the final accepted state.
- **A single run is exploratory.** Use controlled conditions, repeated runs and independent blinded evaluations before drawing conclusions.
- **Agents may say they feel or intend something.** Treat those statements as observations about generated language, not direct measurements of inner experience.

## Roadmap

See [DEVELOPMENT.md](DEVELOPMENT.md) for milestones and acceptance criteria, progressing from the two-agent prototype to controlled studies of memory, attributes, social interaction, reinforcement, and state branching.

## Project status

**Phase I application, Phase II memory evolution, Phase III experimental controls, Phase IV behavioral analysis, Phase V social interaction/feedback, Phase VI identity branching/intervention, and Phase VII research synthesis implemented.** The conceptual layout above is historical design context; the actual application lives in `backend/` and `frontend/`. See [INSTALLATION.md](INSTALLATION.md) for setup, participant/topic selection, memory conditions, historical state inspection, reproducible trial templates/batches, probes, analysis exports, and local-model validation. Automated regression checks use controlled inference responses; real-model stability and research conclusions require local experiments.

Phase IV adds versioned behavioral proxies, agent timelines, matched-design condition summaries, benchmark conversations, read-only withheld/restored-memory tests, and a separate blinded review page. See [PHASE_IV.md](PHASE_IV.md) for definitions, rubrics, offline analysis commands and limits on interpretation.

Phase V adds explicit addressing/abstention, cooperative and competitive tasks, private/public immediate/delayed feedback, matched feedback-off controls, and source-linked task comparisons. See [PHASE_V.md](PHASE_V.md) for scoring rules and experiment procedures.

Phase VI adds isolated full-state branches, inherited conversation context, reversible memory/attribute/history interventions, explicit model variants and paired pre/post probes. See [PHASE_VI.md](PHASE_VI.md) for lineage, recovery and continuity-analysis procedures.

Phase VII adds immutable study protocols, source-linked statistical contrasts and sensitivity, publication packages with archived analysis code, and anonymous synthetic reproduction data. See [PHASE_VII.md](PHASE_VII.md) for the local replication command, dictionary, validity limits and sharing profiles. Cite the exact commit and artifact hash; [CITATION.cff](CITATION.cff) provides software citation metadata.
