const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

function nonEmpty(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function isPlaceholderReferrer(value) {
  const text = nonEmpty(value);
  if (!text) return true;
  const lower = text.toLowerCase();
  return lower === 'direct' || lower === '(direct)' || lower === 'none';
}

export function parseUtmFromPath(path) {
  if (!path || !String(path).includes('?')) return {};
  const query = String(path).split('?').slice(1).join('?');
  const params = new URLSearchParams(query);
  const out = {};
  for (const key of UTM_KEYS) {
    const value = nonEmpty(params.get(key));
    if (value) out[key] = value;
  }
  return out;
}

function utmFromSessionRow(row) {
  if (!row || typeof row !== 'object') return {};
  const out = {};
  for (const key of UTM_KEYS) {
    const value = nonEmpty(row[key]);
    if (value) out[key] = value;
  }
  const fromPath = parseUtmFromPath(row.entry_page);
  for (const key of UTM_KEYS) {
    if (!out[key] && fromPath[key]) out[key] = fromPath[key];
  }
  return out;
}

/**
 * Re-evaluates UTM capture on each visitor payload (poll / refresh).
 * Merges summary traffic with session + journey URLs, same idea as the API.
 */
export function resolveVisitorTrafficUtm(traffic = {}, sessions = [], journey = []) {
  const merged = {};
  for (const key of UTM_KEYS) {
    merged[key] = nonEmpty(traffic[key]);
  }

  const paths = [
    traffic.landing_page,
    ...sessions.map((s) => s?.entry_page),
    ...journey.map((step) => step?.page_path),
  ].filter(Boolean);

  for (const path of paths) {
    const fromPath = parseUtmFromPath(path);
    for (const key of UTM_KEYS) {
      merged[key] = merged[key] || fromPath[key] || null;
    }
  }

  for (const session of sessions) {
    const fromSession = utmFromSessionRow(session);
    for (const key of UTM_KEYS) {
      merged[key] = merged[key] || fromSession[key] || null;
    }
  }

  const captured =
    traffic.utm_captured === true
    || UTM_KEYS.some((key) => merged[key]);

  return {
    utm_source: merged.utm_source,
    utm_medium: merged.utm_medium,
    utm_campaign: merged.utm_campaign,
    utm_term: merged.utm_term,
    utm_content: merged.utm_content,
    utm_captured: captured,
  };
}

/**
 * Traffic Source card on visitor detail: re-check referrer + UTM on every payload refresh.
 * Optional fields are hidden until at least one value exists.
 */
export function resolveVisitorTrafficDetails(traffic = {}, sessions = [], journey = []) {
  const utm = resolveVisitorTrafficUtm(traffic, sessions, journey);

  let referrer = isPlaceholderReferrer(traffic.referrer) ? null : nonEmpty(traffic.referrer);
  let referrerDomain = nonEmpty(traffic.referrer_domain);

  const orderedSessions = [...sessions].sort(
    (a, b) => new Date(String(a?.started_at ?? 0)).getTime() - new Date(String(b?.started_at ?? 0)).getTime(),
  );

  for (const session of orderedSessions) {
    if (!referrer && !isPlaceholderReferrer(session?.referrer)) {
      referrer = nonEmpty(session.referrer);
    }
    referrerDomain = referrerDomain || nonEmpty(session?.referrer_domain);
  }

  return {
    ...utm,
    referrer,
    referrer_domain: referrerDomain,
    show_referrer: Boolean(referrer),
    show_referrer_domain: Boolean(referrerDomain),
    show_utm_source: Boolean(utm.utm_source),
    show_utm_medium: Boolean(utm.utm_medium),
    show_utm_campaign: Boolean(utm.utm_campaign),
  };
}
