"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  ConfirmDeleteButton,
  type ConfirmDeleteResult,
} from "@/components/ui/ConfirmDeleteButton";
import {
  campaignCannotDeleteMessage,
  campaignDeleteLockedStatusLabel,
  isCampaignDeleteLocked,
  type CampaignDraftStatus,
} from "@/lib/campaign-drafts";

/**
 * Drafts: confirm + delete. Live / scheduled / past: same trash control,
 * but an info dialog — the campaign is not removed.
 */
export function CampaignDraftDeleteControl({
  name,
  status,
  onConfirm,
}: {
  name: string;
  status: CampaignDraftStatus;
  onConfirm: () => Promise<ConfirmDeleteResult>;
}) {
  if (!isCampaignDeleteLocked(status)) {
    return (
      <ConfirmDeleteButton
        name={name}
        entityLabel="draft"
        compact
        consequence="This permanently removes the draft conversation."
        onConfirm={onConfirm}
      />
    );
  }
  return <CannotDeleteCampaignButton name={name} status={status} />;
}

function CannotDeleteCampaignButton({
  name,
  status,
}: {
  name: string;
  status: CampaignDraftStatus;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const okRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const statusName = campaignDeleteLockedStatusLabel(status);
  const message = campaignCannotDeleteMessage(status);

  useEffect(() => {
    if (!open) return;
    okRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex size-7 items-center justify-center rounded-full text-text-caption hover:bg-subtle hover:text-text-primary"
        aria-label={`Cannot delete ${name} (${statusName})`}
        title={`Cannot delete — ${statusName}`}
      >
        <Trash2 className="size-3.5" strokeWidth={1.75} />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="w-full max-w-md overflow-hidden rounded-2xl border border-border-default border-l-[3px] border-l-[#e54d4d] bg-surface shadow-lg"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="px-5 pt-5 sm:px-6 sm:pt-6">
              <div className="flex gap-4">
                <div
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-red-50 text-[#e54d4d]"
                  aria-hidden
                >
                  <Info className="size-5" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <h2
                    id={titleId}
                    className="text-base font-semibold text-text-primary"
                  >
                    Cannot delete
                  </h2>
                  <p
                    id={descriptionId}
                    className="mt-1.5 text-sm leading-relaxed text-text-caption"
                  >
                    <span className="font-medium text-text-primary">{name}</span>
                    {" — "}
                    {message}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex justify-end px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
              <Button
                ref={okRef}
                type="button"
                variant="primary"
                className="bg-[#e54d4d] text-white hover:bg-[#d44343]"
                onClick={() => setOpen(false)}
              >
                OK
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
