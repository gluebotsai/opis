import { Module } from '@nestjs/common';
import { CallStateService } from './services/call-state.service';
import { CallController } from './controllers/call.controller';

@Module({
  imports: [],
  controllers: [CallController],
  providers: [CallStateService],
})
export class AppModule {}
