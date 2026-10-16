import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgentService, AgentIdentity } from './services/agent.service';
import { ExperimentService } from './services/experiment.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('transcriptContainer') private transcriptContainer!: ElementRef;

  availableAgents: AgentIdentity[] = [];

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

  turns: any[] = [];
  auditEvents: any[] = [];
  activeTurnAgent: string | null = null;

  private eventsSub!: Subscription;

  constructor(
      private agentService: AgentService,
      private experimentService: ExperimentService
  ) {}

  ngOnInit() {
      this.loadAgents();

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
      this.scrollToBottom();
  }

  scrollToBottom(): void {
      try {
          this.transcriptContainer.nativeElement.scrollTop = this.transcriptContainer.nativeElement.scrollHeight;
      } catch(err) { }
  }

  loadAgents() {
      this.agentService.getAgents().subscribe({
          next: (agents) => this.availableAgents = agents,
          error: (err) => console.error('Failed to load agents', err)
      });
  }

  createAgent() {
      if (!this.newAgent.id || !this.newAgent.name) return;

      const payload = {
          id: this.newAgent.id,
          name: this.newAgent.name,
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
          },
          error: (err) => console.error('Create agent failed', err)
      });
  }

  startExperiment() {
      if (this.availableAgents.length < 2) {
          this.diagnostic = "Need at least 2 agents to start.";
          return;
      }

      const config = {
          runId: this.runId,
          agentIds: this.availableAgents.slice(0, 2).map(a => a.id),
          maxTurns: this.maxTurns,
          llmConfig: {
              baseUrl: this.llmBaseUrl,
              model: this.selectedModel,
              maxTokens: this.maxTokens,
              outputMode: this.outputMode
          }
      };

      if (!this.selectedModel) { this.diagnostic = 'Discover and select a loaded model first.'; return; }
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
      this.experimentStatus = state.status;
      this.activeTurnAgent = state.activeAgentId ?? null;
      this.diagnostic = state.error?.message || '';
      if (state.config) {
          this.runId = state.config.runId;
          this.maxTurns = state.config.maxTurns;
          this.llmBaseUrl = state.config.llmConfig.baseUrl;
          this.selectedModel = state.config.llmConfig.model;
          this.maxTokens = state.config.llmConfig.maxTokens;
          this.outputMode = state.config.llmConfig.outputMode;
      }
  }

  handleServerEvent(event: {type: string, data: any}) {
      if (event.type === 'snapshot') {
          this.connectionMessage = '';
          this.applyState(event.data);
          this.turns = event.data.turns.map((turn: any) => ({ turnRecord: turn, auditTrail: turn.auditTrail || [] }));
          this.auditEvents = event.data.events;
      } else if (event.type === 'status_changed') {
          this.applyState(event.data);
      } else if (event.type === 'turn_started') {
          this.activeTurnAgent = event.data.agentId;
      } else if (event.type === 'turn_completed') {
          this.activeTurnAgent = null;
          if (!this.turns.some(t => t.turnRecord.turnIndex === event.data.turnRecord.turnIndex)) {
              this.turns.push(event.data);
              this.turns.sort((a, b) => a.turnRecord.turnIndex - b.turnRecord.turnIndex);
          }
          if (!this.auditEvents.some(e => e.type === 'memory_update' && e.turnIndex === event.data.turnRecord.turnIndex)) {
              this.auditEvents.push({ type: 'memory_update', turnIndex: event.data.turnRecord.turnIndex,
                  agentId: event.data.turnRecord.agentId, operations: event.data.auditTrail });
          }
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
