import { bouncePageForSession } from "./bounceRate.js";
import { CHANNEL_LABELS, classifyChannel, sourceLabel, } from "./trafficSource.js";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
const CLICK_ID_KEYS = ["gclid", "fbclid", "msclkid", "ttclid", "twclid", "gbraid", "wbraid", "li_fat_id"];
function emptyString(value) {
    if (value == null)
        return null;
    const text = String(value).trim();
    return text || null;
}
function referrerDomainFromReferrer(referrer) {
    if (!referrer)
        return null;
    try {
        return new URL(referrer).hostname.replace(/^www\./, "") || null;
    }
    catch {
        return null;
    }
}
function pickClickId(touch) {
    for (const key of CLICK_ID_KEYS) {
        const value = emptyString(touch[key]);
        if (value)
            return { type: key, value };
    }
    return { type: null, value: null };
}
function capturedAtFromTouch(touch) {
    const raw = touch.capturedAt;
    if (raw == null || raw === "")
        return null;
    const ms = Number(raw);
    if (!Number.isFinite(ms) || ms <= 0)
        return null;
    return new Date(ms).toISOString();
}
export function buildTouchFromRecord(input) {
    const touch = input ?? {};
    const referrer = emptyString(touch.referrer);
    const referrerDomain = emptyString(touch.referrer_domain) ??
        emptyString(touch.referrerDomain) ??
        referrerDomainFromReferrer(referrer);
    const utmSource = emptyString(touch.utm_source);
    const utmMedium = emptyString(touch.utm_medium);
    const utmCampaign = emptyString(touch.utm_campaign);
    const utmTerm = emptyString(touch.utm_term);
    const utmContent = emptyString(touch.utm_content);
    const clickId = pickClickId(touch);
    const channel = classifyChannel(referrer, referrerDomain, utmSource, utmMedium, utmCampaign);
    const label = sourceLabel(referrer, referrerDomain, utmSource, utmMedium, utmCampaign, channel);
    const hasUtm = UTM_KEYS.some((key) => emptyString(touch[key]));
    const hasAttribution = Boolean(hasUtm || clickId.value || referrer);
    return {
        channel,
        channel_label: CHANNEL_LABELS[channel] ?? label,
        source_label: label,
        referrer,
        referrer_domain: referrerDomain,
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
        utm_term: utmTerm,
        utm_content: utmContent,
        click_id: clickId.value,
        click_id_type: clickId.type,
        captured_at: capturedAtFromTouch(touch),
        has_attribution: hasAttribution,
    };
}
export function buildTouchFromSession(session) {
    if (!session)
        return buildTouchFromRecord(null);
    return buildTouchFromRecord({
        referrer: session.referrer,
        referrer_domain: session.referrer_domain,
        utm_source: session.utm_source,
        utm_medium: session.utm_medium,
        utm_campaign: session.utm_campaign,
        utm_term: session.utm_term,
        utm_content: session.utm_content,
    });
}
function parseCampaignJson(raw) {
    if (!raw)
        return null;
    if (typeof raw === "object" && !Array.isArray(raw))
        return raw;
    if (typeof raw !== "string")
        return null;
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "{}" || trimmed === "null")
        return null;
    try {
        const parsed = JSON.parse(trimmed);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
export function buildSourceJourney(sessions) {
    const ordered = [...sessions].sort((a, b) => new Date(String(a.started_at ?? 0)).getTime() - new Date(String(b.started_at ?? 0)).getTime());
    const steps = [];
    for (const session of ordered) {
        const touch = session.touch && typeof session.touch === "object"
            ? session.touch
            : buildTouchFromSession(session);
        const source_label = touch.source_label || touch.channel_label || "Unknown";
        const channel_label = touch.channel_label || "Unknown";
        const last = steps[steps.length - 1];
        if (last && last.source_label === source_label) {
            last.session_count += 1;
            continue;
        }
        steps.push({ source_label, channel_label, session_count: 1 });
    }
    const path_label = steps.length ? steps.map((s) => s.source_label).join(" → ") : "—";
    return { steps, path_label };
}
export function buildHybridTouch(firstTouch, lastTouch) {
    const sameChannel = firstTouch.channel === lastTouch.channel;
    const sameSource = firstTouch.source_label === lastTouch.source_label;
    const pathLabel = sameSource
        ? firstTouch.source_label
        : `${firstTouch.source_label} → ${lastTouch.source_label}`;
    let note = null;
    if (!firstTouch.has_attribution && !lastTouch.has_attribution) {
        note = "No campaign attribution was captured for this visitor.";
    }
    else if (sameChannel && sameSource) {
        note = "First and last touch are the same channel.";
    }
    else {
        note = "Visitor arrived via one channel and returned via another.";
    }
    return {
        model: "hybrid",
        same_channel: sameChannel,
        same_source: sameSource,
        path_label: pathLabel,
        first_channel_label: firstTouch.channel_label,
        last_channel_label: lastTouch.channel_label,
        note,
    };
}
export function buildSessionChannelMix(sessions) {
    const counts = new Map();
    for (const session of sessions) {
        const touch = buildTouchFromSession(session);
        const key = touch.channel || "unknown";
        const row = counts.get(key);
        if (row)
            row.sessions += 1;
        else {
            counts.set(key, {
                channel: key,
                channel_label: touch.channel_label,
                sessions: 1,
            });
        }
    }
    return [...counts.values()].sort((a, b) => b.sessions - a.sessions);
}
export function enrichSessionsWithTouch(sessions) {
    return sessions.map((session) => ({
        ...session,
        touch: buildTouchFromSession(session),
        bounce_page: bouncePageForSession(session),
    }));
}
export function buildVisitorTouchAttribution(campaignJson, sessions) {
    const campaign = parseCampaignJson(campaignJson);
    const firstFromCampaign = campaign?.firstTouch;
    const lastFromCampaign = campaign?.lastTouch;
    const orderedSessions = [...sessions].sort((a, b) => new Date(String(a.started_at ?? 0)).getTime() - new Date(String(b.started_at ?? 0)).getTime());
    const earliestSession = orderedSessions[0] ?? null;
    const latestSession = orderedSessions[orderedSessions.length - 1] ?? null;
    const firstFromProfile = firstFromCampaign && typeof firstFromCampaign === "object"
        ? buildTouchFromRecord(firstFromCampaign)
        : null;
    const lastFromProfile = lastFromCampaign && typeof lastFromCampaign === "object"
        ? buildTouchFromRecord(lastFromCampaign)
        : null;
    const firstFromSession = buildTouchFromSession(earliestSession);
    const lastFromSession = buildTouchFromSession(latestSession);
    const firstTouch = firstFromProfile?.has_attribution ? firstFromProfile : firstFromSession.has_attribution ? firstFromSession : firstFromProfile ?? firstFromSession;
    const lastTouch = lastFromProfile?.has_attribution ? lastFromProfile : lastFromSession.has_attribution ? lastFromSession : lastFromProfile ?? lastFromSession;
    let source = "session_fallback";
    if (firstFromProfile?.has_attribution && lastFromProfile?.has_attribution) {
        source = "campaign_profile";
    }
    else if (firstFromProfile?.has_attribution || lastFromProfile?.has_attribution) {
        source = "mixed";
    }
    return {
        first_touch: firstTouch,
        last_touch: lastTouch,
        hybrid_touch: buildHybridTouch(firstTouch, lastTouch),
        source_journey: buildSourceJourney(orderedSessions),
        source,
    };
}
