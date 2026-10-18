import {Component,Input,Output,EventEmitter} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
@Component({selector:'app-world-state',standalone:true,imports:[CommonModule,FormsModule],template:`
<details *ngIf="state" open><summary>World State — {{time(state.minute)}}</summary>
<p>Revision {{state.revision}}. World facts are separate from agent beliefs. Model sampling remains variable.</p>
<h4>Locations and wake state</h4><div *ngFor="let position of state.positions | keyvalue">{{position.key}}: {{position.value}} · {{state.waits[$any(position.key)] ? ('waiting ' + json(state.waits[$any(position.key)])) : 'eligible'}} <button [disabled]="running || !actor.trim() || !reason.trim()" (click)="wake.emit({agentId:position.key,actor,reason})">Request next turn</button></div>
<h4>Inventories</h4><div *ngFor="let inventory of state.inventories"><strong>{{inventory.id}}</strong> · {{inventory.ownerType}} {{inventory.ownerId}} · {{inventory.visibility}}<pre>{{inventory.quantities | json}}</pre></div>
<h4>Environmental state</h4><pre>{{state.environment | json}}</pre>
<h4>Upcoming scheduled occurrences</h4><div *ngFor="let event of upcoming()">{{event.id}} · {{time(event.minute)}}</div>
<h4>Deterministic researcher controls</h4><label>Researcher <input [(ngModel)]="actor" [disabled]="running"></label><label>Reason <input [(ngModel)]="reason" [disabled]="running"></label>
<label>Advance to absolute simulation minute <input type="number" [min]="state.minute" [(ngModel)]="advanceMinute" [disabled]="running"></label><button [disabled]="running || !actor.trim() || !reason.trim()" (click)="advance.emit({minute:advanceMinute,actor,reason})">Advance time</button>
</details>`,styles:[`pre{white-space:pre-wrap;overflow-wrap:anywhere}label{display:block}details{margin:1rem 0}button{margin:.25rem}`]})
export class WorldStateComponent {
 @Input() state:any;@Input() config:any;@Input() running=false;
 @Output() advance=new EventEmitter<any>();@Output() wake=new EventEmitter<any>();
 actor='';reason='';advanceMinute=0;json=JSON.stringify;
 time(minute:number){return 'Day '+(Math.floor(minute/1440)+1)+' '+String(Math.floor(minute%1440/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');}
 upcoming(){return (this.config?.events??[]).flatMap((event:any)=>Array.from({length:event.occurrences},(_,i)=>({id:event.id+':'+i,minute:event.atMinute+i*(event.intervalMinutes??0)}))).filter((event:any)=>!this.state.executed.includes(event.id)).sort((a:any,b:any)=>a.minute-b.minute||(a.id<b.id?-1:1)).slice(0,30);}
}
