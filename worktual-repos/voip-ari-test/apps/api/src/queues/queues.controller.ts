import { Controller, Get, Post, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiSecurity, ApiOperation } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { prisma } from '@telephony/shared';

class CreateQueueDto {
  name: string;
  strategy?: string;
  timeout?: number;
}

class AddMemberDto {
  agentId: string;
  penalty?: number;
}

@ApiTags('Queues')
@ApiSecurity('X-API-Key')
@UseGuards(ApiKeyGuard)
@Controller('api/v1/queues')
export class QueuesController {
  @Get()
  @ApiOperation({ summary: 'List all queues for tenant' })
  async listQueues(@Req() req: any) {
    return prisma.queue.findMany({
      where: { tenantId: req.tenant.id },
      include: { members: { include: { agent: true } } },
    });
  }

  @Post()
  @ApiOperation({ summary: 'Create a new call queue' })
  async createQueue(@Req() req: any, @Body() body: CreateQueueDto) {
    return prisma.queue.create({
      data: {
        tenantId: req.tenant.id,
        name: body.name,
        strategy: body.strategy || 'ringall',
        timeout: body.timeout || 30,
      },
    });
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Assign an agent to a queue' })
  async addMember(@Param('id') id: string, @Body() body: AddMemberDto) {
    return prisma.queueMember.create({
      data: {
        queueId: id,
        agentId: body.agentId,
        penalty: body.penalty || 0,
      },
    });
  }
}
