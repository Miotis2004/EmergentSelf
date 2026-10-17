import { Router } from 'express';
import { AnalysisService } from '../analysis/AnalysisService';
import { BenchmarkService } from '../analysis/BenchmarkService';
import { METRICS, METRIC_VERSION, CUES, RUBRIC, STANDARD_BENCHMARK, STOPWORDS } from '../analysis/definitions';

export function createAnalysisRouter(analysis:AnalysisService,benchmarks:BenchmarkService){
    const router=Router();
    const handle=(work:(req:any)=>Promise<any>)=>async(req:any,res:any)=>{
        try{res.json(await work(req));}
        catch(error:any){res.status(error.code==='ENOENT'?404:error.code==='EEXIST'?409:400).json({error:error.code==='EEXIST'?'ID or rater/item rating already exists; use a new versioned ID':error.code==='ENOENT'?'Analysis artifact not found':error.message});}
    };
    router.get('/definitions',(req,res)=>res.json({metricVersion:METRIC_VERSION,metrics:METRICS,lexicons:CUES,stopwords:[...STOPWORDS],rubric:RUBRIC,standardBenchmark:STANDARD_BENCHMARK}));
    router.get('/catalog',handle(()=>benchmarks.catalog()));
    router.post('/reports',handle(req=>analysis.report(req.body.runIds,req.body.options)));
    router.post('/benchmarks',handle(req=>benchmarks.define(req.body)));
    router.post('/benchmark-sessions',handle(req=>benchmarks.run(req.body)));
    router.post('/evaluation-datasets',handle(req=>analysis.dataset(req.body)));
    router.get('/evaluation-datasets/:datasetId',handle(req=>analysis.publicDataset(req.params.datasetId)));
    router.post('/ratings',handle(req=>analysis.rate(req.body)));
    return router;
}
