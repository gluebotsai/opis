import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { prisma } from '@telephony/shared';
import Redis from 'ioredis';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private redisPublisher: Redis;

  constructor() {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = Number(process.env.REDIS_PORT) || 6379;
    this.redisPublisher = new Redis({ host, port });
  }

  async listQueues(tenantId: string) {
    return prisma.queue.findMany({
      where: { tenantId },
      include: {
        members: {
          include: { agent: true },
        },
      },
    });
  }

  async createQueue(tenantId: string, name: string, strategy = 'ringall', timeout = 30) {
    this.logger.log(`Creating queue [${name}] with strategy [${strategy}] for tenant [${tenantId}]`);
    return prisma.queue.create({
      data: {
        tenantId,
        name,
        strategy,
        timeout,
      },
    });
  }

  async addMember(queueId: string, agentId: string, penalty = 0) {
    const queue = await prisma.queue.findUnique({ where: { id: queueId } });
    if (!queue) throw new NotFoundException('Queue not found');

    this.logger.log(`Adding Agent [${agentId}] to Queue [${queueId}]`);
    const member = await prisma.queueMember.create({
      data: {
        queueId,
        agentId,
        penalty,
      },
    });

    // Publish queue update event for WebSocket broadcasting
    await this.redisPublisher.publish('telephony.events.queue', JSON.stringify({
      event: 'queue.member_added',
      tenantId: queue.tenantId,
      queueId: queue.id,
      queueName: queue.name,
      agentId,
      timestamp: new Date().toISOString(),
    }));

    return member;
  }

  async removeMember(queueId: string, agentId: string) {
    const queue = await prisma.queue.findUnique({ where: { id: queueId } });
    if (!queue) throw new NotFoundException('Queue not found');

    await prisma.queueMember.delete({
      where: {
        queueId_agentId: { queueId, agentId },
      },
    });

    this.logger.log(`Removed Agent [${agentId}] from Queue [${queueId}]`);

    await this.redisPublisher.publish('telephony.events.queue', JSON.stringify({
      event: 'queue.member_removed',
      tenantId: queue.tenantId,
      queueId: queue.id,
      queueName: queue.name,
      agentId,
      timestamp: new Date().toISOString(),
    }));

    return { success: true };
  }

  async getNextAvailableAgent(queueId: string) {
    const queue = await prisma.queue.findUnique({
      where: { id: queueId },
      include: {
        members: {
          include: { agent: true },
        },
      },
    });

    if (!queue) throw new NotFoundException('Queue not found');

    // Filter available agents
    const availableMembers = queue.members.filter(
      (m) => m.agent.status === 'AVAILABLE',
    );

    if (availableMembers.length === 0) return null;

    if (queue.strategy === 'random') {
      const randomIndex = Math.floor(Math.random() * availableMembers.length);
      return availableMembers[randomIndex].agent;
    }

    // Default ringall / first available
    return availableMembers[0].agent;
  }

  // GAP 7 FIX: Queue metrics endpoint
  async getQueueMetrics(queueId: string) {
    const queue = await prisma.queue.findUnique({
      where: { id: queueId },
      include: {
        members: {
          include: { agent: true },
        },
      },
    });

    if (!queue) throw new NotFoundException('Queue not found');

    const totalMembers = queue.members.length;
    const availableAgents = queue.members.filter((m) => m.agent.status === 'AVAILABLE').length;
    const busyAgents = queue.members.filter((m) => m.agent.status === 'BUSY').length;
    const offlineAgents = queue.members.filter((m) => m.agent.status === 'OFFLINE').length;

    // Count active calls in this queue (calls currently in progress for queue agents)
    const activeCallsForAgents = await prisma.activeCalls.count({
      where: {
        tenantId: queue.tenantId,
        status: { in: ['RINGING', 'ANSWERED'] },
      },
    });

    // Count completed calls for this tenant today for average metrics
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todaysCalls = await prisma.callHistory.findMany({
      where: {
        tenantId: queue.tenantId,
        startTime: { gte: todayStart },
        status: 'COMPLETED',
      },
    });

    const totalCallsToday = todaysCalls.length;
    const totalDuration = todaysCalls.reduce((sum, c) => sum + c.duration, 0);
    const averageCallDuration = totalCallsToday > 0 ? Math.round(totalDuration / totalCallsToday) : 0;

    // Calculate average wait time (time between INITIATED and ANSWERED)
    const answeredCalls = todaysCalls.filter((c) => c.answerTime);
    const totalWait = answeredCalls.reduce((sum, c) => {
      const wait = c.answerTime!.getTime() - c.startTime.getTime();
      return sum + wait;
    }, 0);
    const averageWaitTime = answeredCalls.length > 0 ? Math.round(totalWait / answeredCalls.length / 1000) : 0;

    // Abandoned calls = calls that ended without being answered
    const abandonedCalls = await prisma.callHistory.count({
      where: {
        tenantId: queue.tenantId,
        startTime: { gte: todayStart },
        status: { in: ['NO_ANSWER', 'FAILED'] },
      },
    });

    const serviceLevel = totalCallsToday > 0
      ? Math.round(((totalCallsToday - abandonedCalls) / totalCallsToday) * 100)
      : 100;

    return {
      queueId: queue.id,
      queueName: queue.name,
      strategy: queue.strategy,
      totalMembers,
      availableAgents,
      busyAgents,
      offlineAgents,
      activeCallsInQueue: activeCallsForAgents,
      totalCallsToday,
      averageCallDuration,
      averageWaitTime,
      abandonedCalls,
      serviceLevel,
    };
  }
}
