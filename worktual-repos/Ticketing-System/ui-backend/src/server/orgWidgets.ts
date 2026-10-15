/**
 * Public Help widgets — browser-safe publicId (no secret in the page).
 * Submit hits POST /api/public/widgets/:publicId/tickets → intake create.
 */
import { randomBytes } from "crypto";
import { query } from "./db";

export async function ensureOrgWidgetsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS ticketing.org_widgets (
      id               BIGSERIAL PRIMARY KEY,
      organization_id  BIGINT NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
      name             TEXT NOT NULL,
      public_id        TEXT NOT NULL UNIQUE,
      allowed_origins  TEXT[] NOT NULL DEFAULT '{}',
      enabled          BOOLEAN NOT NULL DEFAULT TRUE,
      button_label     TEXT NOT NULL DEFAULT 'Help',
      created_by_id    BIGINT,
      created_by_name  TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_org_widgets_org
     ON ticketing.org_widgets(organization_id, created_at DESC)`
  );
}

function newPublicId(): string {
  return `wgt_${randomBytes(12).toString("base64url")}`;
}

export type OrgWidgetRow = {
  id: string;
  organizationId: string;
  name: string;
  publicId: string;
  allowedOrigins: string[];
  enabled: boolean;
  buttonLabel: string;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapWidget(r: Record<string, unknown>): OrgWidgetRow {
  const origins = Array.isArray(r.allowed_origins)
    ? (r.allowed_origins as string[])
    : [];
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    name: String(r.name),
    publicId: String(r.public_id),
    allowedOrigins: origins.map(String),
    enabled: Boolean(r.enabled),
    buttonLabel: String(r.button_label || "Help"),
    createdById: r.created_by_id ? String(r.created_by_id) : null,
    createdByName: r.created_by_name ? String(r.created_by_name) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export async function listOrgWidgets(
  organizationId: string
): Promise<OrgWidgetRow[]> {
  const { rows } = await query(
    `SELECT * FROM ticketing.org_widgets
     WHERE organization_id = $1
     ORDER BY created_at DESC`,
    [organizationId]
  );
  return rows.map((r) => mapWidget(r as Record<string, unknown>));
}

export async function createOrgWidget(input: {
  organizationId: string;
  name: string;
  allowedOrigins?: string[];
  buttonLabel?: string;
  createdById?: string | null;
  createdByName?: string | null;
}): Promise<OrgWidgetRow> {
  const name = String(input.name || "").trim() || "Help widget";
  const buttonLabel = String(input.buttonLabel || "Help").trim() || "Help";
  const origins = (input.allowedOrigins || [])
    .map((o) => String(o || "").trim().replace(/\/$/, ""))
    .filter(Boolean);
  const publicId = newPublicId();
  const { rows } = await query(
    `INSERT INTO ticketing.org_widgets (
       organization_id, name, public_id, allowed_origins, button_label,
       created_by_id, created_by_name
     ) VALUES ($1,$2,$3,$4::text[],$5,$6,$7)
     RETURNING *`,
    [
      input.organizationId,
      name,
      publicId,
      origins,
      buttonLabel,
      input.createdById || null,
      input.createdByName || null,
    ]
  );
  return mapWidget(rows[0] as Record<string, unknown>);
}

export async function updateOrgWidget(input: {
  organizationId: string;
  widgetId: string;
  name?: string;
  allowedOrigins?: string[];
  buttonLabel?: string;
  enabled?: boolean;
}): Promise<OrgWidgetRow | null> {
  const { rows: existing } = await query(
    `SELECT * FROM ticketing.org_widgets
     WHERE organization_id = $1 AND id = $2`,
    [input.organizationId, input.widgetId]
  );
  if (!existing[0]) return null;
  const cur = mapWidget(existing[0] as Record<string, unknown>);
  const name =
    input.name !== undefined ? String(input.name).trim() || cur.name : cur.name;
  const buttonLabel =
    input.buttonLabel !== undefined
      ? String(input.buttonLabel).trim() || cur.buttonLabel
      : cur.buttonLabel;
  const enabled =
    input.enabled !== undefined ? Boolean(input.enabled) : cur.enabled;
  const origins =
    input.allowedOrigins !== undefined
      ? input.allowedOrigins
          .map((o) => String(o || "").trim().replace(/\/$/, ""))
          .filter(Boolean)
      : cur.allowedOrigins;
  const { rows } = await query(
    `UPDATE ticketing.org_widgets SET
       name = $3,
       button_label = $4,
       enabled = $5,
       allowed_origins = $6::text[],
       updated_at = NOW()
     WHERE organization_id = $1 AND id = $2
     RETURNING *`,
    [input.organizationId, input.widgetId, name, buttonLabel, enabled, origins]
  );
  return rows[0] ? mapWidget(rows[0] as Record<string, unknown>) : null;
}

export async function getWidgetByPublicId(
  publicId: string
): Promise<OrgWidgetRow | null> {
  const { rows } = await query(
    `SELECT * FROM ticketing.org_widgets WHERE public_id = $1 LIMIT 1`,
    [String(publicId || "").trim()]
  );
  if (!rows[0]) return null;
  return mapWidget(rows[0] as Record<string, unknown>);
}

/** Empty allowed_origins = allow any origin (dev / first onboard). */
export function originAllowed(
  widget: Pick<OrgWidgetRow, "enabled" | "allowedOrigins">,
  originHeader: string | undefined
): boolean {
  if (!widget.enabled) return false;
  if (!widget.allowedOrigins.length) return true;
  const origin = String(originHeader || "").trim().replace(/\/$/, "");
  if (!origin) return true; // non-browser clients (curl / server tests)
  return widget.allowedOrigins.some(
    (o) => o === origin || o === "*" || origin.startsWith(o)
  );
}
