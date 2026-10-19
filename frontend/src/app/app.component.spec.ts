import { By } from '@angular/platform-browser';
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
        agents = { getDemeanors: () => of([{type:'analytical',label:'Analytical and Scientific',description:'Approaches questions methodically, values evidence, and tests explanations'},{type:'custom',label:'Custom',description:''}]), createAgent: jasmine.createSpy().and.returnValue(of(agent('new'))), getAgents: jasmine.createSpy().and.returnValue(of([agent('sara'), agent('charlie'), agent('bob')])) };
        experiments = {
            events$: events,
            studies: () => of({studies:[],publications:[],runIds:[]}),
            branches: () => of({branches:[],comparisons:[]}),
            analysis: () => of({metrics:[],benchmarks:[],datasets:[]}),
            research: () => of({runs:[],templates:[],snapshots:[],batches:[],probes:[],systemPrompt:'Fixed system',turnPrompt:'Turn',inputCharLimit:24000}),
            getLlmDefaults: () => of(savedConfig.llmConfig),
            getLlmModels: () => of([{ id: 'loaded' }]),
            getMemoryHistory: () => of({ baselineTurn:-1, lastTurn:-1, state: {entries:[]}, timeline:[] }),
            connectEvents: () => {}, disconnectEvents: () => {},
            startExperiment: jasmine.createSpy().and.returnValue(of({ success: true })),
            resumeExperiment: jasmine.createSpy().and.returnValue(of({ success: true })),
            pauseExperiment: jasmine.createSpy().and.returnValue(of({ success: true })),
            stopExperiment: jasmine.createSpy().and.returnValue(of({ success: true })),
            resetExperiment: jasmine.createSpy().and.returnValue(of({ success: true }))
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

    const selectParticipants = () => { component.setAgentIncluded('bob', true); component.setAgentIncluded('sara', true); };

    const completedTurn = (index: number, response = 'Actual model words') => ({type:'turn_completed',data:{turnRecord:{turnIndex:index,agentId:'bob',agentName:'Bob',response},auditTrail:[]}});

    it('shows a removal icon for every available agent and refreshes only after successful archival',()=>{
        const icons=Array.from(fixture.nativeElement.querySelectorAll('app-agent-archive > button')) as HTMLButtonElement[];
        expect(icons.length).toBe(component.availableAgents.length);
        expect(icons.map(b=>b.getAttribute('aria-label'))).toEqual(['Remove BOB (bob)','Remove CHARLIE (charlie)','Remove SARA (sara)']);
        selectParticipants();agents.getAgents.and.returnValue(of([agent('charlie'),agent('sara')]));component.agentArchived('bob');fixture.detectChanges();
        expect(component.availableAgents.map(a=>a.id)).toEqual(['charlie','sara']);expect(component.nextParticipantIds).toEqual(['sara']);
    });

    it('records recovery settings and keeps correction diagnostics separate from conversation text',()=>{
        selectParticipants();
        component.startExperiment();expect(experiments.startExperiment.calls.mostRecent().args[0].recoveryConfig.correctiveRetries).toBe(3);
        const recovery={phase:'correcting',agentId:'bob',turnIndex:56,correctiveRetry:2,correctiveLimit:3,reason:'Conflicting activity transitions',code:'CONFLICTING_OPERATIONAL_TRANSITIONS'};
        events.next({type:'status_changed',data:{status:'running',config:{...savedConfig,recoveryConfig:component.recoveryConfig},currentTurnIndex:56,recovery}});
        events.next({type:'recovery_attempt',data:{id:'attempt-56-1',type:'recovery_attempt',logicalTurnIndex:56,agentId:'bob',attemptNumber:1,code:recovery.code,recoveryAction:'corrective_retry',stateCommitted:false,correctionMessage:'Private corrective feedback'}});
        fixture.detectChanges();expect(fixture.nativeElement.querySelector('app-recovery-status').textContent).toContain('Corrective retry 2 of 3');expect(component.turns.length).toBe(0);expect(component.auditEvents.length).toBe(1);expect(fixture.nativeElement.querySelector('.transcript').textContent).not.toContain('Private corrective feedback');expect(fixture.nativeElement.querySelector('app-recovery-controls fieldset').disabled).toBeTrue();
    });

    it('separates all setup controls from a single independently scrollable transcript and persistent toolbar', () => {
        const root=fixture.nativeElement;
        expect(component.selectedTab).toBe('setup');
        expect(root.querySelector('#setup-panel').hidden).toBeFalse();
        expect(root.querySelector('#conversation-panel').hidden).toBeTrue();
        for(const selector of ['#conversation-topic','#model-id','#memory-mode','app-operational-controls','app-publication-panel','app-branch-panel','app-social-controls','app-analysis-panel','app-research-panel','.participant-selection']) expect(root.querySelector('#setup-panel').querySelector(selector)).not.toBeNull();
        expect(root.querySelector('.experiment-toolbar').contains(root.querySelector('#run-id'))).toBeTrue();
        expect(root.querySelector('.experiment-toolbar .controls').querySelectorAll('button').length).toBe(5);
        component.selectTab('conversation');fixture.detectChanges();
        expect(root.querySelectorAll('.transcript').length).toBe(1);
        const transcript=root.querySelector('.transcript') as HTMLElement,middle=root.querySelector('.middle-panel') as HTMLElement;
        expect(getComputedStyle(transcript).overflowY).toBe('auto');
        expect(transcript.clientHeight).toBeGreaterThan(middle.clientHeight * .5);
        expect(getComputedStyle(root.querySelector('#setup-panel')).overflowY).toBe('auto');
    });

    it('starts in Conversation and retains mounted research forms and run state while switching tabs', async () => {
        selectParticipants();
        const research=fixture.debugElement.query(By.css('app-research-panel')).componentInstance;
        research.templateId='preserve-this-template';
        const transcript=fixture.nativeElement.querySelector('.transcript');
        component.startExperiment();expect(component.selectedTab).toBe('conversation');
        events.next({type:'status_changed',data:{status:'running',config:savedConfig,currentTurnIndex:0}});
        component.selectTab('setup');fixture.detectChanges();
        events.next({type:'status_changed',data:{status:'running',config:savedConfig,currentTurnIndex:0}});
        expect(component.selectedTab).toBe('setup');
        component.selectTab('conversation');fixture.detectChanges();
        expect(fixture.debugElement.query(By.css('app-research-panel')).componentInstance).toBe(research);
        expect(research.templateId).toBe('preserve-this-template');expect(fixture.nativeElement.querySelector('.transcript')).toBe(transcript);
        expect(experiments.startExperiment.calls.count()).toBe(1);expect(experiments.resumeExperiment).not.toHaveBeenCalled();
        await fixture.whenStable();fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('#conversation-topic').disabled).toBeTrue();
    });

    it('retains completed turns on Stop/completion and leaves Reset semantics to server snapshots', () => {
        events.next({type:'status_changed',data:{status:'running',config:savedConfig,currentTurnIndex:0}});
        events.next(completedTurn(0));component.stopExperiment();
        events.next({type:'status_changed',data:{status:'stopped',config:savedConfig,currentTurnIndex:1}});fixture.detectChanges();
        expect(component.turns.length).toBe(1);expect(component.selectedTab).toBe('conversation');
        expect(fixture.nativeElement.querySelector('progress').value).toBe(1);
        events.next({type:'status_changed',data:{status:'completed',config:savedConfig,currentTurnIndex:1}});
        component.resetExperiment();expect(component.turns.length).toBe(1);expect(experiments.resetExperiment).toHaveBeenCalled();
        events.next({type:'snapshot',data:{status:'idle',config:null,currentTurnIndex:0,turns:[],events:[]}});
        expect(component.nextParticipantIds).toEqual([]);expect(component.turns.length).toBe(0);expect(component.currentTurnIndex).toBe(0);expect(component.availableAgents.length).toBe(3);expect(agents.createAgent).not.toHaveBeenCalled();
    });

    it('follows turns near the bottom, preserves manual reading across tabs and offers an explicit latest action', () => {
        component.selectTab('conversation');const element=fixture.nativeElement.querySelector('.transcript') as HTMLElement;
        let height=1000,position=800;const viewport=200;
        Object.defineProperties(element,{scrollHeight:{configurable:true,get:()=>height},clientHeight:{configurable:true,get:()=>viewport},scrollTop:{configurable:true,get:()=>position,set:(value:number)=>position=Math.max(0,Math.min(value,height-viewport))}});
        fixture.detectChanges();position=740;component.onTranscriptScroll();expect(component.followLatest).toBeTrue();
        height=1200;events.next(completedTurn(0));fixture.detectChanges();expect(position).toBe(1000);
        position=100;component.onTranscriptScroll();expect(component.followLatest).toBeFalse();
        height=1500;events.next(completedTurn(1));fixture.detectChanges();expect(position).toBe(100);expect(component.unseenTurns).toBe(1);
        component.selectTab('setup');fixture.detectChanges();height=1800;events.next(completedTurn(2));fixture.detectChanges();
        component.selectTab('conversation');fixture.detectChanges();expect(position).toBe(100);expect(component.unseenTurns).toBe(2);
        component.scrollToBottom();fixture.detectChanges();expect(position).toBe(1600);expect(component.unseenTurns).toBe(0);
        height=2100;events.next(completedTurn(3));fixture.detectChanges();expect(position).toBe(1900);
    });

    it('preserves speech, action-only, no-op, rejected attempts and memory indicators with readable long text', () => {
        component.selectTab('conversation');
        const text='Original model text\n  Spacing preserved. '+ 'longword'.repeat(500);
        events.next(completedTurn(0,text));
        const action:any=completedTurn(1,'');action.data.turnRecord.turnKind='action_only';action.data.turnRecord.operationalState={location:{id:'garden',name:'Garden'},action:{type:'working',description:'Preparing beds',status:'in_progress'}};action.data.turnRecord.operationalAudit=[{status:'accepted',operation:{action:'set_action'}}];action.data.auditTrail=[{status:'failed',operation:{action:'update',type:'belief',content:'Original proposal',reason:'New evidence'},error:'Missing target'}];events.next(action);
        const noop:any=completedTurn(2,'');noop.data.turnRecord.turnKind='intentional_noop';events.next(noop);
        events.next({type:'experiment_error',data:{id:'failed-attempt',type:'experiment_error',turnIndex:3,agentId:'bob',message:'Unknown location',attempt:{operationalAudit:[{status:'rejected',operation:{action:'set_location'},error:'Unknown location'}]}}});
        fixture.detectChanges();const root=fixture.nativeElement,content=root.querySelector('.turn-content') as HTMLElement;
        expect(content.textContent).toBe(text);expect(getComputedStyle(content).whiteSpace).toBe('pre-wrap');expect(getComputedStyle(content).overflowWrap).toBe('anywhere');expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth+1);
        expect(root.querySelector('.turn-operational').textContent).toContain('Preparing beds');expect(root.querySelector('.memory-indicator').textContent).toContain('1 rejected');expect(root.querySelector('.rejected-attempt').textContent).toContain('Unknown location');
        expect(root.querySelectorAll('.turn').length).toBe(4);expect(root.querySelector('#conversation-panel').textContent).toContain('Speech: None (intentional)');
    });

    it('starts a different run following latest while Resume within the same run preserves reading mode', () => {
        events.next({type:'status_changed',data:{status:'running',config:savedConfig,currentTurnIndex:3}});
        component.followLatest=false;component.selectTab('setup');
        events.next({type:'status_changed',data:{status:'paused',config:savedConfig,currentTurnIndex:3}});
        events.next({type:'status_changed',data:{status:'running',config:savedConfig,currentTurnIndex:3}});
        expect(component.selectedTab).toBe('setup');expect(component.followLatest).toBeFalse();
        events.next({type:'snapshot',data:{status:'running',config:{...savedConfig,runId:'another-run'},currentTurnIndex:0,turns:[],events:[]}});
        expect(component.selectedTab).toBe('conversation');expect(component.followLatest).toBeTrue();expect(component.currentTurnIndex).toBe(0);
    });

    it('supports keyboard tab selection without triggering lifecycle actions', () => {
        const button=fixture.nativeElement.querySelector('#setup-tab') as HTMLButtonElement;
        button.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));fixture.detectChanges();
        expect(component.selectedTab).toBe('conversation');expect(document.activeElement?.id).toBe('conversation-tab');
        expect(experiments.startExperiment).not.toHaveBeenCalled();expect(experiments.resumeExperiment).not.toHaveBeenCalled();
    });

    it('creates preset and custom initial dispositions without changing numerical attributes', () => {
        component.newAgent.id = 'new'; component.newAgent.name = 'New';
        component.demeanorType = 'analytical'; component.createAgent();
        const preset = agents.createAgent.calls.mostRecent().args[0];
        expect(preset.startingDemeanor.type).toBe('analytical');
        expect(preset.stats.curiosity).toEqual({initial:5,current:5});
        component.newAgent.id = 'custom'; component.newAgent.name = 'Custom';
        component.demeanorType = 'custom'; component.customDemeanor = '  Patient and reflective  ';
        component.createAgent();
        expect(agents.createAgent.calls.mostRecent().args[0].startingDemeanor).toEqual({type:'custom',description:'Patient and reflective'});
    });

    it('shows custom input only when selected and rejects empty or oversized custom descriptions', () => {
        component.newAgent.id = 'custom'; component.newAgent.name = 'Custom';
        expect(fixture.nativeElement.querySelector('#custom-demeanor')).toBeNull();
        component.demeanorType = 'custom'; fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('#custom-demeanor').maxLength).toBe(1000);
        for (const text of ['   ', 'x'.repeat(1001)]) { component.customDemeanor=text; component.createAgent(); }
        expect(agents.createAgent).not.toHaveBeenCalled();
        expect(component.agentCreationError).toContain('1–1,000');
    });

    it('omits demeanor for legacy behavior and displays saved demeanor without an edit control', () => {
        component.newAgent.id = 'new'; component.newAgent.name = 'New'; component.createAgent();
        expect(agents.createAgent.calls.mostRecent().args[0].startingDemeanor).toBeUndefined();
        component.availableAgents[0].startingDemeanor={type:'custom',description:'Patient and reflective'};
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.starting-demeanor').textContent).toContain('Patient and reflective');
    });

    it('displays observational contamination warnings alongside the original proposed memory', () => {
        const content='[c9d4f211-3b7a-4e8c-9f12-6a0e8b5c2d47] belief (confidence=0.6): Original words';
        component.auditEvents=[{type:'memory_update',turnIndex:2,agentId:'bob',operations:[{
            status:'success',operation:{action:'add',type:'belief',content,reason:'Observed'},
            warnings:[{operationIndex:0,message:'Serialized record metadata detected; original content retained.'}]
        }]}];
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.memory-warning').textContent).toContain('Warning (operation 1)');
        expect(fixture.nativeElement.querySelector('.log-entry').textContent).toContain(content);
    });

    it('sends and freezes operational configuration, then displays validated silent turns without inventing speech', () => {
        component.operationalConfig.locations=[{id:'garden',name:'Garden'}];selectParticipants();component.startExperiment();
        expect(experiments.startExperiment.calls.mostRecent().args[0].operationalConfig.locations[0].id).toBe('garden');
        const operational={location:{id:'garden',name:'Garden'},action:{type:'working',description:'Preparing rows',status:'in_progress'},outcomeVerified:false};
        const turn={turnIndex:0,agentId:'bob',agentName:'Bob',response:'',turnKind:'action_only',operationalState:operational,operationalAudit:[{status:'accepted',operation:{action:'set_location',location_id:'garden'}}]};
        events.next({type:'snapshot',data:{status:'paused',config:{...savedConfig,operationalConfig:{enabled:true,locations:[{id:'garden',name:'Garden'}],observationPolicy:'self_only'}},turns:[turn],events:[],operationalStates:{bob:operational}}});
        fixture.detectChanges();expect(component.configurationLocked).toBeTrue();expect(component.operationalFor('bob')).toEqual(operational);
        expect(fixture.nativeElement.querySelector('.turn-operational').textContent).toContain('Preparing rows');
        expect(fixture.nativeElement.textContent).toContain('Speech: None (intentional)');
        expect(fixture.nativeElement.querySelector('app-operational-controls fieldset').disabled).toBeTrue();
    });

    it('starts with all agents unchecked and submits explicitly selected agents in deterministic order', () => {
        expect(component.nextParticipantIds).toEqual([]);
        const checkboxes = fixture.nativeElement.querySelectorAll('.agent-card input[type=checkbox]');
        expect(checkboxes.length).toBe(3);
        expect(Array.from(checkboxes).every((input: any) => !input.checked)).toBeTrue();
        component.startExperiment();
        expect(experiments.startExperiment).not.toHaveBeenCalled();
        component.setAgentIncluded('sara', true); component.setAgentIncluded('bob', true); component.setAgentIncluded('charlie', true);
        component.startExperiment();
        expect(experiments.startExperiment.calls.mostRecent().args[0].agentIds).toEqual(['bob','charlie','sara']);
    });

    it('sends exactly two checked agents and retains choices when agents reload', () => {
        const checkboxes = fixture.nativeElement.querySelectorAll('.agent-card input[type=checkbox]');
        (checkboxes[2] as HTMLInputElement).click(); (checkboxes[0] as HTMLInputElement).click(); fixture.detectChanges();
        component.loadAgents();
        expect(component.nextParticipantIds).toEqual(['bob','sara']);
        component.startExperiment();
        expect(experiments.startExperiment.calls.mostRecent().args[0].agentIds).toEqual(['bob','sara']);
    });

    it('leaves newly discovered agents unchecked while preserving explicit selections', () => {
        selectParticipants();
        agents.getAgents.and.returnValue(of([agent('sara'),agent('new'),agent('bob'),agent('charlie')]));
        component.loadAgents();
        expect(component.nextParticipantIds).toEqual(['bob','sara']);
        expect(component.selectedAgentIds.has('new')).toBeFalse();
    });

    it('rejects fewer than two selections with an inline diagnostic and no start request', () => {
        component.setAgentIncluded('bob', true);
        component.startExperiment(); fixture.detectChanges();
        expect(experiments.startExperiment).not.toHaveBeenCalled();
        expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('Select at least two agents');
    });

    it('trims the optional multiline topic and rejects oversized topics', () => {
        selectParticipants();
        component.initialTopic = ' \nWhat makes someone trustworthy?\n ';
        component.startExperiment();
        expect(experiments.startExperiment.calls.mostRecent().args[0].initialTopic).toBe('What makes someone trustworthy?');
        expect((fixture.nativeElement.querySelector('#conversation-topic') as HTMLTextAreaElement).maxLength).toBe(8000);
        experiments.startExperiment.calls.reset();
        component.initialTopic = 'x'.repeat(8001); component.startExperiment();
        expect(experiments.startExperiment).not.toHaveBeenCalled();
        expect(component.diagnostic).toContain('8,000');
    });

    it('restores the saved participant order/topic and locks edits for active and completed runs', async () => {
        for (const status of ['running','paused','stopped','completed']) {
            events.next({ type: 'status_changed', data: { status, config: savedConfig } });
            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();
            const boxes = Array.from(fixture.nativeElement.querySelectorAll('.agent-card input[type=checkbox]')) as HTMLInputElement[];
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
        selectParticipants();
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

    it('preserves saved social rules, displays declines and receives source-linked environmental events',()=>{
        const config={...savedConfig,socialConfig:{enabled:true},taskConfig:{kind:'public_goods',endowment:8,multiplier:2,prize:10},feedbackConfig:{enabled:true,source:'task',timing:'delayed',delayTurns:3,visibility:'public',positiveScore:1,negativeScore:-1,maxVisible:20}};
        events.next({type:'snapshot',data:{status:'paused',config,turns:[{turnIndex:0,agentName:'BOB',social:{action:'decline',recipient_id:null},response:''}],events:[]}});
        fixture.detectChanges();expect(component.configurationLocked).toBeTrue();expect(component.feedbackConfig.delayTurns).toBe(3);
        expect(fixture.nativeElement.textContent).toContain('declined to speak');
        const event={id:'reward',type:'feedback',turnIndex:0,score:2};events.next({type:'environment_event',data:event});events.next({type:'environment_event',data:event});
        expect(component.auditEvents.filter(e=>e.id==='reward').length).toBe(1);
        component.resumeExperiment();expect(experiments.resumeExperiment).toHaveBeenCalledWith();
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
        expect(component.nextParticipantIds).toEqual([]);
    });
});
