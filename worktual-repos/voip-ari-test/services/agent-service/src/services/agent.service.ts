import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma, AgentStatus } from '@telephony/shared';
import Redis from 'ioredis';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private redisPublisher: Redis;

  constructor() {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = Number(process.env.REDIS_PORT) || 6379;
    this.redisPublisher = new Redis({ host, port });
  }

  async listAgents(tenantId: string) {
    return prisma.agent.findMany({
      where: { tenantId },
      include: { sipExtension: true },
    });
  }

  async createAgent(tenantId: string, name: string, email: string, extension?: string) {
    this.logger.log(`Creating agent [${name}] for tenant [${tenantId}]`);

    const agent = await prisma.agent.create({
      data: {
        tenantId,
        name,
        email,
        status: AgentStatus.OFFLINE,
      },
    });

    if (extension) {
      await prisma.sipExtension.create({
        data: {
          tenantId,
          extension,
          password: 'password123',
          agentId: agent.id,
        },
      });
    }

    return agent;
  }

  // GAP 6 FIX: Agent Login - transitions OFFLINE → AVAILABLE
  async login(agentId: string) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { sipExtension: true },
    });
    if (!agent) throw new NotFoundException('Agent not found');

    if (agent.status !== AgentStatus.OFFLINE) {
      throw new BadRequestException(`Agent is already logged in with status: ${agent.status}`);
    }

    const updated = await prisma.agent.update({
      where: { id: agentId },
      data: {
        status: AgentStatus.AVAILABLE,
        lastLoginAt: new Date(),
      },
    });

    this.logger.log(`Agent [${agentId}] logged in → AVAILABLE`);

    // Publish agent.login event for WebSocket & Webhook broadcasting
    await this.redisPublisher.publish('telephony.events.agent', JSON.stringify({
      event: 'agent.login',
      tenantId: agent.tenantId,
      agentId: agent.id,
      agentName: agent.name,
      extension: agent.sipExtension?.extension,
      status: 'AVAILABLE',
      timestamp: new Date().toISOString(),
    }));

    return updated;
  }

  // GAP 6 FIX: Agent Logout - transitions any state → OFFLINE, removes from all queues
  async logout(agentId: string) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { sipExtension: true, queueMembers: true },
    });
    if (!agent) throw new NotFoundException('Agent not found');

    if (agent.status === AgentStatus.OFFLINE) {
      throw new BadRequestException('Agent is already logged out');
    }

    // Remove agent from all queue memberships on logout
    if (agent.queueMembers.length > 0) {
      await prisma.queueMember.deleteMany({
        where: { agentId },
      });
      this.logger.log(`Removed agent [${agentId}] from ${agent.queueMembers.length} queues on logout`);
    }

    const updated = await prisma.agent.update({
      where: { id: agentId },
      data: {
        status: AgentStatus.OFFLINE,
        lastLogoutAt: new Date(),
      },
    });

    this.logger.log(`Agent [${agentId}] logged out → OFFLINE`);

    // Publish agent.logout event
    await this.redisPublisher.publish('telephony.events.agent', JSON.stringify({
      event: 'agent.logout',
      tenantId: agent.tenantId,
      agentId: agent.id,
      agentName: agent.name,
      status: 'OFFLINE',
      timestamp: new Date().toISOString(),
    }));

    return updated;
  }

  async updateStatus(agentId: string, status: AgentStatus) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) throw new NotFoundException('Agent not found');

    this.logger.log(`Updating agent [${agentId}] status to ${status}`);
    const updated = await prisma.agent.update({
      where: { id: agentId },
      data: { status },
    });

    // Publish agent.status_change event
    await this.redisPublisher.publish('telephony.events.agent', JSON.stringify({
      event: 'agent.status_change',
      tenantId: agent.tenantId,
      agentId: agent.id,
      agentName: agent.name,
      previousStatus: agent.status,
      newStatus: status,
      timestamp: new Date().toISOString(),
    }));

    return updated;
  }
}
