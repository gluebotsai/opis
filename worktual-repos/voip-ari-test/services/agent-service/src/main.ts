import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
  const logger = new Logger('AgentService');
  const app = await NestFactory.create(AppModule);
  
  const port = process.env.AGENT_SERVICE_PORT || 3002;
  await app.listen(port);
  logger.log(`Agent Service started and listening on port ${port}...`);
}

bootstrap();
