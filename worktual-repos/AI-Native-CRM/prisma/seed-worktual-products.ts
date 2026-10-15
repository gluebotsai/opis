/**
 * Seed Worktual catalog from price_sheet_03_07_with_price.xlsx (structured, not Excel import).
 * Idempotent: stable IDs under wt-* / wt-book-*.
 *
 * Never uses the legacy default tenant. Pass one of:
 *   SEED_ORGANIZATION_ID=<uuid> npx tsx prisma/seed-worktual-products.ts
 *   SEED_USER_EMAIL=you@company.com npx tsx prisma/seed-worktual-products.ts
 */
import { PrismaClient } from "@prisma/client";
import { requireOrganizationId } from "../backend/src/dao/org/organization";

const prisma = new PrismaClient();

/** Set in main() after resolveSeedOrganizationId — never the legacy default. */
let ORG = "";

async function resolveSeedOrganizationId(): Promise<string> {
  const fromEnv = process.env.SEED_ORGANIZATION_ID?.trim();
  if (fromEnv) return requireOrganizationId(fromEnv);

  const email = process.env.SEED_USER_EMAIL?.trim().toLowerCase();
  if (email) {
    const rows = await prisma.$queryRawUnsafe<Array<{ organization_id: string }>>(
      `SELECT u.organization_id::text AS organization_id
       FROM accounts.setup_users u
       WHERE lower(u.work_email) = $1
         AND u.organization_id IS NOT NULL
       LIMIT 1`,
      email,
    );
    const orgId = rows[0]?.organization_id?.trim();
    if (!orgId) {
      throw new Error(
        `No organization found for SEED_USER_EMAIL=${email}. Set SEED_ORGANIZATION_ID explicitly.`,
      );
    }
    return requireOrganizationId(orgId);
  }

  throw new Error(
    "Refusing to seed without a tenant. Set SEED_ORGANIZATION_ID=<uuid> or SEED_USER_EMAIL=<login email>. Never uses the default tenant id.",
  );
}

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
  const targets = [args.productId, args.offerId, args.addonId].filter(Boolean);
  if (targets.length !== 1) {
    throw new Error(`Entry ${args.id} needs exactly one target`);
  }
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
  ORG = await resolveSeedOrganizationId();
  console.log("Seeding Worktual products for org", ORG);

  // Clear default flags then recreate books
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
  const uae = await upsertBook({
    id: "wt-book-uae",
    name: "UAE / Dubai",
    code: "AE",
    currency: "AED",
    isDefault: false,
  });
  const uk = await upsertBook({
    id: "wt-book-uk",
    name: "United Kingdom",
    code: "UK",
    currency: "GBP",
    isDefault: false,
  });

  // --- AI Native CCaaS ---
  await replaceProduct({
    id: "wt-product-ccaas",
    name: "AI Native Contact Centre (CCaaS)",
    sku: "WT-CCAAS",
    tagline: "Lola chat + voice bots with live agents",
    description:
      "AI Native Contact Centre Solution (Web, WhatsApp, Facebook, Instagram, Email, SMS chatbots + Voicebot) with live agents. India/UAE/UK rate cards apply.",
    category: "CCaaS",
    productType: "customizable",
    billingType: "recurring",
    billingFrequency: "monthly",
    price: 6000,
    currency: "INR",
    customAttributes: {
      source: "price_sheet_03_07_with_price.xlsx",
      taxNote: "GST (India) / VAT (UK) excluded from list prices unless noted",
      channels: [
        "web_chat",
        "whatsapp",
        "facebook",
        "instagram",
        "email",
        "sms",
        "voice",
      ],
    },
    offers: [
      {
        id: "wt-offer-ccaas-starter",
        name: "Starter",
        code: "STARTER",
        meterKey: "seat",
        includedQty: 1,
        sortOrder: 0,
      },
      {
        id: "wt-offer-ccaas-growth",
        name: "Growth",
        code: "GROWTH",
        meterKey: "seat",
        includedQty: 1,
        sortOrder: 1,
      },
      {
        id: "wt-offer-ccaas-pro",
        name: "Pro (AI-Assisted)",
        code: "PRO",
        meterKey: "seat",
        includedQty: 1,
        sortOrder: 2,
      },
      {
        id: "wt-offer-ccaas-enterprise",
        name: "Enterprise (AI-Native)",
        code: "ENTERPRISE",
        meterKey: "seat",
        includedQty: 1,
        sortOrder: 3,
      },
      {
        id: "wt-offer-ccaas-voice-1k",
        name: "Voice pack · 1,000 mins",
        code: "VOICE-1000",
        meterKey: "minute",
        includedQty: 1000,
        sortOrder: 10,
      },
      {
        id: "wt-offer-ccaas-voice-2k",
        name: "Voice pack · 2,000 mins",
        code: "VOICE-2000",
        meterKey: "minute",
        includedQty: 2000,
        sortOrder: 11,
      },
      {
        id: "wt-offer-ccaas-voice-3k",
        name: "Voice pack · 3,000 mins",
        code: "VOICE-3000",
        meterKey: "minute",
        includedQty: 3000,
        sortOrder: 12,
      },
      {
        id: "wt-offer-ccaas-sessions-300",
        name: "Chatbot sessions · 300",
        code: "SESS-300",
        meterKey: "session",
        includedQty: 300,
        sortOrder: 20,
      },
      {
        id: "wt-offer-ccaas-sessions-1k",
        name: "Chatbot sessions · 1,000",
        code: "SESS-1000",
        meterKey: "session",
        includedQty: 1000,
        sortOrder: 21,
      },
      {
        id: "wt-offer-ccaas-sessions-2500",
        name: "Chatbot sessions · 2,500",
        code: "SESS-2500",
        meterKey: "session",
        includedQty: 2500,
        sortOrder: 22,
      },
    ],
    addons: [
      {
        id: "wt-addon-ccaas-live-agent",
        name: "Live agent",
        unitLabel: "agents",
        meterKey: "agent",
        pricingModel: "per_unit",
        unitPrice: 9000,
        sortOrder: 0,
      },
      {
        id: "wt-addon-ccaas-extra-agent",
        name: "Additional live agents (beyond plan)",
        unitLabel: "agents",
        meterKey: "agent",
        isOverage: true,
        pricingModel: "per_unit",
        unitPrice: 15000,
        sortOrder: 1,
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
        sortOrder: 2,
      },
      {
        id: "wt-addon-ccaas-email-volume",
        name: "Email bot volume",
        unitLabel: "emails",
        meterKey: "email",
        pricingModel: "tiered",
        sortOrder: 3,
        tiers: [
          {
            id: "wt-tier-email-3k",
            minQty: 1,
            maxQty: 3000,
            unitPrice: 13.33,
          },
          {
            id: "wt-tier-email-20k",
            minQty: 3001,
            maxQty: 20000,
            unitPrice: 7,
          },
          {
            id: "wt-tier-email-30k",
            minQty: 20001,
            maxQty: 30000,
            unitPrice: 6,
          },
          {
            id: "wt-tier-email-50k",
            minQty: 30001,
            maxQty: null,
            unitPrice: 4.4,
          },
        ],
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
    ],
  });

  // Seat license list prices (India monthly; UK annual-discount monthly equiv in GBP)
  await upsertEntry({
    id: "wt-entry-in-ccaas-starter",
    priceBookId: india.id,
    offerId: "wt-offer-ccaas-starter",
    amount: 6000,
  });
  await upsertEntry({
    id: "wt-entry-in-ccaas-growth",
    priceBookId: india.id,
    offerId: "wt-offer-ccaas-growth",
    amount: 9000,
  });
  await upsertEntry({
    id: "wt-entry-in-ccaas-pro",
    priceBookId: india.id,
    offerId: "wt-offer-ccaas-pro",
    amount: 13000,
  });
  await upsertEntry({
    id: "wt-entry-uk-ccaas-starter",
    priceBookId: uk.id,
    offerId: "wt-offer-ccaas-starter",
    amount: 60,
  });
  await upsertEntry({
    id: "wt-entry-uk-ccaas-growth",
    priceBookId: uk.id,
    offerId: "wt-offer-ccaas-growth",
    amount: 80,
  });
  await upsertEntry({
    id: "wt-entry-uk-ccaas-pro",
    priceBookId: uk.id,
    offerId: "wt-offer-ccaas-pro",
    amount: 110,
  });
  // Voice packs India
  await upsertEntry({
    id: "wt-entry-in-voice-1k",
    priceBookId: india.id,
    offerId: "wt-offer-ccaas-voice-1k",
    amount: 20000,
  });
  await upsertEntry({
    id: "wt-entry-in-voice-2k",
    priceBookId: india.id,
    offerId: "wt-offer-ccaas-voice-2k",
    amount: 35000,
  });
  await upsertEntry({
    id: "wt-entry-in-voice-3k",
    priceBookId: india.id,
    offerId: "wt-offer-ccaas-voice-3k",
    amount: 50000,
  });
  // Voice packs UAE (Dubai 5x approx from sheet headers)
  await upsertEntry({
    id: "wt-entry-ae-voice-1k",
    priceBookId: uae.id,
    offerId: "wt-offer-ccaas-voice-1k",
    amount: 3890,
  });
  await upsertEntry({
    id: "wt-entry-ae-voice-2k",
    priceBookId: uae.id,
    offerId: "wt-offer-ccaas-voice-2k",
    amount: 6807.5,
  });
  await upsertEntry({
    id: "wt-entry-ae-voice-3k",
    priceBookId: uae.id,
    offerId: "wt-offer-ccaas-voice-3k",
    amount: 9725,
  });
  // Session packs India
  await upsertEntry({
    id: "wt-entry-in-sess-300",
    priceBookId: india.id,
    offerId: "wt-offer-ccaas-sessions-300",
    amount: 10000,
  });
  await upsertEntry({
    id: "wt-entry-in-sess-1k",
    priceBookId: india.id,
    offerId: "wt-offer-ccaas-sessions-1k",
    amount: 27000,
  });
  await upsertEntry({
    id: "wt-entry-in-sess-2500",
    priceBookId: india.id,
    offerId: "wt-offer-ccaas-sessions-2500",
    amount: 50000,
  });
  // Session packs UK
  await upsertEntry({
    id: "wt-entry-uk-sess-250",
    priceBookId: uk.id,
    offerId: "wt-offer-ccaas-sessions-300",
    amount: 500,
  });
  await upsertEntry({
    id: "wt-entry-uk-sess-1k",
    priceBookId: uk.id,
    offerId: "wt-offer-ccaas-sessions-1k",
    amount: 1000,
  });
  await upsertEntry({
    id: "wt-entry-uk-sess-2500",
    priceBookId: uk.id,
    offerId: "wt-offer-ccaas-sessions-2500",
    amount: 2500,
  });

  // --- AI Native CRM ---
  await replaceProduct({
    id: "wt-product-crm",
    name: "AI Native CRM",
    sku: "WT-CRM",
    tagline: "Enterprise CRM with contact capacity packs",
    description:
      "User license includes access for up to 10,000 contacts. Implementation cost depends on scope.",
    category: "CRM",
    productType: "customizable",
    billingType: "recurring",
    billingFrequency: "monthly",
    price: 15000,
    currency: "INR",
    customAttributes: {
      source: "price_sheet_03_07_with_price.xlsx",
      implementationInr: 300000,
      includedContacts: 10000,
    },
    offers: [
      {
        id: "wt-offer-crm-user",
        name: "User license",
        code: "USER",
        meterKey: "seat",
        includedQty: 10000,
        sortOrder: 0,
      },
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
          {
            id: "wt-tier-crm-10k",
            minQty: 1,
            maxQty: 10000,
            unitPrice: 1,
          },
          {
            id: "wt-tier-crm-25k",
            minQty: 10001,
            maxQty: 25000,
            unitPrice: 0.9,
          },
          {
            id: "wt-tier-crm-50k",
            minQty: 25001,
            maxQty: null,
            unitPrice: 0.8,
          },
        ],
      },
    ],
  });
  await upsertEntry({
    id: "wt-entry-in-crm-user",
    priceBookId: india.id,
    offerId: "wt-offer-crm-user",
    amount: 15000,
  });
  await upsertEntry({
    id: "wt-entry-in-crm-product",
    priceBookId: india.id,
    productId: "wt-product-crm",
    amount: 15000,
  });

  // --- CDP ---
  await replaceProduct({
    id: "wt-product-cdp",
    name: "Cognitive Customer Data Platform",
    sku: "WT-CDP",
    tagline: "Profile & data-source based pricing",
    description:
      "Charges depend on customer profiles and data sources. Quote from India list as starting point.",
    category: "CDP",
    productType: "fixed",
    billingType: "one_time",
    price: 76500000,
    currency: "INR",
    customAttributes: {
      source: "price_sheet_03_07_with_price.xlsx",
      pricingNote: "Depends on profiles and data sources",
    },
  });
  await upsertEntry({
    id: "wt-entry-in-cdp",
    priceBookId: india.id,
    productId: "wt-product-cdp",
    amount: 76500000,
  });

  // --- Campaign Management ---
  await replaceProduct({
    id: "wt-product-campaign",
    name: "AI Native Campaign Management",
    sku: "WT-CAMPAIGN",
    tagline: "Multi-channel campaigns up to 50k contacts",
    description:
      "Email, SMS, WhatsApp, Push, In-App. Base plan covers 50,000 contacts; channel usage billed separately.",
    category: "Marketing",
    productType: "customizable",
    billingType: "recurring",
    billingFrequency: "monthly",
    price: 35000,
    currency: "INR",
    customAttributes: {
      source: "price_sheet_03_07_with_price.xlsx",
      includedContacts: 50000,
    },
    offers: [
      {
        id: "wt-offer-campaign-base",
        name: "Base · 50k contacts",
        code: "BASE-50K",
        meterKey: "custom",
        includedQty: 50000,
        sortOrder: 0,
      },
    ],
    addons: [
      {
        id: "wt-addon-campaign-email",
        name: "Email campaign",
        unitLabel: "emails",
        meterKey: "email",
        pricingModel: "per_unit",
        unitPrice: 5,
        sortOrder: 0,
      },
      {
        id: "wt-addon-campaign-sms",
        name: "SMS campaign",
        unitLabel: "SMS",
        meterKey: "custom",
        pricingModel: "per_unit",
        unitPrice: 1.06,
        sortOrder: 1,
      },
      {
        id: "wt-addon-campaign-whatsapp",
        name: "WhatsApp campaign",
        unitLabel: "credits",
        meterKey: "custom",
        pricingModel: "per_unit",
        unitPrice: 5,
        sortOrder: 2,
      },
      {
        id: "wt-addon-campaign-web-push",
        name: "Web push",
        unitLabel: "subscribers",
        meterKey: "custom",
        pricingModel: "per_unit",
        unitPrice: 0.44,
        sortOrder: 3,
      },
      {
        id: "wt-addon-campaign-app-push",
        name: "App push",
        unitLabel: "subscribers",
        meterKey: "custom",
        pricingModel: "per_unit",
        unitPrice: 1.23,
        sortOrder: 4,
      },
    ],
  });
  await upsertEntry({
    id: "wt-entry-in-campaign-base",
    priceBookId: india.id,
    offerId: "wt-offer-campaign-base",
    amount: 35000,
  });

  // --- CVM ---
  await replaceProduct({
    id: "wt-product-cvm",
    name: "AI Native Customer Value Management",
    sku: "WT-CVM",
    tagline: "MAU-based value management",
    description:
      "Implementation fee plus monthly for 100,000 monthly active users.",
    category: "CVM",
    productType: "customizable",
    billingType: "recurring",
    billingFrequency: "monthly",
    price: 100000,
    currency: "INR",
    customAttributes: {
      source: "price_sheet_03_07_with_price.xlsx",
      includedMau: 100000,
    },
    offers: [
      {
        id: "wt-offer-cvm-mau",
        name: "100k MAU",
        code: "MAU-100K",
        meterKey: "custom",
        includedQty: 100000,
        sortOrder: 0,
      },
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
  await upsertEntry({
    id: "wt-entry-in-cvm-mau",
    priceBookId: india.id,
    offerId: "wt-offer-cvm-mau",
    amount: 100000,
  });

  // --- Ticketing ---
  await replaceProduct({
    id: "wt-product-ticketing",
    name: "AI Native Ticketing System",
    sku: "WT-TICKETING",
    tagline: "Per-user license with ticket packs",
    description:
      "₹15,000 / user / month includes 2,000 tickets. Additional ticket packs available.",
    category: "Service",
    productType: "customizable",
    billingType: "recurring",
    billingFrequency: "monthly",
    price: 15000,
    currency: "INR",
    customAttributes: {
      source: "price_sheet_03_07_with_price.xlsx",
      includedTicketsPerUser: 2000,
    },
    offers: [
      {
        id: "wt-offer-ticket-user",
        name: "User license · 2,000 tickets",
        code: "USER-2K",
        meterKey: "seat",
        includedQty: 2000,
        sortOrder: 0,
      },
    ],
    addons: [
      {
        id: "wt-addon-ticket-overage",
        name: "Additional tickets",
        unitLabel: "tickets",
        meterKey: "custom",
        isOverage: true,
        pricingModel: "tiered",
        sortOrder: 0,
        tiers: [
          {
            id: "wt-tier-tix-1k",
            minQty: 1,
            maxQty: 1000,
            unitPrice: 12,
          },
          {
            id: "wt-tier-tix-5k",
            minQty: 1001,
            maxQty: 5000,
            unitPrice: 10,
          },
          {
            id: "wt-tier-tix-10k",
            minQty: 5001,
            maxQty: null,
            unitPrice: 9,
          },
        ],
      },
    ],
  });
  await upsertEntry({
    id: "wt-entry-in-ticket-user",
    priceBookId: india.id,
    offerId: "wt-offer-ticket-user",
    amount: 15000,
  });

  // --- Web Tracking (quote TBD) ---
  await replaceProduct({
    id: "wt-product-web-tracking",
    name: "Web Tracking",
    sku: "WT-WEBTRACK",
    tagline: "Scope-dependent quotation",
    description:
      "Quotation pending full solution scope. Charges finalized after clarity on tracking requirements.",
    category: "Analytics",
    productType: "fixed",
    billingType: "one_time",
    price: null,
    currency: "INR",
    customAttributes: {
      source: "price_sheet_03_07_with_price.xlsx",
      statusNote: "Quote after scope clarity",
    },
  });

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
  console.log("Worktual seed complete:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
