import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { AgentService } from '../services/agent.service';
import { AgentStatus } from '@telephony/shared';

@Controller('agents')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Get()
  async listAgents(@Query('tenantId') tenantId: string) {
    return this.agentService.listAgents(tenantId);
  }

  @Post()
  async createAgent(@Body() body: { tenantId: string; name: string; email: string; extension?: string }) {
    return this.agentService.createAgent(body.tenantId, body.name, body.email, body.extension);
  }

  @Put(':id/status')
  async updateStatus(@Param('id') id: string, @Body() body: { status: AgentStatus }) {
    return this.agentService.updateStatus(id, body.status);
  }
}
