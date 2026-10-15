import { Injectable, Logger } from '@nestjs/common';
import { prisma } from '@telephony/shared';

@Injectable()
export class NumberService {
  private readonly logger = new Logger(NumberService.name);

  async listNumbers(tenantId: string) {
    return prisma.phoneNumber.findMany({
      where: { tenantId },
    });
  }

  async provisionNumber(
    tenantId: string,
    number: string,
    provider = 'AIRTEL',
    assignedTo?: string,
    routeTo?: string,
    callerId?: string,
  ) {
    this.logger.log(`Provisioning number [${number}] for tenant [${tenantId}]`);
    return prisma.phoneNumber.create({
      data: {
        tenantId,
        number,
        provider,
        assignedTo,
        routeTo,
        callerId,
      },
    });
  }

  async updateNumber(id: string, data: { assignedTo?: string; routeTo?: string; callerId?: string }) {
    return prisma.phoneNumber.update({
      where: { id },
      data,
    });
  }

  async deleteNumber(id: string) {
    return prisma.phoneNumber.delete({
      where: { id },
    });
  }

  // GAP 8 FIX: Inbound DID routing - resolve which queue/extension to route an inbound call to
  async resolveInboundRoute(didNumber: string) {
    const phoneNumber = await prisma.phoneNumber.findUnique({
      where: { number: didNumber },
    });

    if (!phoneNumber) {
      this.logger.warn(`No DID routing found for number: ${didNumber}`);
      return null;
    }

    this.logger.log(`DID [${didNumber}] routes to: ${phoneNumber.routeTo || 'default'}`);
    return {
      tenantId: phoneNumber.tenantId,
      routeTo: phoneNumber.routeTo,
      callerId: phoneNumber.callerId,
    };
  }

  // GAP 8 FIX: Caller ID mapping - get outbound caller ID for a tenant/extension
  async getOutboundCallerId(tenantId: string, extension?: string) {
    // Try to find a number assigned to this extension first
    if (extension) {
      const assigned = await prisma.phoneNumber.findFirst({
        where: { tenantId, assignedTo: extension },
      });
      if (assigned?.callerId) return assigned.callerId;
      if (assigned) return assigned.number;
    }

    // Fallback to the first available number for this tenant
    const defaultNumber = await prisma.phoneNumber.findFirst({
      where: { tenantId },
    });

    return defaultNumber?.callerId || defaultNumber?.number || null;
  }
}
