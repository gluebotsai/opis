import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { RecordingService } from '../services/recording.service';

@Controller('recordings')
export class RecordingController {
  constructor(private readonly recordingService: RecordingService) {}

  @Get()
  async listRecordings(@Query('tenantId') tenantId: string) {
    return this.recordingService.listRecordings(tenantId);
  }

  @Post()
  async saveRecording(
    @Body() body: { tenantId: string; callHistoryId: string; filePath: string; fileSize?: number; duration?: number },
  ) {
    return this.recordingService.saveRecording(
      body.tenantId,
      body.callHistoryId,
      body.filePath,
      body.fileSize,
      body.duration,
    );
  }
}
