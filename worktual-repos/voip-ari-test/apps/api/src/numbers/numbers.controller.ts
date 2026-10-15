import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiSecurity, ApiOperation } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { prisma } from '@telephony/shared';

class CreateNumberDto {
  number: string;
  provider?: string;
  assignedTo?: string;
}

@ApiTags('Numbers')
@ApiSecurity('X-API-Key')
@UseGuards(ApiKeyGuard)
@Controller('api/v1/numbers')
export class NumbersController {
  @Get()
  @ApiOperation({ summary: 'List all DID phone numbers for tenant' })
  async listNumbers(@Req() req: any) {
    return prisma.phoneNumber.findMany({
      where: { tenantId: req.tenant.id },
    });
  }

  @Post()
  @ApiOperation({ summary: 'Register a new DID phone number' })
  async createNumber(@Req() req: any, @Body() body: CreateNumberDto) {
    return prisma.phoneNumber.create({
      data: {
        tenantId: req.tenant.id,
        number: body.number,
        provider: body.provider || 'AIRTEL',
        assignedTo: body.assignedTo,
      },
    });
  }
}
