import { visitorsRepository } from "../repositories/clickhouse/visitorsRepository.js";
import { buildAnonymousScopeProfile } from "../utils/guestUserProfile.js";
import { buildVisitorCdpProfile, enrichWeakProfileFromKnownUserIdentity, isWeakKnownProfileLabel, profileDisplayLabel, } from "../utils/visitorCdpProfile.js";
export function sessionDisplayMapKey(key) {
    return `${String(key.session_id).trim()}\0${String(key.visitor_id).trim()}`;
}
function sessionKeyId(key) {
    return sessionDisplayMapKey(key);
}
/** Profile label for one browser session (logged in this session, else Anonymous). */
export function sessionDisplayProfileOrAnonymous(row, visitorId) {
    const profile = buildVisitorCdpProfile(row, visitorId);
    return profile ?? buildAnonymousScopeProfile();
}
export async function resolveSessionDisplayProfiles(client, websiteId, organizationId, keys) {
    const out = new Map();
    const deduped = [];
    const seen = new Set();
    for (const key of keys) {
        const sessionId = String(key.session_id ?? "").trim();
        const visitorId = String(key.visitor_id ?? "").trim();
        if (!sessionId || !visitorId)
            continue;
        const id = sessionKeyId({ session_id: sessionId, visitor_id: visitorId });
        if (seen.has(id))
            continue;
        seen.add(id);
        deduped.push({ session_id: sessionId, visitor_id: visitorId });
    }
    if (!deduped.length)
        return out;
    if (organizationId <= 0) {
        for (const key of deduped) {
            out.set(sessionKeyId(key), buildAnonymousScopeProfile());
        }
        return out;
    }
    const rows = await visitorsRepository.getSessionDisplayProfileRowsByKeys(client, websiteId, organizationId, deduped);
    const weakUserIds = new Set();
    for (const key of deduped) {
        const row = rows.get(sessionKeyId(key)) ?? null;
        let profile = sessionDisplayProfileOrAnonymous(row, key.visitor_id);
        const uid = String(profile.webtracking_user_id ?? "").trim();
        if (profile.is_cdp_known && uid && isWeakKnownProfileLabel(profileDisplayLabel(profile))) {
            weakUserIds.add(uid);
        }
        out.set(sessionKeyId(key), profile);
    }
    if (weakUserIds.size > 0) {
        const identityByUserId = await visitorsRepository.fetchKnownUserIdentityByUserIds(client, websiteId, [...weakUserIds]);
        for (const key of deduped) {
            const id = sessionKeyId(key);
            const profile = out.get(id);
            if (!profile?.is_cdp_known)
                continue;
            const uid = String(profile.webtracking_user_id ?? "").trim();
            const identity = uid ? identityByUserId.get(uid) : undefined;
            if (!identity)
                continue;
            const enriched = enrichWeakProfileFromKnownUserIdentity(profile, key.visitor_id, websiteId, identity) ??
                profile;
            out.set(id, enriched);
        }
    }
    return out;
}
export function pickLiveSessionIdForVisitor(liveSessions) {
    const byVisitor = new Map();
    for (const row of liveSessions) {
        const visitorId = String(row.visitor_id ?? "").trim();
        const sessionId = String(row.session_id ?? "").trim();
        if (!visitorId || !sessionId)
            continue;
        if (!byVisitor.has(visitorId)) {
            byVisitor.set(visitorId, sessionId);
        }
    }
    return byVisitor;
}
