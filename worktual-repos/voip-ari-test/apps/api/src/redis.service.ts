import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private publisher: Redis;

  onModuleInit() {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = Number(process.env.REDIS_PORT) || 6379;

    this.publisher = new Redis({
      host,
      port,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });

    this.publisher.on('connect', () => {
      this.logger.log(`API Gateway connected to Redis Pub/Sub at ${host}:${port}`);
    });

    this.publisher.on('error', (err) => {
      this.logger.error(`API Gateway Redis connection error: ${err.message}`);
    });
  }

  onModuleDestroy() {
    this.publisher?.disconnect();
  }

  async publishCommand(command: any) {
    const payload = typeof command === 'string' ? command : JSON.stringify(command);
    await this.publisher.publish('telephony.commands.asterisk', payload);
    this.logger.log(`Published command [${command.action || 'UNKNOWN'}] to Redis channel telephony.commands.asterisk`);
  }
}
