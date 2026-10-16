import { Router, Request, Response } from 'express';
import { JsonStorage, AgentState } from '../storage/JsonStorage';

export function createAgentsRouter(storage: JsonStorage): Router {
    const router = Router();

    // List all agents
    router.get('/', async (req: Request, res: Response) => {
        try {
            const agentIds = await storage.listAgents();
            const agents = [];
            for (const id of agentIds) {
                const identity = await storage.loadAgentIdentity(id);
                if (identity) agents.push(identity);
            }
            res.json(agents);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // Create an agent
    router.post('/', async (req: Request, res: Response) => {
        try {
            const { id, name, stats } = req.body;
            if (!id || !name || !stats) {
                return res.status(400).json({ error: 'Missing required fields (id, name, stats)' });
            }

            if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id) || typeof name !== 'string' ||
                typeof stats !== 'object' || Array.isArray(stats) || !Object.values(stats).every((stat: any) =>
                    stat && Number.isFinite(stat.initial) && stat.initial >= 0 && stat.initial <= 10 && stat.current === stat.initial)) {
                return res.status(400).json({ error: 'Agent IDs must use letters, numbers, hyphens or underscores; initial stats must be numbers between 0 and 10 and match current values' });
            }

            const existing = await storage.loadAgentIdentity(id);
            if (existing) {
                return res.status(409).json({ error: 'Agent already exists' });
            }

            const identity: AgentState = { id, name, stats, memories: [], beliefs: [] };
            await storage.saveAgentIdentity(id, identity);
            await storage.saveAgentMemory(id, []);
            await storage.saveAgentBeliefs(id, []);

            res.status(201).json(identity);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // Get specific agent details (identity, memory, beliefs)
    router.get('/:id', async (req: Request, res: Response) => {
        try {
            const id = req.params.id as string;
            const identity = await storage.loadAgentIdentity(id);
            if (!identity) {
                return res.status(404).json({ error: 'Agent not found' });
            }
            const memories = await storage.loadAgentMemory(id) || [];
            const beliefs = await storage.loadAgentBeliefs(id) || [];
            res.json({ identity, memories, beliefs });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}
