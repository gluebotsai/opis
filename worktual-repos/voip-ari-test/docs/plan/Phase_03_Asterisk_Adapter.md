# Phase 3: Asterisk Adapter Microservice

## 1. Overview & Responsibilities
The `asterisk-adapter` is a dedicated NestJS microservice that acts as the single bridge between Asterisk PBX and the Telephony Platform. It communicates directly with Asterisk via **ARI (Asterisk REST Interface)** for call control and **AMI (Asterisk Manager Interface)** for low-level events, normalizing PBX events and publishing them to Redis Pub/Sub.

```text
┌─────────────────┐       WebSocket (ARI)      ┌──────────────────────────┐
│  Asterisk PBX   │ ─────────────────────────► │                          │       Redis Pub/Sub
│                 │       TCP Socket (AMI)     │   adapters/              │ ─────────────────────────►
│                 │ ─────────────────────────► │   asterisk-adapter       │ (telephony.events.asterisk)
└─────────────────┘                            └──────────────────────────┘
```

---

## 2. Microservice Architecture & Key Components

### Component 1: ARI Connection Manager (`ari.service.ts`)
Establishes a persistent WebSocket connection to Asterisk Stasis application `telephony`.

```typescript
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as client from 'ari-client';
import { RedisService } from './redis.service';

@Injectable()
export class AriService implements OnModuleInit {
  private readonly logger = new Logger(AriService.name);
  private ariClient: any;

  constructor(private readonly redisService: RedisService) {}

  async onModuleInit() {
    this.connect();
  }

  private connect() {
    client.connect(
      process.env.ARI_URL || 'http://localhost:8088',
      process.env.ARI_USER || 'telephony',
      process.env.ARI_PASSWORD || 'telephony_password',
      (err, ari) => {
        if (err) {
          this.logger.error(`ARI Connection Failed: ${err.message}. Retrying in 5s...`);
          setTimeout(() => this.connect(), 5000);
          return;
        }

        this.ariClient = ari;
        this.logger.log('Connected to Asterisk ARI Stasis Engine');

        // Register Stasis Application Event Handlers
        ari.on('StasisStart', this.handleStasisStart.bind(this));
        ari.on('StasisEnd', this.handleStasisEnd.bind(this));
        ari.on('ChannelStateChange', this.handleChannelStateChange.bind(this));
        
        ari.start('telephony');
      },
    );
  }

  private handleStasisStart(event: any, channel: any) {
    this.logger.log(`StasisStart on Channel: ${channel.id} (${channel.name})`);
    this.redisService.publish('telephony.events.asterisk', {
      type: 'CHANNEL_STASIS_START',
      channelId: channel.id,
      callerNumber: channel.caller.number,
      connectedNumber: channel.connected.number,
      timestamp: new Date().toISOString(),
    });
  }

  private handleStasisEnd(event: any, channel: any) {
    this.logger.log(`StasisEnd on Channel: ${channel.id}`);
    this.redisService.publish('telephony.events.asterisk', {
      type: 'CHANNEL_STASIS_END',
      channelId: channel.id,
      timestamp: new Date().toISOString(),
    });
  }

  private handleChannelStateChange(event: any, channel: any) {
    this.logger.log(`ChannelStateChange [${channel.id}]: ${channel.state}`);
    this.redisService.publish('telephony.events.asterisk', {
      type: 'CHANNEL_STATE_CHANGE',
      channelId: channel.id,
      state: channel.state,
      timestamp: new Date().toISOString(),
    });
  }

  getAriInstance() {
    return this.ariClient;
  }
}
```

### Component 2: AMI Listener (`ami.service.ts`)
Listens to low-level AMI events (e.g. extension registration status, hardware channel destruction).

```typescript
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as AsteriskAmi from 'asterisk-ami';
import { RedisService } from './redis.service';

@Injectable()
export class AmiService implements OnModuleInit {
  private readonly logger = new Logger(AmiService.name);
  private ami: any;

  constructor(private readonly redisService: RedisService) {}

  onModuleInit() {
    this.ami = new AsteriskAmi({
      port: 5038,
      host: 'localhost',
      username: 'telephony',
      password: 'telephony_password',
      reconnect: true,
      sleep: 5000,
    });

    this.ami.connect();

    this.ami.on('connect', () => this.logger.log('Connected to Asterisk AMI'));
    this.ami.on('eventPeerStatus', (event: any) => {
      this.redisService.publish('telephony.events.asterisk', {
        type: 'PEER_STATUS_CHANGE',
        peer: event.peer,
        peerStatus: event.peerstatus,
        timestamp: new Date().toISOString(),
      });
    });
  }
}
```

---

## 3. Step-by-Step Build Instructions
1. Scaffold NestJS app inside `adapters/asterisk-adapter`: `npx nest new adapters/asterisk-adapter --skip-git`.
2. Add dependencies: `npm install ari-client asterisk-ami ioredis @nestjs/microservices`.
3. Add environment file `.env`:
   ```env
   ARI_URL=http://localhost:8088
   ARI_USER=telephony
   ARI_PASSWORD=telephony_password
   REDIS_HOST=localhost
   REDIS_PORT=6379
   ```
4. Build Redis publisher module to emit normalized events to channel `telephony.events.asterisk`.

---

## 4. Verification Steps
1. Run `npm run start:dev` inside `adapters/asterisk-adapter`.
2. Monitor output logs for `Connected to Asterisk ARI Stasis Engine` and `Connected to Asterisk AMI`.
3. Run a Redis monitor in terminal: `docker exec -it telephony-redis redis-cli monitor`.
4. Make a test call from extension 101 to 102 via Linphone softphone.
5. Verify `CHANNEL_STASIS_START` and `CHANNEL_STATE_CHANGE` JSON events appearing live in Redis.
