# Phase 6: Real-Time Events & Webhooks

## 1. Overview
Establish the real-time event pipeline delivering call state changes to client applications via **WebSockets** and asynchronous event notifications via **Webhooks**.

```text
                           ┌─────────────────────────────┐
                           │  telephony.events.normalized│ (Redis Pub/Sub)
                           └──────────────┬──────────────┘
                                          │
                     ┌────────────────────┴────────────────────┐
                     ▼                                         ▼
       ┌───────────────────────────┐             ┌───────────────────────────┐
       │   WebSocket Gateway       │             │    Webhook Service        │
       │   (apps/api)              │             │    (services/webhook-serv) │
       └─────────────┬─────────────┘             └─────────────┬─────────────┘
                     │ WebSocket (ws://)                       │ HTTP POST (Signed)
                     ▼                                         ▼
             CRM Desktop Client                      Tenant Webhook Server
```

---

## 2. WebSocket Gateway Implementation (`events.gateway.ts`)

```typescript
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/events' })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  handleConnection(client: Socket) {
    const tenantId = client.handshake.query.tenantId as string;
    if (!tenantId) {
      client.disconnect();
      return;
    }

    // Join room isolated by tenantId
    client.join(`tenant:${tenantId}`);
    this.logger.log(`Client ${client.id} connected to room tenant:${tenantId}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client ${client.id} disconnected`);
  }

  // Called when Redis Pub/Sub receives a normalized telephony event
  broadcastEvent(tenantId: string, eventName: string, payload: any) {
    this.server.to(`tenant:${tenantId}`).emit(eventName, {
      event: eventName,
      tenantId,
      timestamp: new Date().toISOString(),
      data: payload,
    });
  }
}
```

---

## 3. Webhook Dispatcher & HMAC Security (`webhook.dispatcher.ts`)

```typescript
import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import axios from 'axios';

@Injectable()
export class WebhookDispatcherService {
  private readonly logger = new Logger(WebhookDispatcherService.name);

  async dispatch(url: string, secret: string, eventName: string, payload: any) {
    const body = JSON.stringify({
      event: eventName,
      timestamp: new Date().toISOString(),
      data: payload,
    });

    // Generate HMAC SHA256 signature
    const signature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    try {
      await axios.post(url, body, {
        headers: {
          'Content-Type': 'application/json',
          'X-Telephony-Signature': `sha256=${signature}`,
          'X-Telephony-Event': eventName,
        },
        timeout: 5000,
      });
      this.logger.log(`Successfully dispatched webhook ${eventName} to ${url}`);
    } catch (error) {
      this.logger.error(`Failed to dispatch webhook to ${url}: ${error.message}`);
      // Push to BullMQ retry queue
    }
  }
}
```

---

## 4. Verification Steps
1. Connect a WebSocket client (e.g. `wscat -c "ws://localhost:3000/events?tenantId=test-tenant"`).
2. Trigger an outbound call via REST API.
3. Observe live events (`call.started`, `call.ringing`, `call.answered`) streamed to `wscat`.
4. Trigger call hangup and verify `X-Telephony-Signature` webhook received at test HTTP listener (e.g. Webhook.site).
