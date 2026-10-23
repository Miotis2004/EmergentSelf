import {Component,Input,Output,EventEmitter,OnChanges} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {ExperimentService} from './services/experiment.service';
@Component({selector:'app-operational-controls',standalone:true,imports:[CommonModule,FormsModule],template:`
<fieldset [disabled]="locked"><legend>Location & activity</legend>
<label><input type="checkbox" [(ngModel)]="config.enabled"> Enable operational turns</label>
<p>Recorded actions do not verify physical reachability or completed work. Optional World Simulation connectivity enforces movement. Unspecified location is always available.</p>
<label>Observation policy <select [(ngModel)]="config.observationPolicy"><option value="self_only">Own state only</option><option value="co_located">Recorded states at the same named location</option></select></label>
<label for="location-json">Locations JSON (version and locations)</label>
<textarea id="location-json" aria-label="Locations JSON" rows="12" spellcheck="false" [value]="draft" (input)="edit($any($event.target).value)"></textarea>
<button type="button" (click)="validate()" [disabled]="busy">Validate JSON</button>
<button type="button" (click)="copy()">Copy JSON</button>
<p role="alert" *ngIf="error">{{error}}</p><p role="status" *ngIf="message">{{message}}</p>
<p>Paste &#123;"version":1,"locations":[...]&#125; with up to 1000 defined rooms. Each room requires id and name; description is optional. Validated rooms are saved with the experiment. Invalid text is retained and blocks starting a new operational experiment.</p>
</fieldset>`,styles:[`textarea{width:100%;box-sizing:border-box;font-family:monospace}label{display:block;margin:.5rem 0}[role=alert]{color:#a00}`]})
export class OperationalControlsComponent implements OnChanges {
 @Input() config:any={enabled:true,locations:[],observationPolicy:'self_only'};@Input() locked=false;
 @Output() validityChange=new EventEmitter<boolean>();draft='';error='';message='';busy=false;private revision=0;
 constructor(private experiments:ExperimentService){}
 ngOnChanges(){this.revision++;this.draft=JSON.stringify({version:1,locations:this.config.locations??[]},null,2);this.error='';this.message='';this.validityChange.emit(true);}
 ngOnInit(){if(!this.draft)this.ngOnChanges();}
 edit(text:string){if(this.locked)return;this.revision++;this.draft=text;this.message='';this.error='Validate JSON before starting.';this.validityChange.emit(false);}
 validate(){if(this.locked||this.busy)return;let parsed:any;try{parsed=JSON.parse(this.draft);}catch{this.error='/: invalid JSON syntax';this.validityChange.emit(false);return;}
 const revision=this.revision;this.busy=true;this.error='';
 this.experiments.validateLocations(parsed).subscribe({next:document=>{this.busy=false;if(revision!==this.revision||this.locked)return;this.config.locations=document.locations;this.error='';this.message='Locations JSON is valid.';this.validityChange.emit(true);},error:error=>{this.busy=false;if(revision!==this.revision||this.locked)return;this.error=error?.error?.error||'Could not validate locations';this.validityChange.emit(false);}});
 }
 async copy(){try{await navigator.clipboard.writeText(this.draft);this.message='Copied complete editor text.';}catch{this.message='Select the JSON text and copy it with your keyboard.';}}
}
