import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { JsonStorage } from './storage/JsonStorage';
import { JsonlStorage } from './storage/JsonlStorage';
import { LlmAdapter, resolveLlmConfig } from './llm/LlmAdapter';
import { ExperimentController } from './experiments/ExperimentController';
import { createAgentsRouter } from './api/agents';
import { AnalysisService } from './analysis/AnalysisService';
import { BenchmarkService } from './analysis/BenchmarkService';
import { createAnalysisRouter } from './api/analysis';
import { ResearchService } from './research/ResearchService';
import { createResearchRouter } from './api/research';
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
const research = new ResearchService(controller, jsonlStorage, jsonStorage);
app.use('/api/research', createResearchRouter(research));
app.use('/api/analysis', createAnalysisRouter(new AnalysisService(controller, jsonlStorage, research), new BenchmarkService(controller, jsonlStorage, research)));
app.use('/api/experiment', createExperimentRouter(controller, jsonlStorage));

app.get('/api/llm/config', (req, res) => {
    res.json(resolveLlmConfig());
});

app.get('/api/llm/models', async (req, res) => {
    try {
        const baseUrl = typeof req.query.baseUrl === 'string' ? req.query.baseUrl : undefined;
        const adapter = new LlmAdapter({ baseUrl });
        res.json(await adapter.getModels());
    } catch (error: any) {
        res.status(502).json({ error: error.message });
    }
});

app.get('/api/events', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    // Queue events during the snapshot read so history always precedes live updates.
    let ready = false;
    const pending: { type: string; data: any }[] = [];
    const send = (type: string, data: any) => {
        if (!res.destroyed) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const unsubscribe = controller.onEvent((type, data) => {
        if (ready) send(type, data);
        else pending.push({ type, data });
    });
    const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 15000);
    res.on('close', () => { unsubscribe(); clearInterval(heartbeat); });
    try {
        send('snapshot', await controller.getSnapshot());
        ready = true;
        for (const event of pending) send(event.type, event.data);
    } catch {
        send('connection_error', { message: 'Could not load research history; reconnect to retry' });
        res.end();
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

export { app, controller };

if (require.main === module) {
    app.listen(port, () => {
        console.log(`Backend server listening at http://localhost:${port}`);
    });
}
