/**
 * When the agent entered their current presence state.
 * Prefer history (immune to heartbeat bumps) with updated_at fallback.
 */
export const PRESENCE_STATE_SINCE_SQL = `
  COALESCE(
    (
      SELECT h.ended_at
      FROM ccass.agent_presence_history h
      WHERE h.agent_id = a.id
        AND h.organization_id = a.organization_id
        AND h.new_state = COALESCE(ap.presence_state, ap.status)
      ORDER BY h.ended_at DESC
      LIMIT 1
    ),
    ap.updated_at
  )
`;
