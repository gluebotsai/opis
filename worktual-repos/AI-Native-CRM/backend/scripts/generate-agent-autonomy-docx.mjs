/**
 * One-off generator for docs/agent-autonomy-workflow.docx
 * Run: node backend/scripts/generate-agent-autonomy-docx.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
} from "docx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../docs/agent-autonomy-workflow.docx");

function h1(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 } });
}
function h2(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 160 } });
}
function h3(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 120 } });
}
function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, ...opts })],
  });
}
function bullet(text) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 80 },
    children: [new TextRun(text)],
  });
}

function agentTable(rows) {
  const header = new TableRow({
    tableHeader: true,
    children: ["Agent", "Description", "Example"].map(
      (t) =>
        new TableCell({
          width: { size: 33, type: WidthType.PERCENTAGE },
          shading: { fill: "E8EEF4" },
          children: [new Paragraph({ children: [new TextRun({ text: t, bold: true })] })],
        }),
    ),
  });
  const body = rows.map(
    (row) =>
      new TableRow({
        children: row.map(
          (text) =>
            new TableCell({
              width: { size: 33, type: WidthType.PERCENTAGE },
              children: [new Paragraph({ children: [new TextRun(text)] })],
            }),
        ),
      }),
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1 },
      bottom: { style: BorderStyle.SINGLE, size: 1 },
      left: { style: BorderStyle.SINGLE, size: 1 },
      right: { style: BorderStyle.SINGLE, size: 1 },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
      insideVertical: { style: BorderStyle.SINGLE, size: 1 },
    },
    rows: [header, ...body],
  });
}

const autonomous = [
  [
    "Lead enrichment",
    "Fills missing company and contact firmographics from public signals. Never overwrites fields a user already set.",
    'New lead "Acme Corp" with no domain → agent adds acme.com, industry, and employee count.',
  ],
  [
    "Lead scoring",
    "Scores each lead on Fit + Intent (0–100). Decides if the lead is sales-ready (score ≥ 40) or should stay in nurture.",
    "Inbound demo request with matching company profile → score 72 (Hot band).",
  ],
  [
    "Lead summary",
    "Writes a short AI narrative on the contact using enrichment and score facts only.",
    'Contact page shows: "VP Ops at mid-market SaaS; strong demo intent; budget discussed on call."',
  ],
  [
    "Sales assignment",
    "Assigns a sales rep when the lead is sales-ready. Applies territory, load balancing, and SLA (Hot vs Warm).",
    "Score reaches 65 → lead assigned to the best-matched rep; SLA clock starts.",
  ],
  [
    "Welcome lead",
    "After assignment, composes and sends a first introduction email from the new rep's connected mailbox.",
    'Customer receives: "Hi Raghuram, I\'m Yaswanth — your point of contact at Worktual…"',
  ],
  [
    "Owner change notify",
    "When an admin reassigns the contact owner, emails the customer that their point of contact changed — from the new rep's mailbox.",
    "Admin moves Raghuram from Rep A to Rep B → customer gets a handoff intro from Rep B.",
  ],
  [
    "Lead nurture",
    "Sends follow-up nurture emails to low-score, unowned leads via the CRM bot mailbox until score reaches 40.",
    'Score 25, no owner → drip email: "Still exploring contact center options? Happy to share a quick overview."',
  ],
  [
    "Lead lifecycle",
    "Advances lead status, lifecycle stage (lead → prospect → customer), and deal pipeline stage from CRM and customer-voiced signals.",
    'Customer replies "Yes, send the proposal" → pipeline advances toward Propose stage.',
  ],
  [
    "Commercial acceptance",
    "Reads inbound customer email and applies accept/decline on sent proposals or quotes. Creates quote, order, or invoice drafts as needed. Never auto-emails commercial documents to the customer.",
    'Customer emails "We accept quote Q-00001" → quote accepted; order and invoice draft created for Finance review.',
  ],
  [
    "Email auto-reply (safe path)",
    "Answers routine inbound email and can book demo slots on the rep's calendar when the topic is classified as safe.",
    'Customer: "Can we meet Thursday at 3pm?" → auto-reply confirms and books the calendar slot.',
  ],
  [
    "Meeting brief",
    "Emails the sales owner a preparation brief when a meeting is booked (contact, company, deal context, recent activity).",
    "Before a demo, rep receives a 360° snapshot of the lead and recent email thread.",
  ],
  [
    "Meeting reminder",
    "Sends reminder emails to owner and customer before scheduled meetings.",
    'Customer gets: "Reminder: your Worktual demo is tomorrow at 3pm IST."',
  ],
  [
    "Minutes of meeting (MOM)",
    "After a transcript is attached, sends a customer-safe summary to the contact and a detailed version internally.",
    "Post-demo: customer receives next steps; sales leadership receives full internal minutes.",
  ],
  [
    "Meeting miss escalation",
    "When a meeting is missed, analyzes context and alerts admins with an intelligent escalation message.",
    "Demo no-show on a Hot lead → admin receives importance-aware escalation with suggested follow-up.",
  ],
  [
    "Marketing opt-out (Compliance)",
    "When an inbound email is classified as a marketing unsubscribe, applies opt-out immediately (reversible). Stops nurture sends.",
    'Customer: "Stop marketing emails" → marketingOptOut set; nurture sequence stops.',
  ],
];

const semiAutonomous = [
  [
    "Email auto-reply (escalation path)",
    "Detects sensitive topics (pricing, legal, complaints, privacy) and does not reply — escalates to the owner for manual handling.",
    'Customer: "Send final pricing and contract terms" → no auto-send; owner gets an inbox alert.',
  ],
  [
    "Post-meeting process",
    "After a transcript, creates draft proposal and/or quote on the deal and notifies sales. Never emails the customer directly.",
    "Demo transcript mentions pricing → draft quote with catalog prices appears on the deal for rep review.",
  ],
  [
    "Pipeline forecast auditor",
    "Judges whether deal stage and expected close date look realistic. Flags mismatches; never changes stage or close date itself.",
    "Deal stuck in Negotiate with no recent activity → flagged Review forecast on the pipeline board.",
  ],
  [
    "Sales & pre-sales coach",
    "Private coaching for the rep who ran the call (discovery, objections, methodology). Visible to the rep only — not managers.",
    'After a call, rep sees: "Ask more budget questions; integration objection was handled well."',
  ],
  [
    "Compliance & privacy",
    "Classifies GDPR/CCPA/privacy requests and drafts responses. Data deletion or access requests wait for admin confirmation before any delete runs.",
    '"Delete my data" → privacy request queued; admin reviews and confirms before execution.',
  ],
  [
    "Invoice escalation",
    "Assesses collections risk on overdue invoices and drafts an internal note plus customer reminder text. Never marks paid/void or sends the reminder itself.",
    "Invoice 30 days overdue → Finance sees severity Escalate and a copyable reminder draft.",
  ],
  [
    "Expansion & revenue matcher",
    "Finds upsell/cross-sell signals from closed-won history and drafts outreach talking points. Never creates a deal or contacts the account.",
    "Account with two past wins and no open deal → Opportunity badge plus draft renewal outreach text.",
  ],
  [
    "Coworker / CRM agent",
    "Chat assistant in each module. Proposes actions via propose_* tools; user clicks Confirm before create, update, send, or delete.",
    'User: "Send quote Q-00002 to Raghuram" → agent proposes Send → rep confirms → email goes out.',
  ],
  [
    "Document & content agents",
    "Help write or rewrite proposal, quote, and invoice template content. Output stays draft until a human approves and sends.",
    '"Rewrite the introduction for the hexaware proposal" → new section text; rep approves document then sends.',
  ],
  [
    "Hygiene",
    "Suggests duplicate contact merges or missing enrichment steps. Never merges automatically.",
    "Two contacts with the same email → agent suggests merge; user confirms in the merge wizard.",
  ],
  [
    "Compose email",
    "Drafts outbound email copy for a rep. Rep reviews and sends manually.",
    '"Draft a follow-up after yesterday\'s demo" → subject and body provided; rep edits and sends.',
  ],
  [
    "In-meeting assist",
    "Live suggestions during a call in the meeting side panel. Rep chooses what to use in the conversation.",
    "Customer mentions a competitor → panel shows battle-card talking points; rep decides whether to use them.",
  ],
];

const doc = new Document({
  creator: "Worktual CRM",
  title: "CRM Agent Autonomy & Workflow",
  description: "Autonomous vs semi-autonomous agents and end-to-end workflow",
  sections: [
    {
      properties: {},
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
          children: [
            new TextRun({ text: "CRM Agents", bold: true, size: 36 }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 600 },
          children: [
            new TextRun({
              text: "Autonomy Classification & End-to-End Workflow",
              size: 24,
              color: "444444",
            }),
          ],
        }),
        p("This document describes which CRM agents run autonomously versus semi-autonomously, what each agent does, and how agents fit into the overall customer workflow from first touch to renewal."),
        p("Autonomous = the agent completes the action (CRM update and/or customer email) within defined safe rules, without a human clicking Confirm.", { bold: true }),
        p("Semi-autonomous = the agent analyzes and drafts; a human must confirm, send, approve, or take over before the important action happens.", { bold: true }),

        h1("1. End-to-end workflow (start to finish)"),
        h2("Phase A — Lead intake & qualification"),
        bullet("1. New person enters CRM (form, import, campaign, or CDP insert)."),
        bullet("2. Lead enrichment fills missing company/contact firmographics."),
        bullet("3. Lead scoring computes Fit + Intent and total score."),
        bullet("4. Lead summary writes the AI narrative on the contact record."),
        bullet("5a. Score ≥ 40 → Sales assignment picks a rep → Welcome lead emails the customer from the rep's mailbox."),
        bullet("5b. Score < 40 and unowned → Lead nurture sends drip emails from the CRM bot until score improves."),
        bullet("6. Lead lifecycle runs continuously — advancing lead status, lifecycle stage, and pipeline as customer signals arrive."),

        h2("Phase B — Engagement & meetings"),
        bullet("7. Email auto-reply handles safe inbound questions and demo scheduling on the rep's mailbox; sensitive mail escalates to the owner."),
        bullet("8. Meeting brief prepares the rep before the call; meeting reminder notifies owner and customer beforehand."),
        bullet("9. In-meeting assist gives live coaching in the call panel (rep decides what to use)."),
        bullet("10. After the call, transcript capture triggers: Sales coach (private rep feedback), Post-meeting process (draft proposal/quote), and Minutes of meeting (customer-safe summary sent)."),

        h2("Phase C — Commercial documents & finance"),
        bullet("11. Rep or coworker agent drafts proposal/quote; human approves document content."),
        bullet("12. Rep sends quote or proposal to customer (human Send — agents never auto-email commercial docs)."),
        bullet("13. Commercial acceptance reads customer accept/decline email → may accept quote and create order + invoice draft."),
        bullet("14. Finance approves invoice → sends to customer → marks paid when payment received."),
        bullet("15. Invoice escalation drafts collections reminders on overdue invoices; Finance copies/sends manually."),

        h2("Phase D — Account growth & governance"),
        bullet("16. Pipeline forecast auditor flags unrealistic deal stages or close dates for owner review."),
        bullet("17. Expansion matcher identifies upsell/cross-sell opportunities and drafts outreach; owner acts manually."),
        bullet("18. Compliance & privacy classifies privacy requests; marketing opt-out applies automatically; deletion waits for admin confirm."),
        bullet("19. If admin reassigns contact owner → Owner change notify emails customer from the new rep's mailbox."),
        bullet("20. Coworker agents assist throughout — user confirms every propose_* action before CRM mutations or sends."),

        h2("Workflow at a glance"),
        p(
          "New lead → Enrich → Score → Summary → Assign (≥40) or Nurture (<40) → Welcome email → Lifecycle (ongoing) → Meetings (brief / assist / MOM) → Draft proposal/quote (semi) → Human send → Commercial acceptance → Invoice (Finance) → Expansion & forecast overlays (semi) → Renewal.",
        ),

        h1("2. Autonomous agents"),
        p("These agents act on their own within safe rules. No human Confirm click is required."),
        agentTable(autonomous),

        h1("3. Semi-autonomous agents"),
        p("These agents think and draft. A human confirms, sends, approves, or takes over before high-impact actions."),
        agentTable(semiAutonomous),

        h1("4. Quick reference"),
        p("Rule of thumb:", { bold: true }),
        bullet("Autonomous pipeline agents (enrich, score, assign, nurture, lifecycle, welcome) drive the lead machine."),
        bullet("Autonomous customer email agents (welcome, owner change, safe auto-reply, reminders, MOM) send when rules allow."),
        bullet("Semi-autonomous agents (post-meeting, forecast, coach, compliance, invoice escalation, expansion, coworker) prepare work for humans."),
        bullet("Commercial documents (proposal, quote, invoice) always require human approve + send — never fully autonomous to the customer."),
        p("Document version: Worktual CRM — generated from production agent architecture."),
      ],
    },
  ],
});

const buffer = await Packer.toBuffer(doc);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, buffer);
console.log(`Wrote ${OUT} (${buffer.length} bytes)`);
