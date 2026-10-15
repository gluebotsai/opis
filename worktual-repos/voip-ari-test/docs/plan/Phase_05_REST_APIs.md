# Phase 5: REST API Gateway & Authentication

## 1. Overview
The `apps/api` NestJS application acts as the public-facing API Gateway for consuming applications (CRM, Contact Center, AI Voice). It handles multi-tenant authentication, rate limiting, request validation, and routes requests to underlying core microservices.

```text
                                 ┌───────────────────────────┐
                                 │     API GATEWAY           │
  Client App (CRM) ────────────► │     apps/api              │
  • REST API (HTTP)              │  • Auth Guards (JWT/Keys) │
  • Swagger Docs                 │  • Rate Limiting          │
                                 │  • OpenAPI Specs          │
                                 └─────────────┬─────────────┘
                                               │ (NATS / gRPC / Redis)
                                               ▼
                                      Microservices Ecosystem
```

---

## 2. Authentication & Authorization Guards

### 2.1 API Key Guard (`api-key.guard.ts`)
Allows backend server-to-server integration from CRMs using the `X-API-Key` header.

```typescript
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { prisma } from '@telephony/shared';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];

    if (!apiKey) {
      throw new UnauthorizedException('X-API-Key header is missing');
    }

    const tenant = await prisma.tenant.findUnique({
      where: { apiKey: String(apiKey) },
    });

    if (!tenant) {
      throw new UnauthorizedException('Invalid API Key');
    }

    // Attach tenant to request object for downstream controllers
    request.tenant = tenant;
    return true;
  }
}
```

---

## 3. Endpoints Breakdown

### 3.1 Call Control Controller (`calls.controller.ts`)

| Method | Endpoint | Description | Request Body Example |
| --- | --- | --- | --- |
| `POST` | `/api/v1/calls` | Originate a new call | `{"from": "101", "to": "102"}` |
| `POST` | `/api/v1/calls/:id/hangup` | Terminate an active call | N/A |
| `POST` | `/api/v1/calls/:id/hold` | Place call on hold | N/A |
| `POST` | `/api/v1/calls/:id/resume` | Resume held call | N/A |
| `POST` | `/api/v1/calls/:id/transfer` | Transfer call | `{"target": "103", "type": "BLIND"}` |
| `POST` | `/api/v1/calls/:id/mute` | Mute channel audio | N/A |
| `POST` | `/api/v1/calls/:id/unmute` | Unmute channel audio | N/A |

### 3.2 Agent Management Controller (`agents.controller.ts`)

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/v1/agents` | List all agents for the tenant |
| `POST` | `/api/v1/agents` | Create a new agent profile |
| `PUT` | `/api/v1/agents/:id/status` | Update agent presence status (`AVAILABLE`, `OFFLINE`, `BUSY`) |
| `DELETE` | `/api/v1/agents/:id` | Remove an agent profile |

---

## 4. Swagger Setup (`main.ts`)
```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('Telephony Platform API')
    .setDescription('Multi-Tenant CPaaS Telephony REST API Specifications')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'X-API-Key')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(3000);
}
bootstrap();
```

---

## 5. Verification Steps
1. Start API gateway: `npm run start:dev -w apps/api`.
2. Open `http://localhost:3000/api/docs` in browser to confirm Swagger UI loads.
3. Test `POST /api/v1/calls` endpoint via Postman passing valid `X-API-Key`.
