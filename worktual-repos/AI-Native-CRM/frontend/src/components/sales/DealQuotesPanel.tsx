import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MutableRefObject,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { buildQuoteLines } from "@/lib/quote-line-builder";
import { canManageDocumentTemplates, normalizeRole } from "@/lib/rbac";
import { useAppSelector } from "@/store";
import {
  acceptQuote,
  createQuote,
  createQuoteFromRequirement,
  fetchDealQuotes,
  fetchQuoteFormOptions,
  rejectQuote,
  sendQuote,
  resendQuote,
  type DealQuoteRow,
  type QuoteFormProduct,
} from "@/services/quotes";
import { fetchDealProposals, type ProposalRow } from "@/services/sales";
import {
  REQUIREMENT_FILE_ACCEPT,
  REQUIREMENT_FILE_MAX_BYTES,
  REQUIREMENT_FILE_TYPES_LABEL,
  isRequirementUploadFile,
} from "@/lib/requirement-file";
import type { QuoteDraftFields } from "@/services/coworker";
import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonText } from "@/components/skeleton/SkeletonText";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  void: "Void",
};

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency || "USD"} ${amount.toFixed(2)}`;
  }
}

export function DealQuotesPanel({
  dealId,
  createOpen: createOpenProp,
  onCreateOpenChange,
  initialProposalId = null,
  patchRef,
  submitRef,
  onDraftChange,
}: {
  dealId: string;
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
  initialProposalId?: string | null;
  patchRef?: MutableRefObject<
    ((patch: Partial<QuoteDraftFields>) => void) | null
  >;
  submitRef?: MutableRefObject<(() => Promise<true | string>) | null>;
  onDraftChange?: (draft: QuoteDraftFields) => void;
}) {
  const navigate = useNavigate();
  const role = normalizeRole(useAppSelector((s) => s.auth.user?.role));
  const canManageTemplates = canManageDocumentTemplates(role);
  const [quotes, setQuotes] = useState<DealQuoteRow[]>([]);
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [requirementFile, setRequirementFile] = useState<{
    name: string;
    base64: string;
  } | null>(null);
  const [products, setProducts] = useState<QuoteFormProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [internalCreate, setInternalCreate] = useState(false);
  const showCreate = createOpenProp ?? internalCreate;
  const setShowCreate = (next: boolean | ((v: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(showCreate) : next;
    onCreateOpenChange?.(value);
    if (createOpenProp === undefined) setInternalCreate(value);
  };
  const [productId, setProductId] = useState("");
  const [offerId, setOfferId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [addonQuantities, setAddonQuantities] = useState<
    Record<string, string>
  >({});
  const [discountPct, setDiscountPct] = useState("0");
  const [proposalId, setProposalId] = useState(initialProposalId ?? "");

  useEffect(() => {
    if (!initialProposalId) return;
    setProposalId(initialProposalId);
    if (createOpenProp === undefined) setInternalCreate(true);
    else onCreateOpenChange?.(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once when parent sets proposal
  }, [initialProposalId]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === productId) ?? null,
    [products, productId],
  );

  const addonQtyNumbers = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [id, raw] of Object.entries(addonQuantities)) {
      const n = Number.parseFloat(raw);
      if (Number.isFinite(n) && n > 0) out[id] = n;
    }
    return out;
  }, [addonQuantities]);

  const reloadQuotes = async () => {
    setLoading(true);
    setError(null);
    try {
      const [q, props] = await Promise.all([
        fetchDealQuotes(dealId),
        fetchDealProposals(dealId),
      ]);
      setQuotes(q.items);
      if (props.ok) setProposals(props.items);
    } catch {
      setError("Failed to load quotes.");
    } finally {
      setLoading(false);
    }
  };

  const loadFormOptions = async () => {
    if (optionsLoaded || optionsLoading) return;
    setOptionsLoading(true);
    try {
      const opts = await fetchQuoteFormOptions();
      setProducts(opts.products);
      setOptionsLoaded(true);
    } catch {
      setError("Failed to load products for new quote.");
    } finally {
      setOptionsLoading(false);
    }
  };

  useEffect(() => {
    void reloadQuotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  useEffect(() => {
    if (showCreate) void loadFormOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCreate]);

  const snapshotDraft = useCallback((): QuoteDraftFields => {
    return {
      dealId,
      productId,
      offerId,
      quantity,
      discountPct,
      addonQuantities: { ...addonQuantities },
    };
  }, [
    addonQuantities,
    dealId,
    discountPct,
    offerId,
    productId,
    quantity,
  ]);

  useEffect(() => {
    if (!showCreate || !onDraftChange) return;
    onDraftChange(snapshotDraft());
  }, [onDraftChange, showCreate, snapshotDraft]);

  const onProductChange = useCallback(
    (nextId: string) => {
      setProductId(nextId);
      const product = products.find((p) => p.id === nextId);
      setOfferId(
        product?.productType === "customizable"
          ? (product.offers[0]?.id ?? "")
          : "",
      );
      setAddonQuantities({});
      setQuantity("1");
    },
    [products],
  );

  const applyPatch = useCallback(
    (patch: Partial<QuoteDraftFields>) => {
      if (patch.productId) {
        const wanted = patch.productId.trim();
        const match =
          products.find((p) => p.id === wanted) ??
          products.find(
            (p) =>
              p.name.toLowerCase() === wanted.toLowerCase() ||
              p.sku?.toLowerCase() === wanted.toLowerCase(),
          );
        if (match) onProductChange(match.id);
        else if (products.length === 0) setProductId(wanted);
      }
      if (typeof patch.offerId === "string") setOfferId(patch.offerId);
      if (typeof patch.quantity === "string" && patch.quantity.trim()) {
        setQuantity(patch.quantity);
      }
      if (typeof patch.discountPct === "string") {
        setDiscountPct(patch.discountPct);
      }
      if (patch.addonQuantities) {
        setAddonQuantities((prev) => ({ ...prev, ...patch.addonQuantities }));
      }
    },
    [onProductChange, products],
  );

  useEffect(() => {
    if (!patchRef) return;
    patchRef.current = applyPatch;
    return () => {
      patchRef.current = null;
    };
  }, [applyPatch, patchRef]);

  const run = async (
    fn: () => Promise<{
      ok: boolean;
      error?: string;
      warning?: string;
      invoiceId?: string | null;
    }>,
  ) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await fn();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Action failed.");
      return;
    }
    if (result.warning) setMessage(result.warning);
    if (result.invoiceId) {
      setMessage(`Invoice created.`);
    }
    await reloadQuotes();
  };

  const doCreate = useCallback(async (): Promise<true | string> => {
    if (optionsLoading && products.length === 0) {
      const msg = "Quote form is still loading — try again in a moment.";
      setError(msg);
      return msg;
    }
    if (!selectedProduct) {
      const msg = "Select a product.";
      setError(msg);
      return msg;
    }
    const resultBuild = buildQuoteLines({
      product: selectedProduct,
      quantity: Number.parseFloat(quantity) || 0,
      offerId,
      addonQuantities: addonQtyNumbers,
    });
    if (resultBuild.error) {
      setError(resultBuild.error);
      return resultBuild.error;
    }
    if (!resultBuild.lines.length) {
      const msg = "Add at least one priced line before creating the quote.";
      setError(msg);
      return msg;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await createQuote({
        dealId,
        discountPct: Number.parseFloat(discountPct) || 0,
        currency: resultBuild.currency,
        fromTemplate: true,
        ...(proposalId ? { proposalId } : {}),
        lines: resultBuild.lines,
      });
      if (!result.ok) {
        setError(result.error);
        return result.error || "Couldn't create quote.";
      }
      setShowCreate(false);
      setProposalId("");
      navigate(`/sales/quotes/${result.id}`);
      return true;
    } catch (err) {
      const msg =
        err instanceof Error && err.message.trim()
          ? err.message.trim()
          : "Couldn't create quote.";
      setError(msg);
      return msg;
    } finally {
      setBusy(false);
    }
  }, [
    addonQtyNumbers,
    dealId,
    discountPct,
    navigate,
    offerId,
    optionsLoading,
    products.length,
    proposalId,
    quantity,
    selectedProduct,
    setShowCreate,
  ]);

  const generateFromProposal = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await createQuote({
        dealId,
        fromTemplate: true,
        proposalId: id,
        lines: [],
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setShowCreate(false);
      navigate(`/sales/quotes/${result.id}`);
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim()
          ? err.message.trim()
          : "Couldn't create quote from that proposal.",
      );
    } finally {
      setBusy(false);
    }
  };

  const generateFromBrd = async () => {
    if (!requirementFile) {
      setError(`Upload a BRD (${REQUIREMENT_FILE_TYPES_LABEL}).`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await createQuoteFromRequirement({
        dealId,
        requirementPdfBase64: requirementFile.base64,
        requirementFilename: requirementFile.name,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRequirementFile(null);
      setShowCreate(false);
      navigate(`/sales/quotes/${result.id}`);
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim()
          ? err.message.trim()
          : "Couldn't create quote from that BRD.",
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!submitRef) return;
    submitRef.current = () => doCreate();
    return () => {
      submitRef.current = null;
    };
  }, [doCreate, submitRef]);

  return (
    <section className="rounded-xl border border-border-default bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Quotes</h2>
          <p className="mt-0.5 text-xs text-text-caption">
            Generate a quote from a proposal on this deal, or from a BRD.
            The quotation template is applied after that source is chosen.
            {canManageTemplates ? (
              <>
                {" "}
                Manage it under{" "}
                <Link
                  to="/configuration/quote-templates"
                  className="text-brand underline"
                >
                  Configuration → Quote templates
                </Link>
                .
              </>
            ) : null}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setShowCreate((v) => !v)}
        >
          New quote
        </Button>
      </div>

      {error ? <p className="mt-3 text-sm text-text-danger">{error}</p> : null}
      {message ? (
        <p className="mt-3 text-sm text-text-secondary">
          {message}{" "}
          <Link to="/finance" className="text-brand underline">
            Open Finance
          </Link>
        </p>
      ) : null}

      {showCreate ? (
        <div className="mt-4 space-y-4 rounded-lg border border-border-default p-3">
          <div>
            <p className="text-xs font-medium text-text-secondary">
              From a proposal
            </p>
            {proposals.length === 0 ? (
              <p className="mt-1 text-xs text-text-caption">
                No proposals on this deal yet.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {proposals.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="font-medium text-text-primary">
                        {p.number}
                      </span>
                      <span className="text-text-caption"> · {p.title}</span>
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-8 px-3 text-xs"
                      disabled={busy}
                      onClick={() => void generateFromProposal(p.id)}
                    >
                      Generate quote
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-text-secondary">From a BRD</p>
            <input
              type="file"
              accept={REQUIREMENT_FILE_ACCEPT}
              className="mt-2 block w-full text-sm text-text-secondary file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) {
                  setRequirementFile(null);
                  return;
                }
                if (!isRequirementUploadFile(file)) {
                  setError(
                    `Unsupported file type — use a ${REQUIREMENT_FILE_TYPES_LABEL} BRD.`,
                  );
                  e.target.value = "";
                  return;
                }
                if (file.size > REQUIREMENT_FILE_MAX_BYTES) {
                  setError("Requirement file must be under 12 MB.");
                  e.target.value = "";
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  const raw = String(reader.result || "");
                  const base64 = raw.includes(",")
                    ? raw.split(",")[1] || ""
                    : raw;
                  if (!base64) {
                    setError("Could not read that file.");
                    return;
                  }
                  setRequirementFile({ name: file.name, base64 });
                  setError(null);
                };
                reader.onerror = () => setError("Could not read that file.");
                reader.readAsDataURL(file);
              }}
            />
            <p className="mt-1 text-xs text-text-caption">
              {requirementFile
                ? `Attached: ${requirementFile.name}`
                : `Upload the customer BRD as ${REQUIREMENT_FILE_TYPES_LABEL}.`}
            </p>
            <Button
              type="button"
              className="mt-2"
              disabled={busy || !requirementFile}
              onClick={() => void generateFromBrd()}
            >
              {busy ? "Generating…" : "Generate quote from BRD"}
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div
          className="mt-4 space-y-3"
          aria-busy="true"
          aria-label="Loading quotes"
        >
          {Array.from({ length: 2 }).map((_, index) => (
            <div
              key={index}
              className="rounded-lg border border-border-default p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-2">
                  <SkeletonText width={120} height={16} />
                  <SkeletonText width={88} height={14} />
                </div>
                <Skeleton height={14} width={40} borderRadius={4} />
              </div>
            </div>
          ))}
        </div>
      ) : quotes.length === 0 ? (
        <p className="mt-4 text-sm text-text-caption">No quotes on this deal.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {quotes.map((q) => (
            <li
              key={q.id}
              className="rounded-lg border border-border-default p-3 text-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-text-primary">
                    <Link
                      to={`/sales/quotes/${q.id}`}
                      className="text-brand underline"
                    >
                      {q.number}
                    </Link>{" "}
                    <span className="text-text-caption">
                      · {STATUS_LABEL[q.status] ?? q.status}
                    </span>
                  </p>
                  <p className="mt-1 text-text-secondary">
                    {formatMoney(Number(q.total), q.currency)}
                  </p>
                  {q.orderNumber ? (
                    <p className="mt-1 text-xs text-text-caption">
                      Order {q.orderNumber} ({q.orderStatus})
                    </p>
                  ) : null}
                  {q.invoiceId ? (
                    <Link
                      to={`/finance/${q.invoiceId}`}
                      className="mt-1 inline-block text-xs text-brand underline"
                    >
                      Invoice {q.invoiceNumber ?? q.invoiceId}
                    </Link>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {q.status === "draft" &&
                  q.approvalStatus === "pending_finance_approval" ? (
                    <span className="text-xs text-amber-800">
                      Pending Finance approval
                    </span>
                  ) : null}
                  {q.status === "draft" &&
                  q.approvalStatus === "finance_rejected" ? (
                    <span className="text-xs text-text-danger">
                      Discount rejected — revise
                    </span>
                  ) : null}
                  {q.status === "draft" ? (
                    <button
                      type="button"
                      className="text-xs underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50"
                      disabled={
                        busy ||
                        q.approvalStatus === "pending_finance_approval" ||
                        q.approvalStatus === "finance_rejected"
                      }
                      title={
                        q.approvalStatus === "pending_finance_approval"
                          ? "Blocked until Finance approves this quote's discount."
                          : q.approvalStatus === "finance_rejected"
                            ? "Discount was rejected — revise and save before sending."
                            : undefined
                      }
                      onClick={() => void run(() => sendQuote(q.id))}
                    >
                      Send
                    </button>
                  ) : null}
                  {q.status === "sent" ? (
                    <>
                      <button
                        type="button"
                        className="text-xs underline"
                        disabled={busy}
                        onClick={() => void run(() => resendQuote(q.id))}
                      >
                        Resend email
                      </button>
                      <button
                        type="button"
                        className="text-xs underline"
                        disabled={busy}
                        onClick={() => void run(() => acceptQuote(q.id))}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="text-xs underline"
                        disabled={busy}
                        onClick={() => void run(() => rejectQuote(q.id))}
                      >
                        Reject
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
