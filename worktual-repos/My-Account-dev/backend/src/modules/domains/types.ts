export type MigrationState = "fastify" | "legacy" | "hybrid";

export interface DomainOwnership {
  domain: string;
  prefixes: readonly string[];
  owner:
    "platform" | "identity" | "accounts" | "sales" | "finance" | "operations";
  state: MigrationState;
  notes: string;
}
