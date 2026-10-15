export class RollbackIntegrationTest extends Error {
  constructor(message = "rollback integration test") {
    super(message);
    this.name = "RollbackIntegrationTest";
  }
}

type DbClient = Parameters<
  Parameters<typeof import("@ai-contact-center/db-cc").ccPrisma.$transaction>[0]
>[0];

export async function runRollbackIntegration<T>(
  fn: (db: DbClient) => Promise<T>,
  options: { timeout?: number } = {},
): Promise<T | null> {
  try {
    return await import("@ai-contact-center/db-cc").then(({ ccPrisma }) =>
      ccPrisma.$transaction(
        async (db) => {
          await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
          await fn(db as DbClient);
          throw new RollbackIntegrationTest();
        },
        { timeout: options.timeout ?? 30_000 },
      ),
    );
  } catch (error) {
    if (error instanceof RollbackIntegrationTest) {
      return null;
    }
    throw error;
  }
}

export type { DbClient };
