import {Component,Input,OnChanges} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
export const decisionModes=['plan','observe','act','idle','change_location','communicate','reflect'];
export function defaultInteraction(){return {decisionConfig:{version:1,mode:'agent_selected',availableModes:[...decisionModes]},schedulingConfig:{version:1,mode:'round_robin',seed:0,algorithm:'mulberry32-fisher-yates-v1',teamSelection:'round_robin',memberSelection:'round_robin',teams:[] as any[]},communicationConfig:{version:1,defaultScope:'global',allowPrivateMessages:true,allowTeamMessages:false,allowLocalMessages:false,allowGlobalMessages:true}};}
@Component({selector:'app-interaction-controls',standalone:true,imports:[CommonModule,FormsModule],styles:[`fieldset{margin:12px 0}label{display:block;margin:6px}input[type=checkbox]{width:auto}.error{color:#a00}.team{border:1px solid #aaa;padding:8px;margin:8px}`],template:`
<fieldset [disabled]="locked"><legend>Decisions, scheduling and communication</legend>
<p *ngIf="legacy">Saved legacy settings: missing configuration retains the original transport, scheduler and visibility.</p>
<label>Decision policy <select [(ngModel)]="config.decisionConfig.mode"><option value="agent_selected">Agent-selected</option><option value="unrestricted">Unrestricted</option></select></label>
<div *ngIf="config.decisionConfig.mode==='agent_selected'"><label *ngFor="let mode of modes"><input type="checkbox" [checked]="config.decisionConfig.availableModes.includes(mode)" (change)="toggleMode(mode,$any($event.target).checked)">{{mode}}</label></div>
<label>Scheduling <select [(ngModel)]="config.schedulingConfig.mode"><option value="round_robin">Round Robin</option><option value="randomized">Randomized</option><option value="team_round_robin">Team Round Robin</option><option value="event_driven">Legacy Event Driven</option></select></label>
<label *ngIf="config.schedulingConfig.mode==='randomized'">Random seed <input type="number" min="0" max="4294967295" step="1" [(ngModel)]="config.schedulingConfig.seed"></label>
<details [open]="config.schedulingConfig.mode==='team_round_robin'"><summary>Static teams (independent of physical location)</summary>
<button type="button" (click)="addTeam()">Create team</button>
<div class="team" *ngFor="let team of config.schedulingConfig.teams;let i=index"><label>Team ID <input [(ngModel)]="team.id"></label><label>Team name <input [(ngModel)]="team.name"></label><label *ngFor="let id of agentIds"><input type="checkbox" [checked]="team.agentIds.includes(id)" (change)="assign(team,id,$any($event.target).checked)">{{label(id)}}</label><button type="button" (click)="removeTeam(i)">Remove team</button></div>
<p>Unassigned: {{unassigned.join(', ') || 'None'}}</p><pre>{{config.schedulingConfig.teams | json}}</pre></details>
<label *ngFor="let scope of scopes"><input type="checkbox" [(ngModel)]="config.communicationConfig[key(scope)]">Allow {{scope}} messages</label>
<label>Default scope <select [(ngModel)]="config.communicationConfig.defaultScope"><option *ngFor="let scope of scopes" [value]="scope" [disabled]="!config.communicationConfig[key(scope)]">{{scope}}</option></select></label>
<p>Scope is selected explicitly by the agent. Team/local/global audiences are resolved by the backend. Researcher audit includes all channels.</p>
<p class="error" role="status" *ngIf="error">{{error}}</p></fieldset>`})
export class InteractionControlsComponent implements OnChanges{
 @Input() config:any=defaultInteraction();@Input() locked=false;@Input() legacy=false;@Input() agentIds:string[]=[];@Input() agents:any[]=[];@Input() worldEnabled=false;@Input() taskKind='none';
 modes=decisionModes;scopes=['private','team','local','global'];
 ngOnChanges(changes:any){if(!this.locked&&!this.legacy&&(changes.worldEnabled||changes.config)){const c=this.config.communicationConfig;c.allowLocalMessages=this.worldEnabled;c.allowGlobalMessages=!this.worldEnabled&&!this.config.schedulingConfig.teams.length;c.defaultScope=this.config.schedulingConfig.teams.length?'team':this.worldEnabled?'local':'global';}}
 key(scope:string){return 'allow'+scope[0].toUpperCase()+scope.slice(1)+'Messages';}
 label(id:string){return this.agents.find(a=>a.id===id)?.name+' ('+id+')';}
 toggleMode(mode:string,checked:boolean){if(this.locked)return;this.config.decisionConfig.availableModes=this.modes.filter(m=>m===mode?checked:this.config.decisionConfig.availableModes.includes(m));}
 addTeam(){if(this.locked)return;let n=1;while(this.config.schedulingConfig.teams.some((t:any)=>t.id==='team-'+n))n++;if(!this.config.schedulingConfig.teams.length)this.config.communicationConfig.allowGlobalMessages=false;this.config.schedulingConfig.teams.push({id:'team-'+n,name:'Team '+n,agentIds:[]});this.config.communicationConfig.allowTeamMessages=true;this.config.communicationConfig.defaultScope='team';}
 removeTeam(i:number){if(!this.locked)this.config.schedulingConfig.teams.splice(i,1);}
 assign(team:any,id:string,checked:boolean){if(!this.locked)team.agentIds=this.agentIds.filter(a=>a===id?checked:team.agentIds.includes(a));}
 get unassigned(){return this.agentIds.filter(id=>!this.config.schedulingConfig.teams.some((t:any)=>t.agentIds.includes(id)));}
 get error(){return InteractionControlsComponent.validate(this.config,this.agentIds,this.worldEnabled,this.taskKind);}
 static validate(c:any,ids:string[],world:boolean,task:string){
  if(c.decisionConfig.mode==='agent_selected'&&!c.decisionConfig.availableModes.length)return 'Select at least one decision mode.';
  const s=c.schedulingConfig,teams=s.teams,members=teams.flatMap((t:any)=>t.agentIds);
  if(s.mode==='randomized'&&(!Number.isInteger(s.seed)||s.seed<0||s.seed>4294967295))return 'Seed must be an integer from 0 to 4294967295.';
  if(new Set(teams.map((t:any)=>t.id)).size!==teams.length||teams.some((t:any)=>!/^[A-Za-z0-9_-]{1,120}$/.test(t.id)||!t.name.trim()||t.id.length>120||t.name.length>120||!t.agentIds.length)||new Set(members).size!==members.length||members.some((id:string)=>!ids.includes(id)))return 'Teams need unique IDs, names and nonempty, nonduplicated participating members.';
  const cc=c.communicationConfig;
  if((s.mode==='team_round_robin'||cc.allowTeamMessages)&&(!teams.length||ids.some(id=>!members.includes(id))))return 'Assign each participant to exactly one team.';
  if(cc.allowLocalMessages&&!world)return 'Local communication requires an enabled world.';
  if(!cc['allow'+cc.defaultScope[0].toUpperCase()+cc.defaultScope.slice(1)+'Messages'])return 'Default scope must be enabled.';
  if(s.mode==='event_driven'&&!world)return 'Event-driven scheduling requires a world.';
  if(task!=='none'&&s.mode!=='round_robin')return 'Legacy social tasks require original round-robin scheduling.';
  return '';
 }
}
