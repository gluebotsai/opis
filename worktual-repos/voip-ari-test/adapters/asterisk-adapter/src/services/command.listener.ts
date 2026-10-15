import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { AriService } from './ari.service';
import { RedisService } from './redis.service';
import { CallSessionService } from './call-session.service';
import { MediaGatewayService } from './media-gateway.service';

@Injectable()
export class CommandListenerService implements OnModuleInit {
  private readonly logger = new Logger(CommandListenerService.name);

  constructor(
    private readonly ariService: AriService,
    private readonly redisService: RedisService,
    private readonly callSessionService: CallSessionService,
    private readonly mediaGateway: MediaGatewayService,
  ) {}

  onModuleInit() {
    this.redisService.subscribeCommands((commandData) => {
      this.handleCommand(commandData);
    });
    this.logger.log('CommandListenerService initialized and listening to telephony.commands.asterisk');
  }

  private async handleCommand(cmd: any) {
    this.logger.log(`Received command from Redis: ${JSON.stringify(cmd)}`);
    const client = this.ariService.getAriClient();
    if (!client) {
      this.logger.error('ARI client is not connected to Asterisk');
      return;
    }

    const payload = cmd.payload || cmd;

    try {
      switch (cmd.action) {
        case 'ORIGINATE': {
          await this.handleOriginate(client, payload);
          break;
        }

        case 'HANGUP': {
          await this.handleHangup(payload);
          break;
        }

        case 'ANSWER': {
          await this.handleAnswer(client, payload);
          break;
        }

        case 'HOLD': {
          await this.handleHold(payload, true);
          break;
        }

        case 'RESUME': {
          await this.handleHold(payload, false);
          break;
        }

        case 'MUTE': {
          await this.handleMute(payload, true);
          break;
        }

        case 'UNMUTE': {
          await this.handleMute(payload, false);
          break;
        }

        case 'TRANSFER': {
          const channelId = payload.channelId;
          const target = payload.target;
          const transferType = payload.type || 'BLIND';

          if (!channelId || !target) {
            this.logger.warn('TRANSFER requires channelId and target');
            break;
          }

          if (transferType === 'BLIND') {
            this.logger.log(`Blind transferring channel ${channelId} to ${target}`);
            await client.channels.redirect({
              channelId,
              endpoint: `PJSIP/${target}`,
            });
          } else if (transferType === 'ATTENDED') {
            this.logger.log(`Attended transfer: originating consult leg to ${target}`);
            await this.mediaGateway.startHoldMoh(channelId);
            const consultChannel = await client.channels.originate({
              endpoint: `PJSIP/${target}`,
              app: 'telephony',
              appArgs: `attended_transfer,${channelId}`,
            });
            this.logger.log(`Consult channel created: ${consultChannel.id} for attended transfer`);
          }

          this.redisService.publish('telephony.events.asterisk', {
            event: 'call.transferred',
            channelId,
            target,
            type: transferType,
            timestamp: new Date().toISOString(),
          });
          break;
        }

        case 'RECORD': {
          const channelId = payload.channelId;
          const callId = payload.callId || '';
          const recordingName = payload.name || `recording_${channelId}_${Date.now()}`;

          if (!channelId) {
            this.logger.warn('RECORD requires channelId');
            break;
          }

          const session =
            this.callSessionService.getSessionByChannel(channelId) ||
            (callId ? this.callSessionService.getSession(callId) : undefined);
          const recordTarget = session?.callerChannelId || channelId;

          this.logger.log(`Starting recording on channel ${recordTarget} as ${recordingName}`);
          await this.mediaGateway.startRecording({
            targetId: recordTarget,
            name: recordingName,
            format: 'wav',
          });

          this.redisService.publish('telephony.events.asterisk', {
            event: 'recording.started',
            channelId: recordTarget,
            callId: session?.callId || callId,
            recordingName,
            timestamp: new Date().toISOString(),
          });
          break;
        }

        case 'STOP_RECORD': {
          const channelId = payload.channelId;
          const recordingName = payload.name;

          if (!recordingName) {
            this.logger.warn('STOP_RECORD requires recording name');
            break;
          }

          this.logger.log(`Stopping recording ${recordingName}`);
          await this.mediaGateway.stopRecording(recordingName);

          this.redisService.publish('telephony.events.asterisk', {
            event: 'recording.finished',
            channelId,
            recordingName,
            filePath: `/var/spool/asterisk/recording/${recordingName}.wav`,
            timestamp: new Date().toISOString(),
          });
          break;
        }

        case 'CONFERENCE': {
          this.logger.log(`Creating ARI Multi-party Conference Bridge: ${payload.name}`);
          const bridge = await this.mediaGateway.createBridge(`conf_${Date.now()}`, payload.name);
          if (payload.channelIds && Array.isArray(payload.channelIds)) {
            await this.mediaGateway.addChannelToBridge(bridge.id, payload.channelIds);
          }

          this.redisService.publish('telephony.events.asterisk', {
            event: 'conference.created',
            bridgeId: bridge.id,
            name: payload.name,
            timestamp: new Date().toISOString(),
          });
          break;
        }

        case 'EXTERNAL_MEDIA': {
          const channelId = payload.channelId;
          const externalHost = payload.externalHost || '127.0.0.1:5000';
          const format = payload.format || 'slin16';
          const transport = payload.transport || 'udp';

          this.logger.log(`Creating ARI ExternalMedia stream to ${externalHost} for channel ${channelId}`);

          if (channelId) {
            try {
              await client.channels.answer({ channelId });
            } catch (ansErr: any) {
              this.logger.debug(`Channel ${channelId} answer status: ${ansErr.message}`);
            }
          }

          const { externalChannel, bridge } = await this.mediaGateway.createExternalMediaStream({
            channelId,
            externalHost,
            format,
            transport,
          });

          this.redisService.publish('telephony.events.asterisk', {
            event: 'external_media.created',
            channelId,
            externalChannelId: externalChannel.id,
            bridgeId: bridge?.id,
            externalHost,
            format,
            timestamp: new Date().toISOString(),
          });
          break;
        }

        case 'VOICEBOT_START': {
          await this.handleVoicebotStart(payload);
          break;
        }

        case 'VOICEBOT_STOP': {
          await this.handleVoicebotStop(payload);
          break;
        }

        default:
          this.logger.warn(`Unknown action received: ${cmd.action}`);
      }
    } catch (err: any) {
      this.logger.error(`Error executing command ${cmd.action}: ${err.message}`, err.stack);
    }
  }

  private normalizeOutboundNumber(raw: string): string {
    let n = String(raw || '').trim().replace(/[\s()-]/g, '');
    if (!n) return n;
    if (n.startsWith('00')) n = `+${n.slice(2)}`;
    if (n.startsWith('+')) return n;
    if (/^[6-9]\d{9}$/.test(n)) return `+91${n}`;
    if (/^91\d{10}$/.test(n)) return `+${n}`;
    return n;
  }

  private async handleOriginate(client: any, payload: any) {
    const to = this.normalizeOutboundNumber(payload.to || payload.endpoint);
    const from = payload.from || payload.callerId || process.env.DEFAULT_AGENT_EXTENSION || 'w1001';
    const callId = payload.callId;

    if (!to) {
      this.logger.warn('ORIGINATE requires to');
      return;
    }

    const session = this.callSessionService.createSession({
      direction: 'OUTBOUND',
      agentExtension: from,
      fromNumber: from,
      toNumber: to,
      callId,
    });

    const bridge = await this.mediaGateway.createBridge(session.callId, `outbound_${session.callId}`);
    this.callSessionService.setBridge(session.callId, bridge.id);

    this.logger.log(
      `Outbound call [${session.callId}]: ringing WebRTC agent ${from}, then PSTN ${to}`,
    );

    const agentChan = await client.channels.originate({
      endpoint: `PJSIP/${from}`,
      app: 'telephony',
      appArgs: `join_bridge,${session.callId},${bridge.id},agent,${to}`,
      callerId: to,
    });

    this.callSessionService.setAgentChannel(session.callId, agentChan.id);

    await this.redisService.publish('telephony.events.asterisk', {
      event: 'call.initiated',
      callId: session.callId,
      channelId: agentChan.id,
      bridgeId: bridge.id,
      from,
      to,
      direction: 'OUTBOUND',
      tenantId: session.tenantId,
      agentExtension: from,
      timestamp: new Date().toISOString(),
    });
  }

  private async isEndpointReachable(client: any, extension: string): Promise<{ ok: boolean; detail: string }> {
    try {
      const endpoint = await client.endpoints.get({ tech: 'PJSIP', resource: extension });
      const state = endpoint?.state || 'unknown';
      const contacts = endpoint?.channel_ids?.length ?? 0;
      if (state === 'offline') {
        return {
          ok: false,
          detail: `PJSIP/${extension} is offline (no WebRTC/SIP registration). Register agent softphone first.`,
        };
      }
      return { ok: true, detail: `PJSIP/${extension} state=${state} contacts=${contacts}` };
    } catch (err: any) {
      return {
        ok: false,
        detail: `PJSIP/${extension} not found or unreachable: ${err.message}`,
      };
    }
  }

  private async handleAnswer(client: any, payload: any) {
    const channelId = payload.channelId;
    let agentExtension =
      payload.agentExtension || process.env.DEFAULT_AGENT_EXTENSION || 'w1001';
    const fallbackExt = process.env.FALLBACK_AGENT_EXTENSION || '1001';

    if (!channelId || channelId.startsWith('out_')) {
      this.logger.warn(`Skipping answer on invalid/local channelId: ${channelId}`);
      return;
    }

    let session = this.callSessionService.getSessionByChannel(channelId);
    if (!session && payload.callId) {
      session = this.callSessionService.getSession(payload.callId);
    }

    if (!session) {
      this.logger.warn(`ANSWER: no session for channel ${channelId}`);
      return;
    }

    const callerChannelId = session.callerChannelId || channelId;

    let reach = await this.isEndpointReachable(client, agentExtension);
    if (!reach.ok && fallbackExt && fallbackExt !== agentExtension) {
      this.logger.warn(`${reach.detail} — trying fallback ${fallbackExt}`);
      const fallbackReach = await this.isEndpointReachable(client, fallbackExt);
      if (fallbackReach.ok) {
        agentExtension = fallbackExt;
        reach = fallbackReach;
      }
    }

    session.agentExtension = agentExtension;

    this.logger.log(
      `Answering inbound call [${session.callId}] channel ${callerChannelId} -> agent ${agentExtension} (${reach.detail})`,
    );

    if (!reach.ok) {
      await this.mediaGateway.startHoldMoh(callerChannelId);
      await this.redisService.publish('telephony.events.asterisk', {
        event: 'call.answer_failed',
        callId: session.callId,
        channelId: callerChannelId,
        direction: 'INBOUND',
        tenantId: session.tenantId,
        agentExtension,
        reason: reach.detail,
        timestamp: new Date().toISOString(),
      });
      this.logger.error(`ANSWER aborted for [${session.callId}]: ${reach.detail}`);
      return;
    }

    let bridge: any;
    try {
      await client.channels.answer({ channelId: callerChannelId }).catch(() => {});
      await this.mediaGateway.stopHoldMoh(callerChannelId);

      bridge = await this.mediaGateway.createBridge(session.callId, `inbound_${session.callId}`);
      this.callSessionService.setBridge(session.callId, bridge.id);
      await this.mediaGateway.addChannelToBridge(bridge.id, callerChannelId);

      const agentChan = await client.channels.originate({
        endpoint: `PJSIP/${agentExtension}`,
        app: 'telephony',
        appArgs: `join_bridge,${session.callId},${bridge.id},agent`,
        callerId: session.fromNumber || 'Inbound Customer',
        timeout: 30,
      });

      this.callSessionService.setAgentChannel(session.callId, agentChan.id);

      await this.redisService.publish('telephony.events.asterisk', {
        event: 'call.answered',
        callId: session.callId,
        channelId: callerChannelId,
        agentChannelId: agentChan.id,
        bridgeId: bridge.id,
        direction: 'INBOUND',
        tenantId: session.tenantId,
        agentExtension,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      const msg = typeof err.message === 'string' ? err.message : JSON.stringify(err.message || err);
      this.logger.error(`Error answering call ${session.callId}: ${msg}`);

      if (bridge?.id) {
        await this.mediaGateway.destroyBridge(bridge.id);
        const s = this.callSessionService.getSession(session.callId);
        if (s) s.bridgeId = undefined;
      }
      await this.mediaGateway.startHoldMoh(callerChannelId);

      await this.redisService.publish('telephony.events.asterisk', {
        event: 'call.answer_failed',
        callId: session.callId,
        channelId: callerChannelId,
        direction: 'INBOUND',
        tenantId: session.tenantId,
        agentExtension,
        reason: msg.includes('Allocation failed')
          ? `Allocation failed originating PJSIP/${agentExtension}. Agent softphone is not registered on Asterisk.`
          : msg,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleHangup(payload: any) {
    const channelId = payload.channelId;
    const callId = payload.callId;

    const session =
      (callId && this.callSessionService.getSession(callId)) ||
      (channelId && this.callSessionService.getSessionByChannel(channelId));

    if (session) {
      this.logger.log(`Hanging up session [${session.callId}]`);
      await this.ariService.cleanupSession(session.callId, 'HANGUP_COMMAND', channelId);
      return;
    }

    if (channelId && !channelId.startsWith('out_')) {
      const client = this.ariService.getAriClient();
      this.logger.log(`Hanging up lone channel ${channelId}`);
      await client?.channels.hangup({ channelId }).catch(() => {});
    } else {
      this.logger.warn(`Skipping hangup on invalid/local channelId: ${channelId}`);
    }
  }

  private async handleHold(payload: any, hold: boolean) {
    const channelId = payload.channelId;
    const session =
      this.callSessionService.getSessionByChannel(channelId) ||
      (payload.callId ? this.callSessionService.getSession(payload.callId) : undefined);

    const target = session?.callerChannelId || channelId;
    if (!target) return;

    if (hold) {
      this.logger.log(`Holding caller channel ${target}`);
      await this.mediaGateway.startHoldMoh(target);
      await this.redisService.publish('telephony.events.asterisk', {
        event: 'call.hold',
        callId: session?.callId,
        channelId: target,
        bridgeId: session?.bridgeId,
        timestamp: new Date().toISOString(),
      });
    } else {
      this.logger.log(`Resuming caller channel ${target}`);
      await this.mediaGateway.stopHoldMoh(target);
      await this.redisService.publish('telephony.events.asterisk', {
        event: 'call.resume',
        callId: session?.callId,
        channelId: target,
        bridgeId: session?.bridgeId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleMute(payload: any, mute: boolean) {
    const channelId = payload.channelId;
    const session =
      this.callSessionService.getSessionByChannel(channelId) ||
      (payload.callId ? this.callSessionService.getSession(payload.callId) : undefined);

    const target = session?.agentChannelId || channelId;
    if (!target) return;

    await this.mediaGateway.setMute(target, mute, 'in');
    await this.redisService.publish('telephony.events.asterisk', {
      event: mute ? 'call.muted' : 'call.unmuted',
      callId: session?.callId,
      channelId: target,
      timestamp: new Date().toISOString(),
    });
  }

  private async handleVoicebotStart(payload: any) {
    const channelId = payload.channelId;
    const callId = payload.callId;

    let session = callId
      ? this.callSessionService.getSession(callId)
      : channelId
      ? this.callSessionService.getSessionByChannel(channelId)
      : undefined;

    if (!session && channelId) {
      session = this.callSessionService.createSession({
        direction: 'INBOUND',
        callerChannelId: channelId,
        callId: callId || undefined,
      });
    }

    const callerChannelId = session?.callerChannelId || channelId;
    if (!callerChannelId) {
      this.logger.warn('VOICEBOT_START requires channelId or callId');
      return;
    }

    this.logger.log(`[Voicebot] Starting voicebot for channel ${callerChannelId} (session ${session?.callId})`);

    const client = this.ariService.getAriClient();
    if (client) {
      try {
        await client.channels.answer({ channelId: callerChannelId });
      } catch (ansErr: any) {
        this.logger.debug(`Answer channel status: ${ansErr.message}`);
      }
    }

    await this.mediaGateway.stopHoldMoh(callerChannelId);

    const rtpHost = process.env.VOICEBOT_RTP_HOST || '127.0.0.1:5000';
    const { externalChannel, bridge } = await this.mediaGateway.createExternalMediaStream({
      channelId: callerChannelId,
      externalHost: rtpHost,
      format: 'slin16',
      transport: 'udp',
      bridgeId: session?.bridgeId,
    });

    if (session) {
      session.externalMediaChannelId = externalChannel.id;
      session.voicebotBridgeId = bridge?.id;
      session.bridgeId = bridge?.id || session.bridgeId;
      session.voicebotActive = true;
    }

    const voicebotServiceUrl = process.env.VOICEBOT_SERVICE_URL || 'http://127.0.0.1:5001';
    try {
      await fetch(`${voicebotServiceUrl}/sessions/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId: session?.callId || callerChannelId,
          callerNumber: session?.fromNumber || '',
          ccaasNumber: session?.toNumber || '',
        }),
      });
      this.logger.log(`[Voicebot] Notified voicebot-service at ${voicebotServiceUrl}`);
    } catch (err: any) {
      this.logger.error(`[Voicebot] Failed to notify voicebot-service: ${err.message}`);
    }

    this.redisService.publish('telephony.events.asterisk', {
      event: 'voicebot.started',
      callId: session?.callId || callerChannelId,
      channelId: callerChannelId,
      externalChannelId: externalChannel.id,
      bridgeId: bridge?.id,
      timestamp: new Date().toISOString(),
    });
  }

  private async handleVoicebotStop(payload: any) {
    const channelId = payload.channelId;
    const callId = payload.callId;

    const session = callId
      ? this.callSessionService.getSession(callId)
      : channelId
      ? this.callSessionService.getSessionByChannel(channelId)
      : undefined;

    const callerChannelId = session?.callerChannelId || channelId;
    this.logger.log(`[Voicebot] Stopping voicebot for channel ${callerChannelId} (session ${session?.callId})`);

    const client = this.ariService.getAriClient();

    if (session?.externalMediaChannelId && client) {
      try {
        await client.channels.hangup({ channelId: session.externalMediaChannelId });
        this.logger.log(`[Voicebot] Hung up external media channel ${session.externalMediaChannelId}`);
      } catch (err: any) {
        this.logger.debug(`[Voicebot] Hangup external channel status: ${err.message}`);
      }
    }

    const voicebotServiceUrl = process.env.VOICEBOT_SERVICE_URL || 'http://127.0.0.1:5001';
    try {
      await fetch(`${voicebotServiceUrl}/sessions/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId: session?.callId || callerChannelId,
        }),
      });
      this.logger.log(`[Voicebot] Notified voicebot-service stop`);
    } catch (err: any) {
      this.logger.error(`[Voicebot] Failed to notify voicebot-service stop: ${err.message}`);
    }

    if (session) {
      session.externalMediaChannelId = undefined;
      session.voicebotBridgeId = undefined;
      session.voicebotActive = false;
    }

    if (callerChannelId && session?.state !== 'CONNECTED' && session?.state !== 'ENDED') {
      await this.mediaGateway.startHoldMoh(callerChannelId);
    }

    this.redisService.publish('telephony.events.asterisk', {
      event: 'voicebot.stopped',
      callId: session?.callId || callerChannelId,
      channelId: callerChannelId,
      timestamp: new Date().toISOString(),
    });
  }
}
