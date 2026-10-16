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
