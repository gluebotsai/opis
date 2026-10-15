/**
 * Shared list-page highlight when returning from a co-worker create flow.
 */
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

export function useCreateHighlight(opts?: {
  param?: string;
  flashMs?: number;
  toastMs?: number;
}) {
  const param = opts?.param ?? "highlight";
  const flashMs = opts?.flashMs ?? 4200;
  const toastMs = opts?.toastMs ?? 3500;
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightId = searchParams.get(param);
  const [highlightFlash, setHighlightFlash] = useState<string | null>(null);
  const [createdToast, setCreatedToast] = useState(false);
  const handled = useRef<string | null>(null);
  const paramsRef = useRef(searchParams);
  paramsRef.current = searchParams;
  const setParamsRef = useRef(setSearchParams);
  setParamsRef.current = setSearchParams;

  useEffect(() => {
    if (!highlightId) return;
    if (handled.current === highlightId) return;
    handled.current = highlightId;
    setHighlightFlash(highlightId);
    setCreatedToast(true);
    const scrollTimer = window.setTimeout(() => {
      const el = document.querySelector(
        `[data-highlight-id="${CSS.escape(highlightId)}"]`,
      );
      el?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }, 120);
    window.setTimeout(() => setHighlightFlash(null), flashMs);
    window.setTimeout(() => setCreatedToast(false), toastMs);
    const next = new URLSearchParams(paramsRef.current);
    next.delete(param);
    setParamsRef.current(next, { replace: true });
    return () => {
      window.clearTimeout(scrollTimer);
    };
  }, [highlightId, flashMs, toastMs, param]);

  const isHighlighted = (id: string) =>
    highlightFlash === id || highlightId === id;

  return { highlightId, highlightFlash, createdToast, isHighlighted };
}
