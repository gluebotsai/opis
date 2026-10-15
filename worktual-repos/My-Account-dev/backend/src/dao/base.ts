import type { QueryResultRow } from "pg";
import type { RlsClient, TenantContext } from "../plugins/postgres.js";

export abstract class TenantDao {
  protected constructor(
    protected readonly withTenant: <T>(
      context: TenantContext,
      operation: (client: RlsClient) => Promise<T>,
    ) => Promise<T>,
  ) {}

  protected query<Row extends QueryResultRow>(
    context: TenantContext,
    text: string,
    values: unknown[] = [],
  ) {
    return this.withTenant(context, (client) =>
      client.query<Row>(text, values),
    );
  }
}
