import { isAnonymousScopeCdpId } from "./guestUserProfile.js";
export function resolveSelectedCdpId(profiles, options) {
    if (!profiles.length)
        return null;
    const cdpId = String(options.cdpId ?? "").trim();
    if (cdpId) {
        const match = profiles.find((p) => p.cdp_id === cdpId);
        if (match)
            return match.cdp_id;
    }
    const userId = String(options.userId ?? "").trim();
    if (userId) {
        const upper = userId.toUpperCase();
        const match = profiles.find((p) => p.webtracking_user_id.toUpperCase() === upper || p.webtracking_user_id === userId);
        if (match)
            return match.cdp_id;
    }
    // Shared browser: default to Guest so anonymous (pre-login) activity by visitor_id / session_id
    // is visible. Pass ?cdp_id= or ?userId= to open a specific logged-in account.
    const anonymousFirst = profiles.find((p) => isAnonymousScopeCdpId(p.cdp_id));
    return anonymousFirst?.cdp_id ?? profiles[0]?.cdp_id ?? null;
}
