/**
 * Smoke-check quote + invoice document pipeline pieces.
 * Usage: npx tsx --env-file=../.env scripts/verify-quote-invoice-docs.ts
 */
import { prisma } from "../src/dao/db/prisma";
import { ensureDefaultInvoiceTemplate } from "../src/dao/finance/invoice-template-service";
import { ensureDefaultQuoteTemplate } from "../src/dao/sales/quote-template-service";
import {
  commercialLinesPipeTable,
  withCommercialLineItemsSection,
} from "../src/lib/commercial-line-table";
import { defaultDocumentBlueprint } from "../src/lib/document-blueprint";

async function main() {
  const orgId = process.env.SEED_ORGANIZATION_ID ||
    "1000";

  const quoteTpl = await ensureDefaultQuoteTemplate(orgId);
  const invoiceTpl = await ensureDefaultInvoiceTemplate(orgId);
  console.log("quote template", quoteTpl.name, quoteTpl.blueprint ? "blueprint=yes" : "blueprint=no");
  console.log("invoice template", invoiceTpl.name, invoiceTpl.blueprint ? "blueprint=yes" : "blueprint=no");

  const bpInvoice = defaultDocumentBlueprint("invoice");
  if (!bpInvoice.html.includes("Invoice")) {
    throw new Error("invoice default blueprint missing Invoice title");
  }

  const table = commercialLinesPipeTable(
    [{ name: "Ticketing", quantity: 1, unitPrice: 50, amount: 50 }],
    "USD",
  );
  if (!table.includes("| Item |")) throw new Error("pipe table header missing");

  const secs = withCommercialLineItemsSection(
    [{ id: "a", key: "introduction", title: "Intro", body: "x", sortOrder: 1 }],
    table,
    "Total: USD 50.00",
  );
  if (!secs.some((s) => s.key === "line_items")) {
    throw new Error("line_items section not injected");
  }

  const quote = await prisma.quote.findFirst({
    where: { organizationId: orgId },
    include: { lines: true },
    orderBy: { updatedAt: "desc" },
  });
  console.log(
    "latest quote",
    quote?.number ?? "(none)",
    "lines=",
    quote?.lines.length ?? 0,
    "blueprint=",
    quote?.blueprint ? "yes" : "no",
  );

  const invoice = await prisma.invoice.findFirst({
    where: { organizationId: orgId },
    include: { lines: true },
    orderBy: { updatedAt: "desc" },
  });
  console.log(
    "latest invoice",
    invoice?.number ?? "(none)",
    "lines=",
    invoice?.lines.length ?? 0,
    "templateId=",
    invoice?.templateId ?? "null",
  );

  console.log("verify-quote-invoice-docs: OK");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
