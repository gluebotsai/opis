import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { prisma, CallStatus, CallDirection } from '@telephony/shared';

@Injectable()
export class CallStateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CallStateService.name);
  private redisPublisher: Redis;
  private redisSubscriber: Redis;

  onModuleInit() {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = Number(process.env.REDIS_PORT) || 6379;

    this.redisPublisher = new Redis({ host, port });
    this.redisSubscriber = new Redis({ host, port });

    // Subscribe to Asterisk events published by asterisk-adapter
    this.redisSubscriber.subscribe('telephony.events.asterisk', (err) => {
      if (err) this.logger.error(`Subscription error: ${err.message}`);
      else this.logger.log('Subscribed to telephony.events.asterisk');
    });

    this.redisSubscriber.on('message', (channel, message) => {
      if (channel === 'telephony.events.asterisk') {
        this.handleAsteriskEvent(message);
      }
    });
  }

  onModuleDestroy() {
    this.redisPublisher?.disconnect();
    this.redisSubscriber?.disconnect();
  }

  // Handle Asterisk event and update Call State Machine & DB
  private async handleAsteriskEvent(rawMessage: string) {
    try {
      const event = JSON.parse(rawMessage);
      this.logger.log(`Processing event: ${event.event} for Channel: ${event.channelId}`);

      switch (event.event) {
        case 'channel.originated': {
          // GAP 10 FIX: Link the Asterisk channel ID back to CallHistory record
          if (event.callId) {
            await prisma.callHistory.update({
              where: { id: event.callId },
              data: { asteriskCallId: event.channelId },
            }).catch((err: any) => {
              this.logger.warn(`Could not link asteriskCallId for callId ${event.callId}: ${err.message}`);
            });
            this.logger.log(`Linked asteriskCallId [${event.channelId}] to CallHistory [${event.callId}]`);
          }
          break;
        }

        case 'stasis.start': {
          // Try matching by channelId first, then by caller/connected numbers
          await this.updateCallStateByChannel(event.channelId, CallStatus.RINGING, {
            callerNumber: event.callerNumber,
            connectedNumber: event.connectedNumber,
          });
          break;
        }

        case 'channel.state_change': {
          if (event.state === 'Up') {
            await this.updateCallStateByChannel(event.channelId, CallStatus.ANSWERED);
          }
          break;
        }

        case 'stasis.end': {
          await this.updateCallStateByChannel(event.channelId, CallStatus.COMPLETED);
          break;
        }

        case 'call.transferred': {
          await this.updateCallStateByChannel(event.channelId, CallStatus.TRANSFERRED);
          break;
        }

        case 'recording.started': {
          this.logger.log(`Recording started for channel ${event.channelId}`);
          break;
        }

        case 'recording.finished': {
          // Auto-save recording metadata when recording finishes
          if (event.callId || event.channelId) {
            const call = event.callId
              ? await prisma.callHistory.findUnique({ where: { id: event.callId } })
              : await prisma.callHistory.findFirst({ where: { asteriskCallId: event.channelId } });

            if (call) {
              await prisma.recording.create({
                data: {
                  tenantId: call.tenantId,
                  callHistoryId: call.id,
                  filePath: event.filePath || `/var/spool/asterisk/recording/${event.recordingName}.wav`,
                },
              });

              await prisma.callHistory.update({
                where: { id: call.id },
                data: { recordingUrl: event.filePath },
              });
              this.logger.log(`Recording metadata saved for call ${call.id}`);
            }
          }
          break;
        }

        default:
          this.logger.debug(`Unhandled event type: ${event.event}`);
      }
    } catch (err: any) {
      this.logger.error(`Error handling event: ${err.message}`);
    }
  }

  // Dispatch command to asterisk-adapter over Redis
  async sendAsteriskCommand(action: string, payload: any) {
    const message = JSON.stringify({ action, payload, timestamp: new Date().toISOString() });
    await this.redisPublisher.publish('telephony.commands.asterisk', message);
    this.logger.log(`Dispatched command [${action}] to asterisk-adapter`);
  }

  // Originate a Call
  async originate(tenantId: string, from: string, to: string) {
    this.logger.log(`Tenant [${tenantId}] originating call from ${from} to ${to}`);

    // Create DB CallHistory entry
    const callRecord = await prisma.callHistory.create({
      data: {
        tenantId,
        direction: CallDirection.OUTBOUND,
        fromNumber: from,
        toNumber: to,
        status: CallStatus.INITIATED,
      },
    });

    // GAP 3 FIX: Send ORIGINATE command with correct payload keys matching what command.listener expects
    await this.sendAsteriskCommand('ORIGINATE', {
      to: to,
      from: from,
      callId: callRecord.id,
    });

    return callRecord;
  }

  // Hangup a Call
  async hangup(callId: string) {
    await this.sendAsteriskCommand('HANGUP', { channelId: callId });
    return { callId, status: CallStatus.COMPLETED };
  }

  // Hold / Resume Call
  async hold(callId: string) {
    await this.sendAsteriskCommand('HOLD', { channelId: callId });
    return { callId, status: CallStatus.ON_HOLD };
  }

  async resume(callId: string) {
    await this.sendAsteriskCommand('RESUME', { channelId: callId });
    return { callId, status: CallStatus.ANSWERED };
  }

  // Transfer Call
  async transfer(callId: string, target: string, type: string = 'BLIND') {
    await this.sendAsteriskCommand('TRANSFER', { channelId: callId, target, type });
    return { callId, status: CallStatus.TRANSFERRED };
  }

  // Start Recording on live call
  async startRecording(callId: string) {
    const call = await prisma.callHistory.findUnique({ where: { id: callId } });
    if (!call || !call.asteriskCallId) {
      throw new Error(`No active Asterisk channel found for call ${callId}`);
    }

    const recordingName = `rec_${callId}_${Date.now()}`;
    await this.sendAsteriskCommand('RECORD', {
      channelId: call.asteriskCallId,
      callId: callId,
      name: recordingName,
    });
    return { callId, recordingName, status: 'RECORDING' };
  }

  // Stop Recording on live call
  async stopRecording(callId: string, recordingName: string) {
    const call = await prisma.callHistory.findUnique({ where: { id: callId } });
    await this.sendAsteriskCommand('STOP_RECORD', {
      channelId: call?.asteriskCallId,
      name: recordingName,
    });
    return { callId, recordingName, status: 'RECORDING_STOPPED' };
  }

  // GAP 10 FIX: Find call by asteriskCallId OR by caller/connected numbers
  private async updateCallStateByChannel(channelId: string, status: CallStatus, extra?: { callerNumber?: string; connectedNumber?: string }) {
    // Try direct match by asteriskCallId first
    let activeCall = await prisma.callHistory.findFirst({
      where: { asteriskCallId: channelId },
    });

    // Fallback: try matching by caller number if this is a new Stasis channel
    if (!activeCall && extra?.callerNumber) {
      activeCall = await prisma.callHistory.findFirst({
        where: {
          fromNumber: extra.callerNumber,
          status: { in: [CallStatus.INITIATED, CallStatus.RINGING] },
        },
        orderBy: { startTime: 'desc' },
      });

      // If found, link the asteriskCallId now
      if (activeCall) {
        await prisma.callHistory.update({
          where: { id: activeCall.id },
          data: { asteriskCallId: channelId },
        });
        this.logger.log(`Late-linked asteriskCallId [${channelId}] to CallHistory [${activeCall.id}]`);
      }
    }

    if (activeCall) {
      const updateData: any = { status };
      if (status === CallStatus.ANSWERED) updateData.answerTime = new Date();
      if (status === CallStatus.COMPLETED) {
        updateData.endTime = new Date();
        // Calculate duration in seconds
        if (activeCall.answerTime) {
          updateData.duration = Math.floor((Date.now() - new Date(activeCall.answerTime).getTime()) / 1000);
        }
      }

      await prisma.callHistory.update({
        where: { id: activeCall.id },
        data: updateData,
      });
      this.logger.log(`CallHistory [${activeCall.id}] updated to status: ${status}`);
    } else if (status === CallStatus.RINGING) {
      // Auto-create inbound call history for incoming PSTN calls on DID
      const tenant = await prisma.tenant.findFirst();
      if (tenant) {
        const newInboundCall = await prisma.callHistory.create({
          data: {
            tenantId: tenant.id,
            asteriskCallId: channelId,
            direction: CallDirection.INBOUND,
            fromNumber: extra?.callerNumber || 'PSTN_CALLER',
            toNumber: extra?.connectedNumber || '+914440004407',
            status: CallStatus.RINGING,
          },
        });
        this.logger.log(`Created new Inbound CallHistory [${newInboundCall.id}] for DID call on channel [${channelId}]`);
      }
    } else {
      this.logger.warn(`No CallHistory found for channelId: ${channelId}`);
    }
  }
}
