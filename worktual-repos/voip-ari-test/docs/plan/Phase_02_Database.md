# Phase 2: Database Architecture & Shared Library

## 1. Overview & Data Modeling Strategy
Design a multi-tenant relational database schema using Prisma ORM. The `@telephony/shared` package exposes typed data access objects, Prisma Client instances, shared DTOs, and utility functions used by all microservices.

---

## 2. Complete Database Schema (`shared/prisma/schema.prisma`)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  SUPER_ADMIN
  TENANT_ADMIN
  MANAGER
  AGENT
}

enum AgentStatus {
  OFFLINE
  AVAILABLE
  BUSY
  ON_BREAK
  WRAP_UP
}

enum CallDirection {
  INBOUND
  OUTBOUND
  INTERNAL
}

enum CallStatus {
  INITIATED
  RINGING
  ANSWERED
  ON_HOLD
  TRANSFERRED
  COMPLETED
  BUSY
  NO_ANSWER
  FAILED
}

enum TransferType {
  BLIND
  ATTENDED
}

model Tenant {
  id        String   @id @default(uuid())
  name      String
  apiKey    String   @unique @default(uuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  users         User[]
  agents        Agent[]
  sipExtensions SipExtension[]
  numbers       PhoneNumber[]
  queues        Queue[]
  callHistory   CallHistory[]
  recordings    Recording[]
  webhooks      Webhook[]
  auditLogs     AuditLog[]
}

model User {
  id        String   @id @default(uuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  email     String   @unique
  password  String
  name      String
  role      Role     @default(TENANT_ADMIN)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Agent {
  id        String      @id @default(uuid())
  tenantId  String
  tenant    Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name      String
  email     String
  status    AgentStatus @default(OFFLINE)
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt

  sipExtension SipExtension?
  queueMembers QueueMember[]
}

model SipExtension {
  id        String   @id @default(uuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  extension String
  password  String
  agentId   String?  @unique
  agent     Agent?   @relation(fields: [agentId], references: [id], onDelete: SetNull)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([tenantId, extension])
}

model PhoneNumber {
  id        String   @id @default(uuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  number    String   @unique
  provider  String   @default("AIRTEL")
  assignedTo String? // Queue ID or Extension
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Queue {
  id        String   @id @default(uuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name      String
  strategy  String   @default("ringall") // ringall, leastrecent, random
  timeout   Int      @default(30)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  members QueueMember[]
}

model QueueMember {
  id        String   @id @default(uuid())
  queueId   String
  queue     Queue    @relation(fields: [queueId], references: [id], onDelete: Cascade)
  agentId   String
  agent     Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  penalty   Int      @default(0)
  createdAt DateTime @default(now())

  @@unique([queueId, agentId])
}

model CallHistory {
  id             String        @id @default(uuid())
  tenantId       String
  tenant         Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  asteriskCallId String?
  direction      CallDirection
  fromNumber     String
  toNumber       String
  status         CallStatus    @default(INITIATED)
  startTime      DateTime      @default(now())
  answerTime     DateTime?
  endTime        DateTime?
  duration       Int           @default(0)
  recordingUrl   String?

  recordings Recording[]
}

model Recording {
  id            String      @id @default(uuid())
  tenantId      String
  tenant        Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  callHistoryId String
  callHistory   CallHistory @relation(fields: [callHistoryId], references: [id], onDelete: Cascade)
  filePath      String
  fileSize      Int         @default(0)
  duration      Int         @default(0)
  createdAt     DateTime    @default(now())
}

model Webhook {
  id        String   @id @default(uuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  url       String
  secret    String
  events    String[] // Array of event names, e.g. ["call.ended", "recording.ready"]
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model AuditLog {
  id        String   @id @default(uuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  action    String
  actor     String
  details   Json?
  createdAt DateTime @default(now())
}
```

---

## 3. Implementation Steps

### Step 2.1: Shared Library Package Setup (`shared/package.json`)
```json
{
  "name": "@telephony/shared",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "db:generate": "prisma generate",
    "db:push": "prisma db push",
    "db:migrate": "prisma migrate dev"
  },
  "dependencies": {
    "@prisma/client": "^5.10.0"
  },
  "devDependencies": {
    "prisma": "^5.10.0",
    "typescript": "^5.3.0"
  }
}
```

### Step 2.2: Shared Entry Point (`shared/src/index.ts`)
```typescript
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
});

export * from '@prisma/client';
```

---

## 4. Verification Steps
1. Set `DATABASE_URL="postgresql://postgres:password@localhost:5432/telephony?schema=public"`.
2. Run `npm run db:push -w @telephony/shared`.
3. Confirm PostgreSQL tables are created using `docker exec -it telephony-db psql -U postgres -d telephony -c "\dt"`.
