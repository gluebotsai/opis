import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
  const logger = new Logger('AsteriskAdapter');
  const app = await NestFactory.createApplicationContext(AppModule);
  logger.log('Asterisk Adapter Microservice started and listening for PBX events...');
}

bootstrap();
