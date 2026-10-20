import { Router, Request, Response } from 'express';
import { JsonlStorage } from '../storage/JsonlStorage';
import { ExperimentController } from '../experiments/ExperimentController';

export function createExperimentRouter(controller: ExperimentController, logs?: JsonlStorage): Router {
    const router = Router();

    router.get('/runs/:runId/agents/:agentId/memory', async (req, res) => {
        try {
            if (!logs) return res.status(503).json({ error: 'Memory history unavailable' });
            const index = (value: unknown) => {
                if (value === undefined) return undefined;
                if (typeof value !== 'string' || !/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Historical turn must be an integer');
                return Number(value);
            };
            res.json(await logs.memoryHistory(String(req.params.runId), String(req.params.agentId), index(req.query.turn), index(req.query.compareTo)));
        } catch (error: any) {
            res.status(error.code === 'ENOENT' ? 404 : 400).json({ error: error.code === 'ENOENT' ? 'No Phase II memory history recorded for this run' : error.message });
        }
    });

    router.get('/status', (req: Request, res: Response) => {
        res.json(controller.getState());
    });

    router.post('/start', async (req: Request, res: Response) => {
        try {
            const { decisionConfig, schedulingConfig, communicationConfig, runId, agentIds, maxTurns, llmConfig, initialTopic, memoryConfig, protocol, socialConfig, taskConfig, feedbackConfig, operationalConfig, worldConfig, recoveryConfig, taskHistoryConfig } = req.body;
            if (!runId || !agentIds || !maxTurns || !llmConfig) {
                 return res.status(400).json({ error: 'Missing required configuration' });
            }
            await controller.start({ ...(decisionConfig===undefined?{}:{decisionConfig}), ...(schedulingConfig===undefined?{}:{schedulingConfig}), ...(communicationConfig===undefined?{}:{communicationConfig}), ...(taskHistoryConfig===undefined?{}:{taskHistoryConfig}), ...(recoveryConfig===undefined?{}:{recoveryConfig}), ...(worldConfig===undefined?{}:{worldConfig}), ...(operationalConfig === undefined ? {} : {operationalConfig}), runId, agentIds, maxTurns, llmConfig, initialTopic, memoryConfig, ...(socialConfig === undefined ? {} : {socialConfig}), ...(taskConfig === undefined ? {} : {taskConfig}), ...(feedbackConfig === undefined ? {} : {feedbackConfig}), ...(protocol === undefined ? {} : {protocol}) });
            res.json({ success: true });
        } catch (error: any) {
             res.status(500).json({ error: error.message });
        }
    });

    router.post('/world/advance',async(req,res)=>{try{res.json(await controller.advanceTime(req.body.minute,req.body.actor,req.body.reason));}catch(error:any){res.status(400).json({error:error.message});}});
    router.post('/world/wake',async(req,res)=>{try{res.json(await controller.wakeAgent(req.body.agentId,req.body.actor,req.body.reason));}catch(error:any){res.status(400).json({error:error.message});}});

    router.post('/pause', async (req: Request, res: Response) => {
        await controller.pause();
        res.json({ success: true });
    });

    router.post('/resume', async (req: Request, res: Response) => {
        await controller.resume();
        res.json({ success: true });
    });

    router.post('/stop', async (req: Request, res: Response) => {
        await controller.stop();
        res.json({ success: true });
    });

    router.post('/reset', async (req: Request, res: Response) => {
        await controller.reset();
        res.json({ success: true });
    });

    return router;
}
