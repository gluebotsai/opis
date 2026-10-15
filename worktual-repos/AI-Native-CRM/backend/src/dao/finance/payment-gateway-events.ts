import { prisma } from "@/dao/db/prisma";
import type { PaymentGatewayProvider } from "@prisma/client";

export async function recordGatewayEventIfNew(input: {
  provider: PaymentGatewayProvider;
  externalEventId: string;
  organizationId: bigint | string;
  invoiceId?: string | null;
  payload?: unknown;
}): Promise<boolean> {
  const orgId =
    typeof input.organizationId === "bigint"
      ? input.organizationId
      : BigInt(input.organizationId);
  try {
    await prisma.paymentGatewayEvent.create({
      data: {
        provider: input.provider,
        externalEventId: input.externalEventId,
        organizationId: orgId,
        invoiceId: input.invoiceId ?? null,
        payload: input.payload as object | undefined,
      },
    });
    return true;
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: string }).code)
        : "";
    if (code === "P2002") return false;
    throw err;
  }
}
