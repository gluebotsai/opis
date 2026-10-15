import { Module } from '@nestjs/common';
import { RedisService } from './services/redis.service';
import { MediaGatewayService } from './services/media-gateway.service';
import { AriService } from './services/ari.service';
import { AmiService } from './services/ami.service';
import { CommandListenerService } from './services/command.listener';
import { CallSessionService } from './services/call-session.service';
import { HealthController } from './controllers/health.controller';

@Module({
  imports: [],
  controllers: [HealthController],
  providers: [
    RedisService,
    CallSessionService,
    MediaGatewayService,
    AriService,
    AmiService,
    CommandListenerService,
  ],
})
export class AppModule {}
