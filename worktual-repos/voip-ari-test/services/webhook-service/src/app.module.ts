import { Module } from '@nestjs/common';
import { WebhookDispatcherService } from './services/webhook.dispatcher';
import { WebhookController } from './controllers/webhook.controller';

@Module({
  imports: [],
  controllers: [WebhookController],
  providers: [WebhookDispatcherService],
})
export class AppModule {}
