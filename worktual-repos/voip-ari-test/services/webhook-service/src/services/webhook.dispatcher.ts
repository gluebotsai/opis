import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { createClient } from 'redis';
import axios from 'axios';
import * as crypto from 'crypto';
import { prisma } from '@telephony/shared';

@Injectable()
export class WebhookDispatcherService implements OnModuleInit {
  private readonly logger = new Logger(WebhookDispatcherService.name);
  private redisClient: any;

  async onModuleInit() {
    this.redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    await this.redisClient.connect();

    this.redisClient.subscribe('telephony.events.asterisk', (message: string) => {
      this.handleEvent(message);
    });

    this.logger.log('WebhookDispatcherService subscribed to telephony.events.asterisk');
  }

  private async handleEvent(message: string) {
    try {
      const event = JSON.parse(message);
      this.logger.log(`Dispatching webhook for event: ${event.type}`);

      // Normalized webhook mapping
      let webhookEventType = event.type;
      if (event.type === 'stasis.start') webhookEventType = 'call.started';
      if (event.type === 'stasis.end') webhookEventType = 'call.ended';
      if (event.type === 'channel.up') webhookEventType = 'call.answered';
      if (event.type === 'recording.finished') webhookEventType = 'recording.ready';

      const webhooks = await prisma.webhook.findMany({
        where: { isActive: true },
      });

      for (const webhook of webhooks) {
        if (webhook.events.includes(webhookEventType) || webhook.events.includes('*')) {
          this.sendWebhookWithRetry(webhook.url, webhook.secret, {
            event: webhookEventType,
            timestamp: new Date().toISOString(),
            data: event.data,
          });
        }
      }
    } catch (err: any) {
      this.logger.error(`Error processing webhook event: ${err.message}`);
    }
  }

  private async sendWebhookWithRetry(url: string, secret: string, payload: any, retries = 3) {
    const signature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await axios.post(url, payload, {
          headers: {
            'Content-Type': 'application/json',
            'X-Telephony-Signature': signature,
          },
          timeout: 5000,
        });
        this.logger.log(`Webhook successfully delivered to ${url}`);
        return;
      } catch (err: any) {
        this.logger.warn(`Webhook delivery attempt ${attempt} failed for ${url}: ${err.message}`);
        if (attempt === retries) {
          this.logger.error(`Webhook delivery permanently failed for ${url}`);
        }
      }
    }
  }
}
