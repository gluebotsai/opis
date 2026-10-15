import fp from "fastify-plugin";
import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";

export interface TenantContext {
  isStaff: boolean;
  organizationId?: string;
  userId?: string;
  role?: string;
}

export interface RlsClient {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export type RlsTransaction = <T>(
  context: TenantContext,
  operation: (client: RlsClient) => Promise<T>,
) => Promise<T>;

async function setRlsContext(
  client: PoolClient,
  context: TenantContext,
): Promise<void> {
  await client.query(
    `select
       set_config('app.is_staff', $1, true),
       set_config('app.organization_id', $2, true),
       set_config('app.user_id', $3, true),
       set_config('app.role', $4, true)`,
    [
      context.isStaff ? "true" : "false",
      context.organizationId ?? "",
      context.userId ?? "",
      context.role ?? "",
    ],
  );
}

export default fp(
  async (app) => {
    const options: PoolConfig = {
      connectionString: app.config.DATABASE_URL,
      max: app.config.DATABASE_POOL_MAX,
      application_name: "my-accounts-api",
      ...(app.config.DATABASE_SSL ? { ssl: { rejectUnauthorized: true } } : {}),
    };
    const pool = new Pool(options);

    const withRlsTransaction: RlsTransaction = async (context, operation) => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await setRlsContext(client, context);
        const result = await operation(client);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    };

    app.decorate("pg", pool);
    app.decorate("withRlsTransaction", withRlsTransaction);
    app.addHook("onClose", async () => pool.end());
  },
  { name: "postgres" },
);
