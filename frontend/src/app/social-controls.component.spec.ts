import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { SocialControlsComponent } from './social-controls.component';
import { ExperimentService } from './services/experiment.service';

describe('Phase V social controls',()=>{
 let fixture:ComponentFixture<SocialControlsComponent>,panel:SocialControlsComponent,service:any;
 beforeEach(async()=>{
  service={research:jasmine.createSpy().and.returnValue(of({id:'feedback',score:-2,deliverFromTurn:8}))};
  await TestBed.configureTestingModule({imports:[SocialControlsComponent],providers:[{provide:ExperimentService,useValue:service}]}).compileComponents();
  fixture=TestBed.createComponent(SocialControlsComponent);panel=fixture.componentInstance;
  panel.social={enabled:false};panel.task={kind:'none',endowment:10,multiplier:1.5,prize:20};panel.feedback={enabled:false,source:'researcher',timing:'immediate',delayTurns:1,visibility:'private',positiveScore:1,negativeScore:-1,maxVisible:20};fixture.detectChanges();
 });
 afterEach(()=>fixture.destroy());
 it('defaults to a clean baseline and shows exact task formulas without trait claims',()=>{
  expect(panel.feedback.enabled).toBeFalse();panel.task.kind='public_goods';fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain('Net score = multiplier');
  panel.task.kind='resource_race';fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain('Ties at zero');expect(fixture.nativeElement.textContent).toContain('do not measure moral understanding');
 });
 it('freezes configuration controls for active and saved runs',()=>{
  panel.locked=true;fixture.detectChanges();const field=fixture.nativeElement.querySelector('fieldset');expect(field.disabled).toBeTrue();
 });
 it('submits feedback attribution and source decision, and displays the saved score and delivery turn',()=>{
  panel.runId='run';panel.feedbackId='signal';panel.agentId='bob';panel.turnIndex=4;panel.valence='negative';panel.actor='R';panel.reason='Observed criterion';
  const listener=jasmine.createSpy();panel.recorded.subscribe(listener);panel.record();fixture.detectChanges();
  expect(service.research).toHaveBeenCalledWith('POST','/runs/run/feedback',{feedbackId:'signal',agentId:'bob',turnIndex:4,valence:'negative',actor:'R',reason:'Observed criterion'});
  expect(listener).toHaveBeenCalled();expect(fixture.nativeElement.textContent).toContain('Recorded score -2; eligible from turn 8');
 });
 it('blocks active and repeated pending submissions and reports conflicts inline',()=>{
  panel.runId='run';panel.running=true;panel.record();expect(service.research).not.toHaveBeenCalled();
  panel.running=false;const pending=new Subject();service.research.and.returnValue(pending);panel.record();panel.record();expect(service.research.calls.count()).toBe(1);
  pending.error({error:{error:'ID already exists'}});fixture.detectChanges();expect(panel.busy).toBeFalse();expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('ID already exists');
 });
});
