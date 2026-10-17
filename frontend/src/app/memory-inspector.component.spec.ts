import { TestBed, ComponentFixture } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { MemoryInspectorComponent } from './memory-inspector.component';
import { ExperimentService } from './services/experiment.service';

describe('Memory history explorer', () => {
    let fixture: ComponentFixture<MemoryInspectorComponent>;
    let component: MemoryInspectorComponent;
    let service: any;
    const entry = { id:'belief-1',type:'belief',content:'Revised opinion',confidence:0.8,importance:0.6,status:'active',
        source:{runId:'run-a',turnIndex:0,eventId:'event-0'},updated_at:'2026-01-01T00:00:00Z' };
    const history = {
        turnIndex:2,baselineTurn:-1,lastTurn:2,compareTo:0,state:{entries:[entry]},
        timeline:[{turnIndex:2,timestamp:'2026-01-01T00:00:00Z',operations:[{operation:{type:'belief',action:'update',reason:'New evidence'},status:'success'}],retrieval:{selectedIds:['belief-1'],summaryIds:[],omittedEntries:0,mode:'enabled'}}],
        diff:{added:[],removed:[],stats:[],changed:[{before:{...entry,content:'Earlier opinion',confidence:0.5},after:entry}]}
    };
    beforeEach(async()=>{
        service={getMemoryHistory:jasmine.createSpy().and.returnValue(of(history))};
        await TestBed.configureTestingModule({imports:[MemoryInspectorComponent],providers:[{provide:ExperimentService,useValue:service}]}).compileComponents();
        fixture=TestBed.createComponent(MemoryInspectorComponent);component=fixture.componentInstance;
        component.runId='run-a';component.agentIds=['bob','sara'];component.ngOnChanges();fixture.detectChanges();
    });
    afterEach(()=>fixture.destroy());

    it('renders separate state categories, provenance, timeline and before/after changes',()=>{
        const text=fixture.nativeElement.textContent;
        for(const label of ['Episodic observations','Beliefs & opinions','Self-description','Relationships','run-a / turn 0','Earlier opinion','Revised opinion','New evidence']) expect(text).toContain(label);
        expect(service.getMemoryHistory).toHaveBeenCalledWith('run-a','bob',undefined,undefined);
        expect(component.indices).toEqual([-1,0,1,2]);
    });
    it('requests selected historical turns and comparison snapshots',()=>{
        component.turn=0;component.compareTo=-1;component.inspect();
        expect(service.getMemoryHistory).toHaveBeenCalledWith('run-a','bob',0,-1);
    });
    it('ignores pending results from a prior agent and clears history when the run resets',()=>{
        const pending=new Subject<any>();service.getMemoryHistory.and.returnValue(pending);
        component.inspect();component.agentId='sara';service.getMemoryHistory.and.returnValue(of({...history,state:{entries:[]}}));component.inspect();
        pending.next(history);expect(component.entries('belief').length).toBe(0);
        component.runId='';component.agentIds=[];component.ngOnChanges();
        expect(component.history).toBeNull();expect(component.agentId).toBe('');
    });
    it('reports unavailable legacy history and retains no invented historical snapshot',()=>{
        service.getMemoryHistory.and.returnValue(throwError(()=>({error:{error:'No Phase II memory history recorded for this run'}})));
        component.inspect();fixture.detectChanges();
        expect(component.history).toBeNull();expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('No Phase II memory history');
    });
});
