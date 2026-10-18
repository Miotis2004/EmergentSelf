import { Injectable, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';

export interface ExperimentConfig {
    runId: string;
    agentIds: string[];
    initialTopic?: string;
    operationalConfig?: any;
    worldConfig?: any;
    memoryConfig?: Record<string, string | number>;
    socialConfig?: any;
    taskConfig?: any;
    feedbackConfig?: any;
    maxTurns: number;
    llmConfig: {
        baseUrl: string;
        model: string;
        maxTokens?: number;
        outputMode?: 'json_schema' | 'json_only';
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

  world(action:string,body:any):Observable<any>{return this.http.post(`${this.apiUrl}/world/${action}`,body);}

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

  getMemoryHistory(runId: string, agentId: string, turn?: number, compareTo?: number): Observable<any> {
      const params: Record<string, string> = {};
      if (turn !== undefined) params['turn'] = String(turn);
      if (compareTo !== undefined) params['compareTo'] = String(compareTo);
      return this.http.get(`${this.apiUrl}/runs/${encodeURIComponent(runId)}/agents/${encodeURIComponent(agentId)}/memory`, { params });
  }

  research(method: string, path: string, body?: any): Observable<any> {
      return this.http.request(method, `http://localhost:3000/api/research${path}`, { body });
  }

  studies(method: string, path: string, body?: any): Observable<any> {
      return this.http.request(method, `http://localhost:3000/api/studies${path}`, { body });
  }

  branches(method: string, path: string, body?: any): Observable<any> {
      return this.http.request(method, `http://localhost:3000/api/branches${path}`, { body });
  }

  analysis(method: string, path: string, body?: any): Observable<any> {
      return this.http.request(method, `http://localhost:3000/api/analysis${path}`, { body });
  }

  getStatus(): Observable<any> {
      return this.http.get(`${this.apiUrl}/status`);
  }

  getLlmDefaults(): Observable<any> {
      return this.http.get('http://localhost:3000/api/llm/config');
  }

  getLlmModels(baseUrl: string): Observable<{id: string}[]> {
      return this.http.get<{id: string}[]>('http://localhost:3000/api/llm/models', { params: { baseUrl } });
  }

  connectEvents() {
    if (this.eventSource) return;
    this.eventSource = new EventSource('http://localhost:3000/api/events');
    for (const type of ['snapshot', 'status_changed', 'turn_started', 'turn_completed', 'experiment_error', 'environment_event', 'connection_error']) {
        this.eventSource.addEventListener(type, (event: MessageEvent) => {
            this.zone.run(() => {
                try { this.events$.next({ type, data: JSON.parse(event.data) }); }
                catch { this.events$.next({ type: 'connection_error', data: { message: 'Invalid live event; reconnect to restore history' } }); }
            });
        });
    }
    this.eventSource.onerror = () => {
        this.zone.run(() => this.events$.next({ type: 'connection_error', data: { message: 'Live connection interrupted. Reconnecting and restoring history…' } }));
    };
  }

  disconnectEvents() {
      if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
      }
  }
}
