import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { DEFAULT_ORGANIZATION_ID } from "../backend/src/dao/org/organization";

const accountUrl =
  process.env.ACCOUNT_DATABASE_URL ??
  "postgresql://postgres@localhost:5432/my_account_qa";

const account = new Pool({ connectionString: accountUrl });
const prisma = new PrismaClient();
/** Seed tenant only — runtime app code must never fall back to this. */
const SEED_ORG = DEFAULT_ORGANIZATION_ID;

async function insertContact(args: {
  first: string;
  last: string;
  email: string;
  phone?: string | null;
  title?: string | null;
  city?: string | null;
  country?: string | null;
  companyName?: string | null;
  domain?: string | null;
  industry?: string | null;
  companyId?: string | null;
  locationId?: string | null;
  stage: string;
  tags: string[];
  notes?: string | null;
  userId: string;
  organizationId?: string;
}) {
  const organizationId = args.organizationId?.trim() || SEED_ORG;
  const { rows } = await account.query<{ id: string }>(
    `INSERT INTO public.contacts (
       first_name, last_name, email, phone, title, city, country,
       company_name, company_domain, company_industry,
       created_by_user_id
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::bigint
     )
     RETURNING id::text AS id`,
    [
      args.first,
      args.last,
      args.email,
      args.phone ?? null,
      args.title ?? null,
      args.city ?? null,
      args.country ?? null,
      args.companyName ?? null,
      args.domain ?? null,
      args.industry ?? null,
      args.userId,
    ],
  );
  const id = rows[0].id;
  await prisma.contactProfile.upsert({
    where: { accountContactId: id },
    create: {
      accountContactId: id,
      organizationId,
      companyId: args.companyId ?? null,
      locationId: args.locationId ?? null,
      ownerUserId: args.userId,
      contactType: args.stage,
      leadSource: "Seed",
      tags: args.tags,
      status: "active",
      notes: args.notes ?? null,
    },
    update: {
      organizationId,
      companyId: args.companyId ?? null,
      locationId: args.locationId ?? null,
      ownerUserId: args.userId,
      contactType: args.stage,
      leadSource: "Seed",
      tags: args.tags,
      status: "active",
      notes: args.notes ?? null,
    },
  });
  return id;
}

async function main() {
  const passwordHash = await bcrypt.hash("demo", 10);

  /** Password for every seeded login: demo */
  const loginUsers = [
    // --- B2B ---
    {
      email: "admin.b2b@worktual.com",
      name: "B2B Admin",
      role: "admin",
    },
    {
      email: "rep.b2b@worktual.com",
      name: "B2B Sales Rep",
      role: "sales_rep",
    },
    {
      email: "manager.b2b@worktual.com",
      name: "B2B Sales Manager",
      role: "sales_manager",
    },
    {
      email: "finance.b2b@worktual.com",
      name: "B2B Finance",
      role: "finance",
    },
    {
      email: "viewer.b2b@worktual.com",
      name: "B2B Viewer",
      role: "viewer",
    },
    {
      email: "marketing.b2b@worktual.com",
      name: "B2B Marketing",
      role: "marketing",
    },
    // --- B2C ---
    {
      email: "admin.b2c@worktual.com",
      name: "B2C Admin",
      role: "admin",
    },
    {
      email: "rep.b2c@worktual.com",
      name: "B2C Sales Rep",
      role: "sales_rep",
    },
    {
      email: "manager.b2c@worktual.com",
      name: "B2C Sales Manager",
      role: "sales_manager",
    },
    // No finance.b2c — B2C uses Commerce, not B2B Finance invoices
    {
      email: "viewer.b2c@worktual.com",
      name: "B2C Viewer",
      role: "viewer",
    },
    {
      email: "marketing.b2c@worktual.com",
      name: "B2C Marketing",
      role: "marketing",
    },
    // --- B2B2C ---
    {
      email: "admin.b2b2c@worktual.com",
      name: "B2B2C Admin",
      role: "admin",
    },
    {
      email: "rep.b2b2c@worktual.com",
      name: "B2B2C Sales Rep",
      role: "sales_rep",
    },
    {
      email: "manager.b2b2c@worktual.com",
      name: "B2B2C Sales Manager",
      role: "sales_manager",
    },
    {
      email: "finance.b2b2c@worktual.com",
      name: "B2B2C Finance",
      role: "finance",
    },
    {
      email: "viewer.b2b2c@worktual.com",
      name: "B2B2C Viewer",
      role: "viewer",
    },
    {
      email: "marketing.b2b2c@worktual.com",
      name: "B2B2C Marketing",
      role: "marketing",
    },
  ] as const;

  let userId = "";
  for (const u of loginUsers) {
    const bt = u.email.includes(".b2b2c@")
      ? "b2b2c"
      : u.email.includes(".b2c@")
        ? "b2c"
        : "b2b";
    const userResult = await account.query<{ id: string }>(
      `INSERT INTO public.users (
         email, password, role, display_name, is_active,
         organization_id, business_type
       )
       VALUES ($1, $2, $3, $4, true, $5::bigint, $6)
       ON CONFLICT (email) DO UPDATE
         SET password = EXCLUDED.password,
             role = EXCLUDED.role,
             display_name = EXCLUDED.display_name,
             is_active = true,
             organization_id = EXCLUDED.organization_id,
             business_type = EXCLUDED.business_type,
             updated_at = now()
       RETURNING id`,
      [
        u.email,
        passwordHash,
        u.role,
        u.name,
        "1000",
        bt,
      ],
    );
    if (u.email === "admin.b2b@worktual.com") {
      userId = userResult.rows[0].id;
    }
  }

  /**
   * Align accounts.organizations.business_type with demo tenants.
   * Runtime reads business_type from accounts.organizations (via setup_users join),
   * not public.users. Separate orgs per motion so demo logins stay correct.
   * No accounts DDL — UPDATE / INSERT only on existing columns.
   */
  const seedOrgs = [
    { id: "1000", name: "Worktual B2B Demo", businessType: "b2b" },
    { id: "1001", name: "Worktual B2C Demo", businessType: "b2c" },
    { id: "1002", name: "Worktual B2B2C Demo", businessType: "b2b2c" },
  ] as const;
  for (const org of seedOrgs) {
    try {
      await account.query(
        `INSERT INTO accounts.organizations (id, company_name, business_type)
         VALUES ($1::bigint, $2, $3)
         ON CONFLICT (id) DO UPDATE
           SET business_type = EXCLUDED.business_type,
               company_name = COALESCE(accounts.organizations.company_name, EXCLUDED.company_name)`,
        [org.id, org.name, org.businessType],
      );
    } catch (err) {
      try {
        await account.query(
          `UPDATE accounts.organizations
           SET business_type = $2
           WHERE id = $1::bigint`,
          [org.id, org.businessType],
        );
      } catch (err2) {
        console.warn(
          "Could not sync accounts.organizations.business_type for",
          org.id,
          err2 instanceof Error ? err2.message : err2,
        );
      }
    }
  }

  // Point demo setup_users at the matching org when that table is present.
  for (const bt of ["b2b", "b2c", "b2b2c"] as const) {
    const orgId = bt === "b2b" ? "1000" : bt === "b2c" ? "1001" : "1002";
    try {
      await account.query(
        `UPDATE accounts.setup_users u
         SET organization_id = $1::bigint,
             updated_at = now()
         WHERE lower(u.work_email) LIKE $2`,
        [orgId, `%.${bt}@worktual.com`],
      );
    } catch (err) {
      console.warn(
        "Could not sync setup_users organization_id for",
        bt,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Retire demo accounts that don't match the product model
  await account.query(
    `UPDATE public.users
     SET is_active = false, updated_at = now()
     WHERE lower(email) = 'finance.b2c@worktual.com'`,
  );

  // --- CRM companies / locations / deals first (for contact hard links) ---
  await prisma.invoice.deleteMany();
  await prisma.salesOrder.deleteMany();
  await prisma.dealActivity.deleteMany();
  await prisma.deal.deleteMany();
  await prisma.companyLocation.deleteMany();
  await prisma.company.deleteMany();
  await account.query(`DELETE FROM public.contacts`);

  const tcs = await prisma.company.create({
    data: {
      organizationId: SEED_ORG,
      name: "TCS",
      industry: "IT services",
      employeeCount: 620000,
      ownerUserId: userId,
      locations: {
        create: [
          {
            organizationId: SEED_ORG,
            name: "Mumbai",
            type: "hq",
            address: "Nariman Point, Mumbai",
            city: "Mumbai",
            industry: "IT services",
            employeeCount: 6200,
          },
          {
            organizationId: SEED_ORG,
            name: "Chennai",
            type: "branch",
            address: "OMR, Chennai",
            city: "Chennai",
          },
          {
            organizationId: SEED_ORG,
            name: "Bangalore",
            type: "branch",
            address: "Whitefield, Bangalore",
            city: "Bangalore",
          },
        ],
      },
    },
    include: { locations: true },
  });

  const infosys = await prisma.company.create({
    data: {
      organizationId: SEED_ORG,
      name: "Infosys",
      industry: "IT services",
      employeeCount: 320000,
      ownerUserId: userId,
      locations: {
        create: [
          {
            organizationId: SEED_ORG,
            name: "Bangalore",
            type: "hq",
            address: "Electronics City, Bangalore",
            city: "Bangalore",
          },
          {
            organizationId: SEED_ORG,
            name: "Pune",
            type: "branch",
            address: "Hinjewadi, Pune",
            city: "Pune",
          },
        ],
      },
    },
    include: { locations: true },
  });

  const acme = await prisma.company.create({
    data: {
      organizationId: SEED_ORG,
      name: "Acme Industries",
      industry: "Manufacturing",
      employeeCount: 1200,
      ownerUserId: userId,
      locations: {
        create: [
          {
            organizationId: SEED_ORG,
            name: "Austin HQ",
            type: "hq",
            address: "Downtown Austin",
            city: "Austin",
          },
        ],
      },
    },
  });

  const nova = await prisma.company.create({
    data: {
      organizationId: SEED_ORG,
      name: "Nova Retail",
      industry: "Retail",
      employeeCount: 450,
      ownerUserId: userId,
      locations: {
        create: [
          {
            organizationId: SEED_ORG,
            name: "Seattle HQ",
            type: "hq",
            address: "South Lake Union",
            city: "Seattle",
          },
        ],
      },
    },
  });

  const mumbai = tcs.locations.find((l) => l.name === "Mumbai")!;
  const chennai = tcs.locations.find((l) => l.name === "Chennai")!;
  const bangaloreHq = infosys.locations.find((l) => l.name === "Bangalore")!;

  // --- my_account_qa contacts (hard-linked to CRM companies) ---
  const priyaId = await insertContact({
    first: "Priya",
    last: "Sharma",
    email: "priya.sharma@acme.com",
    phone: "+1 555 0101",
    title: "VP Sales",
    city: "Austin",
    country: "US",
    companyName: "Acme Industries",
    domain: "acme.com",
    industry: "Manufacturing",
    companyId: acme.id,
    stage: "customer",
    tags: ["b2b", "enterprise"],
    notes: "Primary commercial contact at Acme.",
    userId,
  });

  await insertContact({
    first: "Jordan",
    last: "Lee",
    email: "jordan.lee@novaretail.com",
    phone: "+1 555 0102",
    title: "Buyer",
    city: "Seattle",
    country: "US",
    companyName: "Nova Retail",
    domain: "novaretail.com",
    industry: "Retail",
    companyId: nova.id,
    stage: "prospect",
    tags: ["b2b2c", "retail"],
    notes: "Evaluating partner commerce rollout.",
    userId,
  });

  const samId = await insertContact({
    first: "Sam",
    last: "Okoye",
    email: "sam.okoye@example.com",
    phone: "+1 555 0103",
    title: "Customer",
    city: "Lagos",
    country: "NG",
    companyName: null,
    domain: null,
    industry: null,
    companyId: null,
    stage: "customer",
    tags: ["b2c"],
    notes: "Self-serve subscriber on Starter plan.",
    userId,
  });

  await insertContact({
    first: "Maya",
    last: "Chen",
    email: "maya.chen@example.com",
    phone: "+1 555 0201",
    title: "Customer",
    city: "Toronto",
    country: "CA",
    companyName: null,
    domain: null,
    industry: null,
    companyId: null,
    stage: "customer",
    tags: ["b2c"],
    notes: "Purchased annual plan online.",
    userId,
  });

  await insertContact({
    first: "Leo",
    last: "Martinez",
    email: "leo.martinez@example.com",
    phone: "+1 555 0202",
    title: "Customer",
    city: "Miami",
    country: "US",
    companyName: null,
    domain: null,
    industry: null,
    companyId: null,
    stage: "prospect",
    tags: ["b2c"],
    notes: "Browsed pricing; no order yet.",
    userId,
  });

  const b2cOrg = "1001";
  await prisma.product.upsert({
    where: { id: "seed-b2c-pulse-earbuds" },
    update: {
      organizationId: b2cOrg,
      name: "Pulse Wireless Earbuds",
      tagline: "Everyday ANC earbuds for commuting",
      description:
        "Bluetooth 5.3 earbuds with active noise cancellation, 28-hour case battery, and IPX4 splash resistance. Sold direct to consumers — no company account required.",
      sku: "WT-EARBUD-BLK",
      brand: "Worktual Home",
      category: "Audio",
      subcategory: "Earbuds",
      tags: "bluetooth, consumer, audio",
      price: 79,
      stockOnHand: 50,
      productUrl: "https://shop.worktual.example/products/pulse-earbuds",
      currency: "USD",
      status: "active",
      productType: "fixed",
      billingType: "one_time",
    },
    create: {
      id: "seed-b2c-pulse-earbuds",
      organizationId: b2cOrg,
      name: "Pulse Wireless Earbuds",
      tagline: "Everyday ANC earbuds for commuting",
      description:
        "Bluetooth 5.3 earbuds with active noise cancellation, 28-hour case battery, and IPX4 splash resistance. Sold direct to consumers — no company account required.",
      sku: "WT-EARBUD-BLK",
      brand: "Worktual Home",
      category: "Audio",
      subcategory: "Earbuds",
      tags: "bluetooth, consumer, audio",
      price: 79,
      stockOnHand: 50,
      productUrl: "https://shop.worktual.example/products/pulse-earbuds",
      currency: "USD",
      status: "active",
      productType: "fixed",
      billingType: "one_time",
    },
  });

  const starter = await prisma.product.upsert({
    where: { id: "seed-b2c-starter-plan" },
    update: {
      name: "Starter plan",
      tagline: "Consumer self-serve plan",
      price: 49,
      status: "active",
      sku: "B2C-START",
      brand: "Worktual",
      category: "Subscription",
      subcategory: "Monthly",
      productType: "fixed",
      billingType: "one_time",
    },
    create: {
      id: "seed-b2c-starter-plan",
      organizationId: SEED_ORG,
      name: "Starter plan",
      tagline: "Consumer self-serve plan",
      price: 49,
      currency: "USD",
      status: "active",
      category: "Subscription",
      subcategory: "Monthly",
      brand: "Worktual",
      sku: "B2C-START",
      productType: "fixed",
      billingType: "one_time",
    },
  });

  await prisma.salesOrder.create({
    data: {
      organizationId: SEED_ORG,
      contactId: samId,
      companyId: null,
      number: "SO-B2C-00001",
      status: "confirmed",
      currency: "USD",
      total: 49,
      confirmedAt: new Date(),
      createdByUserId: userId,
      lines: {
        create: [
          {
            organizationId: SEED_ORG,
            productId: starter.id,
            name: starter.name,
            quantity: 1,
            unitPrice: 49,
            amount: 49,
            sortOrder: 0,
          },
        ],
      },
    },
  });

  const rohanId = await insertContact({
    first: "Rohan",
    last: "Desai",
    email: "rohan.desai@tcs.com",
    phone: "+91 98765 0101",
    title: "IT Director",
    city: "Mumbai",
    country: "IN",
    companyName: "TCS",
    domain: "tcs.com",
    industry: "IT services",
    companyId: tcs.id,
    locationId: mumbai.id,
    stage: "prospect",
    tags: ["b2b", "enterprise"],
    notes: "Mumbai HQ stakeholder.",
    userId,
  });

  const meeraId = await insertContact({
    first: "Meera",
    last: "Nair",
    email: "meera.nair@tcs.com",
    phone: "+91 98765 0102",
    title: "Procurement Lead",
    city: "Mumbai",
    country: "IN",
    companyName: "TCS",
    domain: "tcs.com",
    industry: "IT services",
    companyId: tcs.id,
    locationId: mumbai.id,
    stage: "prospect",
    tags: ["b2b"],
    notes: "Commercial evaluation.",
    userId,
  });

  const ananyaId = await insertContact({
    first: "Ananya",
    last: "Iyer",
    email: "ananya.iyer@tcs.com",
    phone: "+91 98765 0103",
    title: "Ops Manager",
    city: "Chennai",
    country: "IN",
    companyName: "TCS",
    domain: "tcs.com",
    industry: "IT services",
    companyId: tcs.id,
    locationId: chennai.id,
    stage: "prospect",
    tags: ["b2b"],
    notes: "Chennai pilot sponsor.",
    userId,
  });

  const rahulId = await insertContact({
    first: "Rahul",
    last: "Menon",
    email: "rahul.menon@infosys.com",
    phone: "+91 98765 0201",
    title: "Solution Architect",
    city: "Bangalore",
    country: "IN",
    companyName: "Infosys",
    domain: "infosys.com",
    industry: "IT services",
    companyId: infosys.id,
    stage: "prospect",
    tags: ["b2b"],
    notes: "Platform evaluation.",
    userId,
  });

  const karanId = await insertContact({
    first: "Karan",
    last: "Mehta",
    email: "karan.mehta@tcs.com",
    phone: "+91 98765 0104",
    title: "Business Head",
    city: "Mumbai",
    country: "IN",
    companyName: "TCS",
    domain: "tcs.com",
    industry: "IT services",
    companyId: tcs.id,
    locationId: mumbai.id,
    stage: "prospect",
    tags: ["b2b"],
    notes: "Expansion stakeholder.",
    userId,
  });

  const snehaId = await insertContact({
    first: "Sneha",
    last: "Kapoor",
    email: "sneha.kapoor@tcs.com",
    phone: "+91 98765 0105",
    title: "Support Lead",
    city: "Mumbai",
    country: "IN",
    companyName: "TCS",
    domain: "tcs.com",
    industry: "IT services",
    companyId: tcs.id,
    locationId: mumbai.id,
    stage: "lead",
    tags: ["b2b"],
    notes: "Support uplift request.",
    userId,
  });

  // silence unused if needed — priya used for clarity of sync
  void priyaId;

  const dealRohan = await prisma.deal.create({
    data: {
      title: "TCS Mumbai — Contact Center + CRM",
      stage: "negotiate",
      amount: 420000,
      companyId: tcs.id,
      locationId: mumbai.id,
      contactId: rohanId,
      contactName: "Rohan Desai",
      contactEmail: "rohan.desai@tcs.com",
      ownerUserId: userId,
      notes: "Multi-year enterprise rollout.",
    },
  });

  await prisma.deal.create({
    data: {
      title: "TCS Mumbai — Workforce Analytics",
      stage: "closed_won",
      amount: 85000,
      companyId: tcs.id,
      locationId: mumbai.id,
      contactId: meeraId,
      contactName: "Meera Nair",
      contactEmail: "meera.nair@tcs.com",
      ownerUserId: userId,
      closedAt: new Date(),
    },
  });

  await prisma.deal.create({
    data: {
      title: "TCS Chennai — Pilot seats",
      stage: "discover",
      amount: 28000,
      companyId: tcs.id,
      locationId: chennai.id,
      contactId: ananyaId,
      contactName: "Ananya Iyer",
      contactEmail: "ananya.iyer@tcs.com",
      ownerUserId: userId,
    },
  });

  await prisma.deal.create({
    data: {
      title: "Infosys Bangalore — Platform license",
      stage: "qualification",
      amount: 210000,
      companyId: infosys.id,
      locationId: bangaloreHq.id,
      contactId: rahulId,
      contactName: "Rahul Menon",
      contactEmail: "rahul.menon@infosys.com",
      ownerUserId: userId,
    },
  });

  await prisma.deal.create({
    data: {
      title: "TCS Mumbai — Expansion seats",
      stage: "propose",
      amount: 64000,
      companyId: tcs.id,
      locationId: mumbai.id,
      contactId: karanId,
      contactName: "Karan Mehta",
      contactEmail: "karan.mehta@tcs.com",
      ownerUserId: userId,
    },
  });

  await prisma.deal.create({
    data: {
      title: "TCS Mumbai — Support uplift",
      stage: "qualification",
      amount: 12000,
      companyId: tcs.id,
      locationId: mumbai.id,
      contactId: snehaId,
      contactName: "Sneha Kapoor",
      contactEmail: "sneha.kapoor@tcs.com",
      ownerUserId: userId,
    },
  });

  await prisma.dealActivity.createMany({
    data: [
      {
        organizationId: SEED_ORG,
        dealId: dealRohan.id,
        type: "meeting",
        subject: "Commercial negotiation with procurement",
        body: "Discussed discount tiers and multi-year commitment.",
      },
      {
        organizationId: SEED_ORG,
        dealId: dealRohan.id,
        type: "email",
        subject: "Sent revised proposal",
        body: "Attached quote v3 with volume pricing.",
      },
      {
        organizationId: SEED_ORG,
        dealId: dealRohan.id,
        type: "call",
        subject: "Follow-up with Rohan",
        body: "Confirmed next stakeholder review for Friday.",
      },
    ],
  });

  // Optional CRM pack-config rows. Contact field packs follow
  // accounts.organizations.industry_type, not this vertical column.
  for (const org of [
    { id: "1000", vertical: "general" as const },
    { id: "1001", vertical: "ecommerce" as const },
    { id: "1002", vertical: "healthcare" as const },
  ]) {
    await prisma.organizationProfile.upsert({
      where: { organizationId: org.id },
      create: {
        organizationId: org.id,
        vertical: org.vertical,
        verticalConfig: {},
      },
      update: { vertical: org.vertical },
    });
  }

  // Franchise channel sample under org 1002 (B2B2C demo tenant).
  const brandHq = await prisma.company.create({
    data: {
      organizationId: "1002",
      name: "Apollo Brand HQ",
      channelRole: "brand_hq",
      industry: "Healthcare",
      ownerUserId: userId,
    },
  });
  await prisma.companyLocation.create({
    data: {
      organizationId: "1002",
      companyId: brandHq.id,
      name: "HQ",
      type: "hq",
      ownerUserId: userId,
    },
  });
  const franchiseNorth = await prisma.company.create({
    data: {
      organizationId: "1002",
      name: "Apollo Franchise North",
      channelRole: "franchise",
      parentCompanyId: brandHq.id,
      industry: "Healthcare",
      ownerUserId: userId,
    },
  });
  await prisma.companyLocation.create({
    data: {
      organizationId: "1002",
      companyId: franchiseNorth.id,
      name: "North Mall",
      type: "branch",
      ownerUserId: userId,
    },
  });
  const franchiseSouth = await prisma.company.create({
    data: {
      organizationId: "1002",
      name: "Apollo Franchise South",
      channelRole: "franchise",
      parentCompanyId: brandHq.id,
      industry: "Healthcare",
      ownerUserId: userId,
    },
  });
  await prisma.companyLocation.create({
    data: {
      organizationId: "1002",
      companyId: franchiseSouth.id,
      name: "South Plaza",
      type: "branch",
      ownerUserId: userId,
    },
  });

  console.log("Seeded my_account_qa.users + contacts (hard-linked to companies)");
  console.log("Seeded crm_qa companies, locations, deals (with contact_id), activities");
  console.log(
    "Seeded organization_profiles + Apollo franchise sample (org 1002)",
  );
  console.log("Login credentials (password for all: demo)");
  console.log("");
  console.log("B2B / B2B2C: admin | rep | manager | finance | viewer | marketing");
  console.log("B2C:         admin | rep | manager | viewer | marketing  (no finance — Commerce path)");
  console.log("");
  for (const bt of ["b2b", "b2c", "b2b2c"] as const) {
    console.log(`${bt.toUpperCase()}:`);
    console.log(`  admin.${bt}@worktual.com`);
    console.log(`  rep.${bt}@worktual.com`);
    console.log(`  manager.${bt}@worktual.com`);
    if (bt !== "b2c") {
      console.log(`  finance.${bt}@worktual.com`);
    }
    console.log(`  viewer.${bt}@worktual.com`);
    console.log(`  marketing.${bt}@worktual.com`);
    console.log("");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await account.end();
    await prisma.$disconnect();
  });
