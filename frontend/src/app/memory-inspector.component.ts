import { Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ExperimentService } from './services/experiment.service';

@Component({
    selector: 'app-memory-inspector', standalone: true, imports: [CommonModule, FormsModule],
    template: `
    <details open>
      <summary><strong>Memory & self-model</strong></summary>
      <label>Run ID <input aria-label="Memory run ID" [(ngModel)]="historyRunId"></label>
      <label>Agent <select aria-label="Memory agent" [(ngModel)]="agentId" (change)="inspect()">
        <option *ngFor="let id of agentIds" [value]="id">{{id}}</option>
      </select></label>
      <button (click)="inspect()" [disabled]="!agentId || !historyRunId">Inspect run</button>
      <p *ngIf="error" role="alert">{{error}}</p>
      <div *ngIf="history">
        <label>State after turn <select aria-label="Historical turn" [(ngModel)]="turn" (change)="inspect()">
          <option [ngValue]="undefined">Latest committed turn</option>
          <option *ngFor="let index of indices" [ngValue]="index">{{index === -1 ? 'Initial state' : index}}</option>
        </select></label>
        <label>Compare with <select aria-label="Compare turn" [(ngModel)]="compareTo" (change)="inspect()">
          <option [ngValue]="undefined">No comparison</option>
          <option *ngFor="let index of indices" [ngValue]="index">{{index === -1 ? 'Initial state' : index}}</option>
        </select></label>
        <p>Showing state after turn {{history.turnIndex}}. History begins at {{history.baselineTurn}}.</p>
        <section *ngIf="history.state?.identity as identity" aria-label="Initial identity">
          <h4>Initial identity</h4>
          <p>{{identity.name}} ({{identity.id}})</p>
          <p *ngIf="identity.startingDemeanor as demeanor"><strong>Starting Demeanor (creation metadata):</strong>
            {{demeanor.type}} — {{demeanor.description}}</p>
          <p *ngIf="!identity.startingDemeanor">Starting Demeanor: unspecified</p>
          <p *ngFor="let stat of identity.stats | keyvalue">{{stat.key}}: initial {{statInitial(stat.value)}}, current {{statCurrent(stat.value)}}</p>
        </section>
        <section *ngFor="let kind of kinds">
          <h4>{{kind.label}}</h4>
          <p *ngIf="!entries(kind.type).length">No active entries.</p>
          <article *ngFor="let entry of entries(kind.type)">
            <p class="memory-text">{{entry.content}}</p>
            <small>Confidence {{entry.confidence}} · Importance {{entry.importance ?? 'unspecified'}}
              <span *ngIf="entry.relationship_agent_id"> · About {{entry.relationship_agent_id}}</span><br>
              Source: {{entry.source ? entry.source.runId + ' / turn ' + entry.source.turnIndex : 'Legacy source unknown'}}<br>
              Updated: {{entry.updated_at || 'Unknown'}}<br>ID: {{entry.id}}</small>
          </article>
        </section>
        <section *ngIf="history.diff" aria-label="Memory differences">
          <h4>Differences from turn {{history.compareTo}}</h4>
          <p *ngIf="!history.diff.added.length && !history.diff.changed.length && !history.diff.removed.length && !history.diff.stats.length">No state differences.</p>
          <p *ngFor="let entry of history.diff.added">Added {{entry.type}}: {{entry.content}}</p>
          <div *ngFor="let item of history.diff.changed">
            <strong>{{item.after.type}} revision</strong>
            <p>Before: {{item.before.content}} ({{item.before.status}}, confidence {{item.before.confidence}})</p>
            <p>After: {{item.after.content}} ({{item.after.status}}, confidence {{item.after.confidence}})</p>
          </div>
          <p *ngFor="let entry of history.diff.removed">Removed: {{entry.content}}</p>
          <p *ngFor="let stat of history.diff.stats">{{stat.key}}: {{stat.before.current}} → {{stat.after.current}} (initial {{stat.after.initial}})</p>
        </section>
        <section aria-label="Memory timeline">
          <h4>Memory timeline</h4>
          <p *ngIf="!history.timeline.length">No Phase II turns recorded.</p>
          <details *ngFor="let event of history.timeline.slice().reverse()">
            <summary>Turn {{event.turnIndex}} · {{event.timestamp | date:'medium'}}</summary>
            <p *ngFor="let op of event.operations">
              {{op.operation.action}} {{op.operation.type}} — {{op.status}}<br>
              Reason: {{op.operation.reason}}<br>
              <span *ngIf="op.error">{{op.error}}</span>
            </p>
            <small *ngIf="event.retrieval">Retrieved {{event.retrieval.selectedIds.length}} entries;
              digest covers {{event.retrieval.summaryIds.length}} additional entries;
              {{event.retrieval.omittedEntries}} omitted. Mode: {{event.retrieval.mode}}.</small>
          </details>
        </section>
      </div>
    </details>`,
    styles: [`:host { display:block; margin-bottom:16px; } label { display:block; margin:6px 0; }
      input, select { width:100%; box-sizing:border-box; } article { border-bottom:1px solid #ddd; padding:6px 0; }
      .memory-text { white-space:pre-wrap; } small { overflow-wrap:anywhere; } h4 { margin-bottom:4px; }`]
})
export class MemoryInspectorComponent implements OnChanges, OnDestroy {
    @Input() runId = '';
    @Input() agentIds: string[] = [];
    @Input() refreshToken = 0;
    historyRunId = '';
    agentId = '';
    turn: number | undefined;
    compareTo: number | undefined;
    history: any = null;
    error = '';
    indices: number[] = [];
    private currentRun = '';
    private requestId = 0;
    private pending?: Subscription;
    kinds = [{type:'episodic', label:'Episodic observations'}, {type:'belief', label:'Beliefs & opinions'},
        {type:'self_description', label:'Self-description'}, {type:'relationship', label:'Relationships'}];
    constructor(private experiments: ExperimentService) {}
    ngOnChanges() {
        if (this.runId !== this.currentRun) {
            this.requestId++; this.pending?.unsubscribe(); this.error = '';
            this.currentRun = this.runId; this.historyRunId = this.runId;
            this.turn = undefined; this.compareTo = undefined; this.history = null;
        }
        if (!this.agentIds.includes(this.agentId)) this.agentId = this.agentIds[0] ?? '';
        if (this.runId && this.agentId) this.inspect();
    }
    inspect() {
        if (!this.historyRunId || !this.agentId) return;
        const requestId = ++this.requestId;
        this.pending?.unsubscribe();
        this.pending = this.experiments.getMemoryHistory(this.historyRunId, this.agentId, this.turn, this.compareTo).subscribe({
            next: data => {
                if (requestId !== this.requestId) return;
                this.history = data; this.error = '';
                this.indices = Array.from({length: data.lastTurn - data.baselineTurn + 1}, (_, i) => i + data.baselineTurn);
            },
            error: err => {
                if (requestId !== this.requestId) return;
                this.history = null; this.error = err?.error?.error || 'Could not load memory history';
            }
        });
    }
    ngOnDestroy() { this.pending?.unsubscribe(); }
    statInitial(value: any) { return value.initial; }
    statCurrent(value: any) { return value.current; }

    entries(type: string) { return this.history?.state?.entries.filter((e: any) => e.type === type && e.status === 'active') ?? []; }
}
