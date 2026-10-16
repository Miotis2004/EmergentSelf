import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AgentStat {
    initial: number;
    current: number;
}

export interface AgentIdentity {
    id: string;
    name: string;
    stats: Record<string, AgentStat>;
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
