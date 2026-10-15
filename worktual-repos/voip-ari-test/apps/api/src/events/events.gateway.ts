import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/events' })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private redisSubscriber: Redis;

  onModuleInit() {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = Number(process.env.REDIS_PORT) || 6379;

    this.redisSubscriber = new Redis({ host, port });

    // Subscribe to all telephony event channels
    this.redisSubscriber.subscribe(
      'telephony.events.asterisk',
      'telephony.events.agent',
      'telephony.events.queue',
      (err) => {
        if (err) this.logger.error(`Redis subscription error: ${err.message}`);
        else this.logger.log('WebSocket Gateway subscribed to telephony event channels');
      },
    );

    this.redisSubscriber.on('message', (channel, message) => {
      this.handleRedisEvent(channel, message);
    });
  }

  onModuleDestroy() {
    this.redisSubscriber?.disconnect();
  }

  handleConnection(client: Socket) {
    const tenantId = (client.handshake.query.tenantId as string) || 'default';
    client.join(`tenant:${tenantId}`);
    this.logger.log(`Client [${client.id}] connected and joined room: tenant:${tenantId}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client [${client.id}] disconnected`);
  }

  private handleRedisEvent(channel: string, rawMessage: string) {
    try {
      const payload = JSON.parse(rawMessage);
      const tenantId = payload.tenantId || 'default';

      let eventName = 'telephony.event';

      // Map raw ARI/platform events to normalized WebSocket event names
      switch (payload.event) {
        // Call events (from asterisk adapter)
        case 'stasis.start':
        case 'call.started':
          eventName = 'call.started';
          break;
        case 'call.initiated':
        case 'channel.originated':
          eventName = 'call.initiated';
          break;
        case 'call.answered':
          eventName = 'call.answered';
          break;
        case 'call.bridged':
          eventName = 'call.bridged';
          break;
        case 'call.hold':
          eventName = 'call.hold';
          break;
        case 'call.resume':
          eventName = 'call.resume';
          break;
        case 'call.muted':
          eventName = 'call.muted';
          break;
        case 'call.unmuted':
          eventName = 'call.unmuted';
          break;
        case 'channel.state_change':
          // Do NOT map Up -> call.answered: inbound PSTN is answered early for MOH
          // before the agent accepts. Use explicit call.answered / call.bridged only.
          if (payload.state === 'Ringing') eventName = 'call.ringing';
          else eventName = 'channel.state_change';
          break;
        case 'call.answer_failed':
          eventName = 'call.answer_failed';
          break;
        case 'stasis.end':
        case 'call.ended':
          eventName = 'call.ended';
          break;
        case 'call.transferred':
          eventName = 'call.transferred';
          break;
        case 'channel.dtmf':
          eventName = 'call.dtmf';
          break;

        // Recording events
        case 'recording.started':
          eventName = 'recording.started';
          break;
        case 'recording.finished':
          eventName = 'recording.ready';
          break;

        // Conference events
        case 'conference.created':
          eventName = 'conference.created';
          break;

        // GAP 5 FIX: Agent status events (from agent-service)
        case 'agent.login':
          eventName = 'agent.online';
          break;
        case 'agent.logout':
          eventName = 'agent.offline';
          break;
        case 'agent.status_change':
          eventName = 'agent.status';
          break;

        // GAP 5 FIX: Queue events (from queue-service)
        case 'queue.member_added':
        case 'queue.member_removed':
        case 'queue.call_entered':
        case 'queue.call_answered':
          eventName = 'queue.updated';
          break;

        // Voicebot events
        case 'voicebot.started':
          eventName = 'voicebot.started';
          break;
        case 'voicebot.stopped':
          eventName = 'voicebot.stopped';
          break;
        case 'voicebot.transcript':
          eventName = 'voicebot.transcript';
          break;
        case 'voicebot.handoff_requested':
          eventName = 'voicebot.handoff_requested';
          break;

        default:
          eventName = payload.event || 'telephony.event';
      }

      this.logger.log(`Broadcasting event [${eventName}] to all clients and room tenant:${tenantId}`);
      this.server.emit(eventName, {
        event: eventName,
        timestamp: new Date().toISOString(),
        data: payload,
      });
      this.server.to(`tenant:${tenantId}`).emit(eventName, {
        event: eventName,
        timestamp: new Date().toISOString(),
        data: payload,
      });
    } catch (err: any) {
      this.logger.error(`Error parsing Redis message for WebSocket broadcast: ${err.message}`);
    }
  }
}
