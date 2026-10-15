/**
 * Insert Standard Price.xlsx catalog into organization 1003 (Worktual).
 * Idempotent via stable wt-* ids. Prices match /Users/macbook/Documents/Standard Price.xlsx.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ORG = "1003";

async function upsertBook(args: {
  id: string;
  name: string;
  code: string;
  currency: string;
  isDefault: boolean;
}) {
  return prisma.priceBook.upsert({
    where: { id: args.id },
    create: {
      id: args.id,
      organizationId: ORG,
      name: args.name,
      code: args.code,
      currency: args.currency,
      isDefault: args.isDefault,
    },
    update: {
      organizationId: ORG,
      name: args.name,
      code: args.code,
      currency: args.currency,
      isDefault: args.isDefault,
    },
  });
}

async function upsertEntry(args: {
  id: string;
  priceBookId: string;
  amount: number;
  productId?: string | null;
  offerId?: string | null;
  addonId?: string | null;
}) {
  return prisma.priceBookEntry.upsert({
    where: { id: args.id },
    create: {
      id: args.id,
      organizationId: ORG,
      priceBookId: args.priceBookId,
      productId: args.productId ?? null,
      offerId: args.offerId ?? null,
      addonId: args.addonId ?? null,
      amount: args.amount,
    },
    update: {
      organizationId: ORG,
      amount: args.amount,
      priceBookId: args.priceBookId,
      productId: args.productId ?? null,
      offerId: args.offerId ?? null,
      addonId: args.addonId ?? null,
    },
  });
}

async function replaceProduct(args: {
  id: string;
  name: string;
  sku: string;
  tagline?: string;
  description?: string;
  category: string;
  productType: "fixed" | "customizable";
  billingType: "one_time" | "recurring";
  billingFrequency?: "monthly" | "quarterly" | "annual" | null;
  price: number | null;
  currency: string;
  customAttributes?: Record<string, unknown>;
  offers?: Array<{
    id: string;
    name: string;
    code?: string;
    includedQty?: number | null;
    meterKey?:
      | "seat"
      | "minute"
      | "session"
      | "email"
      | "agent"
      | "flat"
      | "custom"
      | null;
    sortOrder: number;
  }>;
  addons?: Array<{
    id: string;
    name: string;
    unitLabel?: string;
    meterKey?:
      | "seat"
      | "minute"
      | "session"
      | "email"
      | "agent"
      | "flat"
      | "custom"
      | null;
    isOverage?: boolean;
    pricingModel: "flat" | "per_unit" | "stepped" | "tiered";
    flatPrice?: number | null;
    unitPrice?: number | null;
    stepSize?: number | null;
    stepPrice?: number | null;
    sortOrder: number;
    tiers?: Array<{
      id: string;
      minQty: number;
      maxQty: number | null;
      unitPrice: number;
    }>;
  }>;
}) {
  await prisma.addon.deleteMany({ where: { productId: args.id } });
  await prisma.productOffer.deleteMany({ where: { productId: args.id } });

  return prisma.product.upsert({
    where: { id: args.id },
    create: {
      id: args.id,
      organizationId: ORG,
      name: args.name,
      sku: args.sku,
      tagline: args.tagline ?? null,
      description: args.description ?? null,
      category: args.category,
      productType: args.productType,
      billingType: args.billingType,
      billingFrequency: args.billingFrequency ?? null,
      price: args.price,
      currency: args.currency,
      status: "active",
      customAttributes: args.customAttributes ?? undefined,
      offers: args.offers?.length
        ? {
            create: args.offers.map((o) => ({
              id: o.id,
              organizationId: ORG,
              name: o.name,
              code: o.code ?? null,
              includedQty: o.includedQty ?? null,
              meterKey: o.meterKey ?? null,
              sortOrder: o.sortOrder,
              status: "active" as const,
              billingType: args.billingType,
              billingFrequency: args.billingFrequency ?? null,
            })),
          }
        : undefined,
      addons: args.addons?.length
        ? {
            create: args.addons.map((a) => ({
              id: a.id,
              organizationId: ORG,
              name: a.name,
              unitLabel: a.unitLabel ?? null,
              meterKey: a.meterKey ?? null,
              isOverage: Boolean(a.isOverage),
              pricingModel: a.pricingModel,
              flatPrice: a.flatPrice ?? null,
              unitPrice: a.unitPrice ?? null,
              stepSize: a.stepSize ?? null,
              stepPrice: a.stepPrice ?? null,
              sortOrder: a.sortOrder,
              tiers: a.tiers?.length
                ? {
                    create: a.tiers.map((t) => ({
                      id: t.id,
                      organizationId: ORG,
                      minQty: t.minQty,
                      maxQty: t.maxQty,
                      unitPrice: t.unitPrice,
                    })),
                  }
                : undefined,
            })),
          }
        : undefined,
    },
    update: {
      organizationId: ORG,
      name: args.name,
      sku: args.sku,
      tagline: args.tagline ?? null,
      description: args.description ?? null,
      category: args.category,
      productType: args.productType,
      billingType: args.billingType,
      billingFrequency: args.billingFrequency ?? null,
      price: args.price,
      currency: args.currency,
      status: "active",
      customAttributes: args.customAttributes ?? undefined,
      offers: args.offers?.length
        ? {
            create: args.offers.map((o) => ({
              id: o.id,
              organizationId: ORG,
              name: o.name,
              code: o.code ?? null,
              includedQty: o.includedQty ?? null,
              meterKey: o.meterKey ?? null,
              sortOrder: o.sortOrder,
              status: "active" as const,
              billingType: args.billingType,
              billingFrequency: args.billingFrequency ?? null,
            })),
          }
        : undefined,
      addons: args.addons?.length
        ? {
            create: args.addons.map((a) => ({
              id: a.id,
              organizationId: ORG,
              name: a.name,
              unitLabel: a.unitLabel ?? null,
              meterKey: a.meterKey ?? null,
              isOverage: Boolean(a.isOverage),
              pricingModel: a.pricingModel,
              flatPrice: a.flatPrice ?? null,
              unitPrice: a.unitPrice ?? null,
              stepSize: a.stepSize ?? null,
              stepPrice: a.stepPrice ?? null,
              sortOrder: a.sortOrder,
              tiers: a.tiers?.length
                ? {
                    create: a.tiers.map((t) => ({
                      id: t.id,
                      organizationId: ORG,
                      minQty: t.minQty,
                      maxQty: t.maxQty,
                      unitPrice: t.unitPrice,
                    })),
                  }
                : undefined,
            })),
          }
        : undefined,
    },
  });
}

async function main() {
  const org = await prisma.$queryRawUnsafe<Array<{ id: string; company_name: string }>>(
    `SELECT id::text AS id, company_name FROM accounts.organizations WHERE id = 1003`,
  );
  if (!org[0]) throw new Error("Organization 1003 not found");
  console.log(`Seeding Standard Price catalog into org ${org[0].id} (${org[0].company_name})`);

  await prisma.priceBook.updateMany({
    where: { organizationId: ORG },
    data: { isDefault: false },
  });

  const india = await upsertBook({
    id: "wt-book-india",
    name: "India",
    code: "IN",
    currency: "INR",
    isDefault: true,
  });
  const uk = await upsertBook({
    id: "wt-book-uk",
    name: "United Kingdom",
    code: "UK",
    currency: "GBP",
    isDefault: false,
  });

  // --- CCaaS (Standard Price.xlsx India plans) ---
  await replaceProduct({
    id: "wt-product-ccaas",
    name: "AI Native Contact Centre (CCaaS)",
    sku: "WT-CCAAS",
    tagline: "Lola chat + voice bots with live agents",
    description:
      "AI Native Contact Centre Solution (Web, WhatsApp, Facebook, Instagram, Email, SMS chatbots + Voicebot) with live agents. GST excluded from list prices.",
    category: "CCaaS",
    productType: "customizable",
    billingType: "recurring",
    billingFrequency: "monthly",
    price: 3000,
    currency: "INR",
    customAttributes: {
      source: "Standard Price.xlsx",
      implementationInr: 90000,
      taxNote: "GST excluded",
    },
    offers: [
      { id: "wt-offer-ccaas-starter", name: "Starter", code: "STARTER", meterKey: "seat", includedQty: 1, sortOrder: 0 },
      { id: "wt-offer-ccaas-growth", name: "Growth", code: "GROWTH", meterKey: "seat", includedQty: 1, sortOrder: 1 },
      { id: "wt-offer-ccaas-pro", name: "Pro", code: "PRO", meterKey: "seat", includedQty: 1, sortOrder: 2 },
      { id: "wt-offer-ccaas-enterprise", name: "Enterprise", code: "ENTERPRISE", meterKey: "seat", includedQty: 1, sortOrder: 3 },
      { id: "wt-offer-ccaas-voice-3k", name: "Voice pack · 3,000 mins", code: "VOICE-3000", meterKey: "minute", includedQty: 3000, sortOrder: 10 },
      { id: "wt-offer-ccaas-sessions-300", name: "Chatbot sessions · 300", code: "SESS-300", meterKey: "session", includedQty: 300, sortOrder: 20 },
      { id: "wt-offer-ccaas-sessions-1k", name: "Chatbot sessions · 1,000", code: "SESS-1000", meterKey: "session", includedQty: 1000, sortOrder: 21 },
      { id: "wt-offer-ccaas-sessions-2500", name: "Chatbot sessions · 2,500", code: "SESS-2500", meterKey: "session", includedQty: 2500, sortOrder: 22 },
      { id: "wt-offer-ccaas-sessions-3k", name: "Chatbot sessions · 3,000", code: "SESS-3000", meterKey: "session", includedQty: 3000, sortOrder: 23 },
    ],
    addons: [
      {
        id: "wt-addon-ccaas-impl",
        name: "Implementation",
        meterKey: "flat",
        pricingModel: "flat",
        flatPrice: 90000,
        sortOrder: 0,
      },
      {
        id: "wt-addon-ccaas-live-agent",
        name: "Live agent",
        unitLabel: "agents",
        meterKey: "agent",
        pricingModel: "per_unit",
        unitPrice: 9000,
        sortOrder: 1,
      },
      {
        id: "wt-addon-ccaas-extra-agent",
        name: "Additional live agents (beyond plan)",
        unitLabel: "agents",
        meterKey: "agent",
        isOverage: true,
        pricingModel: "per_unit",
        unitPrice: 15000,
        sortOrder: 2,
      },
      {
        id: "wt-addon-ccaas-extra-mins",
        name: "Additional voice minutes",
        unitLabel: "minutes",
        meterKey: "minute",
        isOverage: true,
        pricingModel: "stepped",
        stepSize: 1000,
        stepPrice: 8000,
        sortOrder: 3,
      },
      {
        id: "wt-addon-ccaas-language-setup",
        name: "Additional language setup (excl. English)",
        unitLabel: "languages",
        meterKey: "custom",
        pricingModel: "flat",
        flatPrice: 20000,
        sortOrder: 4,
      },
      {
        id: "wt-addon-ccaas-ml-voice",
        name: "Multilingual Voicebot",
        meterKey: "flat",
        pricingModel: "flat",
        flatPrice: 6000,
        sortOrder: 5,
      },
      {
        id: "wt-addon-ccaas-ml-assist",
        name: "Multilingual Live agent assist",
        meterKey: "flat",
        pricingModel: "flat",
        flatPrice: 1000,
        sortOrder: 6,
      },
    ],
  });

  await upsertEntry({ id: "wt-entry-in-ccaas-starter", priceBookId: india.id, offerId: "wt-offer-ccaas-starter", amount: 3000 });
  await upsertEntry({ id: "wt-entry-in-ccaas-growth", priceBookId: india.id, offerId: "wt-offer-ccaas-growth", amount: 5000 });
  await upsertEntry({ id: "wt-entry-in-ccaas-pro", priceBookId: india.id, offerId: "wt-offer-ccaas-pro", amount: 6000 });
  await upsertEntry({ id: "wt-entry-in-ccaas-enterprise", priceBookId: india.id, offerId: "wt-offer-ccaas-enterprise", amount: 8000 });
  await upsertEntry({ id: "wt-entry-in-voice-3k", priceBookId: india.id, offerId: "wt-offer-ccaas-voice-3k", amount: 50000 });
  await upsertEntry({ id: "wt-entry-in-sess-300", priceBookId: india.id, offerId: "wt-offer-ccaas-sessions-300", amount: 10000 });
  await upsertEntry({ id: "wt-entry-in-sess-1k", priceBookId: india.id, offerId: "wt-offer-ccaas-sessions-1k", amount: 27000 });
  await upsertEntry({ id: "wt-entry-in-sess-2500", priceBookId: india.id, offerId: "wt-offer-ccaas-sessions-2500", amount: 50000 });
  await upsertEntry({ id: "wt-entry-in-sess-3k", priceBookId: india.id, offerId: "wt-offer-ccaas-sessions-3k", amount: 60000 });

  // UK CCaaS seats
  await upsertEntry({ id: "wt-entry-uk-ccaas-starter", priceBookId: uk.id, offerId: "wt-offer-ccaas-starter", amount: 60 });
  await upsertEntry({ id: "wt-entry-uk-ccaas-growth", priceBookId: uk.id, offerId: "wt-offer-ccaas-growth", amount: 80 });
  await upsertEntry({ id: "wt-entry-uk-ccaas-pro", priceBookId: uk.id, offerId: "wt-offer-ccaas-pro", amount: 110 });

  // --- Ticketing ---
  await replaceProduct({
    id: "wt-product-ticketing",
    name: "AI Native Ticketing System",
    sku: "WT-TICKETING",
    tagline: "Per-user license with ticket packs",
    description: "₹15,000 / user / month includes 2,000 tickets. Implementation ₹90,000 + GST.",
    category: "Service",
    productType: "customizable",
    billingType: "recurring",
    billingFrequency: "monthly",
    price: 15000,
    currency: "INR",
    customAttributes: {
      source: "Standard Price.xlsx",
      implementationInr: 90000,
      includedTicketsPerUser: 2000,
    },
    offers: [
      { id: "wt-offer-ticket-user", name: "User license · 2,000 tickets", code: "USER-2K", meterKey: "seat", includedQty: 2000, sortOrder: 0 },
    ],
    addons: [
      {
        id: "wt-addon-ticket-impl",
        name: "Implementation",
        meterKey: "flat",
        pricingModel: "flat",
        flatPrice: 90000,
        sortOrder: 0,
      },
      {
        id: "wt-addon-ticket-overage",
        name: "Additional tickets",
        unitLabel: "tickets",
        meterKey: "custom",
        isOverage: true,
        pricingModel: "tiered",
        sortOrder: 1,
        tiers: [
          { id: "wt-tier-tix-1k", minQty: 1, maxQty: 1000, unitPrice: 12 },
          { id: "wt-tier-tix-5k", minQty: 1001, maxQty: 5000, unitPrice: 10 },
          { id: "wt-tier-tix-10k", minQty: 5001, maxQty: null, unitPrice: 9 },
        ],
      },
    ],
  });
  await upsertEntry({ id: "wt-entry-in-ticket-user", priceBookId: india.id, offerId: "wt-offer-ticket-user", amount: 15000 });

  // --- CRM ---
  await replaceProduct({
    id: "wt-product-crm",
    name: "AI Native CRM",
    sku: "WT-CRM",
    tagline: "Enterprise CRM with contact capacity packs",
    description: "User license includes access for up to 10,000 contacts. Implementation depends on scope.",
    category: "CRM",
    productType: "customizable",
    billingType: "recurring",
    billingFrequency: "monthly",
    price: 15000,
    currency: "INR",
    customAttributes: {
      source: "Standard Price.xlsx",
      implementationInr: 300000,
      includedContacts: 10000,
    },
    offers: [
      { id: "wt-offer-crm-user", name: "User license", code: "USER", meterKey: "seat", includedQty: 10000, sortOrder: 0 },
    ],
    addons: [
      {
        id: "wt-addon-crm-impl",
        name: "Implementation",
        meterKey: "flat",
        pricingModel: "flat",
        flatPrice: 300000,
        sortOrder: 0,
      },
      {
        id: "wt-addon-crm-contacts",
        name: "Additional contacts",
        unitLabel: "contacts",
        meterKey: "custom",
        isOverage: true,
        pricingModel: "tiered",
        sortOrder: 1,
        tiers: [
          { id: "wt-tier-crm-10k", minQty: 1, maxQty: 10000, unitPrice: 1 },
          { id: "wt-tier-crm-25k", minQty: 10001, maxQty: 25000, unitPrice: 0.9 },
          { id: "wt-tier-crm-50k", minQty: 25001, maxQty: null, unitPrice: 0.8 },
        ],
      },
    ],
  });
  await upsertEntry({ id: "wt-entry-in-crm-user", priceBookId: india.id, offerId: "wt-offer-crm-user", amount: 15000 });
  await upsertEntry({ id: "wt-entry-in-crm-product", priceBookId: india.id, productId: "wt-product-crm", amount: 15000 });

  // --- CDP ---
  await replaceProduct({
    id: "wt-product-cdp",
    name: "Cognitive Customer Data Platform",
    sku: "WT-CDP",
    tagline: "Profile & data-source based pricing",
    description: "Charges depend on customer profiles and data sources.",
    category: "CDP",
    productType: "fixed",
    billingType: "one_time",
    price: 76500000,
    currency: "INR",
    customAttributes: {
      source: "Standard Price.xlsx",
      pricingNote: "Depends on profiles and data sources",
    },
  });
  await upsertEntry({ id: "wt-entry-in-cdp", priceBookId: india.id, productId: "wt-product-cdp", amount: 76500000 });

  // --- CVM ---
  await replaceProduct({
    id: "wt-product-cvm",
    name: "AI Native Customer Value Management",
    sku: "WT-CVM",
    tagline: "MAU-based value management",
    description: "Implementation fee plus monthly for 100,000 monthly active users.",
    category: "CVM",
    productType: "customizable",
    billingType: "recurring",
    billingFrequency: "monthly",
    price: 100000,
    currency: "INR",
    customAttributes: {
      source: "Standard Price.xlsx",
      includedMau: 100000,
      implementationInr: 560000,
    },
    offers: [
      { id: "wt-offer-cvm-mau", name: "100k MAU", code: "MAU-100K", meterKey: "custom", includedQty: 100000, sortOrder: 0 },
    ],
    addons: [
      {
        id: "wt-addon-cvm-impl",
        name: "Implementation fee",
        meterKey: "flat",
        pricingModel: "flat",
        flatPrice: 560000,
        sortOrder: 0,
      },
    ],
  });
  await upsertEntry({ id: "wt-entry-in-cvm-mau", priceBookId: india.id, offerId: "wt-offer-cvm-mau", amount: 100000 });

  // --- Campaign (₹25,000 / mo from Standard Price.xlsx) ---
  await replaceProduct({
    id: "wt-product-campaign",
    name: "AI Native Campaign Management",
    sku: "WT-CAMPAIGN",
    tagline: "Multi-channel campaigns up to 50k contacts",
    description:
      "Email, SMS, WhatsApp, Push, In-App. Base plan covers 50,000 contacts; channel usage billed separately. Implementation ₹1,20,000 + GST.",
    category: "Marketing",
    productType: "customizable",
    billingType: "recurring",
    billingFrequency: "monthly",
    price: 25000,
    currency: "INR",
    customAttributes: {
      source: "Standard Price.xlsx",
      includedContacts: 50000,
      implementationInr: 120000,
    },
    offers: [
      { id: "wt-offer-campaign-base", name: "Base · 50k contacts", code: "BASE-50K", meterKey: "custom", includedQty: 50000, sortOrder: 0 },
    ],
    addons: [
      {
        id: "wt-addon-campaign-impl",
        name: "Implementation",
        meterKey: "flat",
        pricingModel: "flat",
        flatPrice: 120000,
        sortOrder: 0,
      },
      {
        id: "wt-addon-campaign-email",
        name: "Email campaign",
        unitLabel: "emails",
        meterKey: "email",
        pricingModel: "per_unit",
        unitPrice: 5,
        sortOrder: 1,
      },
      {
        id: "wt-addon-campaign-sms",
        name: "SMS campaign",
        unitLabel: "SMS",
        meterKey: "custom",
        pricingModel: "per_unit",
        unitPrice: 1.06,
        sortOrder: 2,
      },
      {
        id: "wt-addon-campaign-whatsapp",
        name: "WhatsApp campaign",
        unitLabel: "credits",
        meterKey: "custom",
        pricingModel: "per_unit",
        unitPrice: 5,
        sortOrder: 3,
      },
      {
        id: "wt-addon-campaign-web-push",
        name: "Web push",
        unitLabel: "subscribers",
        meterKey: "custom",
        pricingModel: "per_unit",
        unitPrice: 0.44,
        sortOrder: 4,
      },
      {
        id: "wt-addon-campaign-app-push",
        name: "App push",
        unitLabel: "subscribers",
        meterKey: "custom",
        pricingModel: "per_unit",
        unitPrice: 1.23,
        sortOrder: 5,
      },
    ],
  });
  await upsertEntry({ id: "wt-entry-in-campaign-base", priceBookId: india.id, offerId: "wt-offer-campaign-base", amount: 25000 });

  // --- Web Tracking (visitor tiers from sheet) ---
  await replaceProduct({
    id: "wt-product-web-tracking",
    name: "Web Tracking",
    sku: "WT-WEBTRACK",
    tagline: "Website visitor tracking by monthly volume",
    description: "Monthly unique visitor packs. India list from Standard Price.xlsx.",
    category: "Analytics",
    productType: "customizable",
    billingType: "recurring",
    billingFrequency: "monthly",
    price: 6000,
    currency: "INR",
    customAttributes: {
      source: "Standard Price.xlsx",
    },
    offers: [
      { id: "wt-offer-web-5k", name: "5,000 visitors · 1 website", code: "VIS-5K", meterKey: "custom", includedQty: 5000, sortOrder: 0 },
      { id: "wt-offer-web-10k", name: "10,000 visitors · 1 website", code: "VIS-10K", meterKey: "custom", includedQty: 10000, sortOrder: 1 },
      { id: "wt-offer-web-15k", name: "15,000 visitors · 1 website", code: "VIS-15K", meterKey: "custom", includedQty: 15000, sortOrder: 2 },
      { id: "wt-offer-web-20k", name: "20,000 visitors · up to 2 websites", code: "VIS-20K", meterKey: "custom", includedQty: 20000, sortOrder: 3 },
      { id: "wt-offer-web-25k", name: "25,000 visitors · up to 2 websites", code: "VIS-25K", meterKey: "custom", includedQty: 25000, sortOrder: 4 },
      { id: "wt-offer-web-50k", name: "50,000 visitors · up to 5 websites", code: "VIS-50K", meterKey: "custom", includedQty: 50000, sortOrder: 5 },
    ],
  });
  await upsertEntry({ id: "wt-entry-in-web-5k", priceBookId: india.id, offerId: "wt-offer-web-5k", amount: 6000 });
  await upsertEntry({ id: "wt-entry-in-web-10k", priceBookId: india.id, offerId: "wt-offer-web-10k", amount: 12000 });
  await upsertEntry({ id: "wt-entry-in-web-15k", priceBookId: india.id, offerId: "wt-offer-web-15k", amount: 18000 });
  await upsertEntry({ id: "wt-entry-in-web-20k", priceBookId: india.id, offerId: "wt-offer-web-20k", amount: 24000 });
  await upsertEntry({ id: "wt-entry-in-web-25k", priceBookId: india.id, offerId: "wt-offer-web-25k", amount: 30000 });
  await upsertEntry({ id: "wt-entry-in-web-50k", priceBookId: india.id, offerId: "wt-offer-web-50k", amount: 60000 });
  await upsertEntry({ id: "wt-entry-uk-web-5k", priceBookId: uk.id, offerId: "wt-offer-web-5k", amount: 231 });
  await upsertEntry({ id: "wt-entry-uk-web-10k", priceBookId: uk.id, offerId: "wt-offer-web-10k", amount: 463 });

  const counts = {
    products: await prisma.product.count({
      where: { organizationId: ORG, id: { startsWith: "wt-" } },
    }),
    offers: await prisma.productOffer.count({
      where: { organizationId: ORG, id: { startsWith: "wt-" } },
    }),
    addons: await prisma.addon.count({
      where: { organizationId: ORG, id: { startsWith: "wt-" } },
    }),
    books: await prisma.priceBook.count({
      where: { organizationId: ORG, id: { startsWith: "wt-" } },
    }),
    entries: await prisma.priceBookEntry.count({
      where: { organizationId: ORG, id: { startsWith: "wt-" } },
    }),
  };
  console.log("Seed complete:", counts);

  const products = await prisma.product.findMany({
    where: { organizationId: ORG, id: { startsWith: "wt-" } },
    select: { sku: true, name: true, price: true, currency: true, category: true },
    orderBy: { name: "asc" },
  });
  console.log(JSON.stringify(products, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
