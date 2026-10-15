import { resolveCityForSession } from "./cityGeoUtils.js";
import { countryName } from "./geographyUtils.js";
import { CHANNEL_LABELS, classifyChannel, sourceLabel, } from "./trafficSource.js";
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/;
export function maskIp(ip) {
    if (!ip || typeof ip !== "string")
        return null;
    const trimmed = ip.trim();
    if (!trimmed)
        return null;
    if (trimmed.includes(":")) {
        const parts = trimmed.split(":").filter(Boolean);
        if (parts.length >= 2)
            return `${parts.slice(0, 4).join(":")}:****`;
        return "****";
    }
    const match = IPV4.exec(trimmed);
    if (match)
        return `${match[1]}.${match[2]}.${match[3]}.***`;
    return null;
}
export function ipFromGeoData(geoData) {
    const geo = parseGeoData(geoData);
    if (!geo)
        return null;
    const ip = geo.ip;
    return typeof ip === "string" ? ip : null;
}
function parseGeoData(geoData) {
    if (!geoData)
        return null;
    if (typeof geoData === "object" && !Array.isArray(geoData)) {
        return geoData;
    }
    if (typeof geoData !== "string")
        return null;
    const trimmed = geoData.trim();
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
function geoNumber(value) {
    if (value == null || value === "")
        return null;
    const num = Number(value);
    return Number.isFinite(num) && num !== 0 ? num : null;
}
export function formatBrowserLabel(browser, version) {
    if (browser && version)
        return `${browser} ${version}`;
    return browser ?? version ?? null;
}
export function buildDeviceSummary(sessionRow) {
    if (!sessionRow) {
        return {
            browser: null,
            browser_version: null,
            browser_label: null,
            os: null,
            device: null,
            language: null,
            timezone: null,
            user_agent: null,
        };
    }
    const browser = sessionRow.browser;
    const version = sessionRow.browser_version;
    return {
        browser: browser ?? null,
        browser_version: version ?? null,
        browser_label: formatBrowserLabel(browser, version),
        os: sessionRow.platform ?? null,
        device: sessionRow.device ?? null,
        language: sessionRow.language ?? null,
        timezone: sessionRow.timezone ?? null,
        user_agent: sessionRow.user_agent ?? null,
    };
}
export function buildLocationSummary(sessionRow, visitorCountry) {
    let countryCode = null;
    let city = null;
    let region = null;
    let ipMasked = null;
    let latitude = null;
    let longitude = null;
    let timezone = null;
    let locationSource = null;
    let accuracyMeters = null;
    let altitude = null;
    if (sessionRow) {
        const geo = parseGeoData(sessionRow.geo_data);
        if (geo) {
            const gps = geo.gps ?? null;
            const isGps = geo.location_source === "gps" || geo.source === "gps" || Boolean(gps);
            countryCode =
                sessionRow.country ??
                    geo.country ??
                    visitorCountry ??
                    null;
            city = resolveCityForSession(sessionRow, geo);
            region =
                sessionRow.region ??
                    geo.regionName ??
                    geo.region ??
                    null;
            timezone = geo.timezone ?? null;
            ipMasked = maskIp(ipFromGeoData(geo));
            if (isGps) {
                locationSource = "gps";
                latitude =
                    geoNumber(gps?.latitude) ??
                        geoNumber(geo.latitude);
                longitude =
                    geoNumber(gps?.longitude) ??
                        geoNumber(geo.longitude);
                accuracyMeters = geoNumber(gps?.accuracy) ?? geoNumber(geo.accuracy);
                altitude = geoNumber(gps?.altitude) ?? geoNumber(geo.altitude);
            }
            else {
                locationSource = "ip";
                latitude =
                    geoNumber(sessionRow.latitude) ??
                        geoNumber(geo.latitude) ??
                        geoNumber(geo.lat);
                longitude =
                    geoNumber(sessionRow.longitude) ??
                        geoNumber(geo.longitude) ??
                        geoNumber(geo.lon);
            }
        }
        else {
            countryCode = sessionRow.country ?? visitorCountry ?? null;
            city = resolveCityForSession(sessionRow, null);
            region = sessionRow.region ?? null;
            latitude = geoNumber(sessionRow.latitude);
            longitude = geoNumber(sessionRow.longitude);
            locationSource = latitude != null && longitude != null ? "ip" : null;
        }
    }
    else {
        countryCode = visitorCountry ?? null;
    }
    const hasCoordinates = latitude != null && longitude != null;
    const isGps = locationSource === "gps";
    return {
        country: countryCode,
        country_name: countryCode ? countryName(countryCode) : null,
        city: city ?? "Unknown",
        region,
        ip_masked: ipMasked,
        latitude,
        longitude,
        timezone,
        location_source: locationSource,
        location_source_label: isGps ? "GPS (precise)" : locationSource === "ip" ? "IP (approximate)" : null,
        accuracy_meters: accuracyMeters,
        altitude,
        accuracy_note: isGps
            ? `Precise browser location (±${Math.round(accuracyMeters ?? 0)}m accuracy).`
            : hasCoordinates
                ? "Approximate city-level location from IP address (not GPS)."
                : "Location estimated from IP address. Enable browser geolocation in the SDK for precise coordinates.",
    };
}
function parseUtmFromPath(path) {
    if (!path || !path.includes("?"))
        return {};
    const query = path.split("?").slice(1).join("?");
    const params = new URLSearchParams(query);
    const out = {};
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
        const value = params.get(key);
        if (value)
            out[key] = value;
    }
    return out;
}
export function buildVisitorTrafficSource(sessions, journey = [], topPages = []) {
    const ordered = [...sessions].sort((a, b) => new Date(String(a.started_at ?? 0)).getTime() - new Date(String(b.started_at ?? 0)).getTime());
    const first = ordered[0] ?? sessions[0] ?? null;
    let referrer = first?.referrer ?? null;
    let referrerDomain = first?.referrer_domain ?? null;
    let utmSource = first?.utm_source ?? null;
    let utmMedium = first?.utm_medium ?? null;
    let utmCampaign = first?.utm_campaign ?? null;
    let utmTerm = first?.utm_term ?? null;
    let utmContent = first?.utm_content ?? null;
    const paths = [
        first?.entry_page,
        ...journey.map((step) => step.page_path),
        ...topPages.map((page) => page.page_path),
    ].filter(Boolean);
    for (const path of paths) {
        const utm = parseUtmFromPath(path);
        utmSource = utmSource || utm.utm_source || null;
        utmMedium = utmMedium || utm.utm_medium || null;
        utmCampaign = utmCampaign || utm.utm_campaign || null;
        utmTerm = utmTerm || utm.utm_term || null;
        utmContent = utmContent || utm.utm_content || null;
    }
    if ((!referrer || referrer === "direct") && referrerDomain) {
        referrer = referrerDomain.startsWith("http") ? referrerDomain : `https://${referrerDomain}/`;
    }
    const row = {
        session_id: String(first?.session_id ?? ""),
        visitor_id: "",
        referrer,
        referrer_domain: referrerDomain,
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
    };
    const channel = classifyChannel(referrer, referrerDomain, utmSource, utmMedium, utmCampaign);
    const label = sourceLabel(referrer, referrerDomain, utmSource, utmMedium, utmCampaign, channel);
    const hasUtm = Boolean(utmSource || utmMedium || utmCampaign || utmTerm || utmContent);
    return {
        channel,
        channel_label: CHANNEL_LABELS[channel] ?? label,
        source_label: label,
        referrer: referrer && referrer !== "direct" ? referrer : null,
        referrer_domain: referrerDomain || null,
        landing_page: first?.entry_page ?? null,
        utm_source: utmSource || null,
        utm_medium: utmMedium || null,
        utm_campaign: utmCampaign || null,
        utm_term: utmTerm || null,
        utm_content: utmContent || null,
        utm_captured: hasUtm,
        utm_note: hasUtm ? null : "No UTM parameters were captured for this visitor.",
    };
}
const JOURNEY_REPEAT_WINDOW_MS = 2 * 60 * 1000;
function journeyTimestamp(step) {
    if (!step.created_at)
        return 0;
    const ms = new Date(step.created_at).getTime();
    return Number.isFinite(ms) ? ms : 0;
}
function preferJourneyTitle(current, candidate) {
    const currentTitle = (current.page_title ?? "").trim();
    const candidateTitle = (candidate.page_title ?? "").trim();
    if (candidateTitle.length > currentTitle.length) {
        return { ...current, page_title: candidateTitle };
    }
    return current;
}
/**
 * Collapse rapid re-tracking of the same page (new session / duplicate events within ~2 minutes).
 * Keeps distinct revisits when the visitor navigates away and returns later.
 */
export function collapseJourneySteps(steps) {
    if (!steps.length)
        return [];
    const sorted = [...steps].sort((a, b) => journeyTimestamp(a) - journeyTimestamp(b));
    const out = [];
    for (const step of sorted) {
        const path = step.page_path ?? "";
        const prev = out[out.length - 1];
        if (prev && (prev.page_path ?? "") === path) {
            const delta = journeyTimestamp(step) - journeyTimestamp(prev);
            if (delta >= 0 && delta < JOURNEY_REPEAT_WINDOW_MS) {
                out[out.length - 1] = preferJourneyTitle(prev, step);
                continue;
            }
        }
        out.push({ ...step });
    }
    return out;
}
