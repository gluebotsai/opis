import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private publisher: Redis;
  private subscriber: Redis;

  onModuleInit() {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = Number(process.env.REDIS_PORT) || 6379;

    this.publisher = new Redis({
      host,
      port,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });

    this.subscriber = new Redis({
      host,
      port,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });

    this.publisher.on('connect', () => {
      this.logger.log(`Connected publisher to Redis Pub/Sub at ${host}:${port}`);
    });

    this.subscriber.on('connect', () => {
      this.logger.log(`Connected subscriber to Redis Pub/Sub at ${host}:${port}`);
    });

    this.publisher.on('error', (err) => {
      this.logger.error(`Redis Publisher connection error: ${err.message}`);
    });

    this.subscriber.on('error', (err) => {
      this.logger.error(`Redis Subscriber connection error: ${err.message}`);
    });
  }

  onModuleDestroy() {
    this.publisher?.disconnect();
    this.subscriber?.disconnect();
  }

  async publish(channel: string, message: any) {
    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    await this.publisher.publish(channel, payload);
  }

  // GAP 12 FIX: Subscribe to incoming Asterisk commands channel
  subscribeCommands(callback: (data: any) => void) {
    this.subscriber.subscribe('telephony.commands.asterisk', (err) => {
      if (err) {
        this.logger.error(`Failed to subscribe to telephony.commands.asterisk: ${err.message}`);
      } else {
        this.logger.log('Subscribed to Redis channel: telephony.commands.asterisk');
      }
    });

    this.subscriber.on('message', (channel, message) => {
      if (channel === 'telephony.commands.asterisk') {
        try {
          const parsed = JSON.parse(message);
          callback(parsed);
        } catch (e) {
          callback(message);
        }
      }
    });
  }
}
