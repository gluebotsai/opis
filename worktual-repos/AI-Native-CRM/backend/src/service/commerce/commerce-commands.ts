/**
 * Framework-agnostic commerce order commands for Fastify Wave 9.
 */

import { getServerUserId } from "@/service/account/session-cookie";
import { canEditCommerce } from "@/service/auth/rbac";
import {
  getCurrentBusinessType,
  requireRole,
} from "@/service/auth/require-role";
import {
  assertRecordAccess,
  resolveRecordOwnerScope,
} from "@/service/auth/ownership-scope";
import { isModuleEnabledForType } from "@/config/modules";
import { getContact, listContacts } from "@/dao/contacts/contact-service";
import { getProduct, listProducts } from "@/dao/products/product-service";
import {
  createCommerceOrder,
  getOrder,
  listOrders,
  type CommerceLineInput,
} from "@/dao/sales/order-service";
import { notifyAdminsAsync } from "@/dao/notifications/notify-admins";
import {
  commerceModuleLabel,
  revenuePathLabel,
} from "@/lib/business-type-copy";
import { formatContactDisplayName } from "@/lib/contact-name";

export type CommandResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export type CommerceOrderRow = {
  id: string;
  number: string;
  status: string;
  total: string;
  currency: string;
  contactId: string | null;
  contactName: string | null;
  companyId: string | null;
  companyName: string | null;
  createdAt: string;
};

export type CommerceOrderDetail = {
  id: string;
  number: string;
  status: string;
  total: string;
  currency: string;
  contactId: string | null;
  contactName: string | null;
  companyId: string | null;
  companyName: string | null;
  dealId: string | null;
  dealTitle: string | null;
  createdAt: string;
  lines: Array<{
    id: string;
    name: string;
    quantity: string;
    unitPrice: string;
    amount: string;
  }>;
  invoices: Array<{
    id: string;
    number: string;
    status: string;
    total: string;
    currency: string;
  }>;
};

export async function listCommerceOrdersCommand(filters: {
  page?: number;
  contactId?: string;
}): Promise<{
  items: CommerceOrderRow[];
  total: number;
  page: number;
  pageSize: number;
  title: string;
  caption: string;
  canEdit: boolean;
}> {
  const { getCurrentUserRole } = await import("@/service/auth/require-role");
  const [businessType, scope, userRole] = await Promise.all([
    getCurrentBusinessType(),
    resolveRecordOwnerScope(),
    getCurrentUserRole(),
  ]);

  if (!isModuleEnabledForType("commerce", businessType)) {
    return {
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
      title: "Commerce",
      caption: "Commerce is not enabled for this business type.",
      canEdit: false,
    };
  }

  const canEdit = canEditCommerce(userRole);

  let contactIds: string[] | undefined;
  if (scope.ownerUserId) {
    const contacts = await listContacts({
      page: 1,
      pageSize: 500,
      status: "active",
      ownerUserId: scope.ownerUserId,
      channelCompanyIds: scope.channelCompanyIds,
    });
    contactIds = contacts.items.map((c) => c.id);
    if (filters.contactId && !contactIds.includes(filters.contactId)) {
      return {
        items: [],
        total: 0,
        page: filters.page ?? 1,
        pageSize: 50,
        title: commerceModuleLabel(businessType),
        caption: `${revenuePathLabel(businessType)}. Orders are tied to contacts; company is optional for B2C.`,
        canEdit,
      };
    }
  }

  const page = filters.page ?? 1;
  const result = await listOrders({
    page,
    contactId: filters.contactId,
    commerceOnly: true,
    ...(contactIds ? { contactIds } : {}),
  });

  const nameIds = [
    ...new Set(
      result.items
        .map((o) => o.contactId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const contactNames = new Map<string, string>();
  if (nameIds.length) {
    const contactsPage = await listContacts({
      page: 1,
      pageSize: 500,
      status: "active",
      ownerUserId: scope.ownerUserId,
      channelCompanyIds: scope.channelCompanyIds,
    });
    for (const c of contactsPage.items) {
      contactNames.set(c.id, c.displayName);
    }
  }

  return {
    items: result.items.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      total: o.total.toString(),
      currency: o.currency,
      contactId: o.contactId,
      contactName: o.contactId
        ? (contactNames.get(o.contactId) ?? null)
        : null,
      companyId: o.company?.id ?? null,
      companyName: o.company?.name ?? null,
      createdAt: o.createdAt.toISOString(),
    })),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    title: commerceModuleLabel(businessType),
    caption: `${revenuePathLabel(businessType)}. Orders are tied to contacts; company is optional for B2C.`,
    canEdit,
  };
}

export async function getCommerceCreateOptionsCommand(): Promise<{
  contacts: Array<{ id: string; displayName: string }>;
  products: Array<{ id: string; name: string; price: string | null }>;
  canEdit: boolean;
}> {
  const [businessType, scope] = await Promise.all([
    getCurrentBusinessType(),
    resolveRecordOwnerScope(),
  ]);
  if (!isModuleEnabledForType("commerce", businessType)) {
    return { contacts: [], products: [], canEdit: false };
  }
  const { getCurrentUserRole } = await import("@/service/auth/require-role");
  const userRole = await getCurrentUserRole();
  const canEdit = canEditCommerce(userRole);

  const [contactsResult, products] = await Promise.all([
    listContacts({
      page: 1,
      pageSize: 100,
      status: "active",
      ownerUserId: scope.ownerUserId,
      channelCompanyIds: scope.channelCompanyIds,
    }),
    listProducts({ page: 1, pageSize: 100, status: "active" }),
  ]);

  return {
    contacts: contactsResult.items.map((c) => ({
      id: c.id,
      displayName: c.displayName,
    })),
    products: products.items.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
    })),
    canEdit,
  };
}

export async function getCommerceOrderCommand(
  id: string,
): Promise<
  { ok: true; order: CommerceOrderDetail } | { ok: false; error: string }
> {
  try {
    const businessType = await getCurrentBusinessType();
    if (!isModuleEnabledForType("commerce", businessType)) {
      return { ok: false, error: "Commerce is not enabled." };
    }

    const order = await getOrder(id);
    if (!order) return { ok: false, error: "Order not found." };
    // Commerce list is contact-first; still allow viewing if access ok.
    if (order.dealId && !order.contactId) {
      return { ok: false, error: "Not a commerce order." };
    }

    let contactName: string | null = null;
    if (order.contactId) {
      const contact = await getContact(order.contactId);
      await assertRecordAccess(
        contact?.crm.ownerUserId ?? null,
        undefined,
        contact?.person.companyId ?? order.companyId,
      );
      if (contact) {
        contactName = contact.displayName;
      } else {
        const { getPeopleByIds } = await import(
          "@/dao/account/account-repository"
        );
        const [person] = await getPeopleByIds([order.contactId]);
        if (person) {
          contactName = formatContactDisplayName(
            person.firstName,
            person.lastName,
          );
        }
      }
    } else if (order.dealId) {
      const { getDeal } = await import("@/dao/sales/deal-service");
      const deal = await getDeal(order.dealId);
      await assertRecordAccess(deal?.ownerUserId ?? null);
    }

    return {
      ok: true,
      order: {
        id: order.id,
        number: order.number,
        status: order.status,
        total: order.total.toString(),
        currency: order.currency,
        contactId: order.contactId,
        contactName,
        companyId: order.company?.id ?? null,
        companyName: order.company?.name ?? null,
        dealId: order.deal?.id ?? null,
        dealTitle: order.deal?.title ?? null,
        createdAt: order.createdAt.toISOString(),
        lines: order.lines.map((line) => ({
          id: line.id,
          name: line.name,
          quantity: line.quantity.toString(),
          unitPrice: line.unitPrice.toString(),
          amount: line.amount.toString(),
        })),
        invoices: order.invoices.map((inv) => ({
          id: inv.id,
          number: inv.number,
          status: inv.status,
          total: inv.total.toString(),
          currency: inv.currency,
        })),
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Order not found.",
    };
  }
}

export async function createCommerceOrderCommand(input: {
  contactId: string;
  productId: string;
  quantity?: number;
}): Promise<CommandResult> {
  try {
    const businessType = await getCurrentBusinessType();
    if (!isModuleEnabledForType("commerce", businessType)) {
      return { ok: false, error: "Commerce is not enabled for this business type." };
    }
    await requireRole(
      canEditCommerce,
      "You do not have permission to create orders.",
    );
    const userId = await getServerUserId();
    if (!userId) return { ok: false, error: "Sign in again." };

    const contact = await getContact(input.contactId);
    if (!contact) return { ok: false, error: "Contact not found." };
    await assertRecordAccess(contact.crm.ownerUserId);

    const selected = await getProduct(input.productId);
    if (!selected) return { ok: false, error: "Product not found." };

    const qty = Math.max(0.01, input.quantity ?? 1);
    const unitPrice = Number.parseFloat(selected.price ?? "0") || 0;
    const lines: CommerceLineInput[] = [
      {
        productId: selected.id,
        name: selected.name,
        quantity: qty,
        unitPrice,
      },
    ];

    const order = await createCommerceOrder({
      contactId: input.contactId,
      companyId: contact.person.companyId,
      lines,
      currency: selected.currency ?? "USD",
      actorUserId: userId,
    });

    notifyAdminsAsync({
      kind: "order_created",
      actorUserId: userId,
      orderId: order.id,
      contactId: input.contactId,
      contactName: contact.displayName,
      companyName: contact.person.company?.name ?? null,
      ownerUserId: contact.crm.ownerUserId ?? contact.person.ownerUserId,
      href: `/commerce/${order.id}`,
      detail: `${selected.name} × ${qty}`,
    });

    return { ok: true, id: order.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create order.",
    };
  }
}
