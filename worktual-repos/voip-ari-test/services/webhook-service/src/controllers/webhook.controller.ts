import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { prisma } from '@telephony/shared';

@Controller('webhooks')
export class WebhookController {
  @Get()
  async listWebhooks(@Query('tenantId') tenantId: string) {
    return prisma.webhook.findMany({
      where: { tenantId },
    });
  }

  @Post()
  async createWebhook(@Body() body: { tenantId: string; url: string; secret: string; events?: string[] }) {
    return prisma.webhook.create({
      data: {
        tenantId: body.tenantId,
        url: body.url,
        secret: body.secret,
        events: body.events || ['*'],
      },
    });
  }
}
