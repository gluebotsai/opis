import { query } from "../../db/pool.js";

const TEMPLATE_COLUMNS = `id, name, subject, body_html, created_by, updated_by, created_at, updated_at`;

export async function selectMailTemplates() {
  const { rows } = await query(
    `SELECT ${TEMPLATE_COLUMNS}
     FROM mail_templates
     ORDER BY LOWER(name) ASC, created_at DESC`,
  );
  return rows;
}

export async function selectMailTemplateById(id: any) {
  const { rows } = await query(`SELECT ${TEMPLATE_COLUMNS} FROM mail_templates WHERE id = $1`, [
    id,
  ]);
  return rows[0] || null;
}

export async function insertMailTemplate({ name, subject, bodyHtml, actorEmail }: any) {
  const { rows } = await query(
    `INSERT INTO mail_templates (name, subject, body_html, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $4)
     RETURNING ${TEMPLATE_COLUMNS}`,
    [name, subject, bodyHtml, actorEmail || null],
  );
  return rows[0] || null;
}

export async function updateMailTemplate(id: any, { name, subject, bodyHtml, actorEmail }: any) {
  const { rows } = await query(
    `UPDATE mail_templates SET
      name = $2,
      subject = $3,
      body_html = $4,
      updated_by = $5,
      updated_at = NOW()
     WHERE id = $1
     RETURNING ${TEMPLATE_COLUMNS}`,
    [id, name, subject, bodyHtml, actorEmail || null],
  );
  return rows[0] || null;
}

export async function deleteMailTemplate(id: any) {
  const { rowCount } = await query(`DELETE FROM mail_templates WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
