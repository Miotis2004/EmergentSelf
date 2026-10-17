import { Router } from 'express';
import { BranchService } from '../branches/BranchService';
export function createBranchesRouter(branches:BranchService){
    const router=Router();
    const handle=(work:(req:any)=>Promise<any>)=>async(req:any,res:any)=>{
        try{res.json(await work(req));}catch(error:any){res.status(error.code==='ENOENT'?404:error.code==='EEXIST'?409:400).json({error:error.code==='ENOENT'?'Branch/source artifact not found':error.message});}
    };
    router.get('/catalog',handle(()=>branches.catalog()));
    router.post('/',handle(req=>branches.create(req.body)));
    router.get('/:branchId',handle(req=>branches.get(req.params.branchId)));
    router.post('/:branchId/prepare',handle(req=>branches.prepare(req.params.branchId)));
    router.post('/:branchId/start',handle(req=>branches.start(req.params.branchId)));
    router.post('/:branchId/probe-pairs',handle(req=>branches.probePair(req.params.branchId,req.body)));
    return router;
}
