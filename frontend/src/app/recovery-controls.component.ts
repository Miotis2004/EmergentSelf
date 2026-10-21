import {Component,Input} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
export const defaultRecoveryConfig=()=>({onCorrectiveExhaustion:'suspend',enabled:true,correctiveRetries:3,technicalRetries:5,initialBackoffMs:2000,maxBackoffMs:60000,persistentConnectivityRecovery:true,persistentRetryIntervalMs:60000,auditRejectedAttempts:true});
@Component({selector:'app-recovery-controls',standalone:true,imports:[CommonModule,FormsModule],template:`
<fieldset [disabled]="locked"><legend>Error Recovery</legend>
<label><input type="checkbox" [(ngModel)]="config.enabled"> Automatic recovery</label>
<div *ngIf="config.enabled">
<label>Corrective retries per logical turn <input type="number" min="0" max="20" [(ngModel)]="config.correctiveRetries"></label>
<label>When corrective retries are exhausted <select [ngModel]="config.onCorrectiveExhaustion ?? 'suspend'" (ngModelChange)="config.onCorrectiveExhaustion=$event"><option value="suspend">Suspend experiment (default)</option><option value="record_idle_incomplete_and_advance">Record IDLE / INCOMPLETE and continue</option></select></label>
<p>Automatic continuation consumes the agent's scheduled turn without committing rejected actions. It is a system-imposed incomplete turn, not an agent-selected idle decision. At least one corrective retry must fail; a zero retry budget suspends on the first rejection. Technical failures never forfeit turns.</p>
<label>Short technical retries <input type="number" min="0" max="20" [(ngModel)]="config.technicalRetries"></label>
<label>Initial backoff (milliseconds) <input type="number" min="1" max="60000" [(ngModel)]="config.initialBackoffMs"></label>
<label>Maximum backoff (milliseconds) <input type="number" [min]="config.initialBackoffMs" max="300000" [(ngModel)]="config.maxBackoffMs"></label>
<label><input type="checkbox" [(ngModel)]="config.persistentConnectivityRecovery"> Keep recovering while the model is unavailable</label>
<label>Persistent retry interval (milliseconds) <input type="number" min="1000" max="3600000" [(ngModel)]="config.persistentRetryIntervalMs"></label>
<label><input type="checkbox" [(ngModel)]="config.auditRejectedAttempts"> Detailed rejected-attempt audit</label>
<p>Defaults: 2-second initial backoff, 60-second maximum and persistent interval. Essential rejection evidence is always retained. Retry attempts do not advance simulation time. Exhausted corrections follow the selected policy; unsafe storage suspends safely; Stop and Pause interrupt recovery.</p>
<p *ngIf="!valid(config)" role="alert">Select a valid exhaustion policy and enter valid integer limits. Maximum backoff must be at least initial backoff.</p>
</div></fieldset>`,styles:[`label{display:block;margin:.5rem 0}p{font-size:.85rem}`]})
export class RecoveryControlsComponent {
 @Input() config:any=defaultRecoveryConfig();@Input() locked=false;
 static valid(config:any){return [['correctiveRetries',0,20],['technicalRetries',0,20],['initialBackoffMs',1,60000],['maxBackoffMs',1,300000],['persistentRetryIntervalMs',1000,3600000]].every(([key,min,max])=>Number.isInteger(config[key])&&config[key]>=Number(min)&&config[key]<=Number(max))&&config.maxBackoffMs>=config.initialBackoffMs&&['suspend','record_idle_incomplete_and_advance'].includes(config.onCorrectiveExhaustion===undefined?'suspend':config.onCorrectiveExhaustion);}
 valid=RecoveryControlsComponent.valid;
}
