import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { BlindReviewComponent } from './blind-review.component';
import { ExperimentService } from './services/experiment.service';

describe('Blinded human evaluation',()=>{
  let fixture:ComponentFixture<BlindReviewComponent>,panel:BlindReviewComponent,service:any;
  const dataset={datasetId:'blind',rubric:{version:'human-v1',instructions:'Text evidence only',dimensions:[{id:'question',label:'Questioning',anchors:['None','Low','Medium','High','Strong']}],socialTags:['address','cooperate','none','unclear']},items:[{itemId:'opaque',response:'Unchanged\n  wording.',stimulus:'Question?',context:['Earlier text']}]};
  beforeEach(async()=>{
    service={analysis:jasmine.createSpy().and.callFake((method:string)=>of(method==='GET'?dataset:{itemId:'opaque'}))};
    await TestBed.configureTestingModule({imports:[BlindReviewComponent],providers:[{provide:ExperimentService,useValue:service}]}).compileComponents();
    fixture=TestBed.createComponent(BlindReviewComponent);panel=fixture.componentInstance;fixture.detectChanges();
  });
  afterEach(()=>fixture.destroy());
  it('loads only the public dataset, preserves text, and defaults to insufficient evidence',()=>{
    panel.datasetId='blind';panel.load();fixture.detectChanges();
    expect(service.analysis).toHaveBeenCalledOnceWith('GET','/evaluation-datasets/blind');
    expect(panel.scores).toEqual({question:null});expect(fixture.nativeElement.textContent).toContain('Unchanged\n  wording.');
    expect(fixture.nativeElement.textContent).not.toContain('Source run');
  });
  it('submits zero distinctly from missing scores with opaque item IDs and evidence',()=>{
    panel.datasetId='blind';panel.load();panel.raterId='Rater';panel.scores['question']=0;panel.justification='No question in reply';panel.toggle('cooperate',true);panel.submit();panel.submit();
    expect(service.analysis).toHaveBeenCalledWith('POST','/ratings',{datasetId:'blind',itemId:'opaque',raterId:'Rater',scores:{question:0},tags:['cooperate'],justification:'No question in reply'});
    expect(service.analysis.calls.allArgs().filter((a:any[])=>a[0]==='POST').length).toBe(1);expect(panel.submitted.has('opaque')).toBeTrue();
  });
  it('keeps none and unclear exclusive and allows multiple behavioral tags',()=>{
    panel.toggle('none',true);panel.toggle('address',true);panel.toggle('cooperate',true);expect([...panel.tags]).toEqual(['address','cooperate']);
    panel.toggle('unclear',true);expect([...panel.tags]).toEqual(['unclear']);panel.toggle('unclear',false);expect(panel.tags.size).toBe(0);
  });
  it('reports duplicate rating conflicts without clearing the response or inventing a replacement',()=>{
    panel.datasetId='blind';panel.load();service.analysis.and.returnValue(throwError(()=>({error:{error:'Rating already exists'}})));panel.submit();fixture.detectChanges();
    expect(panel.item.response).toBe('Unchanged\n  wording.');expect(panel.busy).toBeFalse();expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('Rating already exists');
  });
});

describe('Dedicated review route',()=>{
  it('renders the evaluator page without loading agent catalogues or subscribing to live experiments',async()=>{
    const { AppComponent }=await import('./app.component');
    const { AgentService }=await import('./services/agent.service');
    const { provideRouter,Router }=await import('@angular/router');
    const { routes }=await import('./app.routes');
    const original=window.location.pathname;
    window.history.replaceState({},'', '/review');
    const service={analysis:jasmine.createSpy(),disconnectEvents:()=>{}};
    let fixture:ComponentFixture<any>|undefined;
    try{
      await TestBed.configureTestingModule({imports:[AppComponent],providers:[provideRouter(routes),{provide:AgentService,useValue:{}},{provide:ExperimentService,useValue:service}]}).compileComponents();
      fixture=TestBed.createComponent(AppComponent);fixture.detectChanges();
      await TestBed.inject(Router).navigateByUrl('/review');await fixture.whenStable();fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Blinded behavioral review');
      expect(fixture.nativeElement.querySelector('app-analysis-panel')).toBeNull();
      expect(fixture.nativeElement.querySelector('app-research-panel')).toBeNull();
      expect(service.analysis).not.toHaveBeenCalled();
    }finally{fixture?.destroy();window.history.replaceState({},'',original);}
  });
});
