import {TestBed} from '@angular/core/testing';
import {RecoveryControlsComponent,defaultRecoveryConfig} from './recovery-controls.component';
import {RecoveryStatusComponent,RecoveryAuditComponent} from './recovery-status.component';
describe('Error recovery dashboard',()=>{
 it('provides the configured defaults and rejects invalid retry/backoff limits',()=>{
  const config=defaultRecoveryConfig();expect(config.correctiveRetries).toBe(3);expect(config.technicalRetries).toBe(5);expect(config.initialBackoffMs).toBe(2000);expect(config.persistentRetryIntervalMs).toBe(60000);expect(RecoveryControlsComponent.valid(config)).toBeTrue();
  for(const change of [{correctiveRetries:-1},{technicalRetries:1.5},{maxBackoffMs:100},{persistentRetryIntervalMs:10}])expect(RecoveryControlsComponent.valid({...config,...change})).toBeFalse();
 });
 it('locks configuration during an active run',()=>{
  const fixture=TestBed.createComponent(RecoveryControlsComponent);fixture.componentInstance.locked=true;fixture.detectChanges();expect(fixture.nativeElement.querySelector('fieldset').disabled).toBeTrue();expect(fixture.nativeElement.textContent).toContain('Error Recovery');
 });
 it('distinguishes ordinary generation, corrective retry, technical retry, connection wait and suspension',()=>{
  const fixture=TestBed.createComponent(RecoveryStatusComponent),c=fixture.componentInstance;
  for(const [phase,label] of [['generating','Generating turn'],['correcting','Correcting rejected proposal'],['retrying','Retrying inference'],['waiting','Waiting for LLM reconnection'],['suspended','Safely suspended'],['stopped','Stopped by researcher'],['repairing','Repairing turn storage']]){
   c.state={phase,turnIndex:56,agentId:'helena',correctiveRetry:2,correctiveLimit:3,reason:'Conflicting activity transitions',simulationMinute:1920};fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain(label);expect(fixture.nativeElement.textContent).toContain('Day 2 08:00');
  }
 });
 it('keeps rejected attempts and corrections in a separate expandable audit view',()=>{
  const fixture=TestBed.createComponent(RecoveryAuditComponent),c=fixture.componentInstance;c.event={attemptNumber:2,code:'CONFLICTING_OPERATIONAL_TRANSITIONS',recoveryAction:'corrective_retry',logicalTurnIndex:56,agentId:'helena',stateCommitted:false,correctionMessage:'Private backend correction',proposedOperations:{operational:[]}};fixture.detectChanges();expect(fixture.nativeElement.textContent).not.toContain('Private backend correction');c.open=true;fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain('Private backend correction');expect(fixture.nativeElement.textContent).toContain('committed: false');
 });
});
