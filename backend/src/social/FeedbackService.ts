import { ExperimentController } from '../experiments/ExperimentController';
import { JsonlStorage } from '../storage/JsonlStorage';
import { dueTurn, resolveEnvironment } from './environment';
import { id, text } from '../research/protocol';

export class FeedbackService {
    constructor(private controller:ExperimentController,private logs:JsonlStorage){}
    record(runId:string,input:any){return this.controller.researchAction(async()=>{
        if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['feedbackId','agentId','turnIndex','valence','actor','reason'].includes(key)))throw new Error('Invalid feedback fields; scores come from the saved rules');
        id(runId);const feedbackId=id(input.feedbackId);text(input.actor,'Researcher',200);text(input.reason,'Feedback rationale',2000);
        const config=await this.logs.loadConfig(runId);if(!config)throw new Error('Unknown run');
        const {feedbackConfig:f}=resolveEnvironment(config);
        if(!f.enabled||f.source==='task')throw new Error('Researcher feedback is disabled in this run');
        if(!['positive','negative'].includes(input.valence)||!Number.isSafeInteger(input.turnIndex))throw new Error('Select positive/negative and an integer decision turn');
        const turns=await this.logs.getConversationHistory(runId),turn=turns.find(t=>t.turnIndex===input.turnIndex);
        if(!turn||turn.agentId!==input.agentId)throw new Error('Feedback must reference a committed decision by the selected agent');
        const previous=await this.logs.readResearch(runId,'feedback');
        if(previous.some(e=>e.feedbackId===feedbackId))throw Object.assign(new Error('Feedback ID already exists'),{code:'EEXIST'});
        const event={schemaVersion:5,id:`researcher-${feedbackId}`,feedbackId,type:'feedback',runId,agentId:turn.agentId,decisionEventId:turn.eventId,sourceTurnIndex:turn.turnIndex,
            turnIndex:turns.length-1,createdBeforeTurn:turns.length,source:'researcher',ruleVersion:'researcher-v1',valence:input.valence,
            score:input.valence==='positive'?f.positiveScore:f.negativeScore,visibility:f.visibility,deliverFromTurn:dueTurn(f,turns.length-1),
            actor:input.actor,reason:input.reason,timestamp:new Date().toISOString()};
        await this.logs.appendResearch(runId,'feedback',event);this.controller.notifyEnvironmentEvent(event);return event;
    });}
}
