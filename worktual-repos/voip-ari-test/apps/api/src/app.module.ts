import { Module } from '@nestjs/common';
import { CallsController } from './calls/calls.controller';
import { AgentsController } from './agents/agents.controller';
import { QueuesController } from './queues/queues.controller';
import { NumbersController } from './numbers/numbers.controller';
import { WebhooksController } from './webhooks/webhooks.controller';
import { EventsGateway } from './events/events.gateway';
import { RedisService } from './redis.service';

@Module({
  imports: [],
  controllers: [
    CallsController,
    AgentsController,
    QueuesController,
    NumbersController,
    WebhooksController,
  ],
  providers: [EventsGateway, RedisService],
})
export class AppModule {}
