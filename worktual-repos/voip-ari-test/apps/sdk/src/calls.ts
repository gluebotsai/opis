import axios, { AxiosInstance } from 'axios';

export interface OriginateOptions {
  from: string;
  to: string;
}

export class CallsModule {
  constructor(private readonly http: AxiosInstance) {}

  async originate(options: OriginateOptions) {
    const res = await this.http.post('/calls', options);
    return res.data;
  }

  async hangup(callId: string) {
    const res = await this.http.post(`/calls/${callId}/hangup`);
    return res.data;
  }

  async hold(callId: string) {
    const res = await this.http.post(`/calls/${callId}/hold`);
    return res.data;
  }

  async resume(callId: string) {
    const res = await this.http.post(`/calls/${callId}/resume`);
    return res.data;
  }

  async transfer(callId: string, target: string, type: 'BLIND' | 'ATTENDED' = 'BLIND') {
    const res = await this.http.post(`/calls/${callId}/transfer`, { target, type });
    return res.data;
  }

  async mute(callId: string) {
    const res = await this.http.post(`/calls/${callId}/mute`);
    return res.data;
  }

  async unmute(callId: string) {
    const res = await this.http.post(`/calls/${callId}/unmute`);
    return res.data;
  }
}
