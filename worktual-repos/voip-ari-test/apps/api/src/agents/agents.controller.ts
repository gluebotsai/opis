import { Controller, Get, Post, Put, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiSecurity, ApiOperation } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { prisma, AgentStatus } from '@telephony/shared';

class CreateAgentDto {
  name: string;
  email: string;
  extension?: string;
}

class UpdateStatusDto {
  status: AgentStatus;
}

@ApiTags('Agents')
@ApiSecurity('X-API-Key')
@UseGuards(ApiKeyGuard)
@Controller('api/v1/agents')
export class AgentsController {
  @Get()
  @ApiOperation({ summary: 'List all agents for tenant' })
  async listAgents(@Req() req: any) {
    return prisma.agent.findMany({
      where: { tenantId: req.tenant.id },
      include: { sipExtension: true },
    });
  }

  @Post()
  @ApiOperation({ summary: 'Create a new agent' })
  async createAgent(@Req() req: any, @Body() body: CreateAgentDto) {
    const agent = await prisma.agent.create({
      data: {
        tenantId: req.tenant.id,
        name: body.name,
        email: body.email,
        status: AgentStatus.OFFLINE,
      },
    });

    if (body.extension) {
      await prisma.sipExtension.create({
        data: {
          tenantId: req.tenant.id,
          extension: body.extension,
          password: 'password123',
          agentId: agent.id,
        },
      });
    }

    return agent;
  }

  @Put(':id/status')
  @ApiOperation({ summary: 'Update agent presence status' })
  async updateStatus(@Param('id') id: string, @Body() body: UpdateStatusDto) {
    return prisma.agent.update({
      where: { id },
      data: { status: body.status },
    });
  }
}
