import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import {
  createRenewalQuoteForContract,
  fetchDealContracts,
  type DealContractRow,
} from "@/services/sales";

export function DealContractsPanel({ dealId }: { dealId: string }) {
  const [items, setItems] = useState<DealContractRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const result = await fetchDealContracts(dealId);
    if (!result.ok) {
      setError(result.error);
      setItems([]);
      return;
    }
    setItems(result.items);
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRenewalQuote = async (contractId: string) => {
    setBusyId(contractId);
    const result = await createRenewalQuoteForContract(contractId);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await load();
  };

  if (error) {
    return (
      <p className="text-sm text-text-danger" role="alert">
        {error}
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-text-caption">
        No contracts linked to this deal yet.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((contract) => (
        <li
          key={contract.id}
          className="rounded-lg border border-border-default p-3 text-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium text-text-primary">{contract.title}</p>
              <p className="text-text-caption">
                {contract.startsAt.slice(0, 10)} →{" "}
                {contract.endsAt ? contract.endsAt.slice(0, 10) : "—"}
                {contract.arr != null ? ` · ARR ${contract.arr}` : ""}
              </p>
              <p className="text-text-caption">
                Status: {contract.status}
                {contract.autoRenew ? " · auto-renew" : ""}
              </p>
              {contract.renewDealId === dealId ? (
                <p className="mt-1 text-text-secondary">Renewal deal</p>
              ) : null}
            </div>
            {contract.renewDealId === dealId ? (
              <Button
                variant="secondary"
                disabled={busyId === contract.id}
                onClick={() => void onRenewalQuote(contract.id)}
              >
                Create renewal quote
              </Button>
            ) : null}
          </div>
          {contract.renewDealId && contract.renewDealId !== dealId ? (
            <Link
              className="mt-2 inline-block text-text-link"
              to={`/sales/deals/${contract.renewDealId}`}
            >
              Open renewal deal
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
