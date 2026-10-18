import {Component,Input} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
@Component({selector:'app-operational-controls',standalone:true,imports:[CommonModule,FormsModule],template:`
<fieldset [disabled]="locked"><legend>Location & activity</legend>
<label><input type="checkbox" [(ngModel)]="config.enabled"> Enable operational turns</label>
<p>Recorded actions and location changes do not verify physical reachability or completed work. Unspecified location is always available.</p>
<label>Observation policy <select [(ngModel)]="config.observationPolicy"><option value="self_only">Own state only</option><option value="co_located">Recorded states at the same named location</option></select></label>
<div *ngFor="let location of config.locations; index as i">
<label>Location ID <input [(ngModel)]="location.id" maxlength="120"></label>
<label>Name <input [(ngModel)]="location.name" maxlength="200"></label>
<label>Context <textarea [(ngModel)]="location.description" maxlength="1000"></textarea></label>
<button (click)="remove(i)">Remove location</button></div>
<button (click)="add()" [disabled]="config.locations.length >= 30">Add location</button>
</fieldset>`})
export class OperationalControlsComponent {
 @Input() config:any={enabled:true,locations:[],observationPolicy:'self_only'};
 @Input() locked=false;
 add(){if(!this.locked&&this.config.locations.length<30)this.config.locations.push({id:'',name:'',description:''});}
 remove(index:number){if(!this.locked)this.config.locations.splice(index,1);}
}
