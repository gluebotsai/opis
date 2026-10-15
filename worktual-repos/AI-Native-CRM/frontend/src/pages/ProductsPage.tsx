import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ExternalLink, Package, Plus, Search, Upload } from "lucide-react";
import {
  emptyProductDraft,
  ProductCreateDraftPanel,
} from "@/components/products/ProductCreateDraftPanel";
import { ProductImportDialog } from "@/components/products/ProductImportDialog";
import { Button } from "@/components/ui/Button";
import { InfiniteScrollSentinel } from "@/components/ui/InfiniteScrollSentinel";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useCreateHighlight } from "@/hooks/useCreateHighlight";
import {
  hydrateDraftFromMemory,
  readDraftSessionMemory,
} from "@/lib/coworker/use-draft-session-memory";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { productShowsQuoteFields, productShowsRetailFields } from "@/lib/coworker/field-contracts/product";
import {
  formatProductPrice,
  PRODUCT_STATUS_LABELS,
  PRODUCT_TYPE_LABELS,
  productStatusChipClass,
} from "@/lib/product-labels";
import { canImportProducts, normalizeRole } from "@/lib/rbac";
import {
  type AgentToolProposal,
  type ProductDraftFields,
} from "@/services/coworker";
import {
  deleteProduct,
  fetchProduct,
  fetchProductCategories,
  fetchProductsPage,
  updateProduct,
  type ProductListItem,
} from "@/services/products";
import { useAppSelector } from "@/store";
import { SkeletonText } from "@/components/skeleton/SkeletonText";
import { ProductsPageSkeleton } from "./ProductsPageSkeleton";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { MODULE_WORKSPACE_DESCRIPTION } from "@/lib/module-workspace-copy";

function Thumb({
  name,
  imageUrl,
}: {
  name: string;
  imageUrl?: string | null;
}) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        className="size-9 rounded-lg border border-border-default object-cover"
      />
    );
  }
  return (
    <span className="inline-flex size-9 items-center justify-center rounded-lg border border-border-default bg-subtle text-text-caption">
      <Package className="size-4" strokeWidth={1.75} aria-hidden />
      <span className="sr-only">{name}</span>
    </span>
  );
}

export function ProductsPage() {
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const role = normalizeRole(user?.role);
  const canImport = canImportProducts(role);
  const showRetailFields = productShowsRetailFields(user?.businessType);
  const showQuoteFields = productShowsQuoteFields(user?.businessType);

  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceMode =
    searchParams.get("view") === "create" ? "create" : "list";
  const search = searchParams.get("q") ?? "";
  const status = searchParams.get("status") ?? "all";
  const category = searchParams.get("category") ?? "all";

  const [createDraft, setCreateDraft] = useState<ProductDraftFields>(() =>
    hydrateDraftFromMemory(
      emptyProductDraft(),
      readDraftSessionMemory("shell:product"),
      "productDraft",
    ),
  );
  const draftPatchRef = useRef<
    ((patch: Partial<ProductDraftFields>) => void) | null
  >(null);
  const draftSubmitRef = useRef<(() => Promise<true | string>) | null>(null);

  const [draft, setDraft] = useState(search);
  const [items, setItems] = useState<ProductListItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const { createdToast, isHighlighted } = useCreateHighlight();

  useEffect(() => setDraft(search), [search]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (draft.trim()) next.set("q", draft.trim());
      else next.delete("q");
      if (next.toString() !== searchParams.toString()) {
        setSearchParams(next, { replace: true });
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [draft, searchParams, setSearchParams]);

  const patch = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const setWorkspace = useCallback(
    (mode: "list" | "create", opts?: { form?: boolean }) => {
      const next = new URLSearchParams(searchParams);
      if (mode === "create") {
        next.set("view", "create");
        if (opts?.form) next.set("form", "1");
        else next.delete("form");
      } else {
        next.delete("view");
        next.delete("form");
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const createPanelMode =
    searchParams.get("form") === "1" ? "form" : "guided";

  const onDraftPatch = useCallback((patch: Partial<ProductDraftFields>) => {
    setCreateDraft((prev) => ({
      ...prev,
      ...patch,
      offers: patch.offers ?? prev.offers,
      addons: patch.addons ?? prev.addons,
      skippedOptional:
        patch.skippedOptional !== undefined
          ? patch.skippedOptional
          : prev.skippedOptional,
    }));
  }, []);

  const onWorkspaceCommand = useCallback(
    (tool: AgentToolProposal) => {
      if (tool.name !== "set_workspace") return false;
      const mode = String(tool.args.mode || "");
      if (mode === "detail") {
        const entityId =
          typeof tool.args.entityId === "string" ? tool.args.entityId : undefined;
        if (entityId) {
          navigate(`/product/${entityId}`);
          return true;
        }
      }
      const searchQ =
        typeof tool.args.search === "string" ? tool.args.search : undefined;
      if (mode === "list" && searchQ != null) {
        const next = new URLSearchParams(searchParams);
        if (searchQ.trim()) next.set("q", searchQ.trim());
        else next.delete("q");
        setSearchParams(next, { replace: true });
        return true;
      }
      if (mode !== "list" && mode !== "create") return false;
      // Only clear the draft when entering create — re-firing set_workspace
      // while already creating must not wipe name/sku/price mid-chat.
      if (mode === "create" && workspaceMode !== "create") {
        setCreateDraft(emptyProductDraft());
      }
      setWorkspace(mode);
      return true;
    },
    [navigate, searchParams, setSearchParams, setWorkspace, workspaceMode],
  );

  const loadPage = useCallback(
    async (pageNum: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const [result, cats] = await Promise.all([
          fetchProductsPage({
            page: pageNum,
            pageSize: 24,
            search,
            status,
            category,
          }),
          append ? Promise.resolve({ categories }) : fetchProductCategories(),
        ]);
        setItems((prev) => {
          if (!append) return result.items;
          const seen = new Set(prev.map((i) => i.id));
          return [...prev, ...result.items.filter((i) => !seen.has(i.id))];
        });
        setPage(pageNum);
        setTotal(result.pagination.total);
        setHasNext(
          result.pagination.hasNext ??
            pageNum < result.pagination.totalPages,
        );
        if (!append) setCategories(cats.categories);
      } catch {
        setError("Failed to load products.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [search, status, category, categories],
  );

  useEffect(() => {
    void loadPage(1, false);
  }, [search, status, category]); // eslint-disable-line react-hooks/exhaustive-deps

  const onLoadMore = useCallback(() => {
    if (!hasNext || loading || loadingMore) return;
    void loadPage(page + 1, true);
  }, [hasNext, loading, loadingMore, loadPage, page]);

  const sentinelRef = useInfiniteScroll({
    hasMore: hasNext,
    loading: loading || loadingMore,
    onLoadMore,
  });

  const listWorkspace = (
    <div className="crm-fade-in mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="grid gap-3 rounded-xl border border-border-default bg-surface p-4 sm:grid-cols-[1fr_160px_180px]">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search name, SKU, category…"
          leftIcon={<Search className="size-4" strokeWidth={1.75} />}
          aria-label="Search products"
        />
        <Select
          value={status}
          onChange={(e) => patch("status", e.target.value)}
          options={[
            { value: "all", label: "All statuses" },
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
            { value: "draft", label: "Draft" },
            { value: "archived", label: "Archived" },
          ]}
          aria-label="Filter by status"
        />
        <Select
          value={category}
          onChange={(e) => patch("category", e.target.value)}
          options={[
            { value: "all", label: "All categories" },
            ...categories.map((c) => ({ value: c, label: c })),
          ]}
          aria-label="Filter by category"
        />
      </div>

      {error ? <p className="mt-4 text-sm text-text-danger">{error}</p> : null}

      {createdToast ? (
        <p
          className="mt-4 rounded-lg border border-[#b7e4c7] bg-[#e8f8ef] px-4 py-2.5 text-sm text-text-success"
          role="status"
        >
          Product created — it's highlighted below.
        </p>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-xl border border-border-default bg-surface">
        {items.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <span className="inline-flex size-12 items-center justify-center rounded-xl border border-border-default bg-subtle text-text-caption">
              <Package className="size-6" strokeWidth={1.5} />
            </span>
            <p className="mt-4 text-base font-semibold text-text-primary">
              No products found
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-5 text-text-caption">
              Add a product or import a CSV. Clear filters if you expected
              results.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <Button
                type="button"
                variant="primary"
                onClick={() => setWorkspace("create", { form: true })}
              >
                <Plus className="size-4" strokeWidth={2} />
                Add product
              </Button>
              {canImport ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setImportOpen(true)}
                >
                  <Upload className="size-4" strokeWidth={1.75} />
                  Import CSV
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-border-default bg-subtle text-xs font-medium tracking-wide text-text-caption uppercase">
                <tr>
                  <th className="w-14 px-4 py-3" scope="col">
                    <span className="sr-only">Image</span>
                  </th>
                  <th className="px-4 py-3" scope="col">
                    Name
                  </th>
                  <th className="px-4 py-3" scope="col">
                    SKU
                  </th>
                  {showRetailFields ? (
                    <th className="px-4 py-3" scope="col">
                      Brand
                    </th>
                  ) : null}
                  <th className="px-4 py-3" scope="col">
                    Category
                  </th>
                  {showQuoteFields ? (
                    <th className="px-4 py-3" scope="col">
                      Type
                    </th>
                  ) : null}
                  <th className="px-4 py-3" scope="col">
                    Price
                  </th>
                  {showRetailFields ? (
                    <th className="px-4 py-3" scope="col">
                      Stock
                    </th>
                  ) : null}
                  <th className="px-4 py-3" scope="col">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((product) => (
                  <tr
                    key={product.id}
                    data-highlight-id={product.id}
                    className={`border-b border-border-default last:border-0 hover:bg-subtle/70 ${
                      isHighlighted(product.id)
                        ? "bg-[#e8f8ef]/80 ring-1 ring-inset ring-[#0e8f50]/25"
                        : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/product/${product.id}`}
                        className="block"
                        tabIndex={-1}
                      >
                        <Thumb name={product.name} imageUrl={product.imageUrl} />
                      </Link>
                    </td>
                    <td className="max-w-[240px] px-4 py-3">
                      <Link
                        to={`/product/${product.id}`}
                        className="font-medium text-text-primary underline-offset-2 hover:underline"
                      >
                        {product.name}
                      </Link>
                      {product.productUrl?.trim() ? (
                        <a
                          href={product.productUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-1.5 inline-flex align-middle text-text-caption hover:text-text-primary"
                          aria-label="Open product page"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="size-3.5" strokeWidth={1.75} />
                        </a>
                      ) : null}
                      {product.tagline || product.subcategory ? (
                        <p className="mt-0.5 line-clamp-1 text-xs text-text-caption">
                          {product.tagline || product.subcategory}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums text-text-secondary">
                      {product.sku || "—"}
                    </td>
                    {showRetailFields ? (
                      <td className="px-4 py-3 text-text-secondary">
                        {product.brand || "—"}
                      </td>
                    ) : null}
                    <td className="px-4 py-3 text-text-secondary">
                      {product.category || "—"}
                    </td>
                    {showQuoteFields ? (
                    <td className="px-4 py-3 text-text-secondary">
                      {PRODUCT_TYPE_LABELS[product.productType ?? ""] ??
                        product.productType ??
                        "—"}
                      {product.productType === "customizable" &&
                      ((product.offerCount ?? 0) > 0 ||
                        (product.addonCount ?? 0) > 0)
                        ? ` · ${[
                            (product.offerCount ?? 0) > 0
                              ? `${product.offerCount} offer${product.offerCount === 1 ? "" : "s"}`
                              : null,
                            (product.addonCount ?? 0) > 0
                              ? `${product.addonCount} addon${product.addonCount === 1 ? "" : "s"}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}`
                        : ""}
                    </td>
                    ) : null}
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-text-primary">
                      {formatProductPrice(
                        product.listPrice ?? product.price,
                        product.currency,
                      )}
                    </td>
                    {showRetailFields ? (
                      <td
                        className={`px-4 py-3 tabular-nums ${
                          product.stockOnHand === 0
                            ? "text-text-danger"
                            : "text-text-secondary"
                        }`}
                      >
                        {product.stockOnHand == null
                          ? "—"
                          : product.stockOnHand}
                      </td>
                    ) : null}
                    <td className="px-4 py-3">
                      <span
                        className={productStatusChipClass(product.status)}
                      >
                        {PRODUCT_STATUS_LABELS[product.status] ?? product.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {items.length > 0 ? (
        <div className="flex flex-col items-center gap-1 py-6 text-sm text-text-caption">
          <InfiniteScrollSentinel ref={sentinelRef} />
          {loadingMore ? <SkeletonText width={96} height={12} /> : null}
          {!hasNext && !loadingMore ? (
            <p>
              Showing {items.length} of {total}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  // Always use the draft panel (guided or form) so coworker chat patches stay
  // in sync — same pattern as contacts. Never mount standalone ProductForm here.
  const shellWorkspace =
    workspaceMode === "create" ? (
      <ProductCreateDraftPanel
        draft={createDraft}
        onDraftChange={setCreateDraft}
        patchRef={draftPatchRef}
        submitRef={draftSubmitRef}
        mode={createPanelMode}
        onCancel={() => setWorkspace("list")}
        onCreated={(productId) => {
          setCreateDraft(emptyProductDraft());
          const next = new URLSearchParams(searchParams);
          next.delete("view");
          next.delete("form");
          next.set("highlight", productId);
          setSearchParams(next, { replace: true });
          void loadPage(1, false);
        }}
      />
    ) : (
      listWorkspace
    );

  return (
    <AgentModuleShell
      moduleId="product"
      title="Products"
      welcome="Happy to help with the catalog — we can add a product together or find one in the list on the right."
      chips={[
        {
          id: "chip-new-product",
          label: "Create a new product",
          prompt: "Help me create a new product",
        },
        {
          id: "chip-show-list",
          label: "Show products",
          prompt: "Show list",
        },
      ]}
      surface={workspaceMode}
      workspaceMode={workspaceMode}
      draft={workspaceMode === "create" ? createDraft : null}
      workspaceTitle="Products"
      workspaceSubtitle={
        workspaceMode === "list"
          ? MODULE_WORKSPACE_DESCRIPTION.products
          : undefined
      }
      workspaceHeaderActions={
        workspaceMode === "list" ? (
          <>
            {canImport ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setImportOpen(true)}
              >
                <Upload className="size-4" strokeWidth={1.75} />
                Import CSV
              </Button>
            ) : null}
            <Button
              type="button"
              variant="primary"
              onClick={() => setWorkspace("create", { form: true })}
            >
              <Plus className="size-4" strokeWidth={2} />
              Add product
            </Button>
          </>
        ) : undefined
      }
      workspace={
        <>
          <ProductImportDialog
            open={importOpen}
            onClose={() => setImportOpen(false)}
            onImported={() => void loadPage(1, false)}
            businessType={user?.businessType}
          />
          {loading && items.length === 0 && workspaceMode === "list" ? (
            <ProductsPageSkeleton />
          ) : (
            shellWorkspace
          )}
        </>
      }
      onWorkspaceCommand={onWorkspaceCommand}
      onDraftPatch={(patch) => onDraftPatch(patch as Partial<ProductDraftFields>)}
      onToolConfirm={async (tool) => {
        if (tool.name === "propose_create_product") {
          const submit = draftSubmitRef.current;
          if (!submit) return "Create form isn't ready yet — try again in a moment.";
          const result = await submit();
          if (result === true) return true;
          return result;
        }
        // Field updates/deletes proposed while still on the list (before any
        // detail navigation) — mirrors ProductDetailPage so the mutation isn't
        // dropped by a race with the detail-view navigate.
        if (tool.name === "propose_update_product") {
          const productId = String(tool.args.productId || "");
          if (!productId) return false;
          const detail = await fetchProduct(productId);
          if (!detail.ok) return false;
          const { productUpdateBodyFromToolArgs } = await import(
            "@/lib/coworker/product-update-from-tool"
          );
          const body = productUpdateBodyFromToolArgs(
            detail.product,
            tool.args,
            user?.businessType,
          );
          if (!body) return false;
          const result = await updateProduct(productId, body);
          if (!result.ok) return false;
          return true;
        }
        if (tool.name === "propose_delete_product") {
          const productId = String(tool.args.productId || "");
          if (!productId) return false;
          const result = await deleteProduct(productId);
          if (!result.ok) return false;
          return true;
        }
        return false;
      }}
      onAfterTool={() => void loadPage(1, false)}
    />
  );
}
