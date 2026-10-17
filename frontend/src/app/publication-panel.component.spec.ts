import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { PublicationPanelComponent } from './publication-panel.component';
import { ExperimentService } from './services/experiment.service';

describe('Phase VII study registration and publication',()=>{
 let fixture:ComponentFixture<PublicationPanelComponent>,panel:PublicationPanelComponent,service:any;
 beforeEach(async()=>{
  service={studies:jasmine.createSpy().and.callFake((method:string,path:string)=>of(path==='/catalog'?{studies:['study'],publications:[],runIds:['trial-a','trial-b']}:{protocol:{studyId:'study'},profile:'aggregate',publicationId:'release'}))};
  await TestBed.configureTestingModule({imports:[PublicationPanelComponent],providers:[{provide:ExperimentService,useValue:service}]}).compileComponents();
  fixture=TestBed.createComponent(PublicationPanelComponent);panel=fixture.componentInstance;fixture.detectChanges();
 });
 afterEach(()=>fixture.destroy());
 it('freezes selected plans, hypotheses, exclusion rules and analysis settings without starting inference',()=>{
  panel.studyId='study';panel.title='Question markers';panel.researchQuestion='What changes?';panel.actor='R';panel.toggle('trial-b',true);panel.question='More questions?';panel.addHypothesis();panel.sensitivityWindows='5, 20';panel.register();
  const body=service.studies.calls.allArgs().find((a:any[])=>a[0]==='POST'&&a[1]==='')[2];
  expect(body.registrationType).toBe('prospective');expect(body.plannedRunIds).toEqual(['trial-b']);expect(body.hypotheses[0].metric).toBe('question_fraction');expect(body.analysis.sensitivityWindows).toEqual([5,20]);
  panel.hypotheses[0].metric='changed draft';expect(body.hypotheses[0].metric).toBe('question_fraction');expect(service.studies.calls.allArgs().some((a:any[])=>a[1].includes('/start'))).toBeFalse();
 });
 it('requires an explicit retrospective declaration in the submitted protocol',()=>{
  panel.registrationType='retrospective';panel.register();const body=service.studies.calls.allArgs().find((a:any[])=>a[0]==='POST')[2];expect(body.registrationType).toBe('retrospective');
 });
 it('defaults publication disclosure to aggregate and sends an explicit profile',()=>{
  expect(panel.profile).toBe('aggregate');panel.selectedStudy='study';panel.publicationId='release';panel.publish();
  expect(service.studies).toHaveBeenCalledWith('POST','/study/publications',{publicationId:'release',profile:'aggregate'});
 });
 it('keeps missing outcomes, unavailable intervals, zero effects and limitations visible',()=>{
  panel.report={registrationType:'retrospective',totals:{planned:4,observed:2,missing:2,incomplete:1,excluded:0,deviations:0},method:'Independent run bootstrap',interpretation:'Descriptive only',primary:{contrasts:[{hypothesisId:'h1',designHash:'design',metric:'question_fraction',estimate:0,ci95:null,left:[{}],right:[{}],status:'observed_zero'}]},ledger:[],sensitivity:[]};fixture.detectChanges();
  const text=fixture.nativeElement.textContent;expect(text).toContain('missing 2');expect(text).toContain('observed_zero');expect(text).toContain('0.000');expect(text).toContain('Unavailable');expect(text).toContain('Descriptive only');
 });
 it('blocks active/pending submissions and explains registration conflicts inline',()=>{
  panel.running=true;panel.register();expect(service.studies.calls.allArgs().some((a:any[])=>a[0]==='POST')).toBeFalse();panel.running=false;
  const pending=new Subject();service.studies.and.returnValue(pending);panel.register();panel.register();expect(service.studies.calls.allArgs().filter((a:any[])=>a[0]==='POST').length).toBe(1);
  pending.error({error:{error:'Observed data exist; declare retrospective'}});fixture.detectChanges();expect(panel.busy).toBeFalse();expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('retrospective');
 });
});
