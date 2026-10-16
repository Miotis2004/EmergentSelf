import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { JsonStorage } from './storage/JsonStorage';
import { JsonlStorage } from './storage/JsonlStorage';
import { LlmAdapter } from './llm/LlmAdapter';
import { ExperimentController } from './experiments/ExperimentController';
import { createAgentsRouter } from './api/agents';
import { createExperimentRouter } from './api/experiment';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const jsonStorage = new JsonStorage();
const jsonlStorage = new JsonlStorage();
const llmAdapter = new LlmAdapter();
const controller = new ExperimentController(jsonStorage, jsonlStorage, llmAdapter);

app.use('/api/agents', createAgentsRouter(jsonStorage));
app.use('/api/experiment', createExperimentRouter(controller));

app.get('/api/llm/models', async (req, res) => {
    try {
        const config = controller.getConfig();
        const baseUrl = config?.llmConfig?.baseUrl || 'http://127.0.0.1:8080/v1';

        // Temporarily use the adapter to check models at provided URL
        const tempAdapter = new LlmAdapter({ baseUrl, model: 'default' });
        const models = await tempAdapter.getModels();
        res.json(models);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// SSE endpoint for live events
app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const listener = (eventType: string, data: any) => {
        res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    controller.onEvent(listener);

    // Initial state dispatch
    res.write(`event: status_changed\ndata: ${JSON.stringify({ status: controller.getStatus() })}\n\n`);

    req.on('close', () => {
        // Simple listener removal (a real app would use EventEmitter properly)
        controller.onEvent((_, __) => {});
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(port, () => {
    console.log(`Backend server listening at http://localhost:${port}`);
});
