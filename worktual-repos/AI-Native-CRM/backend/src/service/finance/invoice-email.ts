import { getContact } from "@/dao/contacts/contact-service";
import { sendTransactionalEmail } from "@/service/mail/send-transactional";
import { prisma } from "@/dao/db/prisma";
import { formatInvoiceMoney } from "@/dao/finance/invoice-labels";

export type InvoiceEmailResult =
  | { ok: true }
  | { ok: false; error: string; needsConnect?: boolean };

export type InvoiceEmailMode = "initial_send" | "payment_reminder";

type InvoiceEmailContext = {
  number: string;
  currency: string;
  total: string;
  dueLabel: string;
  dealTitle: string | null;
  companyName: string | null;
  orderNumber: string | null;
  contactName: string | null;
  paymentTerms: string | null;
  sections: unknown;
};

function extractPaymentInstructions(sections: unknown): string | null {
  if (!Array.isArray(sections)) return null;
  for (const row of sections) {
    if (!row || typeof row !== "object") continue;
    const key = String((row as { key?: string }).key ?? "").toLowerCase();
    if (key !== "payment") continue;
    const body = String((row as { body?: string }).body ?? "").trim();
    if (body) return body;
  }
  return null;
}

export function buildInvoiceEmailContent(
  mode: InvoiceEmailMode,
  ctx: InvoiceEmailContext,
  options?: {
    includePdfNote?: boolean;
    paymentLinkUrl?: string | null;
    paymentProviderLabel?: string | null;
  },
): { subject: string; body: string } {
  const greeting = `Hello${ctx.contactName ? ` ${ctx.contactName}` : ""},`;
  const accountLine = ctx.companyName ? `Account: ${ctx.companyName}` : null;
  const orderLine = ctx.orderNumber ? `Order: ${ctx.orderNumber}` : null;
  const total = formatInvoiceMoney(ctx.total, ctx.currency);
  const paymentBlock = extractPaymentInstructions(ctx.sections);
  const pdfLine =
    options?.includePdfNote !== false
      ? "Please find the invoice attached as a PDF."
      : null;
  const onlinePayBlock =
    options?.paymentLinkUrl?.trim()
      ? [
          `Pay online${options.paymentProviderLabel ? ` (${options.paymentProviderLabel})` : ""}:`,
          options.paymentLinkUrl.trim(),
          "",
        ]
      : [];

  if (mode === "payment_reminder") {
    return {
      subject: `Reminder: Invoice ${ctx.number} — ${ctx.dealTitle ?? total}`,
      body: [
        greeting,
        "",
        `This is a payment reminder for invoice ${ctx.number}${
          ctx.dealTitle ? ` (${ctx.dealTitle})` : ""
        }.`,
        accountLine,
        orderLine,
        "",
        ...(pdfLine ? [pdfLine, ""] : []),
        `Amount due: ${total}`,
        `Due date: ${ctx.dueLabel}`,
        "",
        ...onlinePayBlock,
        paymentBlock
          ? `Payment instructions:\n${paymentBlock}`
          : ctx.paymentTerms
            ? `Payment terms: ${ctx.paymentTerms}`
            : "Please arrange payment at your earliest convenience.",
        "",
        "Reply to this email if you have already paid or need assistance.",
        "",
        "— Worktual CRM",
      ]
        .filter((line) => line !== null)
        .join("\n"),
    };
  }

  return {
    subject: `Invoice ${ctx.number} — ${ctx.dealTitle ?? total}`,
    body: [
      greeting,
      "",
      `Please find invoice ${ctx.number} for ${ctx.dealTitle ?? "your account"}.`,
      accountLine,
      orderLine,
      "",
      ...(pdfLine ? [pdfLine, ""] : []),
      `Amount due: ${total}`,
      `Due date: ${ctx.dueLabel}`,
      "",
      ...onlinePayBlock,
      paymentBlock
        ? `Payment instructions:\n${paymentBlock}`
        : ctx.paymentTerms
          ? `Payment terms: ${ctx.paymentTerms}`
          : onlinePayBlock.length
            ? "Bank transfer details are also on the attached PDF if needed."
            : "Please arrange payment at your earliest convenience.",
      "",
      "Reply to this email with questions.",
      "",
      "— Worktual CRM",
    ]
      .filter((line) => line !== null)
      .join("\n"),
  };
}

/**
 * Email invoice details to the deal/contact recipient via the actor's inbox.
 */
export async function sendInvoiceToCustomer(args: {
  invoiceId: string;
  userId: string;
  mode?: InvoiceEmailMode;
  attachment?: { filename: string; buffer: Buffer } | null;
}): Promise<InvoiceEmailResult> {
  const mode = args.mode ?? "initial_send";
  const invoice = await prisma.invoice.findUnique({
    where: { id: args.invoiceId },
    include: {
      company: { select: { id: true, name: true } },
      deal: {
        select: {
          id: true,
          title: true,
          contactId: true,
          contactEmail: true,
          contactName: true,
        },
      },
      order: {
        select: {
          id: true,
          number: true,
          contactId: true,
          deal: {
            select: {
              id: true,
              title: true,
              contactId: true,
              contactEmail: true,
              contactName: true,
            },
          },
        },
      },
    },
  });
  if (!invoice) {
    return { ok: false, error: "Invoice not found." };
  }

  const deal = invoice.deal ?? invoice.order?.deal ?? null;

  let to =
    invoice.leadEmail?.trim() ||
    deal?.contactEmail?.trim() ||
    "";
  let contactId = deal?.contactId ?? invoice.order?.contactId ?? null;
  let contactName = deal?.contactName ?? null;

  if (!to && contactId) {
    const contact = await getContact(contactId);
    to = contact?.person.email?.trim() || "";
    contactName = contact?.displayName ?? contactName;
  }

  if (!to) {
    return {
      ok: false,
      error: "No customer email on the invoice or related deal/contact.",
    };
  }

  const dueLabel = invoice.dueAt
    ? invoice.dueAt.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";

  const providerLabel =
    invoice.paymentProvider === "stripe"
      ? "Stripe"
      : invoice.paymentProvider === "razorpay"
        ? "Razorpay"
        : null;

  const { subject, body } = buildInvoiceEmailContent(mode, {
    number: invoice.number,
    currency: invoice.currency,
    total: invoice.total.toString(),
    dueLabel,
    dealTitle: deal?.title ?? null,
    companyName: invoice.company?.name ?? null,
    orderNumber: invoice.order?.number ?? null,
    contactName,
    paymentTerms: invoice.paymentTerms,
    sections: invoice.sections,
  }, {
    paymentLinkUrl: invoice.paymentLinkUrl,
    paymentProviderLabel: providerLabel,
  });

  return sendTransactionalEmail({
    userId: args.userId,
    to,
    subject,
    body,
    contactId,
    attachments: args.attachment?.buffer?.length
      ? [
          {
            filename: args.attachment.filename,
            contentType: "application/pdf",
            content: args.attachment.buffer,
          },
        ]
      : undefined,
  });
}
