import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { convertLeadCtaLabel, showConvertLeadCta } from "@/lib/business-type-copy";
import { defaultDealTitle } from "@/lib/default-deal-title";
import type { BusinessType } from "@/config/modules";
import { convertLead } from "@/services/contacts";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function ConvertLeadButton({
  contactId,
  contactName,
  companyName,
  leadStatus,
  businessType,
  compact = false,
  menuItem = false,
  opened = false,
  hideButton = false,
  onDismiss,
}: {
  contactId: string;
  contactName?: string;
  companyName?: string;
  leadStatus?: string | null;
  businessType: BusinessType;
  compact?: boolean;
  /** Row inside the header More menu. Dialog is portaled so the menu can close. */
  menuItem?: boolean;
  /** Open the convert dialog from a parent CTA. */
  opened?: boolean;
  hideButton?: boolean;
  onDismiss?: () => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const seenOpen = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dealTitle, setDealTitle] = useState(
    defaultDealTitle({ contactName, companyName }),
  );
  const [amount, setAmount] = useState("");
  const isQualified = leadStatus === "qualified";
  useEffect(() => {
    if (opened && !seenOpen.current && isQualified) setOpen(true);
    seenOpen.current = opened;
  }, [opened, isQualified]);

  if (!showConvertLeadCta(businessType)) {
    return null;
  }
  const cta = convertLeadCtaLabel(businessType);

  const onConvert = () => {
    if (!isQualified) {
      setError("Set lead status to Qualified before converting.");
      return;
    }
    setError(null);
    const parsed = amount.trim() === "" ? null : Number.parseFloat(amount);
    if (amount.trim() && (parsed === null || Number.isNaN(parsed))) {
      setError("Enter a valid amount or leave blank.");
      return;
    }
    setPending(true);
    void convertLead(contactId, {
      dealTitle: dealTitle.trim() || undefined,
      amount: parsed,
    }).then((result) => {
      setPending(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      navigate(`/sales/${result.dealId}`);
    });
  };

  const dialog = open
    ? createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-md rounded-xl border border-border-default bg-surface p-5 shadow-lg">
            <h2 className="text-base font-semibold text-text-primary">
              Convert lead to deal
            </h2>
            <p className="mt-1 text-sm text-text-caption">
              Creates a pipeline deal and marks this lead converted.
            </p>
            <div className="mt-4 space-y-3">
              <Input
                label="Deal title"
                value={dealTitle}
                onChange={(e) => setDealTitle(e.target.value)}
                placeholder="Opportunity name"
              />
              <Input
                label="Amount (optional)"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 12000"
              />
            </div>
            {error ? <p className="mt-3 text-sm text-text-danger">{error}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  setError(null);
                  onDismiss?.();
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" disabled={pending} onClick={onConvert}>
                {pending ? "Converting…" : "Create deal"}
              </Button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  const openConvert = () => {
    if (!isQualified) return;
    setError(null);
    setOpen(true);
  };

  if (hideButton) return dialog;

  if (menuItem) {
    return (
      <>
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center px-3 py-2 text-left text-sm text-text-primary hover:bg-subtle disabled:cursor-not-allowed disabled:text-text-caption"
          disabled={pending || !isQualified}
          title={
            isQualified
              ? undefined
              : "Set lead status to Qualified before converting"
          }
          onClick={openConvert}
        >
          {cta}
        </button>
        {dialog}
      </>
    );
  }

  return (
    <div
      className={
        compact ? "inline-flex flex-col items-end gap-1" : "flex flex-col gap-1"
      }
    >
      <Button
        type="button"
        variant={compact ? "secondary" : "primary"}
        className={compact ? "h-8 px-3 text-xs" : ""}
        disabled={pending || !isQualified}
        title={
          isQualified ? undefined : "Set lead status to Qualified before converting"
        }
        onClick={openConvert}
      >
        <ArrowUpRight className="size-3.5" strokeWidth={2} />
        {cta}
      </Button>
      {!isQualified && !compact ? (
        <p className="max-w-[14rem] text-right text-[11px] text-text-caption">
          Qualify the lead first (status → Qualified).
        </p>
      ) : null}
      {error && !open ? <p className="text-xs text-text-danger">{error}</p> : null}
      {dialog}
    </div>
  );
}
