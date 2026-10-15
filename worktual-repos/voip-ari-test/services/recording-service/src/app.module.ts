import { Module } from '@nestjs/common';
import { RecordingService } from './services/recording.service';
import { RecordingController } from './controllers/recording.controller';

@Module({
  imports: [],
  controllers: [RecordingController],
  providers: [RecordingService],
})
export class AppModule {}
