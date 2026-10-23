import {Component,Input,Output,EventEmitter,OnChanges,SimpleChanges} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {ExperimentService} from './services/experiment.service';
@Component({selector:'app-competition-controls',standalone:true,imports:[CommonModule,FormsModule],template:`
<fieldset [disabled]="locked"><legend>Optional team competition</legend>
<p>Paste a complete version-1 competition object. Use null to disable and omit competition rules. Teams come from Decisions, scheduling and communication. Configuration validation does not change a running experiment.</p>
<label for="competition-json">Competition JSON</label><textarea id="competition-json" aria-label="Competition JSON" rows="10" spellcheck="false" [value]="draft" (input)="edit($any($event.target).value)"></textarea>
<button type="button" (click)="validate()" [disabled]="busy">Validate competition JSON</button>
<p role="alert" *ngIf="error">Configuration error: {{error}}</p><p role="status">{{message}}</p>
<p>See the User Guide competition chapter for a full example. Empty eligibleRecipeIds means all configured recipes; empty eligibleAgentIds means all participating team members. Workspace eligibility must be explicit. Shared victory uses simulated completion time.</p>
</fieldset>`,styles:[`textarea{width:100%;box-sizing:border-box;font-family:monospace}[role=alert]{color:#a00}`]})
export class CompetitionControlsComponent implements OnChanges {
 @Input() world:any;@Input() operational:any;@Input() scheduling:any;@Input() communication:any;@Input() agentIds:string[]=[];@Input() locked=false;
 @Output() validityChange=new EventEmitter<boolean>();draft='null';error='';message='';busy=false;private revision=0;private loaded:any;
 constructor(private experiments:ExperimentService){}
 ngOnChanges(changes:SimpleChanges){if(changes['world']||this.world?.competition!==this.loaded){this.loaded=this.world?.competition;this.draft=JSON.stringify(this.loaded??null,null,2);this.revision++;this.error='';this.validityChange.emit(true);}}
 edit(text:string){if(this.locked)return;this.draft=text;this.revision++;this.error='Validate competition JSON before starting.';this.message='';this.validityChange.emit(false);}
 private request(competition:any){return {competition,worldConfig:this.world,operationalConfig:this.operational,schedulingConfig:this.scheduling,communicationConfig:this.communication,agentIds:this.agentIds};}
 validate(){if(this.locked||this.busy)return;let value:any;try{value=JSON.parse(this.draft);}catch{this.error='/: invalid JSON syntax';this.validityChange.emit(false);return;}
 if(value===null){delete this.world.competition;this.loaded=undefined;this.error='';this.message='Competition disabled.';this.validityChange.emit(true);return;}
 const revision=this.revision,request=this.request(value),fingerprint=JSON.stringify(request);this.busy=true;
 this.experiments.validateCompetition(request).subscribe({next:result=>{this.busy=false;if(revision!==this.revision||this.locked||fingerprint!==JSON.stringify(this.request(value)))return;this.world.competition=result;this.loaded=result;this.error='';this.message='Competition configuration is valid.';this.validityChange.emit(true);},error:error=>{this.busy=false;if(revision!==this.revision||this.locked)return;this.error=error?.error?.error||'Validation request failed';this.validityChange.emit(false);}});
 }
}
