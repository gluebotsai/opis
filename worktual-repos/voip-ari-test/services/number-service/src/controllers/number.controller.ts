import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { NumberService } from '../services/number.service';

@Controller('numbers')
export class NumberController {
  constructor(private readonly numberService: NumberService) {}

  @Get()
  async listNumbers(@Query('tenantId') tenantId: string) {
    return this.numberService.listNumbers(tenantId || 'demo-tenant-id');
  }

  @Post()
  async provisionNumber(
    @Body() body: { tenantId?: string; number: string; provider?: string; assignedTo?: string },
  ) {
    return this.numberService.provisionNumber(
      body.tenantId || 'demo-tenant-id',
      body.number,
      body.provider,
      body.assignedTo,
    );
  }

  @Delete(':id')
  async deleteNumber(@Param('id') id: string) {
    return this.numberService.deleteNumber(id);
  }
}
