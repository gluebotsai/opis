import { ImageOff, X } from "lucide-react";
import { useEffect, useState } from "react";

import { IconButton } from "@/components/ui/button";
import { ProfileDetailList, ProfileDetailRow } from "@/components/ui/profile-detail-row";
import type { CustomerOrder } from "@/features/workspace/types";

function orderLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatOrderMoney(amount: string, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return amount;
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function BrokenOrderImage() {
  return (
    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-400">
      <ImageOff className="size-[18px]" strokeWidth={2.25} aria-hidden="true" />
    </span>
  );
}

function OrderLineImage({ src, onOpen }: { src: string | null; onOpen: (src: string) => void }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <BrokenOrderImage />;
  return (
    <button
      type="button"
      className="shrink-0 cursor-pointer rounded-md"
      aria-label="View larger product image"
      onClick={() => onOpen(src)}
    >
      <img
        src={src}
        alt=""
        className="size-10 rounded-md object-cover"
        onError={() => setFailed(true)}
      />
    </button>
  );
}

export function formatOrderDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatOrderDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = formatOrderDate(iso);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .replace(/\s*am$/i, " AM")
    .replace(/\s*pm$/i, " PM");
  return `${day}, ${time}`;
}

export function WorkspaceCustomerOrderDialog({
  order,
  onClose,
}: {
  order: CustomerOrder | null;
  onClose: () => void;
}) {
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  useEffect(() => {
    setPreviewSrc(null);
  }, [order?.id]);

  useEffect(() => {
    if (!order) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (previewSrc) {
        setPreviewSrc(null);
        return;
      }
      onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, order, previewSrc]);

  if (!order) return null;

  const total = formatOrderMoney(order.totalAmount, order.currency);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close order details"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[min(85vh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b-[0.6px] border-[#bfbfbf] px-6 py-5">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-neutral-900">{order.orderNumber}</h2>
            <p className="mt-1 text-sm text-neutral-600">
              {formatOrderDate(order.createdAt)} · {total}
            </p>
          </div>
          <IconButton variant="ghostIcon" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <ProfileDetailList>
            <ProfileDetailRow label="Status">{orderLabel(order.status)}</ProfileDetailRow>
            <ProfileDetailRow label="Payment">{orderLabel(order.paymentStatus)}</ProfileDetailRow>
            {order.fulfillmentStatus ? (
              <ProfileDetailRow label="Fulfillment">{orderLabel(order.fulfillmentStatus)}</ProfileDetailRow>
            ) : null}
            <ProfileDetailRow label="Total">{total}</ProfileDetailRow>
            <ProfileDetailRow label="Date">{formatOrderDate(order.createdAt)}</ProfileDetailRow>
            {order.tracking ? <ProfileDetailRow label="Tracking">{order.tracking}</ProfileDetailRow> : null}
            {order.courier ? <ProfileDetailRow label="Courier">{order.courier}</ProfileDetailRow> : null}
            {order.deliveryStatus ? (
              <ProfileDetailRow label="Delivery">{orderLabel(order.deliveryStatus)}</ProfileDetailRow>
            ) : null}
            {order.deliveryDate ? (
              <ProfileDetailRow label="Delivery date">{order.deliveryDate}</ProfileDetailRow>
            ) : null}
            {order.address ? <ProfileDetailRow label="Address">{order.address}</ProfileDetailRow> : null}
          </ProfileDetailList>
          {order.lines.length > 0 ? (
            <div
              className={`rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-3${
                order.lines.length > 4 ? " max-h-[252px] overflow-y-auto overscroll-contain" : ""
              }`}
            >
              {order.lines.map((line, index) => (
                <div
                  key={`${line.sku ?? line.name}-${index}`}
                  className="flex items-start gap-3 border-b-[0.6px] border-[#e5e5e5] py-2.5 last:border-b-0"
                >
                  <OrderLineImage src={line.imageUrl} onOpen={setPreviewSrc} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 text-sm font-semibold break-words text-neutral-900">{line.name}</p>
                      <span className="shrink-0 text-sm font-semibold text-neutral-900">
                        {line.quantity} × {formatOrderMoney(line.unitPrice, order.currency)}
                      </span>
                    </div>
                    {line.sku ? <p className="mt-0.5 text-sm text-neutral-600">{line.sku}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {order.orderUrl ? (
            <a
              href={order.orderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-sm font-medium text-neutral-900 underline underline-offset-2"
            >
              Open order
            </a>
          ) : null}
        </div>
      </div>
      {previewSrc ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close product image"
            onClick={() => setPreviewSrc(null)}
          />
          <div className="relative z-10">
            <img
              src={previewSrc}
              alt=""
              className="max-h-[80vh] max-w-[min(90vw,720px)] rounded-xl bg-white object-contain"
            />
            <button
              type="button"
              aria-label="Close"
              onClick={() => setPreviewSrc(null)}
              className="absolute top-3 right-3 inline-flex size-[38px] items-center justify-center rounded-full border-[0.6px] border-[#bfbfbf] bg-white text-neutral-900"
            >
              <X className="size-[18px]" strokeWidth={2.25} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
