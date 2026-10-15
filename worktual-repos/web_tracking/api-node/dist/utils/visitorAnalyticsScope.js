export function normalizeVisitorIdList(primaryVisitorId, linkedIds) {
    const primary = String(primaryVisitorId ?? "").trim();
    const linked = Array.isArray(linkedIds)
        ? linkedIds.map((id) => String(id).trim()).filter(Boolean)
        : [];
    const combined = [...new Set([primary, ...linked].filter(Boolean))];
    return combined.length ? combined : primary ? [primary] : [];
}
export function resolveVisitorAnalyticsScope(primaryVisitorId, cdpProfile, options) {
    const primary = String(primaryVisitorId).trim();
    const linkedProfiles = options?.linkedCdpProfiles ?? (cdpProfile ? [cdpProfile] : []);
    const distinctProfiles = linkedProfiles.filter((p) => p?.cdp_id);
    const uniqueByCdp = distinctProfiles.filter((p, i, arr) => arr.findIndex((x) => x.cdp_id === p.cdp_id) === i);
    if (uniqueByCdp.length > 1) {
        const selected = uniqueByCdp.find((p) => p.cdp_id === options?.selectedCdpId) ??
            uniqueByCdp[0] ??
            null;
        return {
            scope: "multi_account_browser",
            primary_visitor_id: primary,
            combined_visitor_ids: [primary],
            linked_cdp_profiles: uniqueByCdp,
            selected_cdp_id: selected?.cdp_id ?? null,
            filter_user_id: selected?.webtracking_user_id ?? "",
        };
    }
    const combined = normalizeVisitorIdList(primaryVisitorId, cdpProfile?.linked_visitor_ids);
    return {
        scope: combined.length > 1 ? "cdp_linked" : "single",
        primary_visitor_id: primary,
        combined_visitor_ids: combined,
        linked_cdp_profiles: distinctProfiles,
        selected_cdp_id: cdpProfile?.cdp_id ?? null,
        filter_user_id: "",
    };
}
export function analyticsFilterFromScope(scope) {
    return {
        visitorIds: scope.combined_visitor_ids,
        filterUserId: scope.scope === "multi_account_browser" ? scope.filter_user_id : "",
    };
}
