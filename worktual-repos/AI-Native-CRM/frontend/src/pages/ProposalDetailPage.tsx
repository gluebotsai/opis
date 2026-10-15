import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { Button } from "@/components/ui/Button";
import { BackLink } from "@/components/ui/BackLink";
import { PAGE_H1_CLASS } from "@/lib/ui-tones";
import { canEditDeals, normalizeRole } from "@/lib/rbac";
import {
  fetchProposal,
  shareProposal,
  sendProposal,
  resendProposal,
  updateProposal,
  personalizeProposal,
  rewriteProposalSection,
  patchProposalSection,
  patchProposalDocumentText,
  patchProposalBlueprintHtml,
  updateProposalDocumentAsset,
  deleteProposal,
  downloadProposalPdf,
  downloadProposalDocx,
  type ProposalDetail,
} from "@/services/sales";
import { DocumentBlueprintView, toReadablePlainText, formatCompanyDisplayName, formatSectionBodyHtml } from "@/components/documents/DocumentBlueprintView";
import { RichStructuredContent } from "@/components/content/RichStructuredContent";
import { ProposalDocumentSkeleton } from "@/pages/ProposalDocumentSkeleton";
import { useAppSelector } from "@/store";
import type { AgentToolProposal } from "@/services/coworker";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  shared: "Shared",
  accepted: "Accepted",
  declined: "Declined",
};

export function ProposalDetailPage() {
  const { proposalId } = useParams<{ proposalId: string }>();
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const canEdit = canEditDeals(normalizeRole(user?.role));
  const [proposal, setProposal] = useState<ProposalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const hasLoadedRef = useRef(false);

  const reload = async () => {
    if (!proposalId) return;
    const isInitial = !hasLoadedRef.current;
    if (isInitial) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await fetchProposal(proposalId);
      if (!result.ok) {
        if (isInitial) {
          setProposal(null);
          setError(result.error);
        }
        return;
      }
      setProposal(result.proposal);
      hasLoadedRef.current = true;
    } catch {
      if (isInitial) {
        setError("Failed to load proposal.");
        setProposal(null);
      }
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    hasLoadedRef.current = false;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalId]);

  const generating = proposal?.approvalStatus === "generating";
  useEffect(() => {
    if (!proposalId || !generating) return;
    const timer = window.setInterval(() => {
      void reload();
    }, 2500);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalId, generating]);

  const onBlueprintHtmlCommit = useCallback(
    (html: string) => {
      if (!proposalId) return;
      void (async () => {
        const result = await patchProposalBlueprintHtml(proposalId, html);
        if (!result.ok) {
          setError(result.error || "Failed to save document edits.");
          return;
        }
        setMessage("Document saved.");
        const next = await fetchProposal(proposalId);
        if (next.ok) setProposal(next.proposal);
      })();
    },
    [proposalId],
  );

  const onPersonalize = async () => {
    if (!proposal) return;
    setBusy(true);
    setRegenerating(true);
    setError(null);
    setMessage(null);
    try {
      const result = await personalizeProposal(proposal.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.warnings?.length) {
        setMessage(result.warnings.join(" "));
      }
      await reload();
    } finally {
      setBusy(false);
      setRegenerating(false);
    }
  };

  const downloadBlob = async (
    fetcher: (id: string) => Promise<Blob>,
    filename: string,
    failureMessage: string,
  ) => {
    if (!proposal) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await fetcher(proposal.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : failureMessage);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <AgentModuleShell
        key={`proposal-loading-${proposalId ?? "x"}`}
        moduleId="sales"
        title="Proposal"
        welcome="Ask me to change a heading or section, regenerate, or send the proposal."
        surface="detail"
        entityId={proposalId ?? null}
        workspace={<ProposalDocumentSkeleton />}
      />
    );
  }

  if (!proposal) {
    return (
      <AgentModuleShell
        key={`proposal-missing-${proposalId ?? "x"}`}
        moduleId="sales"
        title="Proposal"
        welcome="Proposal workspace"
        surface="detail"
        entityId={proposalId ?? null}
        workspace={
          <div className="px-6 py-10">
            <p className="text-sm text-text-danger">{error ?? "Not found"}</p>
            <BackLink to="/sales" className="mt-3">
              Back to Sales
            </BackLink>
          </div>
        }
      />
    );
  }

  if (proposal.approvalStatus === "generating") {
    return (
      <AgentModuleShell
        key={`proposal-generating-${proposal.id}`}
        moduleId="sales"
        title="Proposal"
        welcome="The proposal is still being written from the BRD, catalog, and knowledge base."
        surface="detail"
        entityId={proposal.id}
        workspace={
          <div>
            <ProposalDocumentSkeleton />
            {proposal.generationRun?.progress?.label ? (
              <p className="px-6 pb-4 text-sm text-text-caption">
                {proposal.generationRun.progress.label}
              </p>
            ) : null}
          </div>
        }
      />
    );
  }

  if (proposal.approvalStatus === "failed") {
    return (
      <AgentModuleShell
        key={`proposal-failed-${proposal.id}`}
        moduleId="sales"
        title="Proposal"
        welcome="Proposal workspace"
        surface="detail"
        entityId={proposal.id}
        workspace={
          <div className="px-6 py-10">
            <p className="text-sm text-text-danger">
              {proposal.summary || error || "Proposal generation failed."}
            </p>
            <BackLink to={`/sales/${proposal.dealId}`} className="mt-3">
              Back to deal
            </BackLink>
          </div>
        }
      />
    );
  }

  const sections = proposal.sections;

  const workspace = (
    <div className="crm-fade-in px-4 py-5 sm:px-6 print:px-0">
      <div className="mb-5 print:hidden">
        <div>
          <BackLink to={`/sales/${proposal.dealId}`}>Back to deal</BackLink>
          <h1 className={`mt-2 ${PAGE_H1_CLASS}`}>{proposal.number}</h1>
          <p className="mt-1 text-sm text-text-caption">
            {STATUS_LABEL[proposal.status] ?? proposal.status}
            {proposal.generationRun?.pricingIssues &&
            typeof proposal.generationRun.pricingIssues === "object" &&
            (proposal.generationRun.pricingIssues as { sendBlocked?: boolean })
              .sendBlocked
              ? " · Pricing incomplete — Send blocked"
              : null}
            {proposal.templateName ? ` · from ${proposal.templateName}` : null}
            {" · "}
            <Link
              to={`/sales/${proposal.dealId}`}
              className="text-brand underline"
            >
              {proposal.dealTitle}
            </Link>
          </p>
        </div>
        <div className="mt-3 flex min-w-0 max-w-full flex-nowrap items-center gap-2 overflow-x-auto pb-0.5">
          {canEdit && proposal.status === "draft" ? (
            <Button
              type="button"
              variant="secondary"
              className="h-9 shrink-0 whitespace-nowrap"
              disabled={busy}
              onClick={() => void onPersonalize()}
            >
              {busy ? "Rewriting for this customer…" : "Regenerate for this customer"}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            className="h-9 shrink-0 whitespace-nowrap"
            disabled={busy}
            onClick={() =>
              void downloadBlob(
                downloadProposalPdf,
                `${proposal.number || "proposal"}.pdf`,
                "Could not download PDF.",
              )
            }
          >
            Download PDF
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="h-9 shrink-0 whitespace-nowrap"
            disabled={busy}
            onClick={() =>
              void downloadBlob(
                downloadProposalDocx,
                `${proposal.number || "proposal"}.docx`,
                "Could not download Word document.",
              )
            }
          >
            Download DOCX
          </Button>
          {canEdit && proposal.status === "draft" ? (
            <Button
              type="button"
              variant="primary"
              className="h-9 shrink-0 whitespace-nowrap"
              disabled={busy}
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  setError(null);
                  setMessage(null);
                  const result = await sendProposal(proposal.id);
                  setBusy(false);
                  if (!result.ok) {
                    setError(result.error ?? "Failed to send proposal.");
                    return;
                  }
                  if (result.warning) {
                    setMessage(result.warning);
                  } else {
                    setMessage("Proposal sent to the customer.");
                  }
                  await reload();
                })()
              }
            >
              Send
            </Button>
          ) : null}
          {canEdit && proposal.status === "draft" ? (
            <Button
              type="button"
              variant="secondary"
              className="h-9 shrink-0 whitespace-nowrap"
              disabled={busy}
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  await shareProposal(proposal.id);
                  setBusy(false);
                  await reload();
                })()
              }
            >
              Mark shared
            </Button>
          ) : null}
          {canEdit && proposal.status === "shared" ? (
            <Button
              type="button"
              variant="secondary"
              className="h-9 shrink-0 whitespace-nowrap"
              disabled={busy}
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  setError(null);
                  setMessage(null);
                  const result = await resendProposal(proposal.id);
                  setBusy(false);
                  if (!result.ok) {
                    setError(result.error ?? "Failed to resend proposal.");
                    return;
                  }
                  setMessage("Proposal re-sent to the customer.");
                  await reload();
                })()
              }
            >
              Resend
            </Button>
          ) : null}
          {canEdit && proposal.status === "shared" ? (
            <>
              <Button
                type="button"
                variant="secondary"
                className="h-9 shrink-0 whitespace-nowrap"
                disabled={busy}
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    setError(null);
                    setMessage(null);
                    const result = await updateProposal(proposal.id, {
                      status: "accepted",
                    });
                    setBusy(false);
                    if (!result.ok) {
                      setError(result.error ?? "Failed to update proposal.");
                      return;
                    }
                    setMessage(
                      "Proposal marked accepted. Use Convert to quote on the deal when the customer is ready for pricing.",
                    );
                    await reload();
                  })()
                }
              >
                Mark accepted
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-9 shrink-0 whitespace-nowrap"
                disabled={busy}
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    setError(null);
                    setMessage(null);
                    const result = await updateProposal(proposal.id, {
                      status: "declined",
                    });
                    setBusy(false);
                    if (!result.ok) {
                      setError(result.error ?? "Failed to update proposal.");
                      return;
                    }
                    setMessage("Proposal marked declined.");
                    await reload();
                  })()
                }
              >
                Mark declined
              </Button>
            </>
          ) : null}
          {canEdit &&
          (proposal.status === "shared" || proposal.status === "accepted") ? (
            <Button
              type="button"
              variant="primary"
              className="h-9 shrink-0 whitespace-nowrap"
              onClick={() =>
                navigate(
                  `/sales/${proposal.dealId}?tab=quotes&proposalId=${proposal.id}`,
                )
              }
            >
              Convert to quote
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="mb-4 text-sm text-text-danger print:hidden" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mb-4 text-sm text-text-secondary print:hidden" role="status">
          {message}
        </p>
      ) : null}

      <article
        className={
          /proposal-doc/i.test(proposal.blueprint?.html || "")
            ? "mx-auto w-full max-w-6xl print:border-0 print:p-0"
            : "mx-auto w-full max-w-6xl rounded-xl border border-border-default bg-surface p-6 sm:p-8 print:border-0 print:p-0"
        }
      >
        {proposal.blueprint ? null : (
          <header className="mb-8 border-b border-border-default pb-6">
            <p className="text-xs font-medium tracking-wide text-text-caption uppercase">
              Proposal {proposal.number} · v{proposal.version}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-text-primary">
              {proposal.title}
            </h2>
            <p className="mt-2 text-sm text-text-secondary">
              Submitted to{" "}
              <span className="font-medium text-text-primary">
                {proposal.companyName ||
                  proposal.customerName ||
                  "Customer"}
              </span>
              {proposal.dealTitle ? ` · ${proposal.dealTitle}` : null}
            </p>
            <p className="mt-1 text-xs text-text-caption">
              {new Date(proposal.updatedAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </p>
          </header>
        )}

        {proposal.blueprint ? (
          <>
            {canEdit &&
            proposal.status === "draft" &&
            /proposal-doc/i.test(proposal.blueprint.html || "") ? (
              <p className="mb-3 text-xs text-text-caption print:hidden">
                Click the document to edit. Changes save when you click away.
              </p>
            ) : null}
            <DocumentBlueprintView
            blueprint={proposal.blueprint}
            assets={proposal.assets}
            sections={sections}
            editable={
              canEdit &&
              proposal.status === "draft" &&
              /proposal-doc/i.test(proposal.blueprint.html || "")
            }
            onHtmlCommit={onBlueprintHtmlCommit}
            tokens={{
              customerName: formatCompanyDisplayName(
                proposal.companyName ||
                  proposal.customerName ||
                  "Customer",
              ),
              companyName: formatCompanyDisplayName(
                proposal.companyName ||
                  proposal.customerName ||
                  "Company",
              ),
              dealTitle: proposal.dealTitle || "",
              date: new Date(proposal.updatedAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              }),
              vendorName:
                proposal.vendorName?.trim() ||
                proposal.seller?.companyName?.trim() ||
                "Our company",
              productScope: (() => {
                const scope = (proposal.productScope?.trim() || "")
                  .replace(/^\(+/, "")
                  .replace(/\)+$/, "");
                const deal = (proposal.dealTitle || "").trim();
                const customer = (
                  proposal.companyName ||
                  proposal.customerName ||
                  ""
                ).trim();
                if (!scope || /^solution overview$/i.test(scope)) return "";
                if (scope === deal) return "";
                if (
                  customer &&
                  scope.toLowerCase().includes(customer.toLowerCase())
                ) {
                  return "";
                }
                return scope;
              })(),
              sellerAddress: proposal.seller?.billingAddress?.trim() || "",
            }}
            className="proposal-print-root"
          />
          </>
        ) : sections.length === 0 ? (
          <div>
            {proposal.summary ? (
              <RichStructuredContent
                text={proposal.summary}
                variant="document"
              />
            ) : (
              <p className="text-sm text-text-caption">
                No structured sections. Attach a PDF or recreate from the
                standard template.
              </p>
            )}
            {proposal.attachmentUrl ? (
              <a
                href={proposal.attachmentUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-block text-sm text-brand underline"
              >
                Open attachment
              </a>
            ) : null}
          </div>
        ) : (
          <div className="space-y-8">
            {sections.map((section) => (
              <section key={section.id}>
                <h3 className="text-base font-semibold text-text-primary">
                  {toReadablePlainText(section.title)}
                </h3>
                <RichStructuredContent
                  className="mt-3"
                  html={formatSectionBodyHtml(section.body)}
                  variant="document"
                />
              </section>
            ))}
          </div>
        )}
      </article>
    </div>
  );

  return (
    <AgentModuleShell
      key={`proposal-${proposal.id}`}
      moduleId="sales"
      title={proposal.number}
      welcome={`Proposal ${proposal.number} for ${proposal.customerName || "this customer"}. Name a heading (for example Overview or Business Context) and tell me what to change or add — or ask to regenerate or send.`}
      surface="detail"
      entityId={proposal.id}
      workspace={
        regenerating ? (
          <ProposalDocumentSkeleton />
        ) : (
          workspace
        )
      }
      onAfterTool={() => {
        void reload();
      }}
      onToolConfirm={async (tool: AgentToolProposal) => {
        if (tool.name === "propose_delete_proposal") {
          const id = String(tool.args.proposalId || proposal.id || "").trim();
          if (!id) return "Missing proposal.";
          const result = await deleteProposal(id);
          if (!result.ok) return result.error || "Failed to delete proposal.";
          navigate("/sales");
          return true;
        }
        if (tool.name === "propose_send_proposal") {
          const id = String(tool.args.proposalId || proposal.id || "").trim();
          if (!id) return "Missing proposal.";
          const result = await sendProposal(id);
          if (!result.ok) return result.error || "Failed to send proposal.";
          await reload();
          return result.warning || true;
        }
        if (tool.name === "propose_personalize_proposal") {
          const id = String(tool.args.proposalId || proposal.id || "").trim();
          if (!id) return "Missing proposal.";
          const productHint =
            typeof tool.args.productHint === "string" &&
            tool.args.productHint.trim()
              ? tool.args.productHint.trim()
              : undefined;
          const productIds = Array.isArray(tool.args.productIds)
            ? tool.args.productIds.filter(
                (pid): pid is string =>
                  typeof pid === "string" && Boolean(pid.trim()),
              )
            : undefined;
          setRegenerating(true);
          try {
            const result = await personalizeProposal(id, {
              ...(productHint ? { productHint } : {}),
              ...(productIds?.length ? { productIds } : {}),
            });
            if (!result.ok) return result.error;
            await reload();
            return true;
          } finally {
            setRegenerating(false);
          }
        }
        if (tool.name === "propose_create_proposal") {
          return false;
        }
        if (tool.name === "propose_patch_proposal_section") {
          const id = String(tool.args.proposalId || proposal.id || "").trim();
          const sectionKey = String(tool.args.sectionKey || "").trim();
          if (!id || !sectionKey) return "Missing proposal or section.";
          const result = await patchProposalSection(id, {
            sectionKey,
            title:
              typeof tool.args.title === "string"
                ? tool.args.title
                : undefined,
            body:
              typeof tool.args.body === "string" ? tool.args.body : undefined,
          });
          if (!result.ok) return result.error;
          await reload();
          return true;
        }
        if (tool.name === "propose_patch_proposal_document_text") {
          const id = String(tool.args.proposalId || proposal.id || "").trim();
          const raw = tool.args.textReplacements;
          const rawImages = tool.args.removeImageAssetIds;
          if (!id) return "Missing proposal.";
          const textReplacements = Array.isArray(raw)
            ? raw
                .filter(
                  (row): row is { find: string; replace?: string } =>
                    Boolean(
                      row &&
                        typeof row === "object" &&
                        typeof (row as { find?: string }).find === "string",
                    ),
                )
                .map((row) => ({
                  find: row.find,
                  replace: typeof row.replace === "string" ? row.replace : "",
                }))
            : [];
          const removeImageAssetIds = Array.isArray(rawImages)
            ? rawImages.filter(
                (row): row is string => typeof row === "string" && Boolean(row.trim()),
              )
            : [];
          const tableBordersArg = tool.args.tableBorders;
          const tableBorders =
            tableBordersArg === true ||
            tableBordersArg === "true" ||
            tableBordersArg === 1 ||
            tableBordersArg === "1" ||
            tableBordersArg === "on"
              ? true
              : tableBordersArg === false ||
                  tableBordersArg === "false" ||
                  tableBordersArg === 0 ||
                  tableBordersArg === "off"
                ? false
                : undefined;
          if (
            !textReplacements.length &&
            !removeImageAssetIds.length &&
            tableBorders === undefined
          ) {
            return "No valid document edits.";
          }
          const result = await patchProposalDocumentText(id, {
            textReplacements,
            pageId:
              typeof tool.args.pageId === "string" ? tool.args.pageId : undefined,
            removeImageAssetIds: removeImageAssetIds.length
              ? removeImageAssetIds
              : undefined,
            tableBorders,
          });
          if (!result.ok) return result.error;
          await reload();
          return true;
        }
        if (tool.name === "propose_update_document_asset") {
          const id = String(tool.args.proposalId || proposal.id || "").trim();
          if (!id) return "Missing proposal.";
          const result = await updateProposalDocumentAsset(id, {
            assetId:
              typeof tool.args.assetId === "string"
                ? tool.args.assetId
                : "logo",
            imageUrl:
              typeof tool.args.imageUrl === "string"
                ? tool.args.imageUrl
                : undefined,
            dataBase64:
              typeof tool.args.dataBase64 === "string"
                ? tool.args.dataBase64
                : undefined,
            mime:
              typeof tool.args.mime === "string" ? tool.args.mime : undefined,
            kind:
              tool.args.kind === "logo" || tool.args.kind === "image"
                ? tool.args.kind
                : undefined,
          });
          if (!result.ok) return result.error;
          await reload();
          return true;
        }
        if (tool.name !== "propose_rewrite_proposal_section") return false;
        const id = String(tool.args.proposalId || proposal.id || "");
        const sectionKey = String(tool.args.sectionKey || "").trim();
        if (!id || !sectionKey) return "Missing proposal or section.";
        const instruction =
          typeof tool.args.instruction === "string"
            ? tool.args.instruction
            : undefined;
        const result = await rewriteProposalSection(id, {
          sectionKey,
          instruction,
        });
        if (!result.ok) return result.error;
        await reload();
        return true;
      }}
    />
  );
}
