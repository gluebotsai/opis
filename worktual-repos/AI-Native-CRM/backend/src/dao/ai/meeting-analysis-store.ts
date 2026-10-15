/**
 * Persist Meeting Analysis Agent output (owned schema for Lifecycle).
 */

import { prisma } from "@/dao/db/prisma";
import { randomUUID } from "node:crypto";

export type MeetingAnalysisInput = {
  organizationId: string;
  activityId: string;
  contactId?: string | null;
  dealId?: string | null;
  outcome?: string | null;
  bantBudget?: boolean | null;
  bantAuthority?: boolean | null;
  bantNeed?: boolean | null;
  bantTimelineText?: string | null;
  nextStepAgreed?: string | null;
  objectionsRaised?: string[];
  confidence?: number;
  evidence?: string[];
};

export async function upsertMeetingAnalysis(
  input: MeetingAnalysisInput,
): Promise<void> {
  const id = randomUUID().replace(/-/g, "").slice(0, 24);
  const objections = JSON.stringify(input.objectionsRaised ?? []);
  const evidence = JSON.stringify(input.evidence ?? []);
  const confidence = Math.max(0, Math.min(1, Number(input.confidence ?? 0)));

  await prisma.$executeRawUnsafe(
    `
    INSERT INTO meeting_analyses (
      id, organization_id, activity_id, contact_id, deal_id,
      outcome, bant_budget, bant_authority, bant_need, bant_timeline_text,
      next_step_agreed, objections_raised, confidence, evidence, analyzed_at, created_at
    ) VALUES (
      $1, $2::bigint, $3, $4::text, $5,
      $6, $7, $8, $9, $10,
      $11, $12::jsonb, $13, $14::jsonb, NOW(), NOW()
    )
    ON CONFLICT (activity_id) DO UPDATE SET
      outcome = EXCLUDED.outcome,
      bant_budget = EXCLUDED.bant_budget,
      bant_authority = EXCLUDED.bant_authority,
      bant_need = EXCLUDED.bant_need,
      bant_timeline_text = EXCLUDED.bant_timeline_text,
      next_step_agreed = EXCLUDED.next_step_agreed,
      objections_raised = EXCLUDED.objections_raised,
      confidence = EXCLUDED.confidence,
      evidence = EXCLUDED.evidence,
      analyzed_at = NOW()
    `,
    id,
    input.organizationId,
    input.activityId,
    input.contactId ?? null,
    input.dealId ?? null,
    input.outcome ?? null,
    input.bantBudget ?? null,
    input.bantAuthority ?? null,
    input.bantNeed ?? null,
    input.bantTimelineText ?? null,
    input.nextStepAgreed ?? null,
    objections,
    confidence,
    evidence,
  );

  // Mirror BANT onto contact profile when confident.
  if (input.contactId && confidence >= 0.5) {
    await prisma.$executeRawUnsafe(
      `
      UPDATE contact_profiles SET
        bant_budget = COALESCE($2, bant_budget),
        bant_authority = COALESCE($3, bant_authority),
        bant_need = COALESCE($4, bant_need),
        updated_at = NOW()
      WHERE account_contact_id = $1::text
      `,
      input.contactId,
      input.bantBudget ?? null,
      input.bantAuthority ?? null,
      input.bantNeed ?? null,
    );
  }
}

export async function latestMeetingAnalysisForContact(
  contactId: string,
): Promise<Record<string, unknown> | null> {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `
    SELECT * FROM meeting_analyses
    WHERE contact_id = $1::text
    ORDER BY analyzed_at DESC
    LIMIT 1
    `,
    contactId,
  );
  return rows[0] ?? null;
}
