export function isPostgresDeadlock(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const details = error as Error & {
    code?: string;
    meta?: { code?: string; message?: string };
  };
  const code = details.code ?? details.meta?.code;
  if (code === "40P01") return true;
  return /deadlock detected/i.test(`${details.message} ${details.meta?.message ?? ""}`);
}

export async function sleepMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
