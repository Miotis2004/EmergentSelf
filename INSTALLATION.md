# Installation Guide: Emergent Self

This document outlines how to set up and run the Emergent Self Phase I application. The application consists of an Angular frontend and a Node.js/TypeScript backend.

## Prerequisites

- **Node.js**: The project requires an LTS version of Node.js.
  - Ensure you are using `v22.22.1` or later.
  - You can use [nvm](https://github.com/nvm-sh/nvm) (or [nvm-windows](https://github.com/coreybutler/nvm-windows)) to manage your Node versions. Run `nvm use` in the project root if you have `nvm` installed.
- **npm**: Comes bundled with Node.js.
- **Local LLM Server**: You need a running llama.cpp-compatible server that provides an OpenAI-compatible API.

## Application Structure

- `frontend/`: Angular dashboard application.
- `backend/`: Node.js + Express + TypeScript API and experiment controller.
- `model_memories/`: Storage directory for agent states (identities, memories).
- `researcher/`: Storage directory for experimental configurations and append-only logs.

## Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the backend development server:
   ```bash
   npm run dev
   ```
   The backend will typically start on `http://localhost:3000`.

## Frontend Setup

1. Open a new terminal and navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the Angular development server:
   ```bash
   npm start
   ```
   The frontend will be accessible at `http://localhost:4200`.

## Connecting to the Local LLM

The backend is configured to communicate with an OpenAI-compatible API, defaulting to `http://127.0.0.1:8080`.

1. Ensure your local LLM server (e.g., `llama.cpp`'s server) is running.
   - *Example `llama.cpp` command:*
     ```bash
     ./llama-server -m path/to/your/model.gguf --port 8080 --host 127.0.0.1 -c 4096
     ```
2. Verify the server is reachable:
   - You can test the health endpoint: `curl http://127.0.0.1:8080/health`
   - Or check available models: `curl http://127.0.0.1:8080/v1/models`

You can change the backend LLM configuration (URL, models) within the frontend dashboard once the application is running.

## Running an Experiment

1. Open the Angular dashboard at `http://localhost:4200`.
2. Use the **Agent Management** section to create at least two agents. Assign them numerical stats (e.g., curiosity: 5, sociability: 7).
3. Navigate to the **Experiment Controls**.
4. Set the maximum turns and click **Start**.
5. Observe the live conversation and inspect the active memory updates.
6. Check the `model_memories/` and `researcher/` directories in your project root to see the generated JSON files and JSONL logs.

## Troubleshooting

- **Connection refused (port 8080)**: Ensure your local model server is running and accessible on `127.0.0.1:8080`.
- **CORS errors**: The backend should handle CORS, but ensure your frontend is running on `http://localhost:4200` and the backend on the expected port (e.g., `3000`).
- **Memory not updating**: Check the backend console logs. Ensure the selected model supports structured output (JSON schema) and successfully returns the requested format.

## Structured output and Phase I diagnostics

The dashboard discovers loaded model IDs from the backend's `/api/llm/models`
endpoint (which queries the selected server's `/v1/models`). Select a model before
starting. The exact selected identifier, temperature, token budget and output mode
are saved in each run's `config.json`. Run IDs cannot be reused with different
settings; reset and choose a new run ID when changing them. Resume retains the
recorded settings and retries the failed turn, keeping completed turns intact.

Backend environment defaults (set in the shell or ignored `backend/.env`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `LLM_BASE_URL` | `http://127.0.0.1:8080/v1` | OpenAI-compatible API base URL |
| `LLM_MAX_TOKENS` | `2048` | Positive integer completion token limit; dashboard can override per run |
| `LLM_OUTPUT_MODE` | `json_schema` | `json_schema` or explicit `json_only` compatibility mode |
| `LLM_DEBUG_CONTENT` | unset | Set to `true` only for deliberate debugging of response content |

JSON Schema mode sends the agent-turn schema to the server and independently
validates every returned object with the same schema. JSON-only mode sends
`response_format: {"type":"json_object"}` plus a format-only instruction; the
same independent schema validation still applies. There is no automatic mode
switch, JSON repair, Markdown stripping, dialogue rewriting or invented response.
If a server rejects a mode, configure a supported one for a new run. Missing
`memory_operations` is normalized to `[]`; malformed operations are rejected.
Stat updates must target an existing stat, use `update`, and contain a finite
number in the dashboard's 0–10 range. Initial stat values never change.

Backend diagnostics and error events record HTTP status, requested/reported model,
finish reason, content presence/length, a capped excerpt and token usage when
provided. By default the excerpt exposes only punctuation with text redacted.
`LLM_DEBUG_CONTENT=true` includes up to 200 characters of raw model output, which
can contain sensitive information; leave it disabled for normal research runs.
Complete prompts and conversations are not printed to the console. Research
conversation/state/audit files intentionally retain the experimental record.
`finish_reason: "length"` is always treated as truncation, even if its JSON parses.

Inference or validation errors appear inline in the dashboard and in the audit
panel, clear the thinking indicator and pause the run. Resume retries the failed
turn. Pause completes any in-flight turn before Resume can launch another loop.
Multiple dashboards can subscribe simultaneously; reconnecting restores saved
conversation and audit history. Backend process restart does not automatically
start a run: submit the same configuration/Run ID to continue saved turns.

Run regression checks with `cd backend && npm test`. These use controlled local
HTTP responses, including a 100-turn run and failure/retry and Pause/Resume races;
they do not establish compatibility with your actual model.

For the real local-model acceptance check, start your llama.cpp server, then run:

```bash
cd backend
# Uses discovery automatically when exactly one model is loaded.
# Set LLM_TEST_MODEL to an exact discovered ID if multiple models are loaded.
LLM_BASE_URL=http://127.0.0.1:8080/v1 npm run test:local-model
```

This creates isolated Bob/Sara states with numeric attributes, runs 100 real turns
using the unchanged application identity prompts, and preserves the resulting
conversation, metadata and audit files in the printed temporary directory. It
stops with a failure on invalid inference output and never substitutes dialogue.

## Participants and conversation topics

Each available agent has an **Include in Next Experiment** checkbox. Agents
initially default to included. Uncheck anyone who should not participate; at least
two selected agents are required. The dashboard submits checked IDs in ascending
ID order, which becomes the fixed round-robin turn order. More than two agents
are supported. Only participating agents receive turns or memory/stat changes.

**Conversation Topic** is optional multiline text, trimmed before saving and
limited to 1,000 characters. A nonempty topic is the user-message stimulus for
turn zero only. It is not inserted into the identity system prompt or repeatedly
reintroduced on later turns. Agents may move to other subjects naturally. Empty
or missing topics retain the original open-ended first-turn message.

Participants and topic are saved with the immutable run configuration and shown
when that run is loaded. Controls remain locked for running, paused, stopped and
completed runs. Resume uses the original configuration; to prepare another run,
Reset and choose a new Run ID. Existing runs without `initialTopic` are treated as
having an empty topic, without rewriting their configuration or research logs.
Apply this enhancement locally after any ongoing stability experiment finishes;
there is no automatic restart or migration of an active run.

Regression checks:

```bash
cd backend
npm test
cd ../frontend
npm test -- --watch=false --browsers=ChromeHeadless
npm run build
```

The frontend tests require Chrome/Chromium (set `CHROME_BIN` if necessary).
Backend tests use isolated temporary storage and controlled inference responses,
including participant isolation, multi-agent order, topic delivery, legacy data
compatibility, and pause/resume/restart preservation.
