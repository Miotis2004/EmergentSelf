import {TestBed} from '@angular/core/testing';
import {WorldControlsComponent,defaultWorldConfig} from './world-controls.component';
import {WorldStateComponent} from './world-state.component';
describe('World simulation controls',()=>{
 it('edits a timezone-free clock and preserves valid JSON when a draft is invalid',()=>{
  const fixture=TestBed.createComponent(WorldControlsComponent),c=fixture.componentInstance;c.config=defaultWorldConfig();c.config.enabled=true;
  c.setTime(3,'06:30');expect(c.config.initialMinute).toBe(3270);expect(c.day).toBe(3);expect(c.time).toBe('06:30');
  const states:boolean[]=[];c.validityChange.subscribe(v=>states.push(v));c.update('initialPositions','{"bob":"room"}');c.update('initialPositions','{bad');expect(c.config.initialPositions).toEqual({bob:'room'});expect(states).toEqual([true,false]);c.update('initialPositions','{}');expect(states.at(-1)).toBeTrue();
 });
 it('locks every world configuration control during a saved run',()=>{
  const fixture=TestBed.createComponent(WorldControlsComponent),c=fixture.componentInstance;c.config.enabled=true;c.locked=true;fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('fieldset').disabled).toBeTrue();const before=JSON.stringify(c.config);c.setTime(10,'12:00');c.update('items','[]');expect(JSON.stringify(c.config)).toBe(before);
 });
 it('shows authoritative inventories and pending schedule without mutating the source state',()=>{
  const fixture=TestBed.createComponent(WorldStateComponent),c=fixture.componentInstance;c.state={minute:1440,revision:1,positions:{bob:'room'},waits:{bob:{untilMinute:2000}},inventories:[{id:'bag',ownerType:'agent',ownerId:'bob',visibility:'private',quantities:{food:2}}],environment:{},executed:['delivery:0']};
  c.config={events:[{id:'delivery',atMinute:1440,intervalMinutes:1440,occurrences:3}]};const before=JSON.stringify(c.state);fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain('Day 2 00:00');expect(fixture.nativeElement.textContent).toContain('bag');expect(c.upcoming().map((e:any)=>e.id)).toEqual(['delivery:1','delivery:2']);expect(JSON.stringify(c.state)).toBe(before);
 });
});
