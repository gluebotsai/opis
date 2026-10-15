import type { Redis } from "ioredis";
export type OnboardingCodePayload = {
    userId: number;
    organizationId: number;
    websiteId: number;
};
export declare function generateOnboardingCode(): string;
export declare function storeOnboardingCode(redis: Redis | null, code: string, payload: OnboardingCodePayload): Promise<void>;
export declare function consumeOnboardingCode(redis: Redis | null, code: string): Promise<OnboardingCodePayload | null>;
