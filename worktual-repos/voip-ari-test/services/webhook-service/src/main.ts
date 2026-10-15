import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
  const logger = new Logger('WebhookService');
  const app = await NestFactory.create(AppModule);
  
  const port = process.env.WEBHOOK_SERVICE_PORT || 3005;
  await app.listen(port);
  logger.log(`Webhook Service started and listening on port ${port}...`);
}

bootstrap();
