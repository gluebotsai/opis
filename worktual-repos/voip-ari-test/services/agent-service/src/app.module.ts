import { Module } from '@nestjs/common';
import { AgentService } from './services/agent.service';
import { AgentController } from './controllers/agent.controller';

@Module({
  imports: [],
  controllers: [AgentController],
  providers: [AgentService],
})
export class AppModule {}
