import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { AnalysisPanelComponent } from './analysis-panel.component';
import { ExperimentService } from './services/experiment.service';

describe('Phase IV analysis dashboard',()=>{
  let fixture:ComponentFixture<AnalysisPanelComponent>,panel:AnalysisPanelComponent,service:any;
  beforeEach(async()=>{
    service={research:()=>of({runs:['a','b']}),analysis:jasmine.createSpy().and.callFake((method:string,path:string)=>of(path==='/definitions'?{metrics:[{id:'question_fraction',label:'Questions',definition:'Punctuation proxy.'}],standardBenchmark:{version:1,items:[]}}:{benchmarks:[],datasets:[]}))};
    await TestBed.configureTestingModule({imports:[AnalysisPanelComponent],providers:[{provide:ExperimentService,useValue:service}]}).compileComponents();
    fixture=TestBed.createComponent(AnalysisPanelComponent);panel=fixture.componentInstance;fixture.detectChanges();
  });
  afterEach(()=>fixture.destroy());
  it('requests only selected runs with fixed analysis options',()=>{
    panel.toggle('b',true);panel.windowSize=10;panel.seed=7;panel.analyze();
    expect(service.analysis).toHaveBeenCalledWith('POST','/reports',{runIds:['b'],options:{windowSize:10,seed:7}});
  });
  it('retains observed zeros and gaps for unavailable timeline scores',()=>{
    panel.report={units:[{windows:[{metrics:{question_fraction:{value:0}}},{metrics:{question_fraction:{value:null}}},{metrics:{question_fraction:{value:1}}}]}]};
    expect(panel.points.map(p=>p.value)).toEqual([0,1]);expect(panel.segments.length).toBe(0);
    expect(panel.format(null)).toBe('Unavailable');expect(panel.format(0)).toBe('0.000');
  });
  it('runs source-linked memory views with explicit selected entries and researcher attribution',()=>{
    panel.benchmarkId='fixed';panel.targetRun='a';panel.agentId='bob';panel.turnIndex=8;panel.entryIds='m1\n m2';panel.actor='Tester';panel.reason='Paired test';
    service.analysis.and.callFake((method:string,path:string)=>of(path==='/benchmark-sessions'?{session:{sessionId:'s'},outcomes:[]}:{benchmarks:[],datasets:[]}));
    panel.runBenchmark();
    expect(service.analysis).toHaveBeenCalledWith('POST','/benchmark-sessions',{benchmarkId:'fixed',runId:'a',agentId:'bob',turnIndex:8,entryIds:['m1','m2'],randomizationSeed:42,actor:'Tester',reason:'Paired test'});
  });
  it('does not submit analysis while running or while another operation is pending',()=>{
    panel.running=true;panel.analyze();expect(service.analysis.calls.allArgs().some((a:any[])=>a[0]==='POST')).toBeFalse();
    panel.running=false;const pending=new Subject();service.analysis.and.returnValue(pending);panel.analyze();panel.analyze();
    expect(service.analysis.calls.allArgs().filter((a:any[])=>a[0]==='POST').length).toBe(1);
  });
  it('prepares seeded evaluation samples and presents errors inline',()=>{
    panel.toggle('a',true);panel.datasetId='blind';panel.stream='probe';panel.sampleSize=5;
    service.analysis.and.returnValue(throwError(()=>({error:{error:'Dataset ID exists'}})));panel.createDataset();fixture.detectChanges();
    expect(service.analysis).toHaveBeenCalledWith('POST','/evaluation-datasets',{datasetId:'blind',runIds:['a'],stream:'probe',sampleSize:5,seed:42});
    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('Dataset ID exists');expect(panel.busy).toBeFalse();
  });
});
