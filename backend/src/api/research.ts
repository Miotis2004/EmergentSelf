import { Router } from 'express';
import { DEFAULT_SYSTEM_PROMPT } from '../research/protocol';
import { ResearchService } from '../research/ResearchService';

export function createResearchRouter(research: ResearchService) {
    const router=Router();
    const handle=(work:(req:any)=>Promise<any>)=>async(req:any,res:any)=>{
        try {res.json(await work(req));}
        catch(error:any){res.status(error.code==='ENOENT'?404:error.code==='EEXIST'?409:400).json({error:error.code==='EEXIST'?'ID already exists; use a new ID':error.code==='ENOENT'?'Research artifact not found':error.message});}
    };
    router.get('/defaults', (req,res)=>res.json({systemPrompt:DEFAULT_SYSTEM_PROMPT,turnPrompt:'It is your turn to speak, {name}.',inputCharLimit:24000}));
    router.get('/catalog',handle(()=>research.catalog()));
    router.post('/templates',handle(req=>research.template(req.body.templateId,req.body.configuration)));
    router.post('/batches',handle(req=>research.batch(req.body.batchId,req.body.templateId,req.body.repeats,req.body.conditions,req.body.randomizationSeed,req.body.randomizeParticipants)));
    router.get('/batches/:batchId',handle(req=>research.batchManifest(req.params.batchId)));
    router.post('/batches/:batchId/start',handle(req=>research.startTrial(req.params.batchId,req.body.runId)));
    router.get('/compare',handle(req=>research.compare(req.query.left,req.query.right)));
    router.get('/runs/:runId/export',async(req,res)=>{
        try {const bundle=await research.exportRun(String(req.params.runId));res.setHeader('Content-Disposition',`attachment; filename="${bundle.runId}.json"`);res.json(bundle);}
        catch(error:any){res.status(400).json({error:error.code==='ENOENT'?'Research artifact not found':error.message});}
    });
    router.post('/snapshots',handle(req=>research.snapshot(req.body.snapshotId,req.body.runId,req.body.turnIndex,req.body.actor,req.body.reason)));
    router.post('/clones',handle(req=>research.clone(req.body.snapshotId,req.body.sourceAgentId,req.body.targetAgentId,req.body.actor,req.body.reason)));
    router.post('/probe-definitions',handle(req=>research.defineProbe(req.body.probeId,req.body.prompts)));
    router.post('/runs/:runId/probes',handle(req=>research.probe(req.params.runId,req.body.agentId,req.body.turnIndex,req.body.probeId,req.body.actor,req.body.reason)));
    router.post('/runs/:runId/interventions',handle(req=>research.intervene(req.params.runId,req.body.actor,req.body.reason)));
    return router;
}
