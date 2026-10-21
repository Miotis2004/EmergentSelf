import {Component,Input} from '@angular/core';
import {CommonModule} from '@angular/common';
@Component({selector:'app-turn-forfeiture',standalone:true,imports:[CommonModule],styles:[`aside{padding:10px;border-left:4px solid #9b6617;background:#fff5e6}p{margin:.4rem 0}li{overflow-wrap:anywhere}`],template:`
<aside *ngIf="turn.completionSource==='system_fallback'" aria-label="System-imposed incomplete turn">
<strong>Turn {{turn.turnIndex}} · {{turn.agentName || turn.agentId}} · IDLE / INCOMPLETE</strong>
<p>System fallback: corrective retries exhausted after {{turn.attemptCount}} attempts. This was not an agent-selected idle decision. No rejected dialogue, memory or actions were committed.</p>
<p>Previously committed activity is preserved. Normal simulation time passes; existing world processes may progress.</p>
<details><summary>Validation failures and rejected attempts</summary><p>{{turn.failureCodes?.join(', ')}}</p><ul><li *ngFor="let id of turn.attemptEventIds"><a [attr.href]="'#'+id">{{id}}</a></li></ul></details>
</aside>`})
export class TurnForfeitureComponent {@Input() turn:any={};}
