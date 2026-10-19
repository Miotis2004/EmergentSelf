import {Component,Input} from '@angular/core';
import {CommonModule} from '@angular/common';
@Component({selector:'app-recovery-status',standalone:true,imports:[CommonModule],template:`
<aside *ngIf="state && state.phase!=='idle'" role="status" aria-live="polite" [class.suspended]="state.phase==='suspended'">
<strong>{{labels[state.phase] || state.phase}}</strong><span *ngIf="state.turnIndex !== undefined"> · Turn {{state.turnIndex}} · {{agentLabel || state.agentId}}</span>
<div *ngIf="state.correctiveRetry && state.phase==='correcting'">Corrective retry {{state.correctiveRetry}} of {{state.correctiveLimit}}</div>
<div *ngIf="state.budgetExhausted">Corrective retry budget exhausted ({{state.correctiveLimit}} retries). Inspect rejected attempts before Resume.</div>
<div *ngIf="state.reason">{{state.code}}: {{state.reason}}</div><div *ngIf="state.nextRetryAt && (state.phase==='waiting' || state.phase==='retrying')">Next attempt: {{state.nextRetryAt | date:'mediumTime'}}</div>
<div *ngIf="state.simulationMinute !== undefined">Simulation time: Day {{day(state.simulationMinute)}} {{clock(state.simulationMinute)}}</div>
</aside>`,styles:[`:host{flex-shrink:0;max-height:18dvh;overflow:auto}aside{padding:8px;background:#edf3fa;border-left:3px solid #426e98;font-size:.85rem}.suspended{background:#fff3e2;border-color:#985c15}`]})
export class RecoveryStatusComponent {
 @Input() state:any;@Input() agentLabel='';
 labels:Record<string,string>={idle_wait:'Waiting for world events',repairing:'Repairing turn storage',generating:'Generating turn',correcting:'Correcting rejected proposal',retrying:'Retrying inference',waiting:'Waiting for LLM reconnection',suspended:'Safely suspended — researcher intervention required',paused:'Paused by researcher',stopped:'Stopped by researcher'};
 day(minute:number){return Math.floor(minute/1440)+1;}clock(minute:number){return String(Math.floor(minute%1440/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');}
}
@Component({selector:'app-recovery-audit',standalone:true,imports:[CommonModule],template:`
<details (toggle)="open=$any($event.target).open"><summary>Attempt {{event.attemptNumber}} · {{event.code}} · {{event.recoveryAction}}</summary>
<p>Turn {{event.logicalTurnIndex}} · {{event.agentId}} · committed: {{event.stateCommitted === null ? 'unknown' : event.stateCommitted}} · repeated violation: {{event.repeatedViolation}}</p>
<div *ngIf="open"><p>{{event.explanation}}</p><pre>{{event.proposedOperations | json}}</pre><details *ngIf="event.proposal"><summary>Original rejected proposal</summary><pre>{{event.proposal | json}}</pre></details><pre *ngIf="event.correctionMessage">{{event.correctionMessage}}</pre><details><summary>Original inference evidence</summary><pre>{{event.attempt | json}}</pre></details></div>
</details>`,styles:[`pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.8rem}`]})
export class RecoveryAuditComponent {@Input() event:any;open=false;}
