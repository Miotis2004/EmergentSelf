import type {ExperimentController} from '../experiments/ExperimentController';
import type {JsonlStorage} from '../storage/JsonlStorage';
import {currentOperational} from '../operations/state';
import { Router, Request, Response } from 'express';
import { JsonStorage, AgentState } from '../storage/JsonStorage';
import { DEMEANORS, validateStartingDemeanor } from '../agents/startingDemeanor';

export function createAgentsRouter(storage: JsonStorage, controller?:ExperimentController, logs?:JsonlStorage): Router {
    const router = Router();

    router.get('/demeanors', (_req, res) => res.json(DEMEANORS));

    // List all agents
    router.get('/', async (req: Request, res: Response) => {
        try {
            const agentIds = await storage.listAgents();
            const agents = [];
            for (const id of agentIds) {
                const identity = await storage.loadAgentIdentity(id);
                if (identity) agents.push({...identity,operationalState:currentOperational(await storage.loadWorkingState(id))});
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

            let startingDemeanor;
            try { startingDemeanor = validateStartingDemeanor(req.body.startingDemeanor); }
            catch (error: any) { return res.status(400).json({error:error.message}); }
            const identity: AgentState = { id, name, stats, memories: [], beliefs: [], ...(startingDemeanor ? {startingDemeanor} : {}) };
            await storage.saveAgentIdentity(id, identity);
            await storage.saveAgentMemory(id, []);
            await storage.saveAgentBeliefs(id, []);

            const state=await storage.loadWorkingState(id);
            state.operational=currentOperational(state);
            await storage.saveWorkingState(id,state);
            res.status(201).json(identity);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/:id/task-history',async(req,res)=>{
        try {
            if(!logs)return res.status(503).json({error:'Task history unavailable'});
            const agentId=String(req.params.id);
            if(!await storage.loadAgentIdentity(agentId))return res.status(404).json({error:'Agent not found'});
            const text=(key:string)=>{const value=req.query[key];if(value!==undefined&&typeof value!=='string')throw new Error('Invalid history filter');return value as string|undefined;};
            const number=(key:string)=>{const value=text(key);if(value===undefined)return undefined;if(!/^\d+$/.test(value))throw new Error('Invalid history pagination');return Number(value);};
            res.json(await logs.taskHistory(agentId,{runId:text('runId'),taskId:text('taskId'),status:text('status') as any,limit:number('limit'),offset:number('offset')}));
        }catch(error:any){res.status(error.code==='EIO'?503:400).json({error:error.message});}
    });

    router.post('/:id/archive',async(req,res)=>{
        try {
            if(!controller)return res.status(503).json({error:'Agent archival safeguards unavailable'});
            await controller.archiveAgent(String(req.params.id));
            res.json({success:true,archived:true});
        }catch(error:any){res.status(error.status??409).json({error:error.message});}
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
            const state = await storage.loadWorkingState(id);
            res.json({ identity, memories, beliefs, state });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}
