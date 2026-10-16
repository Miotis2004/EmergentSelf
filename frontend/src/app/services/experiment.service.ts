import { Injectable, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';

export interface ExperimentConfig {
    runId: string;
    agentIds: string[];
    maxTurns: number;
    llmConfig: {
        baseUrl: string;
        model: string;
    };
}

@Injectable({
  providedIn: 'root'
})
export class ExperimentService {
  private apiUrl = 'http://localhost:3000/api/experiment';
  private eventSource: EventSource | null = null;

  public events$ = new Subject<{ type: string, data: any }>();

  constructor(private http: HttpClient, private zone: NgZone) { }

  startExperiment(config: ExperimentConfig): Observable<any> {
    return this.http.post(`${this.apiUrl}/start`, config);
  }

  pauseExperiment(): Observable<any> {
    return this.http.post(`${this.apiUrl}/pause`, {});
  }

  resumeExperiment(): Observable<any> {
    return this.http.post(`${this.apiUrl}/resume`, {});
  }

  stopExperiment(): Observable<any> {
    return this.http.post(`${this.apiUrl}/stop`, {});
  }

  resetExperiment(): Observable<any> {
      return this.http.post(`${this.apiUrl}/reset`, {});
  }

  getStatus(): Observable<any> {
      return this.http.get(`${this.apiUrl}/status`);
  }

  getLlmModels(): Observable<any[]> {
      return this.http.get<any[]>('http://localhost:3000/api/llm/models');
  }

  connectEvents() {
    if (this.eventSource) return;
    this.eventSource = new EventSource('http://localhost:3000/api/events');

    // Status changes
    this.eventSource.addEventListener('status_changed', (event: MessageEvent) => {
      this.zone.run(() => {
        this.events$.next({ type: 'status_changed', data: JSON.parse(event.data) });
      });
    });

    // Turn started
    this.eventSource.addEventListener('turn_started', (event: MessageEvent) => {
        this.zone.run(() => {
            this.events$.next({ type: 'turn_started', data: JSON.parse(event.data) });
        });
    });

    // Turn completed
    this.eventSource.addEventListener('turn_completed', (event: MessageEvent) => {
        this.zone.run(() => {
            this.events$.next({ type: 'turn_completed', data: JSON.parse(event.data) });
        });
    });

    this.eventSource.onerror = (error) => {
        console.error('SSE Error:', error);
        this.zone.run(() => {
             this.events$.next({ type: 'error', data: error });
        });
    };
  }

  disconnectEvents() {
      if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
      }
  }
}
