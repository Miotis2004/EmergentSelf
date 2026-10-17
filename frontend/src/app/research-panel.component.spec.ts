import { TestBed, ComponentFixture } from '@angular/core/testing';
import { of, throwError, Subject } from 'rxjs';
import { ResearchPanelComponent } from './research-panel.component';
import { ExperimentService } from './services/experiment.service';

describe('Phase III research controls',()=>{
 let fixture:ComponentFixture<ResearchPanelComponent>;
 let panel:ResearchPanelComponent;
 let service:any;
 beforeEach(async()=>{
  service={research:jasmine.createSpy().and.callFake((method:string,path:string)=>of(path==='/defaults'?{systemPrompt:'Fixed {attributes}',turnPrompt:'Speak {name}',inputCharLimit:24000}:{runs:['trial'],templates:['template'],snapshots:[],batches:[],probes:[]}))};
  await TestBed.configureTestingModule({imports:[ResearchPanelComponent],providers:[{provide:ExperimentService,useValue:service}]}).compileComponents();
  fixture=TestBed.createComponent(ResearchPanelComponent);panel=fixture.componentInstance;
  panel.configuration={runId:'draft',agentIds:['bob','sara'],maxTurns:100,initialTopic:'Trust',memoryConfig:{mode:'enabled',retrievalChars:12000},llmConfig:{baseUrl:'http://localhost:8080/v1',model:'loaded',maxTokens:2048,outputMode:'json_schema'}};
  panel.ngOnChanges();fixture.detectChanges();
 });
 afterEach(()=>fixture.destroy());
 it('loads fixed prompt defaults and saved research identifiers',()=>{
  expect(panel.systemPrompt).toBe('Fixed {attributes}');expect(panel.catalog.runs).toEqual(['trial']);
  expect(fixture.nativeElement.textContent).toContain('Conversation history only');
 });
 it('freezes selected configuration with explicit sampling, version, prompt and attribute settings',()=>{
  panel.templateId='new-template';panel.modelVersion='model-sha256';panel.useSeed=true;panel.seedSupported=true;panel.samplingSeed=72;
  panel.attributeMode='role';panel.roles={bob:'A researcher-set role',sara:'Another researcher-set role'};
  panel.saveTemplate();
  const call=service.research.calls.allArgs().find((args:any[])=>args[1]==='/templates');
  expect(call[2].configuration.agentIds).toEqual(['bob','sara']);expect(call[2].configuration.llmConfig.seed).toBe(72);
  expect(call[2].configuration.llmConfig.modelVersion).toBe('model-sha256');expect(call[2].configuration.protocol.roles.bob).toBe('A researcher-set role');
  expect(call[2].configuration.protocol.systemPrompt).toBe('Fixed {attributes}');
  panel.roles['bob']='A changed draft';expect(call[2].configuration.protocol.roles.bob).toBe('A researcher-set role');
 });
 it('prepares exactly the chosen conditions with recorded randomization settings',()=>{
  panel.selectedTemplate='template';panel.batchId='batch';panel.repeats=3;panel.randomizationSeed=99;panel.randomizeParticipants=true;panel.includeNone=false;
  panel.prepareBatch();
  const call=service.research.calls.allArgs().find((args:any[])=>args[1]==='/batches');
  expect(call[2].conditions).toEqual(['history','enabled']);expect(call[2].repeats).toBe(3);expect(call[2].randomizationSeed).toBe(99);expect(call[2].randomizeParticipants).toBeTrue();
 });
 it('starts only the selected manifest trial and does not start batches automatically',()=>{
  panel.manifest={batchId:'frozen-batch',trials:[{runId:'trial-1'}]};panel.batchId='edited-draft';panel.startTrial('trial-1');
  expect(service.research).toHaveBeenCalledWith('POST','/batches/frozen-batch/start',{runId:'trial-1'});
  expect(panel.targetRunId).toBe('trial-1');
 });
 it('locks researcher operations while the main experiment is running',()=>{
  panel.running=true;fixture.detectChanges();
  const button=Array.from(fixture.nativeElement.querySelectorAll('button')).find((node:any)=>node.textContent.includes('Freeze current')) as HTMLButtonElement;
  expect(button.matches(':disabled')).toBeTrue();
 });
 it('keeps probe definitions and researcher attribution separate from main conversation requests',()=>{
  panel.probeId='standard';panel.probePrompts='Question one\n\nQuestion two';panel.defineProbe();
  expect(service.research).toHaveBeenCalledWith('POST','/probe-definitions',{probeId:'standard',prompts:['Question one','Question two']});
  panel.targetRunId='run-a';panel.agentId='bob';panel.turnIndex=6;panel.actor='Researcher';panel.reason='Standard comparison';panel.runProbe();
  expect(service.research).toHaveBeenCalledWith('POST','/runs/run-a/probes',{probeId:'standard',agentId:'bob',turnIndex:6,actor:'Researcher',reason:'Standard comparison'});
 });
 it('displays configuration differences including model and input-budget changes',()=>{
  const comparison={leftId:'a',rightId:'b',promptingRecorded:true,differences:[{path:'llmConfig.model',left:'one',right:'two'},{path:'protocol.inputCharLimit',left:1000,right:2000}]};
  service.research.and.callFake((method:string,path:string)=>of(path.startsWith('/compare')?comparison:{runs:[],templates:[],snapshots:[],batches:[],probes:[]}));
  panel.leftRun='a';panel.rightRun='b';panel.compare();fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('table').textContent).toContain('llmConfig.model');expect(fixture.nativeElement.querySelector('table').textContent).toContain('protocol.inputCharLimit');
 });
 it('reports immutable-ID conflicts inline without alerts',()=>{
  service.research.and.returnValue(throwError(()=>({error:{error:'ID already exists; use a new ID'}})));
  panel.templateId='existing';panel.saveTemplate();fixture.detectChanges();
  expect(panel.busy).toBeFalse();expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('ID already exists');
 });
 it('prevents repeated submissions while an operation is pending and follows run restoration',()=>{
  const pending=new Subject<any>();service.research.and.returnValue(pending);
  panel.templateId='new-template';panel.saveTemplate();const count=service.research.calls.count();panel.saveTemplate();expect(service.research.calls.count()).toBe(count);
  panel.configuration={...panel.configuration,runId:'restored-run'};panel.ngOnChanges();expect(panel.targetRunId).toBe('restored-run');
 });
});
