import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ExperimentService } from './services/experiment.service';

@Component({selector:'app-branch-panel',standalone:true,imports:[CommonModule,FormsModule],templateUrl:'./branch-panel.component.html',
 styles:[`:host{display:block;margin:12px 0}fieldset{margin:12px 0}label{display:block;margin:7px 0}input,textarea,select{width:100%;box-sizing:border-box}input[type=checkbox]{width:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-size:12px}td,th{border:1px solid #ddd;padding:5px}[role=alert]{color:#8a1010}`]})
export class BranchPanelComponent implements OnInit {
 @Input() running=false;
 catalog:any={branches:[],comparisons:[]};snapshots:string[]=[];probes:string[]=[];
 branchId='';sourceMode='snapshot';sourceId='';actor='';reason='';maxTurns=100;
 overrideModel=false;baseUrl='http://127.0.0.1:8080/v1';model='';modelVersion='';models:{id:string}[]=[];
 operations:any[]=[];kind='withhold';agentId='';entryIds='';donorSnapshotId='';donorAgentId='';otherAgentId='';otherEntryIds='';relationshipMap='';otherRelationshipMap='';
 fromBranchId='';operationIndex=0;statKey='';statValue=5;historyMode='clear';operationalOperations='[]';
 selectedBranch='';saved:any=null;probeId='';postTurnIndex=-1;modelPolicy='same_branch';contextPolicy='isolated';pair:any=null;
 busy=false;error='';message='';
 constructor(private experiments:ExperimentService){}
 ngOnInit(){this.refresh();}
 refresh(){this.experiments.branches('GET','/catalog').subscribe({next:data=>this.catalog=data,error:e=>this.fail(e)});
  this.experiments.research('GET','/catalog').subscribe({next:data=>{this.snapshots=data.snapshots;this.probes=data.probes;},error:e=>this.fail(e)});}
 private fail(e:any){this.error=e?.error?.error||e.message||'Branch operation failed';}
 private act(method:string,path:string,body:any,done:(data:any)=>void){
  if(this.busy||this.running)return;this.busy=true;this.error='';this.message='';
  this.experiments.branches(method,path,body).subscribe({next:data=>{this.busy=false;done(data);this.refresh();},error:e=>{this.busy=false;this.fail(e);}});
 }
 addOperation(){if(this.busy||this.running)return;this.error='';try{
  const ids=(value:string)=>value.split(/\s+/).filter(Boolean);
  const mapping=(value:string)=>value.trim()?JSON.parse(value):{};
  let op:any={kind:this.kind};
  if(this.kind==='operational'){op.operations=JSON.parse(this.operationalOperations);if(!Array.isArray(op.operations))throw new Error('Expected operation array');}
  if(['withhold','restore','transplant','swap','attributes','operational'].includes(this.kind))op.agentId=this.agentId;
  if(['withhold','restore','transplant','swap'].includes(this.kind))op.entryIds=ids(this.entryIds);
  if(this.kind==='restore'||this.kind==='reverse')op={...op,fromBranchId:this.fromBranchId,operationIndex:this.operationIndex};
  if(this.kind==='transplant')op={...op,donorSnapshotId:this.donorSnapshotId,donorAgentId:this.donorAgentId,relationshipMap:mapping(this.relationshipMap)};
  if(this.kind==='swap')op={...op,otherAgentId:this.otherAgentId,otherEntryIds:ids(this.otherEntryIds),relationshipMap:mapping(this.relationshipMap),otherRelationshipMap:mapping(this.otherRelationshipMap)};
  if(this.kind==='attributes')op.values={[this.statKey]:this.statValue};
  if(this.kind==='history')op={...op,mode:this.historyMode,...(this.historyMode==='replace'?{donorSnapshotId:this.donorSnapshotId}:{})};
  this.operations=[...this.operations,op];
 }catch{this.error=this.kind==='operational'?'Operational interventions must be a JSON array of operations.':'Subject mappings must be JSON objects containing participant IDs.';}}
 removeOperation(index:number){if(!this.busy&&!this.running)this.operations=this.operations.filter((_,i)=>i!==index);}
 create(){this.act('POST','',{branchId:this.branchId,...(this.sourceMode==='snapshot'?{sourceSnapshotId:this.sourceId}:{sourceBranchId:this.sourceId}),
  operations:structuredClone(this.operations),actor:this.actor,reason:this.reason,maxTurns:this.maxTurns,
  ...(this.overrideModel?{llmConfig:{baseUrl:this.baseUrl,model:this.model,modelVersion:this.modelVersion}}:{})},data=>{this.saved=data;this.selectedBranch=data.branchId;this.message='Immutable branch created. Prepare or start it explicitly.';});}
 load(){this.act('GET',`/${encodeURIComponent(this.selectedBranch)}`,undefined,data=>{this.saved=data;});}
 prepare(){this.act('POST',`/${encodeURIComponent(this.selectedBranch)}/prepare`,{},data=>{this.saved=data;this.message='Branch baseline prepared for probes or execution.';});}
 start(){this.act('POST',`/${encodeURIComponent(this.selectedBranch)}/start`,{},()=>this.message='Branch started with its saved configuration.');}
 runPair(){this.act('POST',`/${encodeURIComponent(this.selectedBranch)}/probe-pairs`,{agentId:this.agentId,probeId:this.probeId,postTurnIndex:this.postTurnIndex,modelPolicy:this.modelPolicy,contextPolicy:this.contextPolicy,actor:this.actor,reason:this.reason},data=>{this.pair=data;this.message='Pre/post probe comparison recorded in the branch.';});}
 discover(){if(this.busy)return;this.experiments.getLlmModels(this.baseUrl).subscribe({next:data=>{this.models=data;if(data.length===1)this.model=data[0].id;},error:e=>this.fail(e)});}
}
