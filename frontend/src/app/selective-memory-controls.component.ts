import {Component,Input} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
@Component({selector:'app-selective-memory-controls',standalone:true,imports:[CommonModule,FormsModule],template:`
<fieldset [disabled]="locked"><legend>Memory retrieval and conversation continuity</legend>
<label for="memory-strategy">Retrieval strategy</label>
<select id="memory-strategy" [ngModel]="config.retrievalStrategy ?? 'bulk'" (ngModelChange)="strategy($event)">
<option value="bulk">Original bounded memory selection</option><option value="agent_query">Selective retrieval: agent queries</option></select>
<div *ngIf="config.retrievalStrategy==='agent_query'">
<p>Recent authorized messages are automatic. Agents may query their own memories and older experienced conversations using observe. Results arrive on their next turn. These controls apply to a new run; saved runs retain their settings.</p>
<div *ngFor="let field of limits"><label [for]="'selective-'+field.key">{{field.label}}</label>
<input type="number" [id]="'selective-'+field.key" [min]="field.min" [max]="field.max" step="1" [ngModel]="config[field.key] ?? defaults[field.key]" (ngModelChange)="set(field.key,$event)"></div>
<label><input type="checkbox" [ngModel]="config.allowConversationHistoryQuery ?? true" (ngModelChange)="set('allowConversationHistoryQuery',$event)"> Allow retrieval of older authorized conversations</label>
<small>Character budgets are separate from measured model tokens. Retrieval returns agent-authored records as historical data; confidence is not verification. Original JSON/JSONL records remain unchanged.</small>
</div></fieldset>`})
export class SelectiveMemoryControlsComponent {
 @Input() config:any={};@Input() locked=false;
 defaults:any={defaultMemoryEntries:4,defaultMemoryChars:2500,maxQueryResults:10,maxQueryChars:8000,conversationRecentMessages:12,conversationRecentChars:8000,allowConversationHistoryQuery:true,taskHistoryChars:1000};
 limits=[{key:'defaultMemoryEntries',label:'Default memory entries',min:0,max:100},{key:'defaultMemoryChars',label:'Default memory characters',min:0,max:32000},{key:'maxQueryResults',label:'Maximum query results',min:1,max:100},{key:'maxQueryChars',label:'Query result characters per turn',min:256,max:32000},{key:'conversationRecentMessages',label:'Recent authorized messages',min:1,max:100},{key:'conversationRecentChars',label:'Recent conversation characters',min:256,max:32000},{key:'taskHistoryChars',label:'Historical task context characters',min:0,max:8000}];
 strategy(value:string){if(this.locked)return;this.config.retrievalStrategy=value;if(value==='agent_query')for(const [key,defaultValue] of Object.entries(this.defaults))this.config[key]??=defaultValue;}
 set(key:string,value:any){if(!this.locked)this.config[key]=value;}
}
