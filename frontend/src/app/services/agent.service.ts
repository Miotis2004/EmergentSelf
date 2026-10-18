import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AgentStat {
    initial: number;
    current: number;
}

export interface StartingDemeanor { type: string; description: string; }
export interface DemeanorOption extends StartingDemeanor { label: string; }

export interface AgentIdentity {
    id: string;
    name: string;
    stats: Record<string, AgentStat>;
    startingDemeanor?: StartingDemeanor;
    operationalState?: any;
}

export interface AgentDetails {
    identity: AgentIdentity;
    memories: any[];
    beliefs: any[];
}

@Injectable({
  providedIn: 'root'
})
export class AgentService {
  private apiUrl = 'http://localhost:3000/api/agents';

  constructor(private http: HttpClient) { }

  getDemeanors(): Observable<DemeanorOption[]> {
    return this.http.get<DemeanorOption[]>(`${this.apiUrl}/demeanors`);
  }

  getAgents(): Observable<AgentIdentity[]> {
    return this.http.get<AgentIdentity[]>(this.apiUrl);
  }

  getAgentDetails(id: string): Observable<AgentDetails> {
    return this.http.get<AgentDetails>(`${this.apiUrl}/${id}`);
  }

  createAgent(agent: any): Observable<AgentIdentity> {
    return this.http.post<AgentIdentity>(this.apiUrl, agent);
  }
}
