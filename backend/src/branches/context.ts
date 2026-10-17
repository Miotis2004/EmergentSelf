import { JsonlStorage } from '../storage/JsonlStorage';
import { hash } from '../research/protocol';

export function compactTurn(turn:any){
    return {runId:turn.runId,sourceTurnIndex:turn.sourceTurnIndex??turn.turnIndex,eventId:turn.eventId,
        agentId:turn.agentId,agentName:turn.agentName,response:turn.response,...(turn.social?{social:turn.social}:{})};
}
export async function inheritedContext(logs:JsonlStorage,config:any){
    if(!config?.protocol?.historySnapshotId)return [];
    const snapshot=await logs.loadArtifact('snapshots',config.protocol.historySnapshotId);
    if(!Array.isArray(snapshot.context)||hash(snapshot.context)!==snapshot.contextHash||(config.protocol.historyContextHash&&config.protocol.historyContextHash!==snapshot.contextHash))throw new Error('Inherited context hash mismatch');
    return snapshot.context;
}
export async function snapshotContext(logs:JsonlStorage,snapshot:any){
    if(snapshot.context!==undefined){
        if(!Array.isArray(snapshot.context)||hash(snapshot.context)!==snapshot.contextHash)throw new Error('Snapshot context hash mismatch');
        return structuredClone(snapshot.context);
    }
    if(!snapshot.sourceRunId||!Number.isSafeInteger(snapshot.sourceTurnIndex))throw new Error('Snapshot needs attributable conversation context');
    const config=await logs.loadConfig(snapshot.sourceRunId);
    return [...await inheritedContext(logs,config),...(await logs.getConversationHistory(snapshot.sourceRunId)).filter(t=>t.turnIndex<=snapshot.sourceTurnIndex).map(compactTurn)];
}
