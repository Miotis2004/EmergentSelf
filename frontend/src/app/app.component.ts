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

      this.experimentService.getStatus().subscribe(res => {
          this.experimentStatus = res.status;
          if (res.config) {
              this.runId = res.config.runId;
              this.maxTurns = res.config.maxTurns;
          }
      });

      this.experimentService.connectEvents();
      this.eventsSub = this.experimentService.events$.subscribe(event => {
          this.handleServerEvent(event);
      });
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
          alert("Need at least 2 agents to start.");
          return;
      }

      const config = {
          runId: this.runId,
          agentIds: this.availableAgents.slice(0, 2).map(a => a.id),
          maxTurns: this.maxTurns,
          llmConfig: {
              baseUrl: 'http://127.0.0.1:8080/v1',
              model: 'default'
          }
      };

      this.experimentService.startExperiment(config).subscribe({
          error: err => console.error('Failed to start', err)
      });
  }

  pauseExperiment() {
      this.experimentService.pauseExperiment().subscribe();
  }

  resumeExperiment() {
      this.experimentService.resumeExperiment().subscribe();
  }

  stopExperiment() {
      this.experimentService.stopExperiment().subscribe();
  }

  resetExperiment() {
      this.experimentService.resetExperiment().subscribe(() => {
          this.turns = [];
          this.auditEvents = [];
          this.activeTurnAgent = null;
      });
  }

  handleServerEvent(event: {type: string, data: any}) {
      if (event.type === 'status_changed') {
          this.experimentStatus = event.data.status;
          if (event.data.error) {
              console.error("Experiment Error:", event.data.error);
              alert("Error: " + event.data.error);
          }
      } else if (event.type === 'turn_started') {
          this.activeTurnAgent = event.data.agentId;
      } else if (event.type === 'turn_completed') {
          this.activeTurnAgent = null;
          this.turns.push(event.data);
          if (event.data.auditTrail && event.data.auditTrail.length > 0) {
              this.auditEvents.push({
                  type: 'memory_update',
                  turnIndex: event.data.turnRecord.turnIndex,
                  agentId: event.data.turnRecord.agentId,
                  operations: event.data.auditTrail
              });
          }
      } else if (event.type === 'error') {
          console.error("SSE Error:", event.data);
      }
  }
}
