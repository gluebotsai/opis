import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, "../docs/CDP-CRM-field-mapping.docx");

const rows = [
  [
    "1",
    "crm_deals_open",
    "crm.deals (open stages)",
    "Count of active opportunities — identifies contacts still in the sales funnel for follow-up, pipeline reports, and “has active deal” campaign exclusions.",
    "Yes",
  ],
  [
    "2",
    "crm_deals_won",
    "crm.deals (stage = closed_won)",
    "Lifetime won deal count — measures repeat buyer behavior and success rate for loyalty and upsell segments.",
    "Yes",
  ],
  [
    "3",
    "crm_deals_lost",
    "crm.deals (stage = closed_lost)",
    "Lost deal count — flags contacts who did not convert; useful for win-back, objection-based nurture, and loss analysis.",
    "Yes",
  ],
  [
    "4",
    "crm_inbound_emails_count",
    "crm.contact_activities",
    "Total inbound email touches — shows email engagement level and responsiveness for prioritization and “warm lead” segments.",
    "Yes",
  ],
  [
    "5",
    "crm_calls_count",
    "crm.contact_activities (type = call)",
    "Number of logged calls — measures phone engagement and rep effort; supports “high-touch vs low-touch” routing.",
    "Yes",
  ],
  [
    "6",
    "crm_meetings_count",
    "crm.contact_activities (type = meeting)",
    "Meeting activity count — indicates demo/discovery depth; used for MQL/SQL qualification and meeting-based nurture rules.",
    "Yes",
  ],
  [
    "7",
    "crm_tasks_count",
    "crm.contact_activities (type = task)",
    "Task/follow-up volume — reflects ongoing sales work on the contact; helps managers see coverage and stale-lead detection.",
    "Yes",
  ],
  [
    "8",
    "crm_appointments_booked_count",
    "crm.appointments",
    "Total appointments booked (CCaaS + CRM) — tracks scheduling intent and demo demand for campaign attribution and booking funnels.",
    "Yes",
  ],
  [
    "9",
    "crm_appointments_completed_count",
    "crm.appointments (status = completed)",
    "Completed appointments — confirms the contact showed up; stronger intent signal than booked alone for SQL and handoff rules.",
    "Yes",
  ],
  [
    "10",
    "crm_no_show_count",
    "crm.appointments (status = no_show)",
    "No-show count — flags unreliable or low-commitment leads; triggers re-booking flows and rep prioritization down-ranking.",
    "Yes",
  ],
  [
    "11",
    "crm_quotes_sent_count",
    "crm.quotes",
    "Quotes/proposals sent — indicates late-stage buying motion; used for “quoted but not closed” retargeting and forecast hints.",
    "Yes",
  ],
  [
    "12",
    "crm_invoices_issued_count",
    "crm.invoices",
    "Invoices issued — post-sale billing activity; separates prospects from paying customers for finance and renewal segments.",
    "Yes",
  ],
  [
    "13",
    "crm_orders_count",
    "crm.sales_orders",
    "Confirmed order count — core commercial conversion metric for customer vs prospect classification in CDP.",
    "Yes",
  ],
  [
    "14",
    "crm_last_order_total",
    "crm.sales_orders (latest)",
    "Value of most recent order — sizes the customer for upsell/cross-sell tiers and RFM-style “monetary” scoring.",
    "Yes",
  ],
  [
    "15",
    "crm_total_won_revenue",
    "crm.deals (won amount sum)",
    "Lifetime won revenue from deals — primary LTV proxy for VIP tiers, expansion targets, and account prioritization.",
    "Yes",
  ],
  [
    "16",
    "crm_open_pipeline_value",
    "crm.deals (open amount sum)",
    "Sum of open deal amounts — expected revenue at risk/opportunity for the contact; used in sales alerts and pipeline campaigns.",
    "Yes",
  ],
  [
    "17",
    "crm_largest_deal_value",
    "crm.deals",
    "Biggest single deal amount — identifies high-value opportunities for executive involvement and whale segments.",
    "Yes",
  ],
  [
    "18",
    "crm_avg_deal_size",
    "crm.deals",
    "Average deal size — normalizes buying power across contacts for segmentation when deal count > 1.",
    "Yes",
  ],
  [
    "19",
    "crm_last_deal_stage",
    "latest crm.deals",
    "Most recent deal stage — current funnel position (e.g. proposal, negotiation) for stage-based triggers and agent context.",
    "Yes",
  ],
  [
    "20",
    "crm_last_deal_amount",
    "latest crm.deals",
    "Amount on latest deal — recent opportunity size for prioritization without aggregating full history.",
    "Yes",
  ],
  [
    "21",
    "crm_last_activity_type",
    "latest crm.contact_activities",
    "Last touch type (email, call, meeting, etc.) — drives “last channel used” logic and next-best-action recommendations.",
    "Yes",
  ],
  [
    "22",
    "crm_last_activity_at",
    "crm.contact_activities",
    "Timestamp of last activity — base for recency scoring, stale-lead rules, and “days since touch” calculations.",
    "Yes",
  ],
  [
    "23",
    "crm_days_since_last_sales_touch",
    "derived",
    "Days since any sales activity — standard recency metric for nurture cooldowns, SLA alerts, and re-engagement campaigns.",
    "Yes",
  ],
  [
    "24",
    "crm_lead_status",
    "crm.contact_profiles.lead_status",
    "CRM-owned lead disposition (new, working, qualified, etc.) — aligns CDP segments with rep workflow and list views.",
    "Yes",
  ],
  [
    "25",
    "crm_lead_score",
    "crm.lead_scoring_jobs.score",
    "Numeric AI/rule lead score — primary ranking input for assignment, nurture vs sales routing, and hot-lead alerts.",
    "Yes",
  ],
  [
    "26",
    "crm_lead_band",
    "crm.lead_scoring_jobs.band",
    "Hot/warm/cold band — simple segment bucket for campaigns and agents (e.g. hot → assign rep, cold → nurture).",
    "Yes",
  ],
  [
    "27",
    "crm_lead_grade",
    "crm.lead_scoring_jobs.grade",
    "Letter grade (A–D style) — human-readable priority for reps and marketing tier mapping.",
    "Yes",
  ],
  [
    "28",
    "crm_lead_rationale",
    "crm.lead_scoring_jobs.rationale",
    "Short explanation of score — gives reps and agents context for outreach personalization without opening CRM.",
    "Yes",
  ],
  [
    "29",
    "crm_lead_summary",
    "crm.lead_summaries.summary",
    "AI-generated contact summary — 360° narrative for agents, inbox, and campaign dynamic content.",
    "Yes",
  ],
  [
    "30",
    "crm_lead_headline",
    "crm.lead_summaries.headline",
    "One-line lead headline — quick scan in lists, notifications, and CDP profile cards.",
    "Yes",
  ],
  [
    "31",
    "crm_has_open_deal",
    "crm.deals (boolean)",
    "Whether any open deal exists — fast filter for “in pipeline” vs “net new”; prevents duplicate opp creation and wrong campaign sends.",
    "Yes",
  ],
];

function cell(text, bold = false) {
  return new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold, size: 20 })],
      }),
    ],
  });
}

const header = new TableRow({
  tableHeader: true,
  children: [
    cell("SNo", true),
    cell("CDP field", true),
    cell("Source", true),
    cell("Why it is needed", true),
    cell("OK?", true),
  ],
});

const dataRows = rows.map(
  ([sno, field, source, why, ok]) =>
    new TableRow({
      children: [cell(sno), cell(field), cell(source), cell(why), cell(ok)],
    }),
);

const doc = new Document({
  sections: [
    {
      properties: {},
      children: [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun("CRM → CDP trait mapping")],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "Worktual CRM fields synced to CDP customer traits for segmentation, campaigns, agents, and 360° profile view.",
              size: 22,
            }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "Join key: cdp.customer_profile.cdp_id = crm.contact_profiles.account_contact_id",
              italics: true,
              size: 20,
            }),
          ],
        }),
        new Paragraph({ children: [] }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [header, ...dataRows],
        }),
        new Paragraph({ children: [] }),
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun("CDP use cases (summary)")],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "Campaign audience: band, lead_status, has_open_deal, days_since_last_sales_touch",
              size: 20,
            }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "Sales prioritization: score, band, open_pipeline_value, last_activity_at",
              size: 20,
            }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "Customer vs prospect: orders_count, invoices_issued_count, total_won_revenue",
              size: 20,
            }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "Booking / CCaaS: appointments_booked_count, appointments_completed_count, no_show_count",
              size: 20,
            }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "Agent context: summary, headline, rationale, last_deal_stage",
              size: 20,
            }),
          ],
        }),
      ],
    },
  ],
});

const buffer = await Packer.toBuffer(doc);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, buffer);
console.log(`Wrote ${outPath}`);
