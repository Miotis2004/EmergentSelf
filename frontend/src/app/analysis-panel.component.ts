import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ExperimentService } from './services/experiment.service';

@Component({
  selector:'app-analysis-panel',standalone:true,imports:[CommonModule,FormsModule],
  templateUrl:'./analysis-panel.component.html',
  styles:[`:host{display:block;margin:12px 0}fieldset{margin:12px 0}label{display:block;margin:8px 0}input:not([type=checkbox]),select,textarea{width:100%;box-sizing:border-box}table{width:100%;border-collapse:collapse;font-size:12px}td,th{border:1px solid #ddd;padding:5px;overflow-wrap:anywhere}.scroll{overflow:auto}svg{width:100%;max-width:700px;background:#f5f7fa}svg text{font-size:12px}[role=alert]{color:#8a1010}.verbatim{white-space:pre-wrap}`]
})
export class AnalysisPanelComponent implements OnInit {
  @Input() running=false;
  runs:string[]=[];selected=new Set<string>();catalog:any={benchmarks:[],datasets:[]};definitions:any={metrics:[]};
  busy=false;error='';message='';report:any=null;
  windowSize=20;seed=42;metric='question_fraction';unitIndex=0;
  benchmarkId='phase4-standard-v1';targetRun='';agentId='';turnIndex=-1;entryIds='';actor='';reason='';outcomes:any[]=[];
  datasetId='';stream='dialogue';sampleSize=100;
  constructor(private experiments:ExperimentService){}
  ngOnInit(){this.refresh();this.experiments.analysis('GET','/definitions').subscribe({next:data=>this.definitions=data,error:e=>this.fail(e)});}
  refresh(){
    this.experiments.research('GET','/catalog').subscribe({next:data=>this.runs=data.runs,error:e=>this.fail(e)});
    this.experiments.analysis('GET','/catalog').subscribe({next:data=>this.catalog=data,error:e=>this.fail(e)});
  }
  toggle(id:string,checked:boolean){if(checked)this.selected.add(id);else this.selected.delete(id);}
  get runIds(){return this.runs.filter(id=>this.selected.has(id));}
  private fail(e:any){this.error=e?.error?.error||e.message||'Analysis request failed';}
  private act(path:string,body:any,done:(data:any)=>void){
    if(this.busy||this.running)return;this.busy=true;this.error='';this.message='';
    this.experiments.analysis('POST',path,body).subscribe({next:data=>{this.busy=false;done(data);this.refresh();},error:e=>{this.busy=false;this.fail(e);}});
  }
  analyze(){this.act('/reports',{runIds:this.runIds,options:{windowSize:this.windowSize,seed:this.seed}},data=>{this.report=data;this.unitIndex=0;});}
  saveBenchmark(){this.act('/benchmarks',{...this.definitions.standardBenchmark,benchmarkId:this.benchmarkId},()=>this.message='Immutable standard benchmark saved.');}
  runBenchmark(){this.act('/benchmark-sessions',{benchmarkId:this.benchmarkId,runId:this.targetRun,agentId:this.agentId,turnIndex:this.turnIndex,
    entryIds:this.entryIds.split(/\s+/).filter(Boolean),randomizationSeed:this.seed,actor:this.actor,reason:this.reason},data=>{this.outcomes=data.outcomes;this.message=`Benchmark session ${data.session.sessionId} recorded.`;});}
  createDataset(){this.act('/evaluation-datasets',{datasetId:this.datasetId,runIds:this.runIds,stream:this.stream,sampleSize:this.sampleSize,seed:this.seed},data=>this.message=`Saved ${data.items.length} blinded items in dataset ${data.datasetId}. Open the separate review page and enter this dataset ID.`);}
  get selectedDefinition(){return this.definitions.metrics.find((m:any)=>m.id===this.metric);}
  get unit(){return this.report?.units?.[this.unitIndex];}
  format(value:number|null|undefined){return value===null||value===undefined?'Unavailable':value.toFixed(3);}
  get points():{x:number,y:number,value:number,index:number}[]{
    const windows=this.unit?.windows??[];
    const valid=windows.map((w:any)=>w.metrics[this.metric]?.value).filter((v:any)=>typeof v==='number');
    const maximum=Math.max(1,...valid);
    return windows.flatMap((w:any,index:number)=>{
      const value=w.metrics[this.metric]?.value;
      return typeof value==='number'?[{x:45+index*600/Math.max(1,windows.length-1),y:175-value/maximum*140,value,index}]:[];
    });
  }
  get segments(){const points=this.points;return points.slice(1).filter((p,index)=>p.index===points[index].index+1).map(p=>({a:points.find(q=>q.index===p.index-1)!,b:p}));}
  download(){if(!this.report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(this.report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`behavior-${this.report.reportHash.slice(0,12)}.json`;a.click();URL.revokeObjectURL(url);}
}
