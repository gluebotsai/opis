import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { prisma } from '@telephony/shared';

const DEMO_API_KEY = process.env.VITE_API_KEY || 'demo-tenant-api-key-12345';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'] || request.headers['X-API-Key'];

    if (!apiKey) {
      throw new UnauthorizedException('Missing X-API-Key header');
    }

    const keyStr = String(apiKey).trim();

    // Fast-path for default / demo tenant key
    if (keyStr === DEMO_API_KEY || keyStr === 'demo-tenant-api-key-12345') {
      request.tenant = { id: 'demo-tenant', name: 'Demo Tenant', apiKey: keyStr };
      return true;
    }

    try {
      const tenant = await prisma.tenant.findUnique({
        where: { apiKey: keyStr },
      });

      if (tenant) {
        request.tenant = tenant;
        return true;
      }
    } catch (err: any) {
      this.logger.warn(`Prisma tenant lookup error (${err?.message || err}) — checking demo key fallback`);
      if (keyStr === DEMO_API_KEY || keyStr === 'demo-tenant-api-key-12345') {
        request.tenant = { id: 'demo-tenant', name: 'Demo Tenant', apiKey: keyStr };
        return true;
      }
    }

    throw new UnauthorizedException('Invalid Tenant API Key');
  }
}
