import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ExperimentService } from './services/experiment.service';

@Component({selector:'app-social-controls',standalone:true,imports:[CommonModule,FormsModule],template:`
  <details><summary><strong>Social interaction, tasks & feedback</strong></summary>
    <fieldset [disabled]="locked"><legend>Next experiment (frozen when started)</legend>
      <label><input type="checkbox" [(ngModel)]="social.enabled">Enable explicit addressing and decline decisions</label>
      <p>Addressed speech remains public. Relationship memories are private to their owner. Three or more selected agents use the same sequential model endpoint.</p>
      <label>Task <select [(ngModel)]="task.kind"><option value="none">No task</option><option value="public_goods">Cooperative public goods</option><option value="resource_race">Competitive resource race</option></select></label>
      <div *ngIf="task.kind !== 'none'">
        <label>Decision endowment <input type="number" min="1" max="100" [(ngModel)]="task.endowment"></label>
        <label *ngIf="task.kind === 'public_goods'">Pool multiplier <input type="number" min="1.01" max="5" step="0.1" [(ngModel)]="task.multiplier"></label>
        <label *ngIf="task.kind === 'resource_race'">Prize <input type="number" min="0" max="1000" [(ngModel)]="task.prize"></label>
        <p *ngIf="task.kind === 'public_goods'">Each active participant chooses a contribution. Net score = multiplier × total contributions / selected participant count − own contribution. Decline scores zero.</p>
        <p *ngIf="task.kind === 'resource_race'">Each active participant chooses a bid. Net score = −bid + prize / number of highest bidders for winners; others pay their bid. Ties at zero also split the prize. Decline scores zero.</p>
        <p>One decision per participant per round. Outcomes settle after the round; structured amounts are hidden until settlement, but speech can reveal them. Scores do not measure moral understanding.</p>
      </div>
      <label><input type="checkbox" [(ngModel)]="feedback.enabled">Enable environmental feedback (off for baseline)</label>
      <div *ngIf="feedback.enabled">
        <label>Feedback source <select [(ngModel)]="feedback.source"><option value="researcher">Researcher</option><option value="task">Task outcomes</option><option value="both">Both</option></select></label>
        <label>Delivery <select [(ngModel)]="feedback.timing"><option value="immediate">Immediate (next eligible turn)</option><option value="delayed">Delayed</option></select></label>
        <label *ngIf="feedback.timing === 'delayed'">Additional scheduled turns before delivery <input type="number" min="1" max="1000" [(ngModel)]="feedback.delayTurns"></label>
        <label>Visibility <select [(ngModel)]="feedback.visibility"><option value="private">Private to target agent</option><option value="public">Public to participants</option></select></label>
        <label>Positive researcher score <input type="number" min="0.01" max="1000" [(ngModel)]="feedback.positiveScore"></label>
        <label>Negative researcher score <input type="number" min="-1000" max="-0.01" [(ngModel)]="feedback.negativeScore"></label>
        <label>Maximum visible feedback records per prompt <input type="number" min="1" max="100" [(ngModel)]="feedback.maxVisible"></label>
        <p>Feedback is supplied as data and never directly changes stats or memory. Task rewards use the task formula, without scaling by researcher scores.</p>
      </div>
    </fieldset>
    <fieldset [disabled]="running || busy || !runId"><legend>Researcher feedback on a saved decision</legend>
      <p>Pause the run first. Feedback requires researcher feedback to be enabled in its saved configuration.</p>
      <label>Unique feedback ID <input [(ngModel)]="feedbackId"></label>
      <label>Agent ID <input [(ngModel)]="agentId"></label>
      <label>Committed decision turn <input type="number" min="0" [(ngModel)]="turnIndex"></label>
      <label>Valence <select [(ngModel)]="valence"><option value="positive">Positive</option><option value="negative">Negative</option></select></label>
      <label>Researcher <input [(ngModel)]="actor"></label><label>Evidence / rationale <textarea [(ngModel)]="reason" maxlength="2000"></textarea></label>
      <button (click)="record()">Record immutable feedback</button>
    </fieldset><p role="alert" *ngIf="error">{{error}}</p><p role="status" *ngIf="message">{{message}}</p>
  </details>`,styles:[`:host{display:block;margin:12px 0}label{display:block;margin:8px 0}input:not([type=checkbox]),select,textarea{width:100%;box-sizing:border-box}fieldset{margin:10px 0}[role=alert]{color:#8a1010}`]})
export class SocialControlsComponent {
  @Input() social:any;@Input() task:any;@Input() feedback:any;
  @Input() locked=false;@Input() running=false;@Input() runId='';
  @Output() recorded=new EventEmitter<any>();
  feedbackId='';agentId='';turnIndex=0;valence='positive';actor='';reason='';busy=false;error='';message='';
  constructor(private experiments:ExperimentService){}
  record(){if(this.running||this.busy||!this.runId)return;this.busy=true;this.error='';this.message='';
    this.experiments.research('POST',`/runs/${encodeURIComponent(this.runId)}/feedback`,{feedbackId:this.feedbackId,agentId:this.agentId,turnIndex:this.turnIndex,valence:this.valence,actor:this.actor,reason:this.reason}).subscribe({next:event=>{this.busy=false;this.message=`Recorded score ${event.score}; eligible from turn ${event.deliverFromTurn}.`;this.recorded.emit(event);},error:e=>{this.busy=false;this.error=e?.error?.error||e.message||'Feedback request failed';}});
  }
}
