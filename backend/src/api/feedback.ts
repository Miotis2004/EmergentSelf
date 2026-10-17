import { Router } from 'express';
import { FeedbackService } from '../social/FeedbackService';
export function createFeedbackRouter(feedback:FeedbackService){
    const router=Router();
    router.post('/runs/:runId/feedback',async(req,res)=>{
        try {res.json(await feedback.record(String(req.params.runId),req.body));}
        catch(error:any){res.status(error.code==='EEXIST'?409:400).json({error:error.message});}
    });
    return router;
}
