import axios, { AxiosInstance } from 'axios';
import { CallsModule } from './calls';
import { AgentsModule } from './agents';
import { EventsModule } from './events';

export interface TelephonyOptions {
  apiKey: string;
  baseUrl?: string;
  wsUrl?: string;
}

export class TelephonyClient {
  private readonly http: AxiosInstance;
  public readonly calls: CallsModule;
  public readonly agents: AgentsModule;
  public readonly events: EventsModule;

  constructor(options: TelephonyOptions) {
    const baseUrl = options.baseUrl || 'http://localhost:3000/api/v1';

    this.http = axios.create({
      baseURL: baseUrl,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': options.apiKey,
      },
    });

    this.calls = new CallsModule(this.http);
    this.agents = new AgentsModule(this.http);
    this.events = new EventsModule();

    if (options.wsUrl) {
      this.events.connect(options.wsUrl, options.apiKey);
    }
  }
}

export * from './calls';
export * from './agents';
export * from './events';
