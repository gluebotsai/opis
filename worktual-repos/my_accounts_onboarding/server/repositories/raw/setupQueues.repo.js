function runnerQuery(runner) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

export async function listQueues(runner, organizationId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT q.*,
            t.name AS team_name,
            (
              SELECT COUNT(*)::int FROM setup_ccaas_queue_agents qa WHERE qa.queue_id = q.id
            ) AS agent_count
     FROM setup_ccaas_queues q
     LEFT JOIN setup_teams t ON t.id = q.team_id
     WHERE q.organization_id = $1
     ORDER BY q.created_at DESC`,
    [organizationId],
  );
  return rows;
}

export async function getQueueById(runner, organizationId, queueId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT q.*,
            t.name AS team_name,
            (
              SELECT COUNT(*)::int FROM setup_ccaas_queue_agents qa WHERE qa.queue_id = q.id
            ) AS agent_count
     FROM setup_ccaas_queues q
     LEFT JOIN setup_teams t ON t.id = q.team_id
     WHERE q.organization_id = $1 AND q.id = $2`,
    [organizationId, queueId],
  );
  return rows[0] || null;
}

export async function insertQueue(runner, organizationId, fields) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO setup_ccaas_queues (organization_id, name, team_id, status)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [organizationId, fields.name, fields.teamId, fields.status || "active"],
  );
  return getQueueById(runner, organizationId, rows[0].id);
}

export async function updateQueue(runner, organizationId, queueId, fields) {
  await runnerQuery(runner).query(
    `UPDATE setup_ccaas_queues SET
       name = COALESCE($3, name),
       team_id = COALESCE($4::uuid, team_id),
       status = COALESCE($5, status),
       updated_at = NOW()
     WHERE organization_id = $1 AND id = $2`,
    [
      organizationId,
      queueId,
      fields.name ?? null,
      fields.teamId ?? null,
      fields.status ?? null,
    ],
  );
  return getQueueById(runner, organizationId, queueId);
}

export async function deleteQueue(runner, organizationId, queueId) {
  const { rowCount } = await runnerQuery(runner).query(
    `DELETE FROM setup_ccaas_queues WHERE organization_id = $1 AND id = $2`,
    [organizationId, queueId],
  );
  return rowCount > 0;
}

export async function listQueueAgents(runner, queueId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT qa.*,
            u.first_name,
            u.last_name,
            u.work_email,
            u.team_id AS user_team_id
     FROM setup_ccaas_queue_agents qa
     INNER JOIN setup_users u ON u.id = qa.user_id
     WHERE qa.queue_id = $1
     ORDER BY u.first_name, u.last_name`,
    [queueId],
  );
  return rows;
}

export async function listAgentQueueAssignments(runner, organizationId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT qa.user_id, qa.queue_id, q.name AS queue_name
     FROM setup_ccaas_queue_agents qa
     INNER JOIN setup_ccaas_queues q ON q.id = qa.queue_id
     WHERE q.organization_id = $1`,
    [organizationId],
  );
  return rows;
}

export async function replaceQueueAgents(runner, queueId, agents = []) {
  const client = typeof runner?.connect === "function" ? await runner.connect() : runner;
  const shouldRelease = client !== runner;
  try {
    if (typeof client.query === "function" && shouldRelease) {
      await client.query("BEGIN");
    }
    await runnerQuery(client).query(`DELETE FROM setup_ccaas_queue_agents WHERE queue_id = $1`, [
      queueId,
    ]);
    for (const agent of agents) {
      await runnerQuery(client).query(
        `INSERT INTO setup_ccaas_queue_agents (
           queue_id, user_id,
           handles_calls, call_type, handles_email, handles_chat,
           handles_whatsapp, handles_instagram, handles_facebook,
           email_concurrency, chat_concurrency,
           whatsapp_concurrency, instagram_concurrency, facebook_concurrency
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          queueId,
          agent.userId,
          Boolean(agent.handlesCalls),
          agent.callType || "both",
          Boolean(agent.handlesEmail),
          Boolean(agent.handlesChat),
          Boolean(agent.handlesWhatsapp),
          Boolean(agent.handlesInstagram),
          Boolean(agent.handlesFacebook),
          Math.max(1, Number(agent.emailConcurrency) || 1),
          Math.max(1, Number(agent.chatConcurrency) || 1),
          Math.max(1, Number(agent.whatsappConcurrency) || 1),
          Math.max(1, Number(agent.instagramConcurrency) || 1),
          Math.max(1, Number(agent.facebookConcurrency) || 1),
        ],
      );
    }
    if (shouldRelease) {
      await client.query("COMMIT");
    }
    return listQueueAgents(client, queueId);
  } catch (error) {
    if (shouldRelease) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback errors
      }
    }
    throw error;
  } finally {
    if (shouldRelease) client.release();
  }
}
