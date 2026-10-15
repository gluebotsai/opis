import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
  const logger = new Logger('CallService');
  const app = await NestFactory.create(AppModule);
  
  const port = process.env.CALL_SERVICE_PORT || 3001;
  await app.listen(port);
  logger.log(`Call Service started and listening on port ${port}...`);
}

bootstrap();
