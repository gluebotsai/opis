import type { VisitorCdpProfile } from "./visitorCdpProfile.js";
export declare function resolveSelectedCdpId(profiles: VisitorCdpProfile[], options: {
    cdpId?: string | null;
    userId?: string | null;
}): string | null;
