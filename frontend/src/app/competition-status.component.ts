import {Component,Input} from '@angular/core';
import {CommonModule} from '@angular/common';
@Component({selector:'app-competition-status',standalone:true,imports:[CommonModule],template:`
<section *ngIf="world?.competition as c" aria-label="Authoritative competition status">
<h3>Team competition · {{c.phase}}</h3><p>Researcher-visible authoritative state. Hidden team knowledge is not sent to agents.</p>
<p>Start minute {{config?.startMinute}} · Deadline {{config?.deadlineMinute ?? 'none'}}</p>
<div *ngFor="let team of c.teams"><strong>{{team.name}} ({{team.id}})</strong> · {{team.agentIds.join(', ')}}<div *ngFor="let commitment of commitments(team.id)">Recipe {{commitment.recipeId}} · {{commitment.status}} · tasks {{commitment.taskIds.join(', ')}}</div><div *ngFor="let task of tasks(team.id)">Assembly {{task.id}} · {{task.recipeId}} · {{task.status}} · completion minute {{task.finishedMinute ?? task.completionMinute ?? 'not started'}}</div></div>
<div *ngIf="c.result as result" role="status"><h4>{{result.winningTeamIds.length ? (result.tie ? 'Shared verified victory' : 'Verified victory') : 'Competition ended without a winner'}}</h4><p>{{result.reason}} · minute {{result.simulationMinute}} · winning teams {{result.winningTeamIds.join(', ') || 'none'}}</p><div *ngFor="let evidence of result.evidence">Recipe {{evidence.recipeId}} · task {{evidence.taskId}} · agents {{evidence.participantAgentIds.join(', ')}} · completion evidence {{evidence.completionEventId}}</div><details><summary>Final team progress and evidence</summary><pre>{{result | json}}</pre></details></div>
</section>`})
export class CompetitionStatusComponent {@Input() world:any;@Input() config:any;commitments(id:string){return this.world.competition.commitments.filter((c:any)=>c.teamId===id);}tasks(id:string){return (this.world.transformations?.tasks??[]).filter((t:any)=>t.competitionTeamId===id);}}
