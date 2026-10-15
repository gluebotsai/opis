/**
 * Parse dim_known_users.traits_json or identify/login props for display fields.
 */
export declare function parseTraitsJson(raw: unknown): Record<string, unknown>;
export interface ParsedIdentityTraits {
    firstName: string;
    lastName: string;
    fullName: string;
    email: string;
    phone: string;
    method: string;
}
export declare function parseIdentityFromTraitsJson(raw: unknown): ParsedIdentityTraits;
/** Shown when no name/email in CDP row (never generic "User"). */
export declare function customerLabelFromUserId(userId: string): string;
export declare function isGenericContactType(contactType: string): boolean;
/** Fallback labels like "Customer · cmujh38m…" — not a real account name. */
export declare function isObfuscatedCustomerLabel(label: string): boolean;
