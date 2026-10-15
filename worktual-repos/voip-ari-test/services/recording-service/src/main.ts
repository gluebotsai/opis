import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
  const logger = new Logger('RecordingService');
  const app = await NestFactory.create(AppModule);
  
  const port = process.env.RECORDING_SERVICE_PORT || 3004;
  await app.listen(port);
  logger.log(`Recording Service started and listening on port ${port}...`);
}

bootstrap();
