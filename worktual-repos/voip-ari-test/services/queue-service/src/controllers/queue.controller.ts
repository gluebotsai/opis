import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { QueueService } from '../services/queue.service';

@Controller('queues')
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Get()
  async listQueues(@Query('tenantId') tenantId: string) {
    return this.queueService.listQueues(tenantId);
  }

  @Post()
  async createQueue(@Body() body: { tenantId: string; name: string; strategy?: string; timeout?: number }) {
    return this.queueService.createQueue(body.tenantId, body.name, body.strategy, body.timeout);
  }

  @Post(':id/members')
  async addMember(@Param('id') id: string, @Body() body: { agentId: string; penalty?: number }) {
    return this.queueService.addMember(id, body.agentId, body.penalty);
  }

  @Get(':id/next-agent')
  async getNextAgent(@Param('id') id: string) {
    return this.queueService.getNextAvailableAgent(id);
  }
}
