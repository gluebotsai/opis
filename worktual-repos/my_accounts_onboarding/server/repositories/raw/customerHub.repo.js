function runnerQuery(runner) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

export async function selectLeadStatusesByIds(runner, leadIds) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id, status FROM leads WHERE id = ANY($1::uuid[])`,
    [leadIds],
  );
  return rows;
}

export async function selectOrganizationLeadIdsByCreator(runner, createdByUserId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT source_lead_id FROM organizations o
     JOIN leads l ON l.id = o.source_lead_id
     WHERE l.created_by_user_id = $1`,
    [createdByUserId],
  );
  return rows;
}
