import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { AppComponent } from './app.component';
import { AgentService } from './services/agent.service';
import { ExperimentService } from './services/experiment.service';

describe('Experiment participants and initial topic', () => {
    let fixture: ComponentFixture<AppComponent>;
    let component: AppComponent;
    let events: Subject<{type: string; data: any}>;
    let agents: any;
    let experiments: any;
    const agent = (id: string) => ({ id, name: id.toUpperCase(), stats: {} });
    const savedConfig = {
        runId: 'saved-run', agentIds: ['sara', 'bob'], initialTopic: 'Saved topic', maxTurns: 100,
        llmConfig: { baseUrl: 'http://127.0.0.1:8080/v1', model: 'loaded', maxTokens: 2048, outputMode: 'json_schema' }
    };

    beforeEach(async () => {
        events = new Subject();
        agents = { getAgents: jasmine.createSpy().and.returnValue(of([agent('sara'), agent('charlie'), agent('bob')])) };
        experiments = {
            events$: events,
            getLlmDefaults: () => of(savedConfig.llmConfig),
            getLlmModels: () => of([{ id: 'loaded' }]),
            getMemoryHistory: () => of({ baselineTurn:-1, lastTurn:-1, state: {entries:[]}, timeline:[] }),
            connectEvents: () => {}, disconnectEvents: () => {},
            startExperiment: jasmine.createSpy().and.returnValue(of({ success: true })),
            resumeExperiment: jasmine.createSpy().and.returnValue(of({ success: true }))
        };
        await TestBed.configureTestingModule({
            imports: [AppComponent],
            providers: [{ provide: AgentService, useValue: agents }, { provide: ExperimentService, useValue: experiments }]
        }).compileComponents();
        fixture = TestBed.createComponent(AppComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    afterEach(() => fixture.destroy());

    it('defaults all agents to selected and keeps deterministic ID order', () => {
        expect(component.nextParticipantIds).toEqual(['bob','charlie','sara']);
        const checkboxes = fixture.nativeElement.querySelectorAll('input[type=checkbox]');
        expect(checkboxes.length).toBe(3);
        expect(Array.from(checkboxes).every((input: any) => input.checked)).toBeTrue();
        component.startExperiment();
        expect(experiments.startExperiment.calls.mostRecent().args[0].agentIds).toEqual(['bob','charlie','sara']);
    });

    it('sends exactly two checked agents and retains unchecked choices when agents reload', () => {
        const checkbox = fixture.nativeElement.querySelectorAll('input[type=checkbox]')[1] as HTMLInputElement;
        checkbox.click(); fixture.detectChanges();
        component.loadAgents();
        expect(component.nextParticipantIds).toEqual(['bob','sara']);
        component.startExperiment();
        expect(experiments.startExperiment.calls.mostRecent().args[0].agentIds).toEqual(['bob','sara']);
    });

    it('defaults newly discovered agents to selected without reselecting unchecked agents', () => {
        component.setAgentIncluded('charlie', false);
        agents.getAgents.and.returnValue(of([agent('sara'),agent('new'),agent('bob'),agent('charlie')]));
        component.loadAgents();
        expect(component.nextParticipantIds).toEqual(['bob','new','sara']);
    });

    it('rejects fewer than two selections with an inline diagnostic and no start request', () => {
        component.setAgentIncluded('charlie', false); component.setAgentIncluded('sara', false);
        component.startExperiment(); fixture.detectChanges();
        expect(experiments.startExperiment).not.toHaveBeenCalled();
        expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('Select at least two agents');
    });

    it('trims the optional multiline topic and rejects oversized topics', () => {
        component.initialTopic = ' \nWhat makes someone trustworthy?\n ';
        component.startExperiment();
        expect(experiments.startExperiment.calls.mostRecent().args[0].initialTopic).toBe('What makes someone trustworthy?');
        expect((fixture.nativeElement.querySelector('#conversation-topic') as HTMLTextAreaElement).maxLength).toBe(1000);
        experiments.startExperiment.calls.reset();
        component.initialTopic = 'x'.repeat(1001); component.startExperiment();
        expect(experiments.startExperiment).not.toHaveBeenCalled();
        expect(component.diagnostic).toContain('1,000');
    });

    it('restores the saved participant order/topic and locks edits for active and completed runs', async () => {
        for (const status of ['running','paused','stopped','completed']) {
            events.next({ type: 'status_changed', data: { status, config: savedConfig } });
            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();
            const boxes = Array.from(fixture.nativeElement.querySelectorAll('input[type=checkbox]')) as HTMLInputElement[];
            expect(boxes.every(input => input.disabled)).toBeTrue();
            expect(boxes.map(input => input.checked)).toEqual([true,false,true]);
            expect((fixture.nativeElement.querySelector('#conversation-topic') as HTMLTextAreaElement).disabled).toBeTrue();
            expect(component.initialTopic).toBe('Saved topic');
            expect(Array.from(fixture.nativeElement.querySelectorAll('.saved-participants li')).map((li: any) => li.textContent.trim())).toEqual(['SARA (sara)','BOB (bob)']);
            component.setAgentIncluded('charlie', true);
            expect(component.selectedAgentIds.has('charlie')).toBeFalse();
        }
    });

    it('records memory condition and limits, restores them, and freezes controls during runs', async () => {
        component.memoryConfig.mode = 'none';
        component.setMemoryLimit('retrievalEntries', 4);
        component.startExperiment();
        expect(experiments.startExperiment.calls.mostRecent().args[0].memoryConfig.mode).toBe('none');
        expect(experiments.startExperiment.calls.mostRecent().args[0].memoryConfig.retrievalEntries).toBe(4);
        events.next({type:'status_changed',data:{status:'paused',config:{...savedConfig,memoryConfig:{mode:'enabled',retrievalEntries:8}}}});
        fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
        expect(component.memoryConfig.retrievalEntries).toBe(8);
        expect((fixture.nativeElement.querySelector('#memory-mode') as HTMLSelectElement).matches(':disabled')).toBeTrue();
        component.setMemoryLimit('retrievalEntries', 10);
        expect(component.memoryConfig.retrievalEntries).toBe(8);
        events.next({type:'status_changed',data:{status:'completed',config:savedConfig}});
        expect(component.memoryConfig.mode).toBe('enabled');
        expect(component.memoryConfig.retrievalEntries).toBe(24);
    });

    it('Resume sends no replacement configuration; legacy topics display as empty', () => {
        const { initialTopic, ...legacy } = savedConfig;
        events.next({ type: 'status_changed', data: { status: 'paused', config: legacy } });
        component.resumeExperiment();
        expect(experiments.resumeExperiment).toHaveBeenCalledWith();
        expect(component.initialTopic).toBe('');
        expect(component.savedAgentIds).toEqual(['sara','bob']);
        events.next({ type: 'snapshot', data: { status: 'idle', config: null, turns: [], events: [] } });
        expect(component.configurationLocked).toBeFalse();
        expect(component.nextParticipantIds).toEqual(['bob','sara']);
    });
});
