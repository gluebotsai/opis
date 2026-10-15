import { Controller, Post, Body, Param, UseGuards, Get, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { RedisService } from '../redis.service';

@Controller('api/v1/calls')
@UseGuards(ApiKeyGuard)
export class CallsController {
  private readonly logger = new Logger(CallsController.name);

  constructor(private readonly redisService: RedisService) {}

  @Post()
  async originateCall(
    @Body() body: { from: string; to: string; callId?: string; agentExtension?: string },
  ) {
    try {
      const from = body.from || body.agentExtension || process.env.DEFAULT_AGENT_EXTENSION || 'w1001';
      await this.redisService.publishCommand({
        action: 'ORIGINATE',
        from,
        to: body.to,
        callId: body.callId,
      });
      return {
        success: true,
        message: 'Call origination initiated',
        status: 'INITIATED',
        from,
        to: body.to,
        callId: body.callId,
      };
    } catch (err: any) {
      this.logger.error(`Originate error: ${err.message}`);
      throw new HttpException({ success: false, error: err.message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('active')
  async listActiveCalls() {
    return { success: true, calls: [], message: 'Use WebSocket call.* events for live state' };
  }

  @Post('conference')
  async createConference(@Body() body: { name: string; channelIds: string[] }) {
    try {
      await this.redisService.publishCommand({
        action: 'CONFERENCE',
        name: body.name,
        channelIds: body.channelIds,
      });
      return { success: true, message: 'Multi-party conference created', status: 'CONFERENCE_CREATED' };
    } catch (err: any) {
      this.logger.error(`Conference error: ${err.message}`);
      throw new HttpException({ success: false, error: err.message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':id/hangup')
  async hangupCall(@Param('id') id: string, @Body() body?: { callId?: string }) {
    try {
      await this.redisService.publishCommand({
        action: 'HANGUP',
        channelId: id,
        callId: body?.callId,
      });
      return { success: true, message: 'Call hangup initiated', status: 'HANGUP_INITIATED' };
    } catch (err: any) {
      this.logger.error(`Hangup error: ${err.message}`);
      throw new HttpException({ success: false, error: err.message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':id/answer')
  async answerCall(
    @Param('id') id: string,
    @Body() body: { agentExtension?: string; callId?: string },
  ) {
    try {
      const agentExtension =
        body?.agentExtension || process.env.DEFAULT_AGENT_EXTENSION || 'w1001';
      await this.redisService.publishCommand({
        action: 'ANSWER',
        channelId: id,
        agentExtension,
        callId: body?.callId,
      });
      return {
        success: true,
        message: 'Call answered',
        status: 'ANSWERED',
        agentExtension,
      };
    } catch (err: any) {
      this.logger.error(`Answer error: ${err.message}`);
      throw new HttpException({ success: false, error: err.message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':id/hold')
  async holdCall(@Param('id') id: string) {
    try {
      await this.redisService.publishCommand({
        action: 'HOLD',
        channelId: id,
      });
      return { success: true, message: 'Call placed on hold', status: 'ON_HOLD' };
    } catch (err: any) {
      throw new HttpException({ success: false, error: err.message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':id/resume')
  async resumeCall(@Param('id') id: string) {
    try {
      await this.redisService.publishCommand({
        action: 'RESUME',
        channelId: id,
      });
      return { success: true, message: 'Call resumed', status: 'RESUMED' };
    } catch (err: any) {
      throw new HttpException({ success: false, error: err.message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':id/mute')
  async muteCall(@Param('id') id: string) {
    try {
      await this.redisService.publishCommand({
        action: 'MUTE',
        channelId: id,
      });
      return { success: true, message: 'Call audio muted', status: 'MUTED' };
    } catch (err: any) {
      throw new HttpException({ success: false, error: err.message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':id/unmute')
  async unmuteCall(@Param('id') id: string) {
    try {
      await this.redisService.publishCommand({
        action: 'UNMUTE',
        channelId: id,
      });
      return { success: true, message: 'Call audio unmuted', status: 'UNMUTED' };
    } catch (err: any) {
      throw new HttpException({ success: false, error: err.message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':id/transfer')
  async transferCall(@Param('id') id: string, @Body() body: { target: string; type?: string }) {
    try {
      await this.redisService.publishCommand({
        action: 'TRANSFER',
        channelId: id,
        target: body.target,
        type: body.type || 'BLIND',
      });
      return { success: true, message: 'Call transfer initiated', status: 'TRANSFERRING' };
    } catch (err: any) {
      throw new HttpException({ success: false, error: err.message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':id/record')
  async startRecording(@Param('id') id: string) {
    try {
      const recordingName = `rec_${id}_${Date.now()}`;
      await this.redisService.publishCommand({
        action: 'RECORD',
        channelId: id,
        name: recordingName,
      });
      return { success: true, message: 'Recording started', recordingName, status: 'RECORDING' };
    } catch (err: any) {
      throw new HttpException({ success: false, error: err.message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':id/record/stop')
  async stopRecording(@Param('id') id: string, @Body() body: { name: string }) {
    try {
      await this.redisService.publishCommand({
        action: 'STOP_RECORD',
        channelId: id,
        name: body.name,
      });
      return { success: true, message: 'Recording stopped', status: 'RECORDING_STOPPED' };
    } catch (err: any) {
      throw new HttpException({ success: false, error: err.message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':id/voicebot/start')
  async startVoicebot(@Param('id') id: string, @Body() body?: { callId?: string }) {
    try {
      await this.redisService.publishCommand({
        action: 'VOICEBOT_START',
        channelId: id,
        callId: body?.callId,
      });
      return { success: true, message: 'Voicebot started', status: 'VOICEBOT_STARTED' };
    } catch (err: any) {
      this.logger.error(`Start voicebot error: ${err.message}`);
      throw new HttpException({ success: false, error: err.message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':id/voicebot/stop')
  async stopVoicebot(@Param('id') id: string, @Body() body?: { callId?: string }) {
    try {
      await this.redisService.publishCommand({
        action: 'VOICEBOT_STOP',
        channelId: id,
        callId: body?.callId,
      });
      return { success: true, message: 'Voicebot stopped', status: 'VOICEBOT_STOPPED' };
    } catch (err: any) {
      this.logger.error(`Stop voicebot error: ${err.message}`);
      throw new HttpException({ success: false, error: err.message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':id/voicebot/handoff')
  async handoffVoicebot(
    @Param('id') id: string,
    @Body() body?: { callId?: string; agentExtension?: string },
  ) {
    try {
      const agentExtension = body?.agentExtension || process.env.DEFAULT_AGENT_EXTENSION || 'w1001';
      await this.redisService.publishCommand({
        action: 'VOICEBOT_STOP',
        channelId: id,
        callId: body?.callId,
      });
      await this.redisService.publishCommand({
        action: 'ANSWER',
        channelId: id,
        callId: body?.callId,
        agentExtension,
      });
      return {
        success: true,
        message: 'Voicebot handoff initiated',
        status: 'HANDOFF_INITIATED',
        agentExtension,
      };
    } catch (err: any) {
      this.logger.error(`Voicebot handoff error: ${err.message}`);
      throw new HttpException({ success: false, error: err.message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
