import { Module } from '@nestjs/common';
import { QueueService } from './services/queue.service';
import { QueueController } from './controllers/queue.controller';

@Module({
  imports: [],
  controllers: [QueueController],
  providers: [QueueService],
})
export class AppModule {}
