import {RecoveryControlsComponent,defaultRecoveryConfig} from './recovery-controls.component';
import {RecoveryStatusComponent,RecoveryAuditComponent} from './recovery-status.component';
import {WorldControlsComponent,defaultWorldConfig} from './world-controls.component';
import {WorldStateComponent} from './world-state.component';
import {OperationalControlsComponent} from './operational-controls.component';
import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { PublicationPanelComponent } from './publication-panel.component';
import { BranchPanelComponent } from './branch-panel.component';
import { SocialControlsComponent } from './social-controls.component';
import { AnalysisPanelComponent } from './analysis-panel.component';
import { RouterOutlet } from '@angular/router';
import { ResearchPanelComponent } from './research-panel.component';
import { MemoryInspectorComponent } from './memory-inspector.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgentService, AgentIdentity, DemeanorOption } from './services/agent.service';
import { ExperimentService } from './services/experiment.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RecoveryControlsComponent,RecoveryStatusComponent,RecoveryAuditComponent,WorldControlsComponent,WorldStateComponent,OperationalControlsComponent, CommonModule, FormsModule, MemoryInspectorComponent, ResearchPanelComponent, AnalysisPanelComponent, RouterOutlet, SocialControlsComponent, BranchPanelComponent, PublicationPanelComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('transcriptContainer') private transcriptContainer!: ElementRef;

  readonly reviewMode = window.location.pathname === '/review';

  availableAgents: AgentIdentity[] = [];
  selectedAgentIds = new Set<string>();
  savedAgentIds: string[] | null = null;
  initialTopic = '';
  operationalConfig:any={enabled:true,locations:[],observationPolicy:'self_only'};
  recoveryConfig:any=defaultRecoveryConfig();
  recovery:any={phase:'idle'};
  worldConfig:any=defaultWorldConfig();
  worldState:any;
  worldConfigurationValid=true;
  worldControl(action:string,body:any){this.perform(this.experimentService.world(action,body));}
  simulationTime(minute:number){return `Day ${Math.floor(minute/1440)+1} ${String(Math.floor(minute%1440/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;}
  operationalStates:Record<string,any>={};
  operationalFor(id:string){return this.operationalStates[id] ?? this.availableAgents.find(a=>a.id===id)?.operationalState;}

  socialConfig = {enabled:false};
  taskConfig = {kind:'none',endowment:10,multiplier:1.5,prize:20};
  feedbackConfig = {enabled:false,source:'researcher',timing:'immediate',delayTurns:1,visibility:'private',positiveScore:1,negativeScore:-1,maxVisible:20};
  readonly defaultMemoryConfig = {
      mode: 'enabled', maxActiveEntries: 200, maxOperations: 20, maxEntryChars: 2000,
      retrievalEntries: 24, retrievalChars: 12000, entryChars: 1000, summaryChars: 2000,
      transcriptTurns: 10, transcriptChars: 8000, retrievalRule: 'importance'
  };
  memoryConfig = { ...this.defaultMemoryConfig };
  memoryLimits = [
      {key:'maxActiveEntries', label:'Maximum active entries', min:1, max:1000},
      {key:'maxOperations', label:'Operations per turn', min:1, max:50},
      {key:'maxEntryChars', label:'Characters per stored entry', min:1, max:8000},
      {key:'retrievalEntries', label:'Retrieved entries', min:0, max:100},
      {key:'retrievalChars', label:'Retrieved memory characters', min:0, max:32000},
      {key:'entryChars', label:'Characters per retrieved entry', min:1, max:8000},
      {key:'summaryChars', label:'Extractive digest characters', min:0, max:8000},
      {key:'transcriptTurns', label:'Recent transcript turns', min:0, max:100},
      {key:'transcriptChars', label:'Transcript characters', min:0, max:32000}
  ];
  memoryLimit(key: string): any { return (this.memoryConfig as any)[key]; }
  setMemoryLimit(key: string, value: number) { if (!this.configurationLocked) (this.memoryConfig as any)[key] = value; }


  get researchConfiguration() {
      return {runId:this.runId,agentIds:this.savedAgentIds ? [...this.savedAgentIds] : this.nextParticipantIds,initialTopic:this.initialTopic,
          ...(this.worldConfig.enabled?{worldConfig:structuredClone(this.worldConfig)}:{}),recoveryConfig:structuredClone(this.recoveryConfig),operationalConfig:structuredClone(this.operationalConfig),socialConfig:{...this.socialConfig},taskConfig:{...this.taskConfig},feedbackConfig:{...this.feedbackConfig},maxTurns:this.maxTurns,memoryConfig:{...this.memoryConfig},llmConfig:{baseUrl:this.llmBaseUrl,model:this.selectedModel,maxTokens:this.maxTokens,outputMode:this.outputMode}};
  }

  get configurationLocked(): boolean { return this.requestPending || this.experimentStatus !== 'idle'; }

  get nextParticipantIds(): string[] {
      // Stable ID ordering is independent of click order and filesystem listing order.
      return this.availableAgents.filter(agent => this.selectedAgentIds.has(agent.id)).map(agent => agent.id);
  }

  setAgentIncluded(id: string, included: boolean) {
      if (this.configurationLocked) return;
      if (included) this.selectedAgentIds.add(id);
      else this.selectedAgentIds.delete(id);
  }

  participantLabel(id: string): string {
      const agent = this.availableAgents.find(agent => agent.id === id);
      return agent ? `${agent.name} (${id})` : id;
  }

  demeanorOptions: DemeanorOption[] = [];
  demeanorType = '';
  customDemeanor = '';
  agentCreationError = '';

  demeanorLabel(type: string) {
      return this.demeanorOptions.find(option => option.type === type)?.label ?? type;
  }

  newAgent = {
      id: '',
      name: '',
      stats: {
          curiosity: 5,
          sociability: 5
      }
  };

  experimentStatus: string = 'idle';
  runId: string = 'run-test-01';
  maxTurns: number = 100;

  llmBaseUrl = 'http://127.0.0.1:8080/v1';
  models: {id: string}[] = [];
  selectedModel = '';
  maxTokens = 2048;
  outputMode: 'json_schema' | 'json_only' = 'json_schema';
  diagnostic = '';
  connectionMessage = '';
  requestPending = false;

  selectedTab: 'conversation' | 'setup' = 'setup';
  currentTurnIndex = 0;
  followLatest = true;
  unseenTurns = 0;
  private pendingTranscriptScroll = true;
  private pendingScrollRestore: number | null = null;
  private savedTranscriptScrollTop = 0;
  private lastTranscriptHeight = 0;

  turns: any[] = [];
  auditEvents: any[] = [];
  activeTurnAgent: string | null = null;

  private eventsSub!: Subscription;

  constructor(
      private agentService: AgentService,
      private experimentService: ExperimentService
  ) {}

  ngOnInit() {
      if (this.reviewMode) return;
      this.loadAgents();
      this.agentService.getDemeanors().subscribe({
          next: options => this.demeanorOptions = options,
          error: () => this.agentCreationError = 'Could not load starting demeanor options.'
      });

      this.experimentService.getLlmDefaults().subscribe({
          next: defaults => {
              // Never replace a running experiment's recorded settings.
              if (this.experimentStatus === 'idle') {
                  this.llmBaseUrl = defaults.baseUrl;
                  this.maxTokens = defaults.maxTokens;
                  this.outputMode = defaults.outputMode;
              }
              this.discoverModels();
          },
          error: err => this.showError(err)
      });
      this.eventsSub = this.experimentService.events$.subscribe(event => this.handleServerEvent(event));
      this.experimentService.connectEvents();
  }

  ngOnDestroy() {
      if (this.eventsSub) {
          this.eventsSub.unsubscribe();
      }
      this.experimentService.disconnectEvents();
  }

  ngAfterViewChecked() {
      const element = this.transcriptContainer?.nativeElement as HTMLElement | undefined;
      if (this.selectedTab !== 'conversation' || !element?.clientHeight) return;
      if (this.pendingScrollRestore !== null) {
          element.scrollTop = this.pendingScrollRestore;
          this.pendingScrollRestore = null;
      } else if (this.followLatest && (this.pendingTranscriptScroll || element.scrollHeight !== this.lastTranscriptHeight)) {
          element.scrollTop = element.scrollHeight;
      }
      this.lastTranscriptHeight = element.scrollHeight;
      this.pendingTranscriptScroll = false;
  }

  selectTab(tab: 'conversation' | 'setup') {
      if (this.selectedTab === tab) return;
      if (this.selectedTab === 'conversation') this.savedTranscriptScrollTop = this.transcriptContainer?.nativeElement.scrollTop ?? 0;
      this.selectedTab = tab;
      if (tab === 'conversation') {
          if (this.followLatest) { this.pendingTranscriptScroll = true; this.unseenTurns = 0; }
          else this.pendingScrollRestore = this.savedTranscriptScrollTop;
      }
  }

  onTabKeydown(event: KeyboardEvent, tab: 'conversation' | 'setup') {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const target = event.key === 'Home' ? 'conversation' : event.key === 'End' ? 'setup' : tab === 'conversation' ? 'setup' : 'conversation';
      this.selectTab(target);
      document.getElementById(target === 'setup' ? 'setup-tab' : 'conversation-tab')?.focus();
  }

  onTranscriptScroll() {
      const element = this.transcriptContainer?.nativeElement as HTMLElement | undefined;
      if (this.selectedTab !== 'conversation' || !element?.clientHeight) return;
      this.savedTranscriptScrollTop = element.scrollTop;
      this.followLatest = element.scrollHeight - element.clientHeight - element.scrollTop <= 80;
      if (this.followLatest) this.unseenTurns = 0;
  }

  scrollToBottom(): void {
      this.followLatest = true;
      this.unseenTurns = 0;
      this.pendingTranscriptScroll = true;
      this.pendingScrollRestore = null;
      if (this.selectedTab === 'conversation' && this.transcriptContainer) this.transcriptContainer.nativeElement.scrollTop = this.transcriptContainer.nativeElement.scrollHeight;
  }

  get worldEvents():any[]{return this.auditEvents.flatMap(event=>event.type==='world_checkpoint'?event.events??[]:event.type?.startsWith('world_')?[event]:[]).filter(event=>event.type==='world_scheduled_event');}

  get rejectedOperationalAttempts(): any[] {
      return this.auditEvents.filter(event => event.type === 'experiment_error' && event.attempt?.operationalAudit?.length);
  }

  memoryEventCount(turn: any, status: string): number {
      return (turn.auditTrail || []).filter((operation: any) => operation.status === status).length;
  }

  loadAgents() {
      this.agentService.getAgents().subscribe({
          next: (agents) => {
              this.availableAgents = [...agents].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
              if (this.savedAgentIds) this.selectedAgentIds = new Set(this.savedAgentIds);
              else {
                  // Participation is opt-in, including newly created/discovered agents.
                  const availableIds = new Set(agents.map(agent => agent.id));
                  this.selectedAgentIds = new Set([...this.selectedAgentIds].filter(id => availableIds.has(id)));
              }
          },
          error: (err) => console.error('Failed to load agents', err)
      });
  }

  createAgent() {
      this.agentCreationError = '';
      if (!this.newAgent.id || !this.newAgent.name) { this.agentCreationError = 'Provide an agent ID and name.'; return; }
      const option = this.demeanorOptions.find(item => item.type === this.demeanorType);
      const description = this.demeanorType === 'custom' ? this.customDemeanor.trim() : option?.description;
      if (this.demeanorType && (!option || !description || description.length > 1000)) {
          this.agentCreationError = 'Select a starting demeanor; custom descriptions require 1–1,000 characters.';
          return;
      }
      const payload = {
          id: this.newAgent.id,
          name: this.newAgent.name,
          ...(option ? {startingDemeanor:{type:option.type,description:description!}} : {}),
          stats: {
              curiosity: { initial: this.newAgent.stats.curiosity, current: this.newAgent.stats.curiosity },
              sociability: { initial: this.newAgent.stats.sociability, current: this.newAgent.stats.sociability }
          }
      };

      this.agentService.createAgent(payload).subscribe({
          next: () => {
              this.loadAgents();
              this.newAgent.id = '';
              this.newAgent.name = '';
              this.demeanorType = '';
              this.customDemeanor = '';
          },
          error: (err) => this.agentCreationError = err.error?.error || 'Could not create agent.'
      });
  }

  startExperiment() {
      if(!RecoveryControlsComponent.valid(this.recoveryConfig)){this.diagnostic='Correct Error Recovery settings before starting.';return;}
      if(this.worldConfig.enabled&&!this.worldConfigurationValid){this.diagnostic='Correct World Simulation JSON fields before starting.';return;}
      if (this.requestPending || (this.experimentStatus !== 'idle' && this.experimentStatus !== 'stopped')) return;
      const agentIds = this.experimentStatus === 'stopped' && this.savedAgentIds ? [...this.savedAgentIds] : this.nextParticipantIds;
      if (agentIds.length < 2) {
          this.diagnostic = "Select at least two agents to start.";
          return;
      }

      const initialTopic = this.initialTopic.trim();
      if (initialTopic.length > 1000) { this.diagnostic = 'Conversation topic must be at most 1,000 characters'; return; }
      const config = {
          runId: this.runId,
          agentIds,
          initialTopic,
          ...(this.worldConfig.enabled?{worldConfig:structuredClone(this.worldConfig)}:{}),recoveryConfig:structuredClone(this.recoveryConfig),operationalConfig:structuredClone(this.operationalConfig),socialConfig:{...this.socialConfig},taskConfig:{...this.taskConfig},feedbackConfig:{...this.feedbackConfig},
          memoryConfig: { ...this.memoryConfig },
          maxTurns: this.maxTurns,
          llmConfig: {
              baseUrl: this.llmBaseUrl,
              model: this.selectedModel,
              maxTokens: this.maxTokens,
              outputMode: this.outputMode
          }
      };

      if (!this.selectedModel) { this.diagnostic = 'Discover and select a loaded model first.'; return; }
      this.selectTab('conversation');
      this.perform(this.experimentService.startExperiment(config));
  }

  discoverModels() {
      const baseUrl = this.llmBaseUrl;
      this.experimentService.getLlmModels(baseUrl).subscribe({
          next: models => {
              if (baseUrl !== this.llmBaseUrl) return;
              this.models = models;
              if (!models.some(m => m.id === this.selectedModel)) this.selectedModel = models.length === 1 ? models[0].id : '';
              if (!models.length) this.diagnostic = 'No loaded models found at this endpoint.';
          },
          error: err => this.showError(err)
      });
  }

  showError(err: any) { this.diagnostic = err?.error?.error || err?.message || 'Request failed'; }
  perform(request: import('rxjs').Observable<any>) {
      this.requestPending = true;
      request.subscribe({
          next: () => { this.requestPending = false; },
          error: err => { this.requestPending = false; this.showError(err); }
      });
  }
  pauseExperiment() { this.perform(this.experimentService.pauseExperiment()); }
  resumeExperiment() { this.perform(this.experimentService.resumeExperiment()); }
  stopExperiment() { this.perform(this.experimentService.stopExperiment()); }
  resetExperiment() { this.perform(this.experimentService.resetExperiment()); }

  private applyState(state: any) {
      const previousStatus = this.experimentStatus;
      const previousRunId = this.savedAgentIds ? this.runId : null;
      if (state.config && previousRunId !== state.config.runId) {
          this.followLatest = true;
          this.unseenTurns = 0;
          this.pendingTranscriptScroll = true;
          this.pendingScrollRestore = null;
          this.savedTranscriptScrollTop = 0;
      }
      if (Number.isSafeInteger(state.currentTurnIndex)) this.currentTurnIndex = state.currentTurnIndex;
      if (state.status === 'running' && (previousStatus === 'idle' || previousStatus === 'stopped' || previousRunId !== state.config?.runId)) this.selectTab('conversation');
      this.recovery=state.recovery??{phase:'idle'};
      this.experimentStatus = state.status;
      this.activeTurnAgent = state.activeAgentId ?? null;
      this.diagnostic = state.error?.message || '';
      if (state.config) {
          this.savedAgentIds = [...state.config.agentIds];
          this.selectedAgentIds = new Set(this.savedAgentIds);
          this.socialConfig = {enabled:false,...state.config.socialConfig};
          this.taskConfig = {kind:'none',endowment:10,multiplier:1.5,prize:20,...state.config.taskConfig};
          this.feedbackConfig = {enabled:false,source:'researcher',timing:'immediate',delayTurns:1,visibility:'private',positiveScore:1,negativeScore:-1,maxVisible:20,...state.config.feedbackConfig};
          this.recoveryConfig={...defaultRecoveryConfig(),enabled:false,...state.config.recoveryConfig};
          this.worldState=state.worldState;
          this.worldConfig=structuredClone(state.config.worldConfig??defaultWorldConfig());
          this.operationalConfig=structuredClone(state.config.operationalConfig ?? {enabled:false,locations:[],observationPolicy:'self_only'});
          this.initialTopic = state.config.initialTopic ?? '';
          this.memoryConfig = { ...this.defaultMemoryConfig, ...state.config.memoryConfig };
          this.runId = state.config.runId;
          this.maxTurns = state.config.maxTurns;
          this.llmBaseUrl = state.config.llmConfig.baseUrl;
          this.selectedModel = state.config.llmConfig.model;
          this.maxTokens = state.config.llmConfig.maxTokens;
          this.outputMode = state.config.llmConfig.outputMode;
      } else {
          if (this.savedAgentIds) this.selectedAgentIds.clear();
          this.savedAgentIds = null;
          this.operationalStates={};
          this.worldState=undefined;
          this.currentTurnIndex = 0;
          this.followLatest = true;
          this.unseenTurns = 0;
          this.pendingTranscriptScroll = true;
          this.pendingScrollRestore = null;
      }
  }

  handleServerEvent(event: {type: string, data: any}) {
      if (event.type === 'snapshot') {
          this.connectionMessage = '';
          const previousRunId = this.savedAgentIds ? this.runId : null;
          this.applyState(event.data);
          if (event.data.turns.length && previousRunId !== event.data.config?.runId) this.selectTab('conversation');
          this.currentTurnIndex = event.data.currentTurnIndex ?? event.data.turns.length;
          this.turns = event.data.turns.map((turn: any) => ({ turnRecord: turn, auditTrail: turn.auditTrail || [] }));
          this.auditEvents = event.data.events;
          this.operationalStates={...(event.data.operationalStates??{})};
          for(const turn of event.data.turns)if(turn.operationalState)this.operationalStates[turn.agentId]=turn.operationalState;
      } else if (event.type === 'status_changed') {
          this.applyState(event.data);
      } else if (event.type === 'turn_started') {
          this.activeTurnAgent = event.data.agentId;
      } else if (event.type === 'turn_completed') {
          this.activeTurnAgent = null;
          if(event.data.turnRecord.worldAfter&&(!this.worldState||event.data.turnRecord.worldAfter.revision>this.worldState.revision))this.worldState=event.data.turnRecord.worldAfter;
          if(event.data.turnRecord.operationalState)this.operationalStates[event.data.turnRecord.agentId]=event.data.turnRecord.operationalState;
          if (!this.turns.some(t => t.turnRecord.turnIndex === event.data.turnRecord.turnIndex)) {
              if (!this.followLatest || this.selectedTab !== 'conversation') this.unseenTurns++;
              this.currentTurnIndex = Math.max(this.currentTurnIndex, event.data.turnRecord.turnIndex + 1);
              this.turns.push(event.data);
              this.turns.sort((a, b) => a.turnRecord.turnIndex - b.turnRecord.turnIndex);
          }
          if (!this.auditEvents.some(e => e.type === 'memory_update' && e.turnIndex === event.data.turnRecord.turnIndex)) {
              this.auditEvents.push({ type: 'memory_update', turnIndex: event.data.turnRecord.turnIndex,
                  agentId: event.data.turnRecord.agentId, operations: event.data.auditTrail });
          }
      } else if (event.type === 'recovery_attempt') {
          this.activeTurnAgent=null;
          if(!this.auditEvents.some(e=>e.id===event.data.id))this.auditEvents.push(event.data);
      } else if (event.type === 'environment_event') {
          if (!this.auditEvents.some(e=>e.id===event.data.id)) this.auditEvents.push(event.data);
      } else if (event.type === 'experiment_error') {
          this.activeTurnAgent = null;
          this.diagnostic = event.data.message;
          if (!this.auditEvents.some(e => e.id === event.data.id)) this.auditEvents.push(event.data);
      } else if (event.type === 'connection_error') {
          this.activeTurnAgent = null;
          this.connectionMessage = event.data.message;
      }
  }
}
