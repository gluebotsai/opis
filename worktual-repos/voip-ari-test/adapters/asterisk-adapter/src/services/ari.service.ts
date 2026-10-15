import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as client from 'ari-client';
import { RedisService } from './redis.service';
import { CallSessionService } from './call-session.service';
import { MediaGatewayService } from './media-gateway.service';

@Injectable()
export class AriService implements OnModuleInit {
  private readonly logger = new Logger(AriService.name);
  private ariClient: any;
  private readonly cleaningUp = new Set<string>();

  constructor(
    private readonly redisService: RedisService,
    private readonly callSessionService: CallSessionService,
    private readonly mediaGateway: MediaGatewayService,
  ) {}

  onModuleInit() {
    this.connect();
  }

  private connect() {
    const ariUrl = process.env.ARI_URL || 'http://localhost:8088';
    const ariUser = process.env.ARI_USER || 'telephony';
    const ariPass = process.env.ARI_PASSWORD || 'telephony_password';

    this.logger.log(`Connecting to Asterisk ARI at ${ariUrl}...`);

    client.connect(ariUrl, ariUser, ariPass, (err: any, ari: any) => {
      if (err) {
        this.logger.error(`ARI Connection failed: ${err.message}. Retrying in 5 seconds...`);
        setTimeout(() => this.connect(), 5000);
        return;
      }

      this.ariClient = ari;
      this.mediaGateway.setAriClient(ari);
      this.logger.log('Connected successfully to Asterisk ARI Stasis Engine & Media Gateway');

      ari.on('StasisStart', (event: any, channel: any) => this.handleStasisStart(event, channel));
      ari.on('StasisEnd', (event: any, channel: any) => this.handleStasisEnd(event, channel));
      ari.on('ChannelStateChange', (event: any, channel: any) => this.handleChannelStateChange(event, channel));
      ari.on('ChannelDtmfReceived', (event: any, channel: any) => this.handleDtmfReceived(event, channel));
      ari.on('ChannelDestroyed', (event: any, channel: any) => this.handleChannelDestroyed(event, channel));

      ari.start('telephony');
    });
  }

  private async handleStasisStart(event: any, channel: any) {
    const args: string[] = event.args || [];
    const action = args[0] || 'inbound';
    const exten = channel.dialplan?.exten || args[1] || 'Unknown';
    const callerNumber = channel.caller?.number || args[2] || 'Unknown';
    const callerName = channel.caller?.name || 'Unknown';

    this.logger.log(
      `StasisStart: Channel [${channel.id}] (${channel.name}) action=${action} Exten=[${exten}] Caller=[${callerNumber}] Args=${JSON.stringify(args)}`,
    );

    try {
      if (action === 'join_bridge') {
        await this.handleJoinBridge(channel, args);
        return;
      }

      if (action === 'inbound' || action === 'outbound') {
        await this.handleInboundStasis(channel, {
          exten,
          callerNumber,
          callerName,
          directionHint: action === 'outbound' ? 'OUTBOUND' : 'INBOUND',
        });
        return;
      }

      // Fallback for channels that enter Stasis without args (treat as inbound)
      await this.handleInboundStasis(channel, {
        exten,
        callerNumber,
        callerName,
        directionHint: 'INBOUND',
      });
    } catch (err: any) {
      this.logger.error(`StasisStart handler error: ${err.message}`, err.stack);
    }
  }

  private async handleInboundStasis(
    channel: any,
    meta: { exten: string; callerNumber: string; callerName: string; directionHint: 'INBOUND' | 'OUTBOUND' },
  ) {
    // Ignore dialplan special/hangup/invalid handlers
    const ext = (meta.exten || '').toLowerCase();
    if (ext === 'h' || ext === 's' || ext === 'i' || ext === 't' || ext === 'e' || ext === 'hangup') {
      this.logger.debug(`Ignoring special exten [${meta.exten}] Stasis for channel [${channel.id}]`);
      return;
    }

    // Skip if channel already belongs to a session
    const existing = this.callSessionService.getSessionByChannel(channel.id);
    if (existing) {
      this.logger.debug(`Channel [${channel.id}] already in session [${existing.callId}]`);
      return;
    }

    const session = this.callSessionService.createSession({
      direction: 'INBOUND',
      callerChannelId: channel.id,
      fromNumber: meta.callerNumber,
      toNumber: meta.exten,
      agentExtension: process.env.DEFAULT_AGENT_EXTENSION || 'w1001',
    });

    try {
      await channel.answer();
      await this.mediaGateway.startHoldMoh(channel.id);
    } catch (err: any) {
      this.logger.debug(`Inbound answer/MOH status: ${err.message}`);
    }

    await this.redisService.publish('telephony.events.asterisk', {
      event: 'call.started',
      callId: session.callId,
      channelId: channel.id,
      bridgeId: session.bridgeId,
      direction: 'INBOUND',
      tenantId: session.tenantId,
      exten: meta.exten,
      did: meta.exten,
      callerNumber: meta.callerNumber,
      callerName: meta.callerName,
      connectedNumber: channel.connected?.number || 'Unknown',
      dialplanContext: channel.dialplan?.context || 'Unknown',
      agentExtension: session.agentExtension,
      timestamp: new Date().toISOString(),
    });
  }

  private async handleJoinBridge(channel: any, args: string[]) {
    // appArgs: join_bridge,{callId},{bridgeId},{role}[,toNumber]
    const callId = args[1];
    const bridgeId = args[2];
    const role = args[3] || 'agent'; // agent | pstn
    const toNumber = args[4];

    if (!callId || !bridgeId) {
      this.logger.warn(`join_bridge missing callId/bridgeId for channel ${channel.id}`);
      await channel.hangup().catch(() => {});
      return;
    }

    let session = this.callSessionService.getSession(callId);
    if (!session) {
      this.logger.warn(`join_bridge: creating session on-the-fly for callId=${callId} role=${role}`);
      session = this.callSessionService.createSession({
        callId,
        direction: role === 'pstn' && !toNumber ? 'INBOUND' : 'OUTBOUND',
        agentExtension: process.env.DEFAULT_AGENT_EXTENSION || 'w1001',
        toNumber,
      });
      this.callSessionService.setBridge(callId, bridgeId);
    }

    if (bridgeId && !session.bridgeId) {
      this.callSessionService.setBridge(callId, bridgeId);
    }

    try {
      await channel.answer();
    } catch (err: any) {
      this.logger.debug(`join_bridge answer status: ${err.message}`);
    }

    const targetBridge = session.bridgeId || bridgeId;
    if (targetBridge) {
      try {
        await this.mediaGateway.addChannelToBridge(targetBridge, channel.id);
      } catch (err: any) {
        this.logger.error(`Failed to add channel ${channel.id} to bridge ${targetBridge}: ${err.message}`);
      }
    }

    if (role === 'agent') {
      this.callSessionService.setAgentChannel(callId, channel.id);
      await this.redisService.publish('telephony.events.asterisk', {
        event: 'call.answered',
        callId,
        channelId: channel.id,
        bridgeId: targetBridge,
        direction: session.direction,
        tenantId: session.tenantId,
        role: 'agent',
        agentExtension: session.agentExtension,
        timestamp: new Date().toISOString(),
      });

      // Outbound: agent answered — now originate PSTN leg
      if (session.direction === 'OUTBOUND' && !session.callerChannelId) {
        const dest = toNumber || session.toNumber;
        if (dest) {
          await this.originatePstnLeg(session.callId, dest, targetBridge!);
        }
      }
    } else if (role === 'pstn') {
      this.callSessionService.setCallerChannel(callId, channel.id);
      await this.redisService.publish('telephony.events.asterisk', {
        event: 'channel.state_change',
        callId,
        channelId: channel.id,
        state: 'Up',
        bridgeId: targetBridge,
        direction: session.direction,
        tenantId: session.tenantId,
        role: 'pstn',
        timestamp: new Date().toISOString(),
      });
    }

    const updated = this.callSessionService.getSession(callId);
    if (updated && this.callSessionService.isBothLegsPresent(updated) && updated.state !== 'CONNECTED') {
      this.callSessionService.markConnected(callId);
      await this.redisService.publish('telephony.events.asterisk', {
        event: 'call.bridged',
        callId,
        channelId: channel.id,
        bridgeId: updated.bridgeId,
        callerChannelId: updated.callerChannelId,
        agentChannelId: updated.agentChannelId,
        direction: updated.direction,
        tenantId: updated.tenantId,
        fromNumber: updated.fromNumber,
        toNumber: updated.toNumber,
        agentExtension: updated.agentExtension,
        timestamp: new Date().toISOString(),
      });
      this.logger.log(`Call [${callId}] bridged — both legs connected in media gateway`);
    }
  }

  private async originatePstnLeg(callId: string, to: string, bridgeId: string) {
    const session = this.callSessionService.getSession(callId);
    if (!session) return;

    const trunk = process.env.OUTBOUND_TRUNK || 'nlp_ccaas_sipserver';
    const pstnTarget =
      to.length > 4 || to.startsWith('+') ? `PJSIP/${to}@${trunk}` : `PJSIP/${to}`;

    this.logger.log(`Outbound: originating PSTN leg ${pstnTarget} for call [${callId}]`);

    try {
      const pstnChan = await this.ariClient.channels.originate({
        endpoint: pstnTarget,
        app: 'telephony',
        appArgs: `join_bridge,${callId},${bridgeId},pstn`,
        callerId: process.env.OUTBOUND_CALLER_ID || '+914440004407',
      });

      await this.redisService.publish('telephony.events.asterisk', {
        event: 'call.initiated',
        callId,
        channelId: pstnChan.id,
        bridgeId,
        from: session.agentExtension,
        to,
        direction: 'OUTBOUND',
        tenantId: session.tenantId,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      this.logger.error(`PSTN originate failed for call [${callId}]: ${err.message}`);
      await this.cleanupSession(callId, 'PSTN_ORIGINATE_FAILED');
    }
  }

  private async handleStasisEnd(_event: any, channel: any) {
    this.logger.log(`StasisEnd: Channel [${channel.id}]`);
    const session = this.callSessionService.getSessionByChannel(channel.id);
    if (session) {
      await this.handleLegEnded(session.callId, channel.id, 'STASIS_END');
    } else {
      await this.redisService.publish('telephony.events.asterisk', {
        event: 'stasis.end',
        channelId: channel.id,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleChannelDestroyed(_event: any, channel: any) {
    const session = this.callSessionService.getSessionByChannel(channel.id);
    if (session && session.state !== 'ENDED') {
      await this.handleLegEnded(session.callId, channel.id, 'CHANNEL_DESTROYED');
    }
  }

  private async handleLegEnded(callId: string, channelId: string, reason: string) {
    const session = this.callSessionService.getSession(callId);
    if (!session || session.state === 'ENDED') return;

    const isAgent = session.agentChannelId === channelId;
    const isCaller = session.callerChannelId === channelId;

    if (isAgent && session.state !== 'CONNECTED' && session.callerChannelId) {
      this.logger.warn(
        `Agent leg ${channelId} ended before CONNECTED (${reason}) — keeping caller ${session.callerChannelId} on MOH`,
      );
      this.callSessionService.clearAgentChannel(callId);

      if (session.bridgeId) {
        await this.mediaGateway.removeChannelFromBridge(session.bridgeId, session.callerChannelId);
        await this.mediaGateway.destroyBridge(session.bridgeId);
        const s = this.callSessionService.getSession(callId);
        if (s) s.bridgeId = undefined;
      }

      await this.mediaGateway.startHoldMoh(session.callerChannelId);

      await this.redisService.publish('telephony.events.asterisk', {
        event: 'call.answer_failed',
        callId,
        channelId: session.callerChannelId,
        direction: session.direction,
        tenantId: session.tenantId,
        agentExtension: session.agentExtension,
        reason:
          'Agent WebRTC leg dropped before media connected. Check mic permission / browser console. Caller is still waiting — click Accept again.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (isCaller || session.state === 'CONNECTED' || isAgent) {
      await this.cleanupSession(callId, reason, channelId);
    }
  }

  private handleChannelStateChange(_event: any, channel: any) {
    const session = this.callSessionService.getSessionByChannel(channel.id);
    this.logger.log(`ChannelStateChange: [${channel.id}] State: ${channel.state}`);
    this.redisService.publish('telephony.events.asterisk', {
      event: 'channel.state_change',
      callId: session?.callId,
      channelId: channel.id,
      bridgeId: session?.bridgeId,
      state: channel.state,
      direction: session?.direction,
      tenantId: session?.tenantId || 'default',
      timestamp: new Date().toISOString(),
    });
  }

  private handleDtmfReceived(event: any, channel: any) {
    const session = this.callSessionService.getSessionByChannel(channel.id);
    this.logger.log(`DTMF Received on [${channel.id}]: ${event.digit}`);
    this.redisService.publish('telephony.events.asterisk', {
      event: 'channel.dtmf',
      callId: session?.callId,
      channelId: channel.id,
      digit: event.digit,
      tenantId: session?.tenantId || 'default',
      timestamp: new Date().toISOString(),
    });
  }

  async cleanupSession(callId: string, reason: string, triggeringChannelId?: string) {
    if (this.cleaningUp.has(callId)) return;
    this.cleaningUp.add(callId);

    const session = this.callSessionService.getSession(callId);
    if (!session) {
      this.cleaningUp.delete(callId);
      return;
    }

    this.logger.log(`Cleaning up session [${callId}] reason=${reason}`);
    this.callSessionService.markEnded(callId);

    const channels = [session.callerChannelId, session.agentChannelId].filter(Boolean) as string[];
    for (const chId of channels) {
      if (triggeringChannelId && chId === triggeringChannelId) continue;
      try {
        await this.ariClient?.channels.hangup({ channelId: chId });
      } catch {
        // already gone
      }
    }

    if (session.bridgeId) {
      await this.mediaGateway.destroyBridge(session.bridgeId);
    }

    await this.redisService.publish('telephony.events.asterisk', {
      event: 'call.ended',
      callId,
      channelId: triggeringChannelId || session.callerChannelId || session.agentChannelId,
      bridgeId: session.bridgeId,
      direction: session.direction,
      tenantId: session.tenantId,
      reason,
      fromNumber: session.fromNumber,
      toNumber: session.toNumber,
      agentExtension: session.agentExtension,
      timestamp: new Date().toISOString(),
    });

    this.callSessionService.destroySession(callId);
    this.cleaningUp.delete(callId);
  }

  getAriClient() {
    return this.ariClient;
  }
}
