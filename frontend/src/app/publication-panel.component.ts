import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ExperimentService } from './services/experiment.service';
@Component({selector:'app-publication-panel',standalone:true,imports:[CommonModule,FormsModule],templateUrl:'./publication-panel.component.html',
 styles:[`:host{display:block;margin:12px 0}fieldset{margin:12px 0}label{display:block;margin:8px 0}input:not([type=checkbox]),textarea,select{width:100%;box-sizing:border-box}pre{white-space:pre-wrap;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-size:12px}td,th{border:1px solid #ddd;padding:5px;overflow-wrap:anywhere}[role=alert]{color:#8a1010}`]})
export class PublicationPanelComponent implements OnInit {
 @Input() running=false;
 catalog:any={studies:[],publications:[],runIds:[]};selected=new Set<string>();defaults:any=null;
 studyId='';title='';researchQuestion='';actor='';registrationType='prospective';
 procedures:Record<string,string>={samplingPlan:'',randomization:'',blinding:'',exclusionRules:'',stoppingRule:'',analysisPlan:''};
 procedureFields=[{id:'samplingPlan',label:'Sampling plan and independent repeats'},{id:'randomization',label:'Randomization and seed policy'},{id:'blinding',label:'Blinding and evaluator procedure'},{id:'exclusionRules',label:'Exclusion rules and missing outcomes'},{id:'stoppingRule',label:'Stopping rule'},{id:'analysisPlan',label:'Analysis, multiplicity and interpretation plan'}];
 hypotheses:any[]=[];hypothesisId='h1';question='';domain='behavior';metric='question_fraction';leftCondition='none';rightCondition='enabled';prediction='greater';minimumEffect=.05;stream='dialogue';probeKey='';
 windowSize=20;bootstrapSamples=500;seed=42;sensitivityWindows='10,40';excludeRunId='';excludeReason='';exclusions:any[]=[];
 selectedStudy='';saved:any=null;report:any=null;publicationId='';profile='aggregate';selectedPublication='';
 busy=false;error='';message='';
 constructor(private experiments:ExperimentService){}
 ngOnInit(){this.refresh();this.experiments.studies('GET','/defaults').subscribe({next:data=>this.defaults=data,error:e=>this.fail(e)});}
 refresh(){this.experiments.studies('GET','/catalog').subscribe({next:data=>this.catalog=data,error:e=>this.fail(e)});}
 toggle(id:string,value:boolean){if(value)this.selected.add(id);else this.selected.delete(id);}
 private fail(e:any){this.error=e?.error?.error||e.message||'Study request failed';}
 private act(method:string,path:string,body:any,done:(value:any)=>void){if(this.busy||this.running)return;this.busy=true;this.error='';this.message='';
  this.experiments.studies(method,path,body).subscribe({next:data=>{this.busy=false;done(data);this.refresh();},error:e=>{this.busy=false;this.fail(e);}});}
 addHypothesis(){if(this.busy||this.running)return;this.hypotheses=[...this.hypotheses,{hypothesisId:this.hypothesisId,question:this.question,domain:this.domain,metric:this.metric,leftCondition:this.leftCondition,rightCondition:this.rightCondition,prediction:this.prediction,minimumEffect:this.minimumEffect,stream:this.stream,...(this.stream==='probe'?{probeKey:this.probeKey}:{})}];}
 addExclusion(){if(this.busy||this.running)return;this.exclusions=[...this.exclusions,{runId:this.excludeRunId,reason:this.excludeReason}];}
 register(){this.act('POST','',{studyId:this.studyId,title:this.title,researchQuestion:this.researchQuestion,actor:this.actor,registrationType:this.registrationType,
  plannedRunIds:this.catalog.runIds.filter((id:string)=>this.selected.has(id)),hypotheses:structuredClone(this.hypotheses),procedures:{...this.procedures},
  analysis:{windowSize:this.windowSize,bootstrapSamples:this.bootstrapSamples,seed:this.seed,sensitivityWindows:this.sensitivityWindows.split(',').map(v=>Number(v.trim())),excludeRuns:structuredClone(this.exclusions)}},data=>{this.saved=data;this.selectedStudy=data.protocol.studyId;this.message='Immutable local registration saved. Existing observations require retrospective registration.';});}
 load(){this.act('GET',`/${encodeURIComponent(this.selectedStudy)}`,undefined,data=>this.saved=data);}
 synthesize(){this.act('POST',`/${encodeURIComponent(this.selectedStudy)}/report`,{},data=>this.report=data);}
 publish(){this.act('POST',`/${encodeURIComponent(this.selectedStudy)}/publications`,{publicationId:this.publicationId,profile:this.profile},data=>{this.selectedPublication=data.publicationId;this.message=`Saved immutable ${data.profile} package. Review its disclosure profile before sharing.`;});}
 download(){this.act('GET',`/publications/${encodeURIComponent(this.selectedPublication)}`,undefined,data=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`${this.selectedPublication}.json`;link.click();URL.revokeObjectURL(url);
 });}
 format(value:any){return typeof value==='number'?value.toFixed(3):'Unavailable';}
}
