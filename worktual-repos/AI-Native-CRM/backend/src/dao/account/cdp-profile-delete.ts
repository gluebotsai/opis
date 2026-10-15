/**
 * Hard-delete cdp.customer_profile when nothing in shared CDP still
 * references it. CRM must not ALTER CDP FKs (gold_customer_metrics, etc.).
 */
import { accountQuery } from "@/dao/db/account-pool";

export function isCdpFkViolation(err: unknown): boolean {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";
  const message = err instanceof Error ? err.message : String(err ?? "");
  return (
    code === "23503" ||
    /gold_customer_metrics|violates foreign key constraint/i.test(message)
  );
}

async function listCdpChildTables(): Promise<
  Array<{ table_schema: string; table_name: string }>
> {
  const { rows } = await accountQuery<{ table_schema: string; table_name: string }>(
    `SELECT DISTINCT tc.table_schema, tc.table_name
     FROM information_schema.table_constraints AS tc
     JOIN information_schema.key_column_usage AS kcu
       ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage AS ccu
       ON ccu.constraint_name = tc.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND ccu.table_schema = 'cdp'
       AND ccu.table_name = 'customer_profile'
       AND tc.table_name <> 'identity_keys'
     ORDER BY 1, 2`,
  );
  return rows;
}

async function deleteCdpChildRows(cdpId: string): Promise<void> {
  const id = cdpId.trim();
  if (!id) return;
  const childTables = await listCdpChildTables();
  const extra = [{ table_schema: "public", table_name: "activation_tasks" }];
  const seen = new Set<string>();

  for (const { table_schema, table_name } of [...childTables, ...extra]) {
    const key = `${table_schema}.${table_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const qualified = `${table_schema}.${table_name}`;
    try {
      await accountQuery(`DELETE FROM ${qualified} WHERE cdp_id = $1::text`, [id]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/column "cdp_id" does not exist/i.test(msg)) continue;
      throw err;
    }
  }
}

/** Remove CDP child FK rows, then customer_profile (+ identity_keys cascade). */
export async function purgeCdpCustomerProfile(cdpId: string): Promise<void> {
  const id = cdpId.trim();
  if (!id) throw new Error("Contact id is required.");
  await deleteCdpChildRows(id);
  try {
    await accountQuery(
      `DELETE FROM cdp.customer_profile WHERE cdp_id = $1::text`,
      [id],
    );
  } catch (err) {
    if (isCdpFkViolation(err)) {
      throw new Error(
        "Could not fully delete this contact — shared platform data still references them. " +
          "Contact your administrator if this persists.",
      );
    }
    throw err;
  }
}

/** @returns true when the CDP person row was removed. */
export async function tryDeleteCdpCustomerProfile(
  cdpId: string,
): Promise<boolean> {
  try {
    await purgeCdpCustomerProfile(cdpId);
    return true;
  } catch (err) {
    if (isCdpFkViolation(err)) {
      console.warn(
        "cdp.customer_profile kept — shared CDP still references this person",
        cdpId,
      );
      return false;
    }
    throw err;
  }
}
