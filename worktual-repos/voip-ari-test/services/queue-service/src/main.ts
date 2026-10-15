import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
  const logger = new Logger('QueueService');
  const app = await NestFactory.create(AppModule);
  
  const port = process.env.QUEUE_SERVICE_PORT || 3003;
  await app.listen(port);
  logger.log(`Queue Service started and listening on port ${port}...`);
}

bootstrap();
