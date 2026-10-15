import { Injectable, Logger } from '@nestjs/common';

export interface ExternalMediaParams {
  channelId?: string;
  externalHost: string; // e.g. "127.0.0.1:5000" or "ai-gateway:5000"
  format?: string; // e.g. "slin16", "ulaw", "alaw"
  transport?: 'udp' | 'tcp';
  encapsulation?: 'rtp' | 'raw';
  bridgeId?: string;
}

export interface RecordMediaParams {
  targetId: string;
  name: string;
  format?: string;
  isBridge?: boolean;
}

/**
 * MediaGatewayService manages Asterisk ARI media resources:
 * - Mixing & Holding Audio Bridges (2-way audio, multi-party conferencing)
 * - Channel Audio Controls (Answer, MOH Hold/Resume, Mute/Unmute)
 * - ExternalMedia Channels (16kHz PCM audio streams for AI/STT/TTS engines)
 * - Channel & Bridge Audio Recording and Playback
 */
@Injectable()
export class MediaGatewayService {
  private readonly logger = new Logger(MediaGatewayService.name);
  private ariClient: any = null;

  /**
   * Set active ARI client instance from AriService connection
   */
  setAriClient(client: any) {
    this.ariClient = client;
    this.logger.log('MediaGatewayService bound to active ARI client instance');
  }

  /**
   * Create an ARI audio mixing or holding bridge for 2-way call audio
   */
  async createBridge(callId: string, name?: string, type: 'mixing' | 'holding' = 'mixing'): Promise<any> {
    if (!this.ariClient) {
      throw new Error('ARI client is not connected');
    }
    const bridgeName = name || `bridge_${callId}`;
    this.logger.log(`[MediaGateway] Creating ${type} bridge: "${bridgeName}" for callId [${callId}]`);

    const bridge = await this.ariClient.bridges.create({
      type: `${type},dtmf_events`,
      name: bridgeName,
    });

    this.logger.log(`[MediaGateway] Bridge created successfully: ID=${bridge.id} Name="${bridge.name}"`);
    return bridge;
  }

  /**
   * Add one or multiple channels into an audio bridge
   */
  async addChannelToBridge(bridgeId: string, channelId: string | string[]): Promise<void> {
    if (!this.ariClient) {
      throw new Error('ARI client is not connected');
    }
    const channels = Array.isArray(channelId) ? channelId : [channelId];
    this.logger.log(`[MediaGateway] Adding channel(s) [${channels.join(', ')}] to bridge [${bridgeId}]`);

    try {
      await this.ariClient.bridges.addChannel({
        bridgeId,
        channel: channels,
      });
      this.logger.log(`[MediaGateway] Successfully joined channel(s) [${channels.join(', ')}] to bridge [${bridgeId}]`);
    } catch (err: any) {
      this.logger.error(`[MediaGateway] Failed to add channels [${channels.join(', ')}] to bridge [${bridgeId}]: ${err.message}`);
      throw err;
    }
  }

  /**
   * Remove channel(s) from an audio bridge
   */
  async removeChannelFromBridge(bridgeId: string, channelId: string | string[]): Promise<void> {
    if (!this.ariClient) return;
    const channels = Array.isArray(channelId) ? channelId : [channelId];
    this.logger.log(`[MediaGateway] Removing channel(s) [${channels.join(', ')}] from bridge [${bridgeId}]`);

    try {
      await this.ariClient.bridges.removeChannel({
        bridgeId,
        channel: channels,
      });
    } catch (err: any) {
      this.logger.debug(`[MediaGateway] Remove channel from bridge status: ${err.message}`);
    }
  }

  /**
   * Safely destroy an audio bridge
   */
  async destroyBridge(bridgeId: string): Promise<void> {
    if (!this.ariClient || !bridgeId) return;
    this.logger.log(`[MediaGateway] Destroying bridge [${bridgeId}]`);
    try {
      await this.ariClient.bridges.destroy({ bridgeId });
      this.logger.log(`[MediaGateway] Bridge [${bridgeId}] destroyed`);
    } catch (err: any) {
      this.logger.debug(`[MediaGateway] Destroy bridge status: ${err.message}`);
    }
  }

  /**
   * Create an ExternalMedia channel for bidirectional raw PCM audio streaming
   * (e.g., streaming 16kHz PCM audio to an AI Voicebot / STT / TTS media gateway)
   */
  async createExternalMediaStream(params: ExternalMediaParams): Promise<{ externalChannel: any; bridge: any }> {
    if (!this.ariClient) {
      throw new Error('ARI client is not connected');
    }

    const format = params.format || 'slin16';
    const transport = params.transport || 'udp';
    const externalHost = params.externalHost || '127.0.0.1:5000';

    this.logger.log(
      `[MediaGateway] Spawning ExternalMedia stream: host=${externalHost} format=${format} transport=${transport}`,
    );

    const externalChannel = await this.ariClient.channels.externalMedia({
      app: 'telephony',
      external_host: externalHost,
      format,
      transport,
      encapsulation: params.encapsulation || 'rtp',
    });

    this.logger.log(`[MediaGateway] ExternalMedia channel spawned: ID=${externalChannel.id}`);

    let bridge: any = null;
    if (params.channelId) {
      if (params.bridgeId) {
        bridge = { id: params.bridgeId };
      } else {
        bridge = await this.createBridge(params.channelId, `ai_media_bridge_${params.channelId}`);
      }
      await this.addChannelToBridge(bridge.id, [params.channelId, externalChannel.id]);
    }

    return { externalChannel, bridge };
  }

  /**
   * Start Music-on-Hold on a channel
   */
  async startHoldMoh(channelId: string): Promise<void> {
    if (!this.ariClient || !channelId) return;
    this.logger.log(`[MediaGateway] Starting Music-on-Hold on channel [${channelId}]`);
    try {
      await this.ariClient.channels.startMoh({ channelId });
    } catch (err: any) {
      this.logger.debug(`[MediaGateway] startMoh status: ${err.message}`);
    }
  }

  /**
   * Stop Music-on-Hold on a channel
   */
  async stopHoldMoh(channelId: string): Promise<void> {
    if (!this.ariClient || !channelId) return;
    this.logger.log(`[MediaGateway] Stopping Music-on-Hold on channel [${channelId}]`);
    try {
      await this.ariClient.channels.stopMoh({ channelId });
    } catch (err: any) {
      this.logger.debug(`[MediaGateway] stopMoh status: ${err.message}`);
    }
  }

  /**
   * Mute or unmute channel audio
   */
  async setMute(channelId: string, mute: boolean, direction: 'in' | 'out' | 'both' = 'in'): Promise<void> {
    if (!this.ariClient || !channelId) return;
    this.logger.log(`[MediaGateway] ${mute ? 'Muting' : 'Unmuting'} channel [${channelId}] direction=${direction}`);
    try {
      if (mute) {
        await this.ariClient.channels.mute({ channelId, direction });
      } else {
        await this.ariClient.channels.unmute({ channelId, direction });
      }
    } catch (err: any) {
      this.logger.error(`[MediaGateway] Mute/Unmute failed on channel [${channelId}]: ${err.message}`);
      throw err;
    }
  }

  /**
   * Start recording call audio on a channel or bridge
   */
  async startRecording(params: RecordMediaParams): Promise<any> {
    if (!this.ariClient) {
      throw new Error('ARI client is not connected');
    }

    const format = params.format || 'wav';
    this.logger.log(`[MediaGateway] Starting audio recording on ${params.isBridge ? 'bridge' : 'channel'} [${params.targetId}] as name="${params.name}"`);

    if (params.isBridge) {
      return await this.ariClient.bridges.record({
        bridgeId: params.targetId,
        name: params.name,
        format,
        ifExists: 'overwrite',
        beep: false,
      });
    } else {
      return await this.ariClient.channels.record({
        channelId: params.targetId,
        name: params.name,
        format,
        ifExists: 'overwrite',
        beep: false,
      });
    }
  }

  /**
   * Stop an active audio recording
   */
  async stopRecording(recordingName: string): Promise<void> {
    if (!this.ariClient || !recordingName) return;
    this.logger.log(`[MediaGateway] Stopping audio recording: "${recordingName}"`);
    try {
      await this.ariClient.recordings.stop({ recordingName });
    } catch (err: any) {
      this.logger.debug(`[MediaGateway] stopRecording status: ${err.message}`);
    }
  }

  /**
   * Play an audio file or sound prompt to a channel or bridge
   */
  async playMedia(targetId: string, mediaUri: string, isBridge = false): Promise<any> {
    if (!this.ariClient) {
      throw new Error('ARI client is not connected');
    }
    this.logger.log(`[MediaGateway] Playing media "${mediaUri}" to ${isBridge ? 'bridge' : 'channel'} [${targetId}]`);

    if (isBridge) {
      return await this.ariClient.bridges.play({
        bridgeId: targetId,
        media: mediaUri,
      });
    } else {
      return await this.ariClient.channels.play({
        channelId: targetId,
        media: mediaUri,
      });
    }
  }
}
