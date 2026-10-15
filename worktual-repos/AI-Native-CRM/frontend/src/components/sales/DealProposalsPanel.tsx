import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { ConfirmDeleteButton } from "@/components/ui/ConfirmDeleteButton";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import {
  createProposalFromPlaybook,
  createProposalVersion,
  deleteProposal,
  fetchDealProposals,
  shareProposal,
  sendProposal,
  resendProposal,
  updateProposal,
  type ProposalRow,
} from "@/services/sales";
import { ProposalDocumentSkeleton } from "@/pages/ProposalDocumentSkeleton";
import {
  REQUIREMENT_FILE_ACCEPT,
  REQUIREMENT_FILE_MAX_BYTES,
  REQUIREMENT_FILE_TYPES_LABEL,
  isRequirementUploadFile,
} from "@/lib/requirement-file";

const STATUS_LABEL: Record<ProposalRow["status"], string> = {
  draft: "Draft",
  shared: "Shared",
  accepted: "Accepted",
  declined: "Declined",
};

function statusClass(status: ProposalRow["status"]): string {
  switch (status) {
    case "shared":
      return "bg-sky-50 text-sky-800";
    case "accepted":
      return "bg-emerald-50 text-emerald-800";
    case "declined":
      return "bg-rose-50 text-rose-800";
    default:
      return "bg-subtle text-text-secondary";
  }
}

export function DealProposalsPanel({
  dealId,
  onConvertToQuote,
}: {
  dealId: string;
  onConvertToQuote?: (proposalId: string) => void;
}) {
  const navigate = useNavigate();
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [requirementText, setRequirementText] = useState("");
  const [requirementPdf, setRequirementPdf] = useState<{
    name: string;
    base64: string;
  } | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const result = await fetchDealProposals(dealId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setProposals(result.items);
    } catch {
      setError("Failed to load proposals.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  const onCreate = async () => {
    setError(null);
    if (requirementText.trim().length < 8 && !requirementPdf) {
      setError(
        `Paste a requirement brief or upload a BRD (${REQUIREMENT_FILE_TYPES_LABEL}).`,
      );
      return;
    }
    setBusy(true);
    setCreating(true);
    try {
      const result = await createProposalFromPlaybook({
        dealId,
        requirementText: requirementText.trim(),
        title: title.trim() || null,
        ...(requirementPdf
          ? {
              requirementPdfBase64: requirementPdf.base64,
              requirementFilename: requirementPdf.name,
            }
          : {}),
      });
      if (!result.ok) {
        setBusy(false);
        setCreating(false);
        setError(result.error);
        return;
      }
      setTitle("");
      setRequirementText("");
      setRequirementPdf(null);
      setShowCreate(false);
      navigate(`/sales/proposals/${result.id}`);
    } catch (err) {
      setBusy(false);
      setCreating(false);
      const ax = err as { code?: string; message?: string };
      setError(
        ax?.code === "ECONNABORTED"
          ? "Create timed out waiting for the API. Check the deal’s proposal list — a draft may still be generating."
          : ax?.message?.trim() || "Failed to create proposal.",
      );
    }
  };

  const run = async (
    fn: () => Promise<{ ok: boolean; error?: string; warning?: string }>,
  ) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    const result = await fn();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Action failed.");
      return;
    }
    if (result.warning) {
      setNotice(result.warning);
    }
    await reload();
  };

  if (creating) {
    return (
      <section className="rounded-xl border border-border-default border-l-4 border-l-sky-500 bg-surface p-2 sm:p-3">
        <ProposalDocumentSkeleton />
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border-default border-l-4 border-l-sky-500 bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-text-primary">
            Proposals
          </h2>
          <p className="mt-1 text-sm text-text-caption">
            Generated from patterns learned from your uploaded proposals.
          </p>
        </div>
        <Button
          type="button"
          variant="primary"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? "Cancel" : "+ New proposal"}
        </Button>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-text-danger">{error}</p>
      ) : null}
      {notice ? (
        <p className="mt-3 text-sm text-amber-800">{notice}</p>
      ) : null}

      {showCreate ? (
        <div className="mt-4 grid gap-3 rounded-lg border border-border-default bg-subtle/40 p-4">
          <Textarea
            label="Requirement"
            value={requirementText}
            onChange={(e) => setRequirementText(e.target.value)}
            rows={5}
            placeholder="Paste the RFP brief, meeting notes, or customer requirements…"
          />
          <div>
            <label className="mb-1 block text-sm font-medium text-text-primary">
              Requirement file (optional)
            </label>
            <input
              type="file"
              accept={REQUIREMENT_FILE_ACCEPT}
              className="block w-full text-sm text-text-secondary file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) {
                  setRequirementPdf(null);
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
                  setRequirementPdf({ name: file.name, base64 });
                  setError(null);
                };
                reader.onerror = () =>
                  setError("Could not read that file.");
                reader.readAsDataURL(file);
              }}
            />
            {requirementPdf ? (
              <p className="mt-1 text-xs text-text-caption">
                Attached: {requirementPdf.name}
                <button
                  type="button"
                  className="ml-2 text-brand underline"
                  onClick={() => setRequirementPdf(null)}
                >
                  Remove
                </button>
              </p>
            ) : (
              <p className="mt-1 text-xs text-text-caption">
                Upload the customer BRD as {REQUIREMENT_FILE_TYPES_LABEL} — we
                extract the text and match a learned writing + layout pattern.
              </p>
            )}
          </div>
          <Input
            label="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <p className="text-xs text-text-caption">
            Writes from patterns learned from your uploaded proposals (section
            order, tone, and visual layout cues like colors and table style).
          </p>
          <div>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void onCreate()}
            >
              {busy ? "Generating from learned pattern…" : "Generate proposal"}
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div
          className="mt-4 space-y-3"
          aria-busy="true"
          aria-label="Loading"
        >
          <div className="h-10 animate-pulse rounded-lg bg-subtle" />
          <div className="h-10 animate-pulse rounded-lg bg-subtle" />
        </div>
      ) : proposals.length === 0 ? (
        <p className="mt-4 text-sm text-text-caption">
          No proposals yet. Generate one from the patterns learned from your
          uploads.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border-default">
          {proposals.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-start justify-between gap-3 py-3.5 text-sm"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/sales/proposals/${p.id}`}
                    className="font-medium text-brand underline"
                  >
                    {p.number}
                    <span className="text-text-caption"> · v{p.version}</span>
                  </Link>
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-medium ${statusClass(p.status)}`}
                  >
                    {STATUS_LABEL[p.status]}
                  </span>
                  {p.approvalStatus === "generating" ? (
                    <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
                      {p.generationRun?.progress?.label || "Generating"}
                    </span>
                  ) : null}
                  {p.generationRun?.pricingIssues &&
                  typeof p.generationRun.pricingIssues === "object" &&
                  (p.generationRun.pricingIssues as { sendBlocked?: boolean })
                    .sendBlocked ? (
                    <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
                      Pricing incomplete
                    </span>
                  ) : null}
                  {p.approvalStatus === "failed" ? (
                    <span className="rounded-md bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-800">
                      Generate failed
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-text-secondary">{p.title}</p>
                {p.customerName ? (
                  <p className="mt-0.5 text-xs text-text-caption">
                    For {p.customerName}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-text-caption">
                  Updated {new Date(p.updatedAt).toLocaleDateString()}
                  {p.hasSections ? " · Structured document" : null}
                  {p.attachmentUrl ? (
                    <>
                      {" · "}
                      <a
                        href={p.attachmentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-text-link hover:underline"
                      >
                        Attachment
                      </a>
                    </>
                  ) : null}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  onClick={() => navigate(`/sales/proposals/${p.id}`)}
                >
                  Open
                </Button>
                {p.status === "draft" && p.approvalStatus !== "generating" ? (
                  <Button
                    variant="primary"
                    className="h-8 px-3 text-xs"
                    disabled={busy}
                    onClick={() => void run(() => sendProposal(p.id))}
                  >
                    Send
                  </Button>
                ) : null}
                {p.status === "draft" && p.approvalStatus !== "generating" ? (
                  <Button
                    variant="secondary"
                    className="h-8 px-3 text-xs"
                    disabled={busy}
                    onClick={() => void run(() => shareProposal(p.id))}
                  >
                    Mark shared
                  </Button>
                ) : null}
                {p.status === "shared" ? (
                  <Button
                    variant="secondary"
                    className="h-8 px-3 text-xs"
                    disabled={busy}
                    onClick={() => void run(() => resendProposal(p.id))}
                  >
                    Resend
                  </Button>
                ) : null}
                {p.status === "shared" ? (
                  <>
                    <Button
                      variant="secondary"
                      className="h-8 px-3 text-xs"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          updateProposal(p.id, { status: "accepted" }),
                        )
                      }
                    >
                      Mark accepted
                    </Button>
                    <Button
                      variant="secondary"
                      className="h-8 px-3 text-xs"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          updateProposal(p.id, { status: "declined" }),
                        )
                      }
                    >
                      Mark declined
                    </Button>
                  </>
                ) : null}
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  disabled={busy}
                  onClick={() => void run(() => createProposalVersion(p.id))}
                >
                  New version
                </Button>
                {onConvertToQuote &&
                (p.status === "shared" || p.status === "accepted") ? (
                  <Button
                    variant="primary"
                    className="h-8 px-3 text-xs"
                    disabled={busy}
                    onClick={() => onConvertToQuote(p.id)}
                  >
                    Convert to quote
                  </Button>
                ) : null}
                {p.status !== "accepted" ? (
                  <ConfirmDeleteButton
                    name={p.title || p.number}
                    entityLabel="proposal"
                    compact
                    consequence="This permanently removes the proposal."
                    disabled={busy}
                    onConfirm={async () => {
                      const result = await deleteProposal(p.id);
                      if (!result.ok) {
                        return {
                          ok: false,
                          error: result.error ?? "Failed to delete proposal.",
                        };
                      }
                      return { ok: true };
                    }}
                    onSuccess={() => void reload()}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
