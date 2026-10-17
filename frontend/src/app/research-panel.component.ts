import { Component, Input, OnInit, OnChanges, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ExperimentService } from './services/experiment.service';

@Component({
    selector:'app-research-panel',standalone:true,imports:[CommonModule,FormsModule],
    template:`
    <details class="research-panel">
      <summary><strong>Experimental controls & reproducibility</strong></summary>
      <p>Freeze a template and starting snapshot, prepare repeated trials, then start each trial explicitly. Probes and researcher operations require the experiment to be paused or stopped.</p>
      <p *ngIf="error" role="alert">{{error}}</p><p *ngIf="message" role="status">{{message}}</p>
      <button (click)="refresh()">Refresh saved research</button>
      <fieldset [disabled]="busy || running">
        <legend>Fixed experiment template</legend>
        <label>Template ID <input [(ngModel)]="templateId"></label>
        <label>Starting snapshot (optional; empty uses current agent state)
          <input list="saved-snapshots" [(ngModel)]="startingSnapshot"></label>
        <label>Model version or weight hash <input [(ngModel)]="modelVersion"></label>
        <small>“unverified” explicitly records unknown provenance; it does not verify model weights.</small>
        <label>Temperature <input type="number" min="0" max="2" step="0.1" [(ngModel)]="temperature"></label>
        <label>Top-p <input type="number" min="0" max="1" step="0.05" [(ngModel)]="topP"></label>
        <label>Declared model context tokens <input type="number" [(ngModel)]="contextTokens"></label>
        <label><input type="checkbox" [(ngModel)]="useSeed">Use sampling seed</label>
        <label *ngIf="useSeed">Sampling seed <input type="number" [(ngModel)]="samplingSeed"></label>
        <label *ngIf="useSeed"><input type="checkbox" [(ngModel)]="seedSupported">I confirmed this server supports the seed parameter</label>
        <label>Attribute condition <select [(ngModel)]="attributeMode">
          <option value="numeric">Named numeric attributes</option><option value="arbitrary">Arbitrary labels (q1, q2, …)</option><option value="role">Explicit researcher role description</option>
        </select></label>
        <div *ngIf="attributeMode === 'role'"><label *ngFor="let agentId of configuration?.agentIds">Role for {{agentId}}<textarea [(ngModel)]="roles[agentId]" maxlength="2000"></textarea></label></div>
        <details><summary>Fixed prompt and input budget</summary>
          <label>System prompt <textarea rows="8" [(ngModel)]="systemPrompt"></textarea></label>
          <label>Turn prompt <textarea [(ngModel)]="turnPrompt"></textarea></label>
          <small>Placeholders: id, name, attributes, memory, digest, transcript (inside braces). Substitutions are literal.</small>
          <label>Maximum input characters <input type="number" [(ngModel)]="inputCharLimit"></label>
          <small>Includes actual request messages. Character limits are not tokenizer guarantees.</small>
        </details>
        <button (click)="saveTemplate()">Freeze current configuration as template</button>
      </fieldset>
      <fieldset [disabled]="busy || running"><legend>Repeated trials</legend>
        <label>Saved template <input list="saved-templates" [(ngModel)]="selectedTemplate"></label>
        <label>Batch ID <input [(ngModel)]="batchId"></label>
        <label>Repeats per condition <input type="number" min="1" max="100" [(ngModel)]="repeats"></label>
        <label>Randomization seed <input type="number" [(ngModel)]="randomizationSeed"></label>
        <label><input type="checkbox" [(ngModel)]="randomizeParticipants">Randomize participant order (matched by repeat across conditions)</label>
        <label><input type="checkbox" [(ngModel)]="includeNone">No memory</label>
        <label><input type="checkbox" [(ngModel)]="includeHistory">Conversation history only</label>
        <label><input type="checkbox" [(ngModel)]="includeStructured">Structured editable memory</label>
        <button (click)="prepareBatch()">Prepare batch</button>
        <label>Load saved batch <input list="saved-batches" [(ngModel)]="batchId"></label><button (click)="loadBatch()">Load batch</button>
        <p>Trials use isolated working state and the same frozen starting snapshot. Sampling settings and budgets are held fixed.</p>
        <div *ngFor="let trial of manifest?.trials">
          <strong>{{trial.runId}}</strong> · repeat {{trial.protocol.repeatIndex + 1}} · {{conditionLabel(trial.memoryConfig.mode)}}
          <button (click)="startTrial(trial.runId)">Start trial</button>
        </div>
      </fieldset>
      <fieldset [disabled]="busy || running"><legend>Snapshots, probes & researcher notes</legend>
        <label>Run ID <input list="saved-runs" [(ngModel)]="targetRunId"></label>
        <label>Historical turn (-1 for initial state) <input type="number" [(ngModel)]="turnIndex"></label>
        <label>Researcher <input [(ngModel)]="actor"></label><label>Reason <textarea [(ngModel)]="reason"></textarea></label>
        <button (click)="note()">Record researcher note</button>
        <label>Snapshot ID <input list="saved-snapshots" [(ngModel)]="snapshotId"></label><button (click)="snapshot()">Capture snapshot at turn</button>
        <label>Source agent ID <input [(ngModel)]="agentId"></label><label>New clone agent ID <input [(ngModel)]="cloneId"></label><button (click)="clone()">Clone from snapshot</button>
        <label>Probe definition ID <input list="saved-probes" [(ngModel)]="probeId"></label>
        <label>Probe prompts (separate turns with a blank line)<textarea rows="4" [(ngModel)]="probePrompts"></textarea></label>
        <button (click)="defineProbe()">Save standardized probe</button><button (click)="runProbe()">Run read-only probe</button>
        <article *ngFor="let result of probeResults"><strong>Probe turn {{result.probeTurn}} — {{result.status}}</strong><p class="verbatim">{{result.response?.response || result.error}}</p></article>
      </fieldset>
      <fieldset><legend>Compare & export</legend>
        <label>Left run <input list="saved-runs" [(ngModel)]="leftRun"></label><label>Right run <input list="saved-runs" [(ngModel)]="rightRun"></label>
        <button (click)="compare()" [disabled]="busy">Compare configurations</button>
        <div *ngIf="comparison"><p *ngIf="!comparison.promptingRecorded">One or both runs predate fixed Phase III prompts.</p>
          <table><thead><tr><th>Setting</th><th>{{comparison.leftId}}</th><th>{{comparison.rightId}}</th></tr></thead>
            <tbody><tr *ngFor="let difference of comparison.differences"><td>{{difference.path}}</td><td>{{difference.left | json}}</td><td>{{difference.right | json}}</td></tr></tbody>
          </table>
        </div>
        <button (click)="exportRun()" [disabled]="busy || running">Download selected run and audit data</button>
      </fieldset>
      <datalist id="saved-templates"><option *ngFor="let value of catalog.templates" [value]="value"></option></datalist>
      <datalist id="saved-batches"><option *ngFor="let value of catalog.batches" [value]="value"></option></datalist>
      <datalist id="saved-snapshots"><option *ngFor="let value of catalog.snapshots" [value]="value"></option></datalist>
      <datalist id="saved-runs"><option *ngFor="let value of catalog.runs" [value]="value"></option></datalist>
      <datalist id="saved-probes"><option *ngFor="let value of catalog.probes" [value]="value"></option></datalist>
    </details>`,
    styles:[`:host {display:block;margin:12px 0} fieldset {margin:12px 0} label {display:block;margin:7px 0} input:not([type=checkbox]),textarea,select {width:100%;box-sizing:border-box} textarea {resize:vertical} table {width:100%;border-collapse:collapse;font-size:12px} td,th {border:1px solid #ddd;padding:5px;overflow-wrap:anywhere} .verbatim {white-space:pre-wrap} [role=alert] {color:#8a1010}`]
})
export class ResearchPanelComponent implements OnInit,OnChanges {
    @Input() configuration:any;
    @Input() running=false;
    @Output() agentsChanged=new EventEmitter<void>();
    catalog:any={runs:[],templates:[],snapshots:[],batches:[],probes:[]};
    error='';message='';busy=false;
    templateId='';selectedTemplate='';startingSnapshot='';modelVersion='unverified';temperature=0.7;topP=1;contextTokens=8192;
    useSeed=false;seedSupported=false;samplingSeed=42;
    attributeMode='numeric';roles:Record<string,string>={};systemPrompt='';turnPrompt='';inputCharLimit=24000;
    batchId='';repeats=1;randomizationSeed=42;randomizeParticipants=false;includeNone=true;includeHistory=true;includeStructured=true;
    manifest:any=null;targetRunId='';turnIndex=-1;actor='';reason='';snapshotId='';agentId='';cloneId='';probeId='';probePrompts='';probeResults:any[]=[];
    leftRun='';rightRun='';comparison:any=null;
    private latestConfigRunId='';
    constructor(private experiments:ExperimentService){}
    ngOnInit(){
        this.experiments.research('GET','/defaults').subscribe({next:data=>{this.systemPrompt=data.systemPrompt;this.turnPrompt=data.turnPrompt;this.inputCharLimit=data.inputCharLimit;},error:error=>this.showError(error)});
        this.refresh();
    }
    ngOnChanges(){
        const next=this.configuration?.runId??'';
        if(!this.targetRunId||this.targetRunId===this.latestConfigRunId)this.targetRunId=next;
        this.latestConfigRunId=next;
        if(!this.agentId)this.agentId=this.configuration?.agentIds?.[0]??'';
    }
    private showError(error:any){this.error=error?.error?.error||error.message||'Research request failed';}
    private act(method:string,path:string,body:any,done?:(value:any)=>void){
        if(this.busy)return;this.busy=true;this.error='';this.message='';
        this.experiments.research(method,path,body).subscribe({next:value=>{this.busy=false;this.message=method==='GET'?'Research data loaded.':'Research operation completed.';done?.(value);this.refresh();},error:error=>{this.busy=false;this.showError(error);}});
    }
    refresh(){this.experiments.research('GET','/catalog').subscribe({next:data=>this.catalog=data,error:error=>this.showError(error)});}
    templateConfiguration(){
        const llmConfig={...this.configuration.llmConfig,modelVersion:this.modelVersion,temperature:this.temperature,topP:this.topP,contextWindowTokens:this.contextTokens,
            ...(this.useSeed?{seed:this.samplingSeed,seedSupported:this.seedSupported}:{})};
        return {...this.configuration,llmConfig,protocol:{version:1,condition:this.configuration.memoryConfig.mode,systemPrompt:this.systemPrompt,turnPrompt:this.turnPrompt,
            inputCharLimit:this.inputCharLimit,attributeMode:this.attributeMode,roles:this.attributeMode==='role'?{...this.roles}:{},...(this.startingSnapshot?{snapshotId:this.startingSnapshot}:{})}};
    }
    saveTemplate(){this.act('POST','/templates',{templateId:this.templateId,configuration:this.templateConfiguration()},()=>this.selectedTemplate=this.templateId);}
    prepareBatch(){const conditions=[...(this.includeNone?['none']:[]),...(this.includeHistory?['history']:[]),...(this.includeStructured?['enabled']:[])];this.act('POST','/batches',{batchId:this.batchId,templateId:this.selectedTemplate,repeats:this.repeats,conditions,randomizationSeed:this.randomizationSeed,randomizeParticipants:this.randomizeParticipants},value=>this.manifest=value);}
    loadBatch(){this.act('GET',`/batches/${encodeURIComponent(this.batchId)}`,undefined,value=>this.manifest=value);}
    startTrial(runId:string){this.act('POST',`/batches/${encodeURIComponent(this.manifest?.batchId || this.batchId)}/start`,{runId},()=>this.targetRunId=runId);}
    note(){this.act('POST',`/runs/${encodeURIComponent(this.targetRunId)}/interventions`,{actor:this.actor,reason:this.reason});}
    snapshot(){this.act('POST','/snapshots',{snapshotId:this.snapshotId,runId:this.targetRunId,turnIndex:this.turnIndex,actor:this.actor,reason:this.reason});}
    clone(){this.act('POST','/clones',{snapshotId:this.snapshotId,sourceAgentId:this.agentId,targetAgentId:this.cloneId,actor:this.actor,reason:this.reason},()=>this.agentsChanged.emit());}
    defineProbe(){this.act('POST','/probe-definitions',{probeId:this.probeId,prompts:this.probePrompts.split(/\n\s*\n/).map(value=>value.trim()).filter(Boolean)});}
    runProbe(){this.act('POST',`/runs/${encodeURIComponent(this.targetRunId)}/probes`,{probeId:this.probeId,agentId:this.agentId,turnIndex:this.turnIndex,actor:this.actor,reason:this.reason},value=>this.probeResults=value.results);}
    compare(){this.act('GET',`/compare?left=${encodeURIComponent(this.leftRun)}&right=${encodeURIComponent(this.rightRun)}`,undefined,value=>this.comparison=value);}
    exportRun(){this.act('GET',`/runs/${encodeURIComponent(this.targetRunId)}/export`,undefined,value=>{
        const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
        const link=document.createElement('a');link.href=url;link.download=`${this.targetRunId}.json`;link.click();URL.revokeObjectURL(url);
    });}
    conditionLabel(value:string){return ({none:'No memory',history:'Conversation history only',enabled:'Structured editable memory'} as Record<string,string>)[value]||value;}
}
