import { similarity } from '../analysis/metrics';
import { hash } from '../research/protocol';
const self=(state:any)=>(state?.entries??[]).filter((entry:any)=>entry.status==='active'&&entry.type==='self_description').map((entry:any)=>entry.content);
export function analyzeBranches(bundles:any[]){
    return {version:'continuity-v1',interpretation:'State lineage, lexical self-description stability and paired probe differences describe functional continuity. They do not establish subjective awareness or causal identity persistence.',
        definitions:{selfDescriptionSimilarity:'Token Jaccard of active self-descriptions at source snapshot versus selected branch state; both empty is unavailable.',responseSimilarity:'Token Jaccard of exact pre/post probe replies; both phases must succeed; lexical similarity is not semantic equivalence.'},
        runs:bundles.filter(bundle=>bundle.branch).map(bundle=>{
            const branch=bundle.branch;
            const stateAt=(agentId:string,turnIndex:number)=>[...bundle.turns].filter((t:any)=>t.agentId===agentId&&t.turnIndex<=turnIndex).sort((a,b)=>b.turnIndex-a.turnIndex)[0]?.stateAfter??branch.snapshot.states[agentId];
            const agents=bundle.config.agentIds.map((agentId:string)=>{
                const pre=branch.preSnapshot.states[agentId],post=stateAt(agentId,Infinity);
                return {agentId,preStateHash:hash(pre),postStateHash:hash(post),selfDescriptionSimilarity:similarity(self(pre),self(post)),preSelfDescriptions:self(pre),postSelfDescriptions:self(post)};
            });
            const comparisons=(bundle.branchComparisons??[]).map((manifest:any)=>{
                const records=bundle.probes.filter((p:any)=>p.comparison?.comparisonId===manifest.comparisonId);
                const definition=manifest.probeDefinition??(bundle.probeDefinitions??[]).find((d:any)=>d.probeId===manifest.probeId);
                const indices=definition?definition.prompts.map((_:any,index:number)=>index):[...new Set(records.map((p:any)=>p.probeTurn))].sort((a:any,b:any)=>a-b);
                const rows=indices.map((probeTurn:number)=>{
                    const pre=records.find((p:any)=>p.probeTurn===probeTurn&&p.comparison.phase==='pre'),post=records.find((p:any)=>p.probeTurn===probeTurn&&p.comparison.phase==='post');
                    const complete=pre?.status==='success'&&post?.status==='success';
                    return {probeTurn,preRecordId:pre?.id??null,postRecordId:post?.id??null,preStatus:pre?.status??'unrun',postStatus:post?.status??'unrun',
                        responseSimilarity:complete?similarity([pre.response.response],[post.response.response]):null,
                        preStateHash:pre?.stateHash??null,postStateHash:post?.stateHash??null};
                });
                return {comparisonId:manifest.comparisonId,agentId:manifest.agentId,probeId:manifest.probeId,postTurnIndex:manifest.postTurnIndex,modelPolicy:manifest.modelPolicy,contextPolicy:manifest.contextPolicy,modelDifferences:manifest.modelDifferences,
                    selfDescriptionSimilarity:similarity(self(branch.preSnapshot.states[manifest.agentId]),self(stateAt(manifest.agentId,manifest.postTurnIndex))),rows,
                    outcomes:(bundle.branchComparisonOutcomes??[]).filter((o:any)=>o.comparisonId===manifest.comparisonId)};
            });
            return {branchId:branch.branchId,manifestHash:branch.manifestHash,source:branch.source,actor:branch.actor,reason:branch.reason,configurationDifferences:branch.configurationDifferences,
                interventionCount:branch.interventions.length,agents,comparisons};
        })};
}
