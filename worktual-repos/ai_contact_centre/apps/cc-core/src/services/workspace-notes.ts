import { z } from "zod";

import type { DbClient } from "../lib/rls.js";
import { serializeEntityIdOptional } from "../lib/id-schema.js";

export const createWorkspaceNoteSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4000),
});

type NoteRow = {
  id: string;
  title: string | null;
  body: string;
  author_user_id: string;
  author_name: string | null;
  conversation_id: string | null;
  conversation_subject: string | null;
  created_at: Date;
  updated_at: Date;
};

export type WorkspaceNoteRecord = {
  id: string;
  title: string;
  body: string;
  authorUserId: string;
  authorName: string;
  conversationId: string | null;
  conversationSubject: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapNoteRow(row: NoteRow): WorkspaceNoteRecord {
  return {
    id: serializeEntityIdOptional(row.id)!,
    title: row.title?.trim() || "Note",
    body: row.body,
    authorUserId: serializeEntityIdOptional(row.author_user_id)!,
    authorName: row.author_name?.trim() || "Agent",
    conversationId: serializeEntityIdOptional(row.conversation_id),
    conversationSubject: row.conversation_subject,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function createConversationNote(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  authorUserId: string,
  title: string,
  body: string,
): Promise<WorkspaceNoteRecord> {
  const rows = await db.$queryRaw<NoteRow[]>`
    INSERT INTO ccass.conversation_notes (
      organization_id,
      conversation_id,
      author_user_id,
      title,
      body
    )
    VALUES (
      ${organizationId}::bigint,
      ${conversationId}::bigint,
      ${authorUserId}::bigint,
      ${title},
      ${body}
    )
    RETURNING
      id,
      title,
      body,
      author_user_id,
      NULL::text AS author_name,
      conversation_id,
      NULL::text AS conversation_subject,
      created_at,
      updated_at
  `;

  const note = rows[0];
  if (!note) {
    throw Object.assign(new Error("Failed to save note"), { status: 500 });
  }

  const enriched = await db.$queryRaw<NoteRow[]>`
    SELECT
      n.id,
      n.title,
      n.body,
      n.author_user_id,
      COALESCE(a.display_name, 'Agent') AS author_name,
      n.conversation_id,
      c.subject AS conversation_subject,
      n.created_at,
      n.updated_at
    FROM ccass.conversation_notes n
    LEFT JOIN ccass.conversations c ON c.id = n.conversation_id
    LEFT JOIN ccass.agents a
      ON a.setup_user_id = n.author_user_id
      AND a.organization_id = n.organization_id
    WHERE n.id = ${note.id}::bigint
    LIMIT 1
  `;

  return mapNoteRow(enriched[0] ?? note);
}

export async function listVisitorNotes(
  db: DbClient,
  organizationId: string,
  visitorId: string,
  _authorUserId: string,
  limit = 50,
  contactId: string | null = null,
): Promise<WorkspaceNoteRecord[]> {
  const linkedContactId = contactId?.trim() || "";
  const rows = await db.$queryRaw<NoteRow[]>`
    SELECT
      n.id,
      n.title,
      n.body,
      n.author_user_id,
      COALESCE(a.display_name, 'Agent') AS author_name,
      n.conversation_id,
      c.subject AS conversation_subject,
      n.created_at,
      n.updated_at
    FROM ccass.conversation_notes n
    INNER JOIN ccass.conversations c ON c.id = n.conversation_id
    LEFT JOIN ccass.agents a
      ON a.setup_user_id = n.author_user_id
      AND a.organization_id = n.organization_id
    WHERE n.organization_id = ${organizationId}::bigint
      AND (
        c.visitor_id = ${visitorId}
        OR c.contact_id = ${visitorId}
        OR (${linkedContactId} <> '' AND c.contact_id = ${linkedContactId})
      )
    ORDER BY n.created_at DESC
    LIMIT ${limit}
  `;

  return rows.map(mapNoteRow);
}

export async function createCommonNote(
  db: DbClient,
  organizationId: string,
  authorUserId: string,
  title: string,
  body: string,
): Promise<WorkspaceNoteRecord> {
  const rows = await db.$queryRaw<NoteRow[]>`
    INSERT INTO ccass.workspace_common_notes (
      organization_id,
      author_user_id,
      title,
      body
    )
    VALUES (
      ${organizationId}::bigint,
      ${authorUserId}::bigint,
      ${title},
      ${body}
    )
    RETURNING
      id,
      title,
      body,
      author_user_id,
      NULL::text AS author_name,
      NULL::bigint AS conversation_id,
      NULL::text AS conversation_subject,
      created_at,
      updated_at
  `;

  const note = rows[0];
  if (!note) {
    throw Object.assign(new Error("Failed to save common note"), { status: 500 });
  }

  const enriched = await db.$queryRaw<NoteRow[]>`
    SELECT
      n.id,
      n.title,
      n.body,
      n.author_user_id,
      COALESCE(a.display_name, 'Agent') AS author_name,
      NULL::bigint AS conversation_id,
      NULL::text AS conversation_subject,
      n.created_at,
      n.updated_at
    FROM ccass.workspace_common_notes n
    LEFT JOIN ccass.agents a
      ON a.setup_user_id = n.author_user_id
      AND a.organization_id = n.organization_id
    WHERE n.id = ${note.id}::bigint
    LIMIT 1
  `;

  return mapNoteRow(enriched[0] ?? note);
}

export async function listCommonNotes(
  db: DbClient,
  organizationId: string,
  authorUserId: string,
  limit = 50,
): Promise<WorkspaceNoteRecord[]> {
  const rows = await db.$queryRaw<NoteRow[]>`
    SELECT
      n.id,
      n.title,
      n.body,
      n.author_user_id,
      COALESCE(a.display_name, 'Agent') AS author_name,
      NULL::bigint AS conversation_id,
      NULL::text AS conversation_subject,
      n.created_at,
      n.updated_at
    FROM ccass.workspace_common_notes n
    LEFT JOIN ccass.agents a
      ON a.setup_user_id = n.author_user_id
      AND a.organization_id = n.organization_id
    WHERE n.organization_id = ${organizationId}::bigint
      AND n.author_user_id = ${authorUserId}::bigint
    ORDER BY n.created_at DESC
    LIMIT ${limit}
  `;

  return rows.map(mapNoteRow);
}
