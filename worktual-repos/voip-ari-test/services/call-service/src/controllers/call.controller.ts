import { Controller, Post, Body, Param } from '@nestjs/common';
import { CallStateService } from '../services/call-state.service';

@Controller('calls')
export class CallController {
  constructor(private readonly callStateService: CallStateService) {}

  @Post('originate')
  async originate(@Body() body: { tenantId: string; from: string; to: string }) {
    return this.callStateService.originate(body.tenantId, body.from, body.to);
  }

  @Post(':id/hangup')
  async hangup(@Param('id') id: string) {
    return this.callStateService.hangup(id);
  }

  @Post(':id/hold')
  async hold(@Param('id') id: string) {
    return this.callStateService.hold(id);
  }

  @Post(':id/resume')
  async resume(@Param('id') id: string) {
    return this.callStateService.resume(id);
  }
}
