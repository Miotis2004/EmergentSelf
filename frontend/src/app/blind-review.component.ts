import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ExperimentService } from './services/experiment.service';

@Component({
  selector:'app-blind-review',standalone:true,imports:[CommonModule,FormsModule],
  template:`<main><h1>Blinded behavioral review</h1>
    <p>Rate only the supplied response and context. Source metadata and answer keys are hidden; wording may reveal identity. Use “Insufficient evidence” when a dimension cannot be judged.</p>
    <p *ngIf="error" role="alert">{{error}}</p><p *ngIf="message" role="status">{{message}}</p>
    <fieldset [disabled]="busy"><label>Dataset ID <input [(ngModel)]="datasetId"></label><button (click)="load()">Load evaluation dataset</button></fieldset>
    <section *ngIf="dataset"><p>{{dataset.rubric.version}} · {{dataset.rubric.instructions}}</p>
      <label>Rater pseudonym <input [(ngModel)]="raterId" maxlength="200"></label>
      <label>Item <select [(ngModel)]="itemIndex" (ngModelChange)="reset()"><option *ngFor="let item of dataset.items;index as i" [ngValue]="i">Item {{i+1}}</option></select></label>
      <article *ngIf="item"><h2>Previous context</h2><p *ngFor="let text of item.context" class="verbatim">{{text}}</p><h2>Stimulus</h2><p class="verbatim">{{item.stimulus}}</p><h2>Response</h2><p class="verbatim">{{item.response}}</p></article>
      <fieldset [disabled]="busy || submitted.has(item.itemId)"><legend>Behavioral rubric</legend>
        <label *ngFor="let dimension of dataset.rubric.dimensions">{{dimension.label}}
          <select [(ngModel)]="scores[dimension.id]"><option [ngValue]="null">Insufficient evidence / not applicable</option><option *ngFor="let anchor of dimension.anchors;index as n" [ngValue]="n">{{n}} — {{anchor}}</option></select>
        </label>
        <p>Social behavior: select applicable tags, “none” alone, “unclear” alone, or leave all unchecked for insufficient evidence.</p>
        <label *ngFor="let tag of dataset.rubric.socialTags"><input type="checkbox" [checked]="tags.has(tag)" (change)="toggle(tag,$any($event.target).checked)">{{tag}}</label>
        <label>Evidence / justification <textarea [(ngModel)]="justification" maxlength="2000" rows="4"></textarea></label>
        <button (click)="submit()">Record immutable rating</button>
      </fieldset><p *ngIf="submitted.has(item.itemId)">Rating recorded for this item. Select the next item.</p>
    </section></main>`,
  styles:[`main{max-width:850px;margin:30px auto;padding:20px}label{display:block;margin:12px 0}input:not([type=checkbox]),textarea,select{width:100%;box-sizing:border-box}.verbatim{white-space:pre-wrap}article{padding:14px;background:#f4f6f8}h2{font-size:16px}[role=alert]{color:#8a1010}`]
})
export class BlindReviewComponent {
  datasetId='';raterId='';dataset:any=null;itemIndex=0;scores:Record<string,number|null>={};tags=new Set<string>();justification='';
  error='';message='';busy=false;submitted=new Set<string>();
  constructor(private experiments:ExperimentService){}
  get item(){return this.dataset?.items?.[this.itemIndex];}
  reset(){this.scores=Object.fromEntries((this.dataset?.rubric.dimensions??[]).map((d:any)=>[d.id,null]));this.tags.clear();this.justification='';this.message='';}
  toggle(tag:string,checked:boolean){if(checked){if(tag==='none'||tag==='unclear')this.tags.clear();else{this.tags.delete('none');this.tags.delete('unclear');}this.tags.add(tag);}else this.tags.delete(tag);}
  private fail(e:any){this.busy=false;this.error=e?.error?.error||e.message||'Evaluation request failed';}
  load(){if(this.busy)return;this.busy=true;this.error='';this.dataset=null;this.experiments.analysis('GET',`/evaluation-datasets/${encodeURIComponent(this.datasetId)}`).subscribe({next:data=>{this.dataset=data;this.datasetId=data.datasetId;this.itemIndex=0;this.submitted.clear();this.reset();this.busy=false;},error:e=>this.fail(e)});}
  submit(){if(this.busy||!this.item||this.submitted.has(this.item.itemId))return;this.busy=true;this.error='';
    this.experiments.analysis('POST','/ratings',{datasetId:this.dataset.datasetId,itemId:this.item.itemId,raterId:this.raterId,scores:{...this.scores},tags:this.tags.size?[...this.tags]:null,justification:this.justification}).subscribe({next:data=>{this.submitted.add(data.itemId);this.busy=false;this.message='Rating recorded.';},error:e=>this.fail(e)});
  }
}
