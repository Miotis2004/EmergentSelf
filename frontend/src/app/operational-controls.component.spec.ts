import {TestBed,ComponentFixture} from '@angular/core/testing';
import {OperationalControlsComponent} from './operational-controls.component';
describe('Operational controls',()=>{
 let fixture:ComponentFixture<OperationalControlsComponent>,component:OperationalControlsComponent;
 beforeEach(async()=>{await TestBed.configureTestingModule({imports:[OperationalControlsComponent]}).compileComponents();fixture=TestBed.createComponent(OperationalControlsComponent);component=fixture.componentInstance;fixture.detectChanges();});
 afterEach(()=>fixture.destroy());
 it('adds explicit locations and prevents edits through controls on saved runs',()=>{
  component.add();expect(component.config.locations.length).toBe(1);component.config.locations[0]={id:'garden',name:'Garden'};
  component.locked=true;component.add();component.remove(0);fixture.detectChanges();expect(component.config.locations[0].id).toBe('garden');expect(fixture.nativeElement.querySelector('fieldset').disabled).toBeTrue();
 });
 it('keeps observation policy explicit and labels outcomes unverified',()=>{
  expect(component.config.observationPolicy).toBe('self_only');expect(fixture.nativeElement.textContent).toContain('do not verify physical reachability');expect(fixture.nativeElement.querySelectorAll('option').length).toBe(2);
 });
});
