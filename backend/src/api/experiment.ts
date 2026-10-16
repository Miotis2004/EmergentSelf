import { Router, Request, Response } from 'express';
import { ExperimentController } from '../experiments/ExperimentController';

export function createExperimentRouter(controller: ExperimentController): Router {
    const router = Router();

    router.get('/status', (req: Request, res: Response) => {
        res.json(controller.getState());
    });

    router.post('/start', async (req: Request, res: Response) => {
        try {
            const { runId, agentIds, maxTurns, llmConfig } = req.body;
            if (!runId || !agentIds || !maxTurns || !llmConfig) {
                 return res.status(400).json({ error: 'Missing required configuration' });
            }
            await controller.start({ runId, agentIds, maxTurns, llmConfig });
            res.json({ success: true });
        } catch (error: any) {
             res.status(500).json({ error: error.message });
        }
    });

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
