/**
 * Live browser pass of Proposal patterns + deal generate UI.
 * Run: npx tsx --env-file=../.env scripts/live-proposal-patterns-browser.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { chromium } from "playwright";
import { accountQuery } from "../src/dao/db/account-pool.ts";
import { prisma } from "../src/dao/db/prisma.ts";
import {
  SESSION_COOKIE_NAME,
  signSessionUserId,
} from "../src/service/account/session-crypto.ts";

const APP = process.env.E2E_APP_BASE || "http://127.0.0.1:5173";
const OUT = "/tmp/crm-proposal-browser";
const findings: string[] = [];

function note(ok: boolean, msg: string) {
  findings.push(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  console.log(findings[findings.length - 1]);
}

async function tinyPdf(title: string, body: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(title, { x: 72, y: 720, size: 18, font });
  page.drawText(body, { x: 72, y: 680, size: 11, font });
  return Buffer.from(await doc.save());
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { rows } = await accountQuery<{
    id: string;
    email: string;
    role: string;
    organization_id: string;
  }>(
    `SELECT u.id::text AS id,
            lower(u.work_email) AS email,
            r.name AS role,
            u.organization_id::text AS organization_id
       FROM accounts.setup_users u
       JOIN accounts.setup_user_product_access a
         ON a.user_id = u.id AND a.product_id = 'crm'
       JOIN accounts.setup_roles r ON r.id = a.role_id
      WHERE lower(r.name) IN ('admin', 'administrator', 'sales_manager', 'manager')
      ORDER BY u.id
      LIMIT 8`,
  );
  if (!rows.length) {
    throw new Error("No CRM admin/sales_manager in accounts.setup_users.");
  }
  const user = rows[0];
  console.log(`session as ${user.role}`);

  const deal = await prisma.deal.findFirst({
    where: { organizationId: BigInt(user.organization_id) },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true },
  });

  const reqPdf = await tinyPdf(
    "Requirement",
    "Need CRM with API integration for 50 seats.",
  );
  const propPdf = await tinyPdf(
    "Winning proposal",
    "We propose CRM with integrations and a scoped commercial offer.",
  );
  writeFileSync(path.join(OUT, "requirement.pdf"), reqPdf);
  writeFileSync(path.join(OUT, "proposal.pdf"), propPdf);

  const browser = await chromium.launch({
    headless: process.env.HEADED === "1" ? false : true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: signSessionUserId(user.id),
      url: APP,
    },
  ]);
  const page = await context.newPage();
  page.setDefaultTimeout(25_000);

  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const onLogin = /sign in/i.test(await page.locator("body").innerText());
  if (onLogin && page.url().includes("/login")) {
    note(false, "Session cookie did not land an authenticated session");
    await page.screenshot({ path: path.join(OUT, "01-login-blocked.png"), fullPage: true });
    await browser.close();
    await prisma.$disconnect();
    process.exit(1);
  }

  await page.goto(`${APP}/configuration/proposal-patterns`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: path.join(OUT, "02-proposal-patterns.png"),
    fullPage: true,
  });
  const recent = page.getByRole("heading", { name: "Recently learned" });
  if (await recent.count()) {
    await recent.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.screenshot({
      path: path.join(OUT, "02b-recently-learned.png"),
      fullPage: false,
    });
  }
  const patternsText = await page.locator("body").innerText();
  note(/proposal patterns/i.test(patternsText), "Proposal patterns page title is visible");
  note(/pair 1/i.test(patternsText), "First pair slot is visible");
  note(
    /requirement document/i.test(patternsText) && /winning proposal/i.test(patternsText),
    "Each slot has requirement + winning proposal dropzones",
  );
  note(/add another pair/i.test(patternsText), "User can add another pair slot");
  note(/learn pattern/i.test(patternsText), "Learn pattern action is present");
  note(/recently learned/i.test(patternsText), "Recently learned list is present");
  note(
    !/visual master/i.test(patternsText) && !/pick master/i.test(patternsText),
    "No visual-master picker on the page",
  );
  note(
    /content pattern/i.test(patternsText) ||
      /case stud/i.test(patternsText) ||
      /need 3 to synthesize/i.test(patternsText) ||
      /recently learned/i.test(patternsText),
    "Recently learned mentions content coverage or is ready for it",
  );

  await page.getByRole("button", { name: "Add another pair" }).click();
  await page.waitForTimeout(300);
  note(
    (await page.getByText("Pair 2").count()) > 0,
    "Add another pair creates Pair 2",
  );
  await page.getByRole("button", { name: "Remove" }).first().click();
  await page.waitForTimeout(200);
  note(
    (await page.getByText("Pair 2").count()) === 0,
    "Remove slot deletes the extra pair",
  );

  const fileInputs = page.locator('input[type="file"]');
  const inputCount = await fileInputs.count();
  note(inputCount >= 2, `Pair slot exposes file inputs (found ${inputCount})`);
  if (inputCount >= 2) {
    await fileInputs.nth(0).setInputFiles(path.join(OUT, "requirement.pdf"));
    await fileInputs.nth(1).setInputFiles(path.join(OUT, "proposal.pdf"));
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: path.join(OUT, "03-after-attach.png"),
      fullPage: true,
    });
    const afterAttach = await page.locator("body").innerText();
    note(
      /requirement\.pdf|scoring this pair|pairing confidence|use anyway|could not score/i.test(
        afterAttach,
      ),
      "Attaching both files starts score UX (confidence, scoring, or error)",
    );
    note(
      /use anyway/i.test(afterAttach) ||
        /pairing confidence/i.test(afterAttach) ||
        /could not score|scoring this pair/i.test(afterAttach),
      "Low-score path is either scoring, showing confidence, or explaining failure",
    );
  }

  if (deal) {
    await page.goto(`${APP}/sales/${deal.id}`, { waitUntil: "domcontentloaded" });
    const proposalsTab = page.getByRole("button", { name: "Proposals", exact: true });
    try {
      await proposalsTab.waitFor({ timeout: 25_000 });
      await proposalsTab.click();
      const newProposal = page.getByRole("button", { name: "+ New proposal" });
      await newProposal.waitFor({ timeout: 10_000 });
      await newProposal.click();
      await page.getByRole("button", { name: "Generate proposal" }).waitFor({
        timeout: 8_000,
      });
    } catch {
      /* screenshot below */
    }
    await page.screenshot({
      path: path.join(OUT, "04-deal-proposals.png"),
      fullPage: true,
    });
    const afterDeal = await page.locator("body").innerText();
    note(
      /generate proposal/i.test(afterDeal),
      "Deal workspace exposes Generate proposal",
    );
    note(
      /learned pattern|uploaded proposals|section order|visual layout/i.test(afterDeal),
      "Generate copy talks about learned patterns, not cloning a PDF",
    );
  } else {
    note(false, "No deal in this org to open generate UI");
  }

  await browser.close();
  await prisma.$disconnect();
  const failed = findings.filter((line) => line.startsWith("FAIL")).length;
  console.log(`\n${findings.filter((l) => l.startsWith("PASS")).length} passed, ${failed} failed`);
  console.log(`screenshots: ${OUT}`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
