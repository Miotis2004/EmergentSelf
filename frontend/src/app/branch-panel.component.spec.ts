import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { BranchPanelComponent } from './branch-panel.component';
import { ExperimentService } from './services/experiment.service';

describe('Phase VI branches and interventions',()=>{
 let fixture:ComponentFixture<BranchPanelComponent>,panel:BranchPanelComponent,service:any;
 beforeEach(async()=>{
  service={branches:jasmine.createSpy().and.callFake((method:string,path:string)=>of(path==='/catalog'?{branches:['source-branch'],comparisons:[]}:{branchId:'new-branch',source:{sourceRunId:'source',sourceTurnIndex:4,snapshotId:'point'},configuration:{llmConfig:{model:'loaded',modelVersion:'v1'},maxTurns:10},snapshot:{context:[]}})),research:()=>of({snapshots:['point'],probes:['identity']}),getLlmModels:()=>of([{id:'loaded'}])};
  await TestBed.configureTestingModule({imports:[BranchPanelComponent],providers:[{provide:ExperimentService,useValue:service}]}).compileComponents();
  fixture=TestBed.createComponent(BranchPanelComponent);panel=fixture.componentInstance;fixture.detectChanges();
 });
 afterEach(()=>fixture.destroy());
 it('creates a fixed branch from selected snapshot and never starts it implicitly',()=>{
  panel.branchId='new-branch';panel.sourceId='point';panel.actor='R';panel.reason='Controlled change';panel.maxTurns=12;
  panel.agentId='bob';panel.entryIds='a\n b';panel.addOperation();panel.create();
  expect(service.branches).toHaveBeenCalledWith('POST','',{branchId:'new-branch',sourceSnapshotId:'point',operations:[{kind:'withhold',agentId:'bob',entryIds:['a','b']}],actor:'R',reason:'Controlled change',maxTurns:12});
  expect(service.branches.calls.allArgs().some((a:any[])=>a[1].endsWith('/start'))).toBeFalse();
 });
 it('builds reversible memory, attribute, swap and history operations in explicit order',()=>{
  panel.kind='attributes';panel.agentId='bob';panel.statKey='curiosity';panel.statValue=8;panel.addOperation();
  panel.kind='history';panel.historyMode='clear';panel.addOperation();panel.kind='reverse';panel.fromBranchId='source-branch';panel.operationIndex=1;panel.addOperation();
  expect(panel.operations).toEqual([{kind:'attributes',agentId:'bob',values:{curiosity:8}},{kind:'history',mode:'clear'},{kind:'reverse',fromBranchId:'source-branch',operationIndex:1}]);
  panel.removeOperation(1);expect(panel.operations.length).toBe(2);
 });
 it('makes changed model/version and baseline-parent lineage explicit',()=>{
  panel.sourceMode='branch';panel.sourceId='source-branch';panel.overrideModel=true;panel.baseUrl='http://local-model/v1';panel.modelVersion='weights-v2';panel.discover();panel.create();
  const body=service.branches.calls.allArgs().find((a:any[])=>a[0]==='POST'&&a[1]==='')[2];
  expect(body.sourceBranchId).toBe('source-branch');expect(body.sourceSnapshotId).toBeUndefined();expect(body.llmConfig).toEqual({baseUrl:'http://local-model/v1',model:'loaded',modelVersion:'weights-v2'});
 });
 it('submits paired probes with explicit models, historical turn and context policy',()=>{
  panel.selectedBranch='new-branch';panel.agentId='bob';panel.probeId='identity';panel.postTurnIndex=5;panel.modelPolicy='source_vs_branch';panel.contextPolicy='phase_history';panel.actor='R';panel.reason='Compare';panel.runPair();
  expect(service.branches).toHaveBeenCalledWith('POST','/new-branch/probe-pairs',{agentId:'bob',probeId:'identity',postTurnIndex:5,modelPolicy:'source_vs_branch',contextPolicy:'phase_history',actor:'R',reason:'Compare'});
 });
 it('blocks actions while running or pending and retains conflicts inline',()=>{
  panel.running=true;panel.create();expect(service.branches.calls.allArgs().some((a:any[])=>a[0]==='POST')).toBeFalse();
  panel.running=false;const pending=new Subject();service.branches.and.returnValue(pending);panel.create();panel.create();expect(service.branches.calls.allArgs().filter((a:any[])=>a[0]==='POST').length).toBe(1);
  pending.error({error:{error:'Branch ID already exists'}});fixture.detectChanges();expect(panel.busy).toBeFalse();expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('already exists');
 });
 it('rejects malformed subject mappings before submitting an intervention',()=>{
  panel.kind='transplant';panel.relationshipMap='invalid JSON';panel.addOperation();expect(panel.operations.length).toBe(0);expect(panel.error).toContain('JSON objects');
 });
});
