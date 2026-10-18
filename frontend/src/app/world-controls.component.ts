import {Component,Input,Output,EventEmitter} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
export function defaultWorldConfig(){return {version:1,enabled:false,initialMinute:0,minutesPerTurn:15,initialPositions:{},items:[],inventories:[],events:[],observationPolicy:'local',communicationPolicy:'local',schedulingMode:'round_robin'};}
@Component({selector:'app-world-controls',standalone:true,imports:[CommonModule,FormsModule],template:`
<fieldset [disabled]="locked"><legend>World Simulation</legend>
<label><input type="checkbox" [(ngModel)]="config.enabled"> Enable deterministic world simulation</label>
<p>Uses the locations in Location & activity; enable operational turns above. Time uses a day-one simulation calendar independent of wall time. Quantities are nonnegative integer units.</p>
<div *ngIf="config.enabled">
<label>Initial simulation day <input type="number" min="1" [ngModel]="day" (ngModelChange)="setTime($event, time)"></label>
<label>Initial simulation time <input type="time" [ngModel]="time" (ngModelChange)="setTime(day, $event)"></label>
<label>Minutes per successful turn <input type="number" min="1" max="10080" [(ngModel)]="config.minutesPerTurn"></label>
<label>Turn scheduling <select [(ngModel)]="config.schedulingMode"><option value="round_robin">Strict round-robin</option><option value="event_driven">Event-driven (wait until time/event)</option></select></label>
<label>Observation policy <select [(ngModel)]="config.observationPolicy"><option value="local">Colocated agents and authorized inventories</option><option value="self_only">Own state and authorized inventories</option></select></label>
<label>Communication policy <select [(ngModel)]="config.communicationPolicy"><option value="local">Local communication only</option><option value="global">Global research transcript</option></select></label>
<p>Selected participants: {{agentIds.join(', ')}}. Initial positions map participant IDs to existing location IDs. Inventories require id, ownerType, ownerId, visibility (private/local/public), authorizedAgentIds, and quantities. Scheduled events require id, atMinute, occurrences, affectedAgentIds, observation and wake; recurrence also requires intervalMinutes.</p>
<label *ngFor="let field of fields">{{field.label}} (JSON)
<textarea rows="5" spellcheck="false" [attr.aria-label]="field.label" [value]="drafts[field.key] ?? json(config[field.key])" (input)="update(field.key, $any($event.target).value)"></textarea>
<span role="alert" *ngIf="errors[field.key]">{{errors[field.key]}}</span></label>
<p>Private inventories can be inspected by owners or explicitly authorized agents; physical transfers additionally require access at the current location. Scheduled environmental changes are configured here, never by agent narrative.</p>
</div></fieldset>`,styles:[`label{display:block;margin:.5rem 0}textarea{display:block;box-sizing:border-box;width:100%;font-family:monospace}p{font-size:.85rem}span{color:#a22}`]})
export class WorldControlsComponent {
 @Input() config:any=defaultWorldConfig();@Input() locked=false;@Input() agentIds:string[]=[];
 @Output() validityChange=new EventEmitter<boolean>();
 fields=[{key:'initialPositions',label:'Initial agent locations'},{key:'items',label:'Item catalog'},{key:'inventories',label:'Initial inventories'},{key:'events',label:'Scheduled events'}];
 drafts:Record<string,string>={};errors:Record<string,string>={};
 get day(){return Math.floor(this.config.initialMinute/1440)+1;}
 get time(){return String(Math.floor(this.config.initialMinute%1440/60)).padStart(2,'0')+':'+String(this.config.initialMinute%60).padStart(2,'0');}
 setTime(day:number,time:string){if(!this.locked&&Number.isInteger(day)&&day>=1&&/^\d{2}:\d{2}$/.test(time)){const [hour,minute]=time.split(':').map(Number);this.config.initialMinute=(day-1)*1440+hour*60+minute;}}
 json(value:any){return JSON.stringify(value,null,2);}
 update(key:string,text:string){if(this.locked)return;this.drafts[key]=text;try{const value=JSON.parse(text);if(key==='initialPositions'?(!value||Array.isArray(value)||typeof value!=='object'):!Array.isArray(value))throw Error('Wrong JSON shape');this.config[key]=value;delete this.errors[key];}catch{this.errors[key]='Enter valid '+(key==='initialPositions'?'object':'array')+' JSON before starting.';}this.validityChange.emit(Object.keys(this.errors).length===0);}
 ngOnChanges(){this.drafts={};this.errors={};this.validityChange.emit(true);}
}
