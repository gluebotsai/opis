/**
 * Seed 15 Worktual demo contacts with interaction history (data only — no schema changes).
 *
 * Usage:
 *   npm run seed:worktual-contacts -w cc-core
 */
import "@ai-contact-center/config/load-root-env";
import { randomUUID } from "node:crypto";
import { ccPrisma } from "@ai-contact-center/db-cc";

const ORG_ID = process.env.ORGANIZATION_ID ?? "ce4ff326-4c0e-43f2-a978-e6b494cd0775";
const QUEUE_ID = process.env.WEBCHAT_QUEUE_ID ?? "81019f3d-826b-498f-8273-18abe4df6dba";
const AGENT_ID = process.env.AGENT_ID ?? "e4ef1989-46ce-4f14-aecd-6944417bfc3d";
const SOURCE_SYSTEM = "form";

type InteractionSeed = {
  channel: "webchat" | "email" | "whatsapp" | "voice";
  status: "resolved" | "closed" | "active";
  outcome: string;
  summary: string;
  dispositionCode: string;
  sentiment: "positive" | "neutral" | "negative";
  daysAgo: number;
  events: Array<{ eventType: string; metadata?: Record<string, unknown> }>;
};

type ContactSeed = {
  id: string;
  firstName: string;
  lastName: string;
  primaryEmail: string;
  primaryPhone: string;
  secondaryEmail?: string;
  company: string;
  industry: string;
  city: string;
  region: string;
  country: string;
  language: string;
  timezone: string;
  department: string;
  lifeCycleStage: string;
  companySize: string;
  customFields: Record<string, unknown>;
  profileAttributes: Record<string, unknown>;
  interactions: InteractionSeed[];
};

const CONTACTS: ContactSeed[] = [
  {
    id: "a1000001-0000-4000-8000-000000000001",
    firstName: "Priya",
    lastName: "Sharma",
    primaryEmail: "priya.sharma@technova.io",
    primaryPhone: "+91 98 4521 8830",
    secondaryEmail: "priya@technova-support.com",
    company: "TechNova Solutions",
    industry: "SaaS",
    city: "Bengaluru",
    region: "Karnataka",
    country: "IN",
    language: "en",
    timezone: "Asia/Kolkata",
    department: "Customer Success",
    lifeCycleStage: "customer",
    companySize: "201-500",
    customFields: { plan: "Enterprise", accountTier: "Gold", supportPriority: "high" },
    profileAttributes: { leadScore: 92, preferredChannel: "webchat", npsLast: 9 },
    interactions: [
      {
        channel: "webchat",
        status: "resolved",
        outcome: "resolved",
        summary: "Asked about API rate limits for the new integration rollout.",
        dispositionCode: "technical_support",
        sentiment: "positive",
        daysAgo: 2,
        events: [
          { eventType: "conversation.started", metadata: { topic: "api_limits" } },
          { eventType: "message.agent", metadata: { bodyPreview: "Shared rate limit documentation." } },
          { eventType: "conversation.resolved", metadata: { resolution: "answered" } },
        ],
      },
      {
        channel: "email",
        status: "closed",
        outcome: "resolved",
        summary: "Renewal quote follow-up for FY26 enterprise contract.",
        dispositionCode: "sales_inquiry",
        sentiment: "neutral",
        daysAgo: 18,
        events: [
          { eventType: "conversation.started", metadata: { subject: "Renewal quote" } },
          { eventType: "conversation.resolved", metadata: { resolution: "quote_sent" } },
        ],
      },
    ],
  },
  {
    id: "a1000001-0000-4000-8000-000000000002",
    firstName: "James",
    lastName: "Okafor",
    primaryEmail: "j.okafor@atlasretail.co.uk",
    primaryPhone: "+44 20 7946 0958",
    company: "Atlas Retail Group",
    industry: "Retail",
    city: "London",
    region: "England",
    country: "GB",
    language: "en",
    timezone: "Europe/London",
    department: "Operations",
    lifeCycleStage: "customer",
    companySize: "1001-5000",
    customFields: { storeCount: 42, posVendor: "Worktual POS", region: "EMEA" },
    profileAttributes: { leadScore: 78, preferredChannel: "email", npsLast: 7 },
    interactions: [
      {
        channel: "webchat",
        status: "resolved",
        outcome: "resolved",
        summary: "Store #118 reported delayed chat routing during peak hours.",
        dispositionCode: "incident",
        sentiment: "negative",
        daysAgo: 5,
        events: [
          { eventType: "conversation.started" },
          { eventType: "message.customer", metadata: { bodyPreview: "Customers waiting 8+ minutes." } },
          { eventType: "conversation.resolved", metadata: { resolution: "queue_tuning" } },
        ],
      },
    ],
  },
  {
    id: "a1000001-0000-4000-8000-000000000003",
    firstName: "Maria",
    lastName: "Gonzalez",
    primaryEmail: "maria.gonzalez@solsticehealth.es",
    primaryPhone: "+34 91 123 4567",
    company: "Solstice Health",
    industry: "Healthcare",
    city: "Madrid",
    region: "Madrid",
    country: "ES",
    language: "es",
    timezone: "Europe/Madrid",
    department: "Patient Services",
    lifeCycleStage: "customer",
    companySize: "501-1000",
    customFields: { hipaaRegion: "EU", clinics: 14 },
    profileAttributes: { leadScore: 85, preferredChannel: "voice", npsLast: 8 },
    interactions: [
      {
        channel: "voice",
        status: "resolved",
        outcome: "resolved",
        summary: "Appointment rescheduling for outpatient clinic network.",
        dispositionCode: "appointment",
        sentiment: "positive",
        daysAgo: 1,
        events: [
          { eventType: "conversation.started" },
          { eventType: "conversation.resolved", metadata: { resolution: "appointment_moved" } },
        ],
      },
      {
        channel: "webchat",
        status: "resolved",
        outcome: "resolved",
        summary: "Clarified data retention policy for patient chat transcripts.",
        dispositionCode: "compliance",
        sentiment: "neutral",
        daysAgo: 12,
        events: [
          { eventType: "conversation.started" },
          { eventType: "conversation.resolved" },
        ],
      },
    ],
  },
  {
    id: "a1000001-0000-4000-8000-000000000004",
    firstName: "David",
    lastName: "Chen",
    primaryEmail: "david.chen@pacificfreight.sg",
    primaryPhone: "+65 6123 4401",
    company: "Pacific Freight Co",
    industry: "Logistics",
    city: "Singapore",
    region: "Central",
    country: "SG",
    language: "en",
    timezone: "Asia/Singapore",
    department: "Fleet Operations",
    lifeCycleStage: "customer",
    companySize: "201-500",
    customFields: { fleetSize: 128, trackingIntegration: "enabled" },
    profileAttributes: { leadScore: 71, preferredChannel: "whatsapp", npsLast: 6 },
    interactions: [
      {
        channel: "whatsapp",
        status: "resolved",
        outcome: "resolved",
        summary: "Shipment #PF-88291 delayed — requested ETA update.",
        dispositionCode: "order_status",
        sentiment: "negative",
        daysAgo: 3,
        events: [
          { eventType: "conversation.started", metadata: { shipmentId: "PF-88291" } },
          { eventType: "message.agent", metadata: { bodyPreview: "Provided revised ETA." } },
          { eventType: "conversation.resolved" },
        ],
      },
    ],
  },
  {
    id: "a1000001-0000-4000-8000-000000000005",
    firstName: "Emily",
    lastName: "Watson",
    primaryEmail: "emily.watson@brightpath.edu",
    primaryPhone: "+1 617 555 0142",
    company: "BrightPath Education",
    industry: "Education",
    city: "Boston",
    region: "MA",
    country: "US",
    language: "en",
    timezone: "America/New_York",
    department: "Admissions",
    lifeCycleStage: "lead",
    companySize: "51-200",
    customFields: { campusCount: 3, crmSync: "pending" },
    profileAttributes: { leadScore: 64, preferredChannel: "webchat", npsLast: null },
    interactions: [
      {
        channel: "webchat",
        status: "resolved",
        outcome: "resolved",
        summary: "Demo request for admissions chatbot on student portal.",
        dispositionCode: "demo_request",
        sentiment: "positive",
        daysAgo: 7,
        events: [
          { eventType: "conversation.started" },
          { eventType: "conversation.resolved", metadata: { resolution: "demo_scheduled" } },
        ],
      },
    ],
  },
  {
    id: "a1000001-0000-4000-8000-000000000006",
    firstName: "Rahul",
    lastName: "Mehta",
    primaryEmail: "rahul.mehta@finedge.in",
    primaryPhone: "+91 22 4012 7788",
    company: "FinEdge Payments",
    industry: "Fintech",
    city: "Mumbai",
    region: "Maharashtra",
    country: "IN",
    language: "en",
    timezone: "Asia/Kolkata",
    department: "Risk & Compliance",
    lifeCycleStage: "customer",
    companySize: "501-1000",
    customFields: { pciLevel: 1, monthlyVolume: "₹42Cr" },
    profileAttributes: { leadScore: 88, preferredChannel: "email", npsLast: 8 },
    interactions: [
      {
        channel: "email",
        status: "resolved",
        outcome: "resolved",
        summary: "Chargeback dispute for transaction TX-441902.",
        dispositionCode: "billing",
        sentiment: "negative",
        daysAgo: 4,
        events: [
          { eventType: "conversation.started", metadata: { transactionId: "TX-441902" } },
          { eventType: "conversation.resolved", metadata: { resolution: "dispute_logged" } },
        ],
      },
      {
        channel: "webchat",
        status: "resolved",
        outcome: "resolved",
        summary: "Webhook delivery failures after weekend maintenance.",
        dispositionCode: "technical_support",
        sentiment: "neutral",
        daysAgo: 9,
        events: [
          { eventType: "conversation.started" },
          { eventType: "conversation.resolved" },
        ],
      },
    ],
  },
  {
    id: "a1000001-0000-4000-8000-000000000007",
    firstName: "Sophie",
    lastName: "Laurent",
    primaryEmail: "sophie.laurent@maisondupont.fr",
    primaryPhone: "+33 1 42 68 53 00",
    company: "Maison Dupont",
    industry: "Luxury Retail",
    city: "Paris",
    region: "Île-de-France",
    country: "FR",
    language: "fr",
    timezone: "Europe/Paris",
    department: "Client Relations",
    lifeCycleStage: "customer",
    companySize: "201-500",
    customFields: { boutiqueCount: 9, vipProgram: "Maison Elite" },
    profileAttributes: { leadScore: 95, preferredChannel: "webchat", npsLast: 10 },
    interactions: [
      {
        channel: "webchat",
        status: "resolved",
        outcome: "resolved",
        summary: "VIP client requested personal shopper callback for new collection.",
        dispositionCode: "callback_scheduled",
        sentiment: "positive",
        daysAgo: 1,
        events: [
          { eventType: "conversation.started" },
          { eventType: "conversation.resolved" },
        ],
      },
    ],
  },
  {
    id: "a1000001-0000-4000-8000-000000000008",
    firstName: "Michael",
    lastName: "Torres",
    primaryEmail: "m.torres@greengrid.com",
    primaryPhone: "+1 512 555 0199",
    company: "GreenGrid Energy",
    industry: "Utilities",
    city: "Austin",
    region: "TX",
    country: "US",
    language: "en",
    timezone: "America/Chicago",
    department: "Customer Care",
    lifeCycleStage: "customer",
    companySize: "1001-5000",
    customFields: { serviceArea: "Central Texas", outageAlerts: true },
    profileAttributes: { leadScore: 73, preferredChannel: "voice", npsLast: 5 },
    interactions: [
      {
        channel: "voice",
        status: "resolved",
        outcome: "resolved",
        summary: "Reported power outage in ZIP 78704; ticket escalated to field ops.",
        dispositionCode: "outage",
        sentiment: "negative",
        daysAgo: 6,
        events: [
          { eventType: "conversation.started" },
          { eventType: "conversation.resolved", metadata: { ticketId: "OUT-22041" } },
        ],
      },
      {
        channel: "webchat",
        status: "resolved",
        outcome: "resolved",
        summary: "Asked about solar buyback program eligibility.",
        dispositionCode: "product_inquiry",
        sentiment: "positive",
        daysAgo: 21,
        events: [{ eventType: "conversation.started" }, { eventType: "conversation.resolved" }],
      },
    ],
  },
  {
    id: "a1000001-0000-4000-8000-000000000009",
    firstName: "Aisha",
    lastName: "Patel",
    primaryEmail: "aisha.patel@carelink.ca",
    primaryPhone: "+1 416 555 0173",
    company: "CareLink Home Services",
    industry: "Home Services",
    city: "Toronto",
    region: "ON",
    country: "CA",
    language: "en",
    timezone: "America/Toronto",
    department: "Scheduling",
    lifeCycleStage: "customer",
    companySize: "51-200",
    customFields: { technicians: 38, serviceZones: 6 },
    profileAttributes: { leadScore: 69, preferredChannel: "whatsapp", npsLast: 7 },
    interactions: [
      {
        channel: "whatsapp",
        status: "resolved",
        outcome: "resolved",
        summary: "Rescheduled HVAC maintenance visit for 14 Maple Street.",
        dispositionCode: "appointment",
        sentiment: "positive",
        daysAgo: 8,
        events: [
          { eventType: "conversation.started" },
          { eventType: "conversation.resolved" },
        ],
      },
    ],
  },
  {
    id: "a1000001-0000-4000-8000-000000000010",
    firstName: "Liam",
    lastName: "O'Brien",
    primaryEmail: "liam.obrien@celtictelecom.ie",
    primaryPhone: "+353 1 555 0120",
    company: "Celtic Telecom",
    industry: "Telecom",
    city: "Dublin",
    region: "Leinster",
    country: "IE",
    language: "en",
    timezone: "Europe/Dublin",
    department: "Business Support",
    lifeCycleStage: "customer",
    companySize: "501-1000",
    customFields: { businessLines: 2400, slaTier: "Premium" },
    profileAttributes: { leadScore: 81, preferredChannel: "email", npsLast: 8 },
    interactions: [
      {
        channel: "email",
        status: "resolved",
        outcome: "resolved",
        summary: "SIP trunk failover test results review with NOC team.",
        dispositionCode: "technical_support",
        sentiment: "neutral",
        daysAgo: 11,
        events: [
          { eventType: "conversation.started" },
          { eventType: "conversation.resolved" },
        ],
      },
    ],
  },
  {
    id: "a1000001-0000-4000-8000-000000000011",
    firstName: "Yuki",
    lastName: "Tanaka",
    primaryEmail: "y.tanaka@sakurarobotics.jp",
    primaryPhone: "+81 3 5555 8801",
    company: "Sakura Robotics",
    industry: "Manufacturing",
    city: "Tokyo",
    region: "Kanto",
    country: "JP",
    language: "ja",
    timezone: "Asia/Tokyo",
    department: "Engineering",
    lifeCycleStage: "customer",
    companySize: "201-500",
    customFields: { productionLines: 12, iotEnabled: true },
    profileAttributes: { leadScore: 76, preferredChannel: "webchat", npsLast: 7 },
    interactions: [
      {
        channel: "webchat",
        status: "resolved",
        outcome: "resolved",
        summary: "Firmware update guidance for assembly line controller v3.2.",
        dispositionCode: "technical_support",
        sentiment: "positive",
        daysAgo: 14,
        events: [
          { eventType: "conversation.started" },
          { eventType: "message.agent" },
          { eventType: "conversation.resolved" },
        ],
      },
    ],
  },
  {
    id: "a1000001-0000-4000-8000-000000000012",
    firstName: "Olivia",
    lastName: "Brooks",
    primaryEmail: "olivia.brooks@harborinsurance.com",
    primaryPhone: "+1 312 555 0166",
    company: "Harbor Insurance",
    industry: "Insurance",
    city: "Chicago",
    region: "IL",
    country: "US",
    language: "en",
    timezone: "America/Chicago",
    department: "Claims",
    lifeCycleStage: "customer",
    companySize: "1001-5000",
    customFields: { policyCount: 18400, claimsPortal: "active" },
    profileAttributes: { leadScore: 83, preferredChannel: "voice", npsLast: 6 },
    interactions: [
      {
        channel: "voice",
        status: "resolved",
        outcome: "resolved",
        summary: "Auto claim CLM-99201 — requested adjuster callback.",
        dispositionCode: "claims",
        sentiment: "neutral",
        daysAgo: 2,
        events: [
          { eventType: "conversation.started", metadata: { claimId: "CLM-99201" } },
          { eventType: "conversation.resolved" },
        ],
      },
      {
        channel: "webchat",
        status: "resolved",
        outcome: "resolved",
        summary: "Policy document download issue on member portal.",
        dispositionCode: "portal_support",
        sentiment: "negative",
        daysAgo: 16,
        events: [{ eventType: "conversation.started" }, { eventType: "conversation.resolved" }],
      },
    ],
  },
  {
    id: "a1000001-0000-4000-8000-000000000013",
    firstName: "Carlos",
    lastName: "Mendez",
    primaryEmail: "carlos.mendez@andesfoods.pe",
    primaryPhone: "+51 1 555 0144",
    company: "Andes Foods",
    industry: "Food & Beverage",
    city: "Lima",
    region: "Lima",
    country: "PE",
    language: "es",
    timezone: "America/Lima",
    department: "Distribution",
    lifeCycleStage: "customer",
    companySize: "201-500",
    customFields: { distributionCenters: 5, coldChain: true },
    profileAttributes: { leadScore: 70, preferredChannel: "whatsapp", npsLast: 8 },
    interactions: [
      {
        channel: "whatsapp",
        status: "resolved",
        outcome: "resolved",
        summary: "Delivery slot change for wholesale order ORD-77102.",
        dispositionCode: "order_change",
        sentiment: "positive",
        daysAgo: 10,
        events: [
          { eventType: "conversation.started" },
          { eventType: "conversation.resolved" },
        ],
      },
    ],
  },
  {
    id: "a1000001-0000-4000-8000-000000000014",
    firstName: "Hannah",
    lastName: "Kim",
    primaryEmail: "hannah.kim@seouldigital.kr",
    primaryPhone: "+82 2 555 0188",
    company: "Seoul Digital Media",
    industry: "Media",
    city: "Seoul",
    region: "Seoul",
    country: "KR",
    language: "ko",
    timezone: "Asia/Seoul",
    department: "Subscriptions",
    lifeCycleStage: "lead",
    companySize: "51-200",
    customFields: { subscribers: 120000, contentVertical: "streaming" },
    profileAttributes: { leadScore: 58, preferredChannel: "webchat", npsLast: null },
    interactions: [
      {
        channel: "webchat",
        status: "resolved",
        outcome: "resolved",
        summary: "Pricing inquiry for multilingual support during live events.",
        dispositionCode: "sales_inquiry",
        sentiment: "positive",
        daysAgo: 6,
        events: [
          { eventType: "conversation.started" },
          { eventType: "conversation.resolved", metadata: { resolution: "pricing_sent" } },
        ],
      },
    ],
  },
  {
    id: "a1000001-0000-4000-8000-000000000015",
    firstName: "Thomas",
    lastName: "Berg",
    primaryEmail: "thomas.berg@nordicsupply.no",
    primaryPhone: "+47 21 55 01 77",
    company: "Nordic Supply AS",
    industry: "Wholesale",
    city: "Oslo",
    region: "Oslo",
    country: "NO",
    language: "no",
    timezone: "Europe/Oslo",
    department: "Procurement",
    lifeCycleStage: "customer",
    companySize: "201-500",
    customFields: { warehouses: 4, erpIntegration: "SAP" },
    profileAttributes: { leadScore: 74, preferredChannel: "email", npsLast: 7 },
    interactions: [
      {
        channel: "email",
        status: "resolved",
        outcome: "resolved",
        summary: "Invoice mismatch on PO-44821 — credit note requested.",
        dispositionCode: "billing",
        sentiment: "negative",
        daysAgo: 13,
        events: [
          { eventType: "conversation.started", metadata: { poNumber: "PO-44821" } },
          { eventType: "conversation.resolved", metadata: { resolution: "credit_note_issued" } },
        ],
      },
      {
        channel: "webchat",
        status: "resolved",
        outcome: "resolved",
        summary: "Bulk order status for shipment NS-33018.",
        dispositionCode: "order_status",
        sentiment: "neutral",
        daysAgo: 4,
        events: [{ eventType: "conversation.started" }, { eventType: "conversation.resolved" }],
      },
    ],
  },
];

function daysAgoDate(daysAgo: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date;
}

function buildInteractionCustomFields(interactions: InteractionSeed[]) {
  const sorted = [...interactions].sort((a, b) => a.daysAgo - b.daysAgo);
  const latest = sorted[0];
  return {
    totalInteractions: interactions.length,
    lastChannel: latest?.channel ?? null,
    lastInteractionAt: latest ? daysAgoDate(latest.daysAgo).toISOString() : null,
    recentInteractions: sorted.slice(0, 3).map((interaction) => ({
      channel: interaction.channel,
      date: daysAgoDate(interaction.daysAgo).toISOString(),
      summary: interaction.summary,
      outcome: interaction.outcome,
      sentiment: interaction.sentiment,
    })),
  };
}

async function upsertContact(contact: ContactSeed, profileId: string) {
  const updatedAt = daysAgoDate(
    Math.min(...contact.interactions.map((interaction) => interaction.daysAgo)),
  );
  const createdAt = daysAgoDate(
    Math.max(...contact.interactions.map((interaction) => interaction.daysAgo)) + 45,
  );
  const customFields = {
    ...contact.customFields,
    ...buildInteractionCustomFields(contact.interactions),
  };

  await ccPrisma.$executeRaw`
    INSERT INTO cdp.contacts (
      id, organization_id, first_name, last_name, primary_email, primary_phone,
      secondary_email, company, industry, city, region, country, language, timezone,
      source_system, custom_fields, is_active, created_at, updated_at,
      life_cycle_stage, department, company_size
    ) VALUES (
      ${contact.id}::bigint,
      ${ORG_ID}::bigint,
      ${contact.firstName},
      ${contact.lastName},
      ${contact.primaryEmail},
      ${contact.primaryPhone},
      ${contact.secondaryEmail ?? null},
      ${contact.company},
      ${contact.industry},
      ${contact.city},
      ${contact.region},
      ${contact.country},
      ${contact.language},
      ${contact.timezone},
      ${SOURCE_SYSTEM},
      ${JSON.stringify(customFields)}::jsonb,
      true,
      ${createdAt},
      ${updatedAt},
      ${contact.lifeCycleStage},
      ${contact.department},
      ${contact.companySize}
    )
    ON CONFLICT (id) DO UPDATE SET
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      primary_email = EXCLUDED.primary_email,
      primary_phone = EXCLUDED.primary_phone,
      secondary_email = EXCLUDED.secondary_email,
      company = EXCLUDED.company,
      industry = EXCLUDED.industry,
      city = EXCLUDED.city,
      region = EXCLUDED.region,
      country = EXCLUDED.country,
      language = EXCLUDED.language,
      timezone = EXCLUDED.timezone,
      source_system = EXCLUDED.source_system,
      custom_fields = EXCLUDED.custom_fields,
      is_active = EXCLUDED.is_active,
      updated_at = EXCLUDED.updated_at,
      life_cycle_stage = EXCLUDED.life_cycle_stage,
      department = EXCLUDED.department,
      company_size = EXCLUDED.company_size
  `;

  await ccPrisma.$executeRaw`
    INSERT INTO cdp.profiles (
      id, organization_id, external_id, email, attributes, created_at, updated_at
    ) VALUES (
      ${profileId}::bigint,
      ${ORG_ID}::bigint,
      ${contact.id},
      ${contact.primaryEmail},
      ${JSON.stringify(contact.profileAttributes)}::jsonb,
      ${createdAt},
      ${updatedAt}
    )
    ON CONFLICT (id) DO UPDATE SET
      external_id = EXCLUDED.external_id,
      email = EXCLUDED.email,
      attributes = EXCLUDED.attributes,
      updated_at = EXCLUDED.updated_at
  `;
}

async function seedInteractions(
  contact: ContactSeed,
  profileId: string,
): Promise<number> {
  let seeded = 0;

  for (const interaction of contact.interactions) {
    const conversationId = randomUUID();
    const interactionId = randomUUID();
    const startedAt = daysAgoDate(interaction.daysAgo);
    const endedAt = new Date(startedAt.getTime() + 18 * 60 * 1000);
    const visitorId = `v_${contact.id.replace(/-/g, "").slice(0, 16)}_${interaction.daysAgo}`;

    await ccPrisma.$executeRaw`
      INSERT INTO cdp.interactions (
        id, organization_id, conversation_id, contact_id, profile_id, visitor_id,
        channel, queue_id, agent_id, status, started_at, ended_at, outcome, summary,
        topics, sentiment, disposition_code, last_activity_at, created_at, updated_at
      ) VALUES (
        ${interactionId}::bigint,
        ${ORG_ID}::bigint,
        ${conversationId}::bigint,
        ${contact.id}::bigint,
        ${profileId}::bigint,
        ${visitorId},
        ${interaction.channel},
        ${QUEUE_ID}::bigint,
        ${AGENT_ID}::bigint,
        ${interaction.status},
        ${startedAt},
        ${endedAt},
        ${interaction.outcome},
        ${interaction.summary},
        ${JSON.stringify([interaction.dispositionCode])}::jsonb,
        ${interaction.sentiment},
        ${interaction.dispositionCode},
        ${endedAt},
        ${startedAt},
        ${endedAt}
      )
      ON CONFLICT (organization_id, conversation_id) DO UPDATE SET
        contact_id = EXCLUDED.contact_id,
        profile_id = EXCLUDED.profile_id,
        summary = EXCLUDED.summary,
        sentiment = EXCLUDED.sentiment,
        disposition_code = EXCLUDED.disposition_code,
        last_activity_at = EXCLUDED.last_activity_at,
        updated_at = EXCLUDED.updated_at
    `;

    for (const event of interaction.events) {
      await ccPrisma.$executeRaw`
        INSERT INTO cdp.interaction_events (
          id, organization_id, interaction_id, conversation_id, event_type, metadata, occurred_at
        ) VALUES (
          ${randomUUID()}::bigint,
          ${ORG_ID}::bigint,
          ${interactionId}::bigint,
          ${conversationId}::bigint,
          ${event.eventType},
          ${JSON.stringify(event.metadata ?? {})}::jsonb,
          ${startedAt}
        )
      `;
    }

    seeded += 1;
  }

  return seeded;
}

async function main() {
  const org = await ccPrisma.organizations.findUnique({
    where: { id: ORG_ID },
    select: { company_name: true, tenant_id: true },
  });
  if (!org) {
    throw new Error(`Organization not found: ${ORG_ID}`);
  }

  let interactionCount = 0;

  for (const contact of CONTACTS) {
    const profileId = `b2000001-0000-4000-8000-${contact.id.slice(-12)}`;
    await upsertContact(contact, profileId);
    interactionCount += await seedInteractions(contact, profileId);
  }

  const total = await ccPrisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM cdp.contacts
    WHERE organization_id = ${ORG_ID}::bigint AND is_active = true
  `;

  console.log(
    JSON.stringify(
      {
        organizationId: ORG_ID,
        organizationName: org.company_name,
        tenantId: org.tenant_id,
        contactsSeeded: CONTACTS.length,
        interactionsSeeded: interactionCount,
        totalActiveContacts: total[0]?.count ?? 0,
        sourceSystem: SOURCE_SYSTEM,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
