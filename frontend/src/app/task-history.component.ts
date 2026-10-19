import {Component,Input,OnChanges,OnDestroy,SimpleChanges} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Subscription} from 'rxjs';
import {AgentService,AgentIdentity} from './services/agent.service';
export function defaultTaskHistoryConfig(){return {enabled:true,recentCompleted:6,recentAdverse:4,recentAttempts:3,relevant:4,maxChars:6000};}
@Component({selector:'app-task-history-controls',standalone:true,imports:[CommonModule,FormsModule],template:`
<fieldset [disabled]="locked"><legend>Verified task-history context</legend>
<label><input type="checkbox" [(ngModel)]="config.enabled"> Include backend-owned historical evidence</label>
<p>History is separate from subjective memories. Past achievements do not establish the current world's physical state. Retrieval settings are frozen with this run.</p>
<label *ngFor="let field of fields">{{field.label}} <input type="number" min="0" [max]="field.key==='maxChars'?32000:100" [(ngModel)]="config[field.key]"></label>
</fieldset>`,styles:[`label{display:block;margin:.4rem 0}p{font-size:.85rem}`]})
export class TaskHistoryControlsComponent {
 @Input() config:any=defaultTaskHistoryConfig();@Input() locked=false;
 fields=[{key:'recentCompleted',label:'Recent completed actions/tasks'},{key:'recentAdverse',label:'Recent failed, cancelled or interrupted tasks'},{key:'recentAttempts',label:'Recent rejected proposals'},{key:'relevant',label:'Relevant prior experience'},{key:'maxChars',label:'Maximum history context characters'}];
}
@Component({selector:'app-task-history',standalone:true,imports:[CommonModule,FormsModule],template:`
<details><summary><strong>Task History — verified events and unverified reports</strong></summary>
<p>Historical evidence is separate from subjective memory and present-world conditions. Reports and rejected proposals are not verified achievements.</p>
<label>Agent ID <input aria-label="Task history agent ID" [(ngModel)]="agentId" list="task-history-agents" (change)="inspect()"></label>
<datalist id="task-history-agents"><option *ngFor="let agent of agents" [value]="agent.id">{{agent.name}}</option><option *ngFor="let id of participantIds" [value]="id"></option></datalist>
<label>Run ID (optional) <input aria-label="Task history run ID" [(ngModel)]="runId" (change)="inspect()"></label>
<label>Status <select aria-label="Task history status" [(ngModel)]="status" (change)="inspect()"><option value="">All statuses</option><option *ngFor="let value of statuses" [value]="value">{{value}}</option></select></label>
<button (click)="inspect()" [disabled]="!agentId || loading">Inspect task history</button>
<p *ngIf="error" role="alert">{{error}}</p><p *ngIf="loading" role="status">Loading task evidence…</p>
<p *ngIf="result">{{result.total}} records · Showing {{result.records.length}}</p>
<p *ngIf="result?.total===0">No task history recorded for these filters.</p>
<article *ngFor="let record of result?.records" [attr.data-verification]="record.verification">
<h4>{{record.description}}</h4><p>{{record.agentId}} · Run {{record.runId}} · {{record.taskType}} <span *ngIf="record.taskId">· {{record.taskId}}</span></p>
<p><strong>{{record.status}} / {{record.outcome}}</strong> · Evidence: {{record.verification}}</p>
<p>Roles: {{record.roles.join(', ') || 'None'}} · Related agents: {{record.relatedAgentIds.join(', ') || 'None'}}</p>
<p>Started: {{time(record.startedAtMinute)}} · Finished: {{time(record.finishedAtMinute)}} · Turn: {{record.turnIndex ?? 'Unknown'}}</p>
<p *ngIf="record.reason">{{record.reason}}</p>
<details><summary>Authoritative sources, contributions and resource evidence</summary>
<p>Source events</p><pre>{{record.sourceEventIds | json}}</pre><p>Rejected-attempt diagnostic sources</p><pre>{{record.attemptEventIds | json}}</pre>
<p>Configured input requirements (consumption requires evidence below)</p><pre>{{record.inputs | json}}</pre><p>Verified outputs</p><pre>{{record.outputs | json}}</pre>
<p>This agent's contributions</p><pre>{{record.contributions | json}}</pre><p>Recorded effects</p><pre>{{record.evidence | json}}</pre></details>
</article>
<button *ngIf="result && result.offset>0" (click)="inspect(result.offset-50)" [disabled]="loading">Previous</button>
<button *ngIf="result && result.offset+result.records.length<result.total" (click)="inspect(result.offset+50)" [disabled]="loading">Next</button>
</details>`,styles:[`label{display:block;margin:.4rem 0}article{border-top:1px solid #ccc;padding:.5rem 0}article[data-verification=agent_reported],article[data-verification=absent]{border-left:3px solid #a66;padding-left:.5rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}p{font-size:.85rem}details{margin:.7rem 0}`]})
export class TaskHistoryComponent implements OnChanges,OnDestroy {
 @Input() agents:AgentIdentity[]=[];@Input() participantIds:string[]=[];@Input() refreshToken:any;
 agentId='';runId='';status='';result:any;error='';loading=false;
 statuses=['planned','attempted','in_progress','completed','failed','cancelled','interrupted'];
 private request?:Subscription;
 constructor(private service:AgentService){}
 ngOnChanges(changes:SimpleChanges){if(this.agentId&&changes['refreshToken'])this.inspect(this.result?.offset??0);}
 inspect(offset=0){if(!this.agentId.trim())return;this.request?.unsubscribe();this.loading=true;this.error='';
  this.request=this.service.getTaskHistory(this.agentId.trim(),{runId:this.runId.trim(),status:this.status,limit:50,offset}).subscribe({next:result=>{this.result=result;this.loading=false;},error:err=>{this.error=err.error?.error||'Could not load task history.';this.loading=false;}});
 }
 time(minute:number|null){return minute===null||minute===undefined?'Unknown':`Day ${Math.floor(minute/1440)+1} ${String(Math.floor(minute%1440/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;}
 ngOnDestroy(){this.request?.unsubscribe();}
}
