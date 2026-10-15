import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { prisma } from '@telephony/shared';

@Injectable()
export class RecordingService {
  private readonly logger = new Logger(RecordingService.name);

  async listRecordings(tenantId: string) {
    return prisma.recording.findMany({
      where: { tenantId },
      include: { callHistory: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async saveRecording(tenantId: string, callHistoryId: string, filePath: string, fileSize = 0, duration = 0) {
    this.logger.log(`Saving recording metadata for CallHistory [${callHistoryId}] -> ${filePath}`);

    const recording = await prisma.recording.create({
      data: {
        tenantId,
        callHistoryId,
        filePath,
        fileSize,
        duration,
      },
    });

    // Update CallHistory record with recording URL/Path
    await prisma.callHistory.update({
      where: { id: callHistoryId },
      data: { recordingUrl: filePath },
    });

    return recording;
  }
}
