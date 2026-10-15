import { Controller, Get } from '@nestjs/common';
import { AriService } from '../services/ari.service';

@Controller('health')
export class HealthController {
  constructor(private readonly ariService: AriService) {}

  @Get()
  checkHealth() {
    const isAriConnected = !!this.ariService.getAriClient();
    return {
      status: isAriConnected ? 'UP' : 'DEGRADED',
      adapter: 'asterisk-adapter',
      ariConnected: isAriConnected,
      timestamp: new Date().toISOString(),
    };
  }
}
