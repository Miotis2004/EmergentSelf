import { Router } from 'express';
import { StudyService } from '../publication/StudyService';
import { DATA_DICTIONARY, VALIDITY } from '../publication/metadata';
export function createStudiesRouter(studies:StudyService){
 const router=Router();
 const handle=(work:(req:any)=>Promise<any>)=>async(req:any,res:any)=>{try{res.json(await work(req));}catch(error:any){res.status(error.code==='ENOENT'?404:error.code==='EEXIST'?409:400).json({error:error.code==='ENOENT'?'Study/publication artifact not found':error.code==='EEXIST'?'Immutable ID exists; use a new versioned ID':error.message});}};
 router.get('/defaults',(req,res)=>res.json({dictionary:DATA_DICTIONARY,validity:VALIDITY}));
 router.get('/catalog',handle(()=>studies.catalog()));
 router.post('/',handle(req=>studies.register(req.body)));
 router.get('/publications/:publicationId',handle(req=>studies.publication(req.params.publicationId)));
 router.get('/:studyId',handle(req=>studies.get(req.params.studyId)));
 router.post('/:studyId/report',handle(req=>studies.report(req.params.studyId)));
 router.post('/:studyId/publications',handle(req=>studies.publish(req.params.studyId,req.body)));
 return router;
}
