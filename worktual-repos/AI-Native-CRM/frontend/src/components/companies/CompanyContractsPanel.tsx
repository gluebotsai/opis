import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchCompanyContracts,
  type CompanyContractRow,
} from "@/services/sales";

export function CompanyContractsPanel({ companyId }: { companyId: string }) {
  const [items, setItems] = useState<CompanyContractRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const result = await fetchCompanyContracts(companyId);
    if (!result.ok) {
      setError(result.error);
      setItems([]);
      return;
    }
    setItems(result.items);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <p className="text-sm text-text-danger" role="alert">
        {error}
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-text-caption">No active contracts for this company.</p>
    );
  }

  return (
    <ul className="mx-auto max-w-6xl space-y-2 px-4 sm:px-6">
      {items.map((contract) => (
        <li
          key={contract.id}
          className="rounded-lg border border-border-default px-3 py-2 text-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium text-text-primary">{contract.title}</p>
              <p className="text-text-caption">
                Ends {contract.endsAt ? contract.endsAt.slice(0, 10) : "—"}
                {contract.arr != null ? ` · ARR ${contract.arr}` : ""}
              </p>
            </div>
            {contract.atRisk ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                At risk
              </span>
            ) : null}
          </div>
          {contract.renewDealId ? (
            <Link
              className="mt-1 inline-block text-text-link"
              to={`/sales/deals/${contract.renewDealId}`}
            >
              Renewal deal
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
