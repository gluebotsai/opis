/** Shared DQL validation and agent-scope rewrite for free-form performance SQL. */

import {
  agentScopedConversationsCte,
  assertReportingEntityId,
} from "./reporting-attribution.js";

const FORBIDDEN =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXECUTE|EXEC|COPY|REINDEX|VACUUM|MERGE|UPSERT|CALL|SET|RESET|LOCK|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|COMMENT|DO|PREPARE|DEALLOCATE)\b/i;

export function stripSqlComments(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
}

export function validateDqlQuery(sql: string): string {
  if (!sql || !sql.trim()) {
    throw new Error("SQL query cannot be empty.");
  }
  const cleaned = stripSqlComments(sql);
  const trimmed = cleaned.replace(/;+\s*$/, "").trim();
  if (trimmed.includes(";")) {
    throw new Error("Multi-statement SQL execution is strictly forbidden.");
  }
  const forbidden = FORBIDDEN.exec(cleaned);
  if (forbidden?.[1]) {
    throw new Error(
      `DQL restriction violation: Operation '${forbidden[1].toUpperCase()}' is forbidden. Only SELECT/WITH DQL queries are allowed.`,
    );
  }
  const firstWord = cleaned.split(/\s+/)[0]?.toUpperCase() ?? "";
  if (firstWord !== "SELECT" && firstWord !== "WITH") {
    throw new Error(
      `DQL restriction violation: Query must begin with SELECT or WITH, got '${firstWord}'.`,
    );
  }
  return cleaned;
}

/**
 * Force agent scope by replacing ccass.conversations with a pre-filtered CTE alias.
 * Org RLS still applies via withOrganizationContext.
 */
export function enforceAgentScopedConversations(
  sql: string,
  organizationId: string,
  userId: string,
): string {
  assertReportingEntityId(organizationId, "organization id");
  assertReportingEntityId(userId, "user id");
  const mentionsConversations = /ccass\.conversations\b/i.test(sql);
  if (!mentionsConversations) {
    return sql;
  }
  const rewritten = sql.replace(/\bccass\.conversations\b/gi, "__agent_conversations");
  const scopeCte = agentScopedConversationsCte(organizationId, userId);
  if (/^WITH\b/i.test(rewritten)) {
    return rewritten.replace(/^WITH\s+/i, `WITH ${scopeCte},\n`);
  }
  return `WITH ${scopeCte}\n${rewritten}`;
}

/** Force organization scope (admin dashboard) without filtering to one agent. */
export function enforceOrgScopedConversations(sql: string, organizationId: string): string {
  assertReportingEntityId(organizationId, "organization id");
  const mentionsConversations = /ccass\.conversations\b/i.test(sql);
  if (!mentionsConversations) {
    return sql;
  }
  const rewritten = sql.replace(/\bccass\.conversations\b/gi, "__org_conversations");
  const scopeCte = `__org_conversations AS (
  SELECT *
  FROM ccass.conversations
  WHERE organization_id = '${organizationId}'::bigint
)`;
  if (/^WITH\b/i.test(rewritten)) {
    return rewritten.replace(/^WITH\s+/i, `WITH ${scopeCte},\n`);
  }
  return `WITH ${scopeCte}\n${rewritten}`;
}

export function extractColumns(rows: Record<string, unknown>[]): string[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return Object.keys(rows[0] ?? {});
}
