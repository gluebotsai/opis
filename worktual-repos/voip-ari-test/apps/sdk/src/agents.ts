import { AxiosInstance } from 'axios';

export class AgentsModule {
  constructor(private readonly http: AxiosInstance) {}

  async list() {
    const res = await this.http.get('/agents');
    return res.data;
  }

  async create(name: string, email: string, extension?: string) {
    const res = await this.http.post('/agents', { name, email, extension });
    return res.data;
  }

  async updateStatus(agentId: string, status: string) {
    const res = await this.http.put(`/agents/${agentId}/status`, { status });
    return res.data;
  }
}
