import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiSecurity, ApiOperation } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { prisma } from '@telephony/shared';

class RegisterWebhookDto {
  url: string;
  secret: string;
  events?: string[];
}

@ApiTags('Webhooks')
@ApiSecurity('X-API-Key')
@UseGuards(ApiKeyGuard)
@Controller('api/v1/webhooks')
export class WebhooksController {
  @Get()
  @ApiOperation({ summary: 'List all registered webhooks for tenant' })
  async listWebhooks(@Req() req: any) {
    return prisma.webhook.findMany({
      where: { tenantId: req.tenant.id },
    });
  }

  @Post()
  @ApiOperation({ summary: 'Register a new HTTP webhook callback URL' })
  async createWebhook(@Req() req: any, @Body() body: RegisterWebhookDto) {
    return prisma.webhook.create({
      data: {
        tenantId: req.tenant.id,
        url: body.url,
        secret: body.secret,
        events: body.events || ['*'],
      },
    });
  }
}
