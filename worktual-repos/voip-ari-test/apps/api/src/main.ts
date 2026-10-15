import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
  const logger = new Logger('APIGateway');
  const app = await NestFactory.create(AppModule);

  app.enableCors({ origin: '*' });

  const config = new DocumentBuilder()
    .setTitle('Telephony Platform API')
    .setDescription('Enterprise Multi-Tenant CPaaS REST API Specifications')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'X-API-Key')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`API Gateway started successfully. Swagger docs available at http://localhost:${port}/api/docs`);
}

bootstrap();
