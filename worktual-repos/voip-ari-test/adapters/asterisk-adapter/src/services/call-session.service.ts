import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

export type CallDirection = 'INBOUND' | 'OUTBOUND';
export type CallSessionState = 'RINGING' | 'BRIDGING' | 'CONNECTED' | 'ENDED';

export interface CallSession {
  callId: string;
  direction: CallDirection;
  bridgeId?: string;
  callerChannelId?: string;
  agentChannelId?: string;
  agentExtension: string;
  toNumber?: string;
  fromNumber?: string;
  state: CallSessionState;
  tenantId: string;
  createdAt: string;

  externalMediaChannelId?: string;
  voicebotBridgeId?: string;
  voicebotActive?: boolean;
}

@Injectable()
export class CallSessionService {
  private readonly logger = new Logger(CallSessionService.name);
  private readonly sessionsByCallId = new Map<string, CallSession>();
  private readonly channelToCallId = new Map<string, string>();

  createSession(params: {
    direction: CallDirection;
    agentExtension?: string;
    callerChannelId?: string;
    fromNumber?: string;
    toNumber?: string;
    tenantId?: string;
    callId?: string;
  }): CallSession {
    const callId = params.callId || randomUUID();
    const session: CallSession = {
      callId,
      direction: params.direction,
      callerChannelId: params.callerChannelId,
      agentExtension: params.agentExtension || process.env.DEFAULT_AGENT_EXTENSION || 'w1001',
      fromNumber: params.fromNumber,
      toNumber: params.toNumber,
      state: 'RINGING',
      tenantId: params.tenantId || 'default',
      createdAt: new Date().toISOString(),
    };

    this.sessionsByCallId.set(callId, session);
    if (session.callerChannelId) {
      this.channelToCallId.set(session.callerChannelId, callId);
    }

    this.logger.log(`Created session [${callId}] direction=${session.direction}`);
    return session;
  }

  getSession(callId: string): CallSession | undefined {
    return this.sessionsByCallId.get(callId);
  }

  getSessionByChannel(channelId: string): CallSession | undefined {
    const callId = this.channelToCallId.get(channelId);
    if (!callId) return undefined;
    return this.sessionsByCallId.get(callId);
  }

  listActiveSessions(): CallSession[] {
    return Array.from(this.sessionsByCallId.values()).filter((s) => s.state !== 'ENDED');
  }

  setBridge(callId: string, bridgeId: string): CallSession | undefined {
    const session = this.sessionsByCallId.get(callId);
    if (!session) return undefined;
    session.bridgeId = bridgeId;
    session.state = 'BRIDGING';
    return session;
  }

  setCallerChannel(callId: string, channelId: string): CallSession | undefined {
    const session = this.sessionsByCallId.get(callId);
    if (!session) return undefined;
    if (session.callerChannelId) {
      this.channelToCallId.delete(session.callerChannelId);
    }
    session.callerChannelId = channelId;
    this.channelToCallId.set(channelId, callId);
    return session;
  }

  setAgentChannel(callId: string, channelId: string): CallSession | undefined {
    const session = this.sessionsByCallId.get(callId);
    if (!session) return undefined;
    if (session.agentChannelId) {
      this.channelToCallId.delete(session.agentChannelId);
    }
    session.agentChannelId = channelId;
    this.channelToCallId.set(channelId, callId);
    return session;
  }

  clearAgentChannel(callId: string): CallSession | undefined {
    const session = this.sessionsByCallId.get(callId);
    if (!session) return undefined;
    if (session.agentChannelId) {
      this.channelToCallId.delete(session.agentChannelId);
      session.agentChannelId = undefined;
    }
    if (session.state === 'BRIDGING' || session.state === 'CONNECTED') {
      session.state = 'RINGING';
    }
    return session;
  }

  markConnected(callId: string): CallSession | undefined {
    const session = this.sessionsByCallId.get(callId);
    if (!session) return undefined;
    session.state = 'CONNECTED';
    return session;
  }

  markEnded(callId: string): CallSession | undefined {
    const session = this.sessionsByCallId.get(callId);
    if (!session) return undefined;
    session.state = 'ENDED';
    return session;
  }

  isBothLegsPresent(session: CallSession): boolean {
    return Boolean(session.callerChannelId && session.agentChannelId && session.bridgeId);
  }

  destroySession(callId: string): CallSession | undefined {
    const session = this.sessionsByCallId.get(callId);
    if (!session) return undefined;

    session.state = 'ENDED';
    if (session.callerChannelId) this.channelToCallId.delete(session.callerChannelId);
    if (session.agentChannelId) this.channelToCallId.delete(session.agentChannelId);
    this.sessionsByCallId.delete(callId);
    this.logger.log(`Destroyed session [${callId}]`);
    return session;
  }
}
