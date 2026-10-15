function visitorKey(row) {
  return String(row?.visitor_id || '').trim();
}

function sessionKey(row) {
  return String(row?.session_id || '').trim();
}

function countUsers(sessions) {
  return new Set(sessions.map((s) => visitorKey(s)).filter(Boolean)).size;
}

export function dedupeSessionsByVisitor(sessions) {
  const seen = new Set();
  const out = [];
  for (const row of sessions || []) {
    const key = visitorKey(row) || sessionKey(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function withCounts(payload, sessions) {
  return {
    ...payload,
    sessions,
    active_sessions: sessions.length,
    active_users: countUsers(sessions),
  };
}

/** Poll: ClickHouse is source of truth for current_page (no client-side rewind). */
export function mergeLivePayload(prev, next) {
  if (!next) return prev;
  const nextSessions = dedupeSessionsByVisitor(next.sessions || []);
  return withCounts({ ...next }, nextSessions);
}

/** SSE tracking: refresh activity/country only; current_page stays from last CH poll. */
export function applyLiveTrackingEvent(prev, event) {
  const session = event?.session;
  if (!session?.session_id) return prev;
  const sessions = [...(prev?.sessions || [])];
  const vid = visitorKey(session);
  const sid = sessionKey(session);
  let idx = sessions.findIndex((s) => sessionKey(s) === sid);
  if (idx < 0 && vid) {
    idx = sessions.findIndex((s) => visitorKey(s) === vid);
  }
  const prevRow = idx >= 0 ? sessions[idx] : null;

  const row = {
    session_id: sid,
    visitor_id: vid || prevRow?.visitor_id,
    current_page: prevRow?.current_page || '/',
    current_page_ts: Number(prevRow?.current_page_ts) || 0,
    country: session.country || prevRow?.country || '',
    last_activity: new Date(session.last_activity_ms || event.ts || Date.now()).toISOString(),
    last_active_profile_label:
      event?.last_active_profile_label
      || prevRow?.last_active_profile_label
      || 'Anonymous',
  };

  if (idx >= 0) {
    sessions[idx] = { ...sessions[idx], ...row };
  } else {
    sessions.unshift(row);
  }

  return {
    ...(prev || {}),
    ...withCounts(prev || {}, sessions),
    presence_source: prev?.presence_source || 'clickhouse',
  };
}
