// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowUpRight, BellRing, Eye, Package, PencilLine, PlusCircle, XCircle } from "lucide-react";

import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import { BranchDropTimingModal } from "../../components/customer/BranchDropTimingModal.tsx";
import { CustomerPurchasedProducts } from "../../components/customer/CustomerPurchasedProducts.tsx";
import { NewProductInquiryModal } from "../../components/customer/NewProductInquiryModal.tsx";
import { ProductRequestDetailsModal } from "../../components/customer/ProductRequestDetailsModal.tsx";
import { useCustomerDashboard } from "../../hooks/useCustomerDashboard.js";
import {
  cancellationRequestLabel,
  cancellationStatusLabel,
  canWithdrawCancellationRequest,
  isOpenCancellationRequest,
  listMyCancellationRequests,
  submitCancellationRequest,
  withdrawCancellationRequest,
} from "../../lib/branchCancellationRequests.js";
import {
  cancelMyProductRequest,
  canEditCustomerProductRequest,
  canNotifyCustomerProductRequestAgain,
  createCustomerProductRequest,
  customerProductRequestStatusHint,
  customerProductRequestStatusLabel,
  findOpenInquiryProductRequest,
  formatProductRequestNewBranchSummary,
  listMyProductRequests,
  notifyMyProductRequestAgain,
  productRequestDisplayStatus,
  productRequestTypeLabel,
} from "../../lib/customerProductRequests.js";
import { getActiveProducts } from "../../lib/activeProducts.js";
import { formatCustomerPortalBranchLabel } from "../../lib/customerPortal.js";
import { getProductName, PRODUCT_CATALOG } from "../../lib/productCatalog.js";
import { getCustomerSession } from "../../lib/customerAuth.js";
import { subscribeToAppEvents } from "../../lib/eventStream.js";
import {
  acceptCustomerGoLiveProducts,
  fetchCustomerGoLiveProducts,
  goLiveStatusLabel,
  requestCustomerGoLiveChanges,
} from "../../lib/goLive.js";

function formatRequestDate(value) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function CustomerProductsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { dashboard, lead, entitlements, loading, error, refresh } = useCustomerDashboard();
  const session = getCustomerSession();
  const organizationId = session?.organizationId || null;
  const [requests, setRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [cancellationRequests, setCancellationRequests] = useState([]);
  const [cancellationLoading, setCancellationLoading] = useState(true);
  const [revokingId, setRevokingId] = useState("");
  const [notifyBusyId, setNotifyBusyId] = useState("");
  const [cancellationBusyId, setCancellationBusyId] = useState("");
  const [requestActionError, setRequestActionError] = useState("");
  const [requestActionMessage, setRequestActionMessage] = useState("");
  const [cancellationMessage, setCancellationMessage] = useState("");
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelNote, setCancelNote] = useState("");
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [requestBannerMode, setRequestBannerMode] = useState(() => {
    if (location.state?.requestNotifiedAgain) {
      return "notified";
    }
    if (location.state?.requestUpdated) {
      return "updated";
    }
    if (location.state?.requestSubmitted) {
      return "submitted";
    }
    return "";
  });
  const [goLiveProducts, setGoLiveProducts] = useState([]);
  const [goLiveBusyId, setGoLiveBusyId] = useState("");
  const [goLiveMessage, setGoLiveMessage] = useState("");
  const [goLiveError, setGoLiveError] = useState("");
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [inquiryNote, setInquiryNote] = useState("");
  const [inquiryBusy, setInquiryBusy] = useState(false);
  const [inquiryError, setInquiryError] = useState("");

  const refreshCancellationRequests = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setCancellationLoading(true);
    }
    try {
      const rows = await listMyCancellationRequests();
      setCancellationRequests(rows);
    } catch {
      setCancellationRequests([]);
    } finally {
      if (!silent) {
        setCancellationLoading(false);
      }
    }
  }, []);

  // Paid/fulfilled and withdrawn requests leave the default open list.
  const visibleRequests = useMemo(
    () =>
      requests.filter(
        (entry) => entry.status !== "fulfilled" && entry.status !== "cancelled",
      ),
    [requests],
  );

  const purchasedCatalogProductIds = useMemo(() => {
    const ids = new Set();
    for (const entry of getActiveProducts(lead)) {
      const productId = String(entry?.productId || "").trim();
      if (productId) {
        ids.add(productId);
      }
    }
    for (const entry of dashboard?.activeProducts || []) {
      const productId = String(entry?.productId || "").trim();
      if (productId) {
        ids.add(productId);
      }
    }
    for (const product of goLiveProducts) {
      const productId = String(product?.productId || "").trim();
      if (productId) {
        ids.add(productId);
      }
    }
    return ids;
  }, [dashboard?.activeProducts, goLiveProducts, lead]);

  const allCatalogProductsPurchased = PRODUCT_CATALOG.every((product) =>
    purchasedCatalogProductIds.has(product.id),
  );

  const refreshProductRequests = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setRequestsLoading(true);
    }
    try {
      const rows = await listMyProductRequests();
      setRequests(rows);
    } catch {
      setRequests([]);
    } finally {
      if (!silent) {
        setRequestsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshProductRequests();
  }, [refreshProductRequests]);

  useEffect(() => {
    const seeded = location.state?.productRequest;
    const hasSubmitFlags = Boolean(
      location.state?.requestSubmitted ||
        location.state?.requestNotifiedAgain ||
        location.state?.requestUpdated ||
        seeded,
    );
    if (!hasSubmitFlags) {
      return undefined;
    }

    if (seeded?.id) {
      setRequests((current) => {
        const without = current.filter((entry) => entry.id !== seeded.id);
        return [seeded, ...without];
      });
      setRequestsLoading(false);
    }

    let cancelled = false;
    void (async () => {
      await refreshProductRequests({ silent: true });
      if (cancelled) {
        return;
      }
      navigate(location.pathname, { replace: true, state: {} });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    location.pathname,
    location.state?.productRequest,
    location.state?.requestNotifiedAgain,
    location.state?.requestSubmitted,
    location.state?.requestUpdated,
    navigate,
    refreshProductRequests,
  ]);

  const refreshGoLive = useCallback(async () => {
    try {
      const data = await fetchCustomerGoLiveProducts();
      setGoLiveProducts(Array.isArray(data?.products) ? data.products : []);
    } catch {
      setGoLiveProducts([]);
    }
  }, []);

  useEffect(() => {
    void refreshGoLive();
  }, [refreshGoLive]);

  useEffect(() => {
    void refreshCancellationRequests();
  }, [location.state?.cancellationSubmitted, cancellationMessage, refreshCancellationRequests]);

  useEffect(() => {
    let reloadTimer = null;
    const unsubscribe = subscribeToAppEvents({
      channels: ["cancellations", "payments", "quotations", "requests"],
      onEvent: (payload) => {
        const eventName = String(payload?.event || "");
        const isCancellation = eventName.startsWith("cancellation.");
        const isProductRequest = eventName.startsWith("product_request.");
        const isPaymentOrQuote =
          eventName === "payment.reported" ||
          eventName === "payment.paid" ||
          eventName === "payment.failed" ||
          eventName === "payment.welcome_email_updated" ||
          eventName === "payment.uat_updated" ||
          eventName === "quotation.approved" ||
          eventName === "quotation.rejected" ||
          eventName === "quotation.paid";

        if (!isCancellation && !isProductRequest && !isPaymentOrQuote) {
          return;
        }
        if (
          organizationId &&
          payload.organizationId &&
          String(payload.organizationId) !== String(organizationId)
        ) {
          return;
        }

        if (reloadTimer) {
          window.clearTimeout(reloadTimer);
        }
        reloadTimer = window.setTimeout(() => {
          if (isCancellation) {
            void refreshCancellationRequests({ silent: true });
          }
          void refreshProductRequests({ silent: true });
          void refresh({ silent: true });
          void refreshGoLive();
        }, 400);
      },
    });

    return () => {
      unsubscribe();
      if (reloadTimer) {
        window.clearTimeout(reloadTimer);
      }
    };
  }, [organizationId, refresh, refreshCancellationRequests, refreshGoLive, refreshProductRequests]);

  const pendingCancellationBySubscriptionId = useMemo(() => {
    const map = {};
    for (const entry of cancellationRequests) {
      if (isOpenCancellationRequest(entry) && entry.subscriptionId) {
        map[entry.subscriptionId] = entry;
      }
    }
    return map;
  }, [cancellationRequests]);

  const pendingDropBranchIds = useMemo(() => {
    const ids = new Set();
    for (const entry of cancellationRequests) {
      if (entry.requestKind === "drop_branch" && isOpenCancellationRequest(entry) && entry.branchId) {
        ids.add(entry.branchId);
      }
    }
    return ids;
  }, [cancellationRequests]);

  const branchDropBlocksNewProduct = Boolean(
    entitlements?.user?.branchId && pendingDropBranchIds.has(entitlements.user.branchId),
  );

  function openCancellationModal(entry) {
    setRequestActionError("");
    setCancellationMessage("");
    setCancelNote("");
    setCancelTarget(entry);
  }

  async function confirmProductCancellation(effectiveTiming) {
    if (!cancelTarget) {
      return;
    }

    setCancellationBusyId(cancelTarget.subscriptionId);
    setRequestActionError("");
    setCancellationMessage("");

    try {
      await submitCancellationRequest({
        requestKind: "cancel_product",
        branchId: cancelTarget.branchId,
        productId: cancelTarget.productId,
        subscriptionId: cancelTarget.subscriptionId,
        customerNote: cancelNote.trim(),
        effectiveTiming,
        companyName: lead?.companyName || "",
        tenantId: lead?.tenantId || "",
      });
      setCancellationMessage(
        effectiveTiming === "immediate"
          ? "Immediate cancellation request submitted to Worktual admin."
          : "Cancellation at end of billing period submitted to Worktual admin.",
      );
      setCancelTarget(null);
      setCancelNote("");
      const rows = await listMyCancellationRequests();
      setCancellationRequests(rows);
    } catch (error) {
      setRequestActionError(
        error instanceof Error ? error.message : "Could not submit cancellation request.",
      );
    } finally {
      setCancellationBusyId("");
    }
  }

  async function handleWithdrawCancellation(requestId) {
    setCancellationBusyId(requestId);
    setRequestActionError("");
    try {
      const withdrawn = await withdrawCancellationRequest(requestId);
      if (!withdrawn) {
        setRequestActionError("This cancellation request can no longer be withdrawn.");
        return;
      }
      setCancellationRequests((current) =>
        current.map((entry) => (entry.id === requestId ? withdrawn : entry)),
      );
    } catch (error) {
      setRequestActionError(
        error instanceof Error ? error.message : "Could not withdraw cancellation request.",
      );
    } finally {
      setCancellationBusyId("");
    }
  }

  async function handleAcceptGoLive(product) {
    setGoLiveBusyId(product.id);
    setGoLiveError("");
    setGoLiveMessage("");
    try {
      await acceptCustomerGoLiveProducts([product.id]);
      setGoLiveMessage(
        "Accepted — ready to purchase. A prorated invoice was sent to finance for approval, and your sales contact was notified.",
      );
      await refreshGoLive();
    } catch (acceptError) {
      setGoLiveError(
        acceptError instanceof Error ? acceptError.message : "Could not accept product.",
      );
    } finally {
      setGoLiveBusyId("");
    }
  }

  async function handleRequestGoLiveChanges(product) {
    const note = window.prompt("Describe the changes you need before go-live:");
    if (note === null) {
      return;
    }
    setGoLiveBusyId(product.id);
    setGoLiveError("");
    try {
      await requestCustomerGoLiveChanges(product.id, note);
      setGoLiveMessage("Change request sent to sales. They will extend UAT after updates.");
      await refreshGoLive();
    } catch (changeError) {
      setGoLiveError(
        changeError instanceof Error ? changeError.message : "Could not submit change request.",
      );
    } finally {
      setGoLiveBusyId("");
    }
  }

  async function handleWithdrawRequest(requestId) {
    setRequestActionError("");
    setRequestActionMessage("");
    setRevokingId(requestId);

    try {
      const cancelled = await cancelMyProductRequest(requestId);
      if (!cancelled) {
        setRequestActionError("This request can no longer be withdrawn.");
        return;
      }

      setRequests((current) =>
        current.map((entry) => (entry.id === requestId ? cancelled : entry)),
      );
      setSelectedRequest((current) =>
        current?.id === requestId ? cancelled : current,
      );
    } catch (withdrawError) {
      setRequestActionError(
        withdrawError instanceof Error
          ? withdrawError.message
          : "Could not withdraw this request.",
      );
    } finally {
      setRevokingId("");
    }
  }

  function handleEditProductRequest(request) {
    navigate("/customer/products/request", {
      state: {
        seedFromProductRequest: request,
        customerEditRequest: true,
      },
    });
  }

  async function handleNotifyProductRequestAgain(requestId) {
    setRequestActionError("");
    setRequestActionMessage("");
    setNotifyBusyId(requestId);
    try {
      await notifyMyProductRequestAgain(requestId);
      setRequestActionMessage("Sales was notified again about this product request.");
      await refreshProductRequests({ silent: true });
    } catch (notifyError) {
      setRequestActionError(
        notifyError instanceof Error
          ? notifyError.message
          : "Could not notify sales again.",
      );
    } finally {
      setNotifyBusyId("");
    }
  }

  function openNewProductInquiry() {
    if (allCatalogProductsPurchased || branchDropBlocksNewProduct) {
      return;
    }
    setInquiryError("");
    setInquiryNote("");
    setInquiryOpen(true);
  }

  async function confirmNewProductInquiry() {
    const note = inquiryNote.trim();
    if (!note) {
      setInquiryError("Add a note for sales before notifying them.");
      return;
    }

    setInquiryBusy(true);
    setInquiryError("");
    setRequestActionError("");
    setRequestActionMessage("");

    try {
      const existingInquiry = findOpenInquiryProductRequest(visibleRequests);
      if (existingInquiry?.id) {
        await notifyMyProductRequestAgain(existingInquiry.id);
        setRequestActionMessage("Sales was notified again about your product inquiry.");
        setInquiryOpen(false);
        setInquiryNote("");
        await refreshProductRequests({ silent: true });
        return;
      }

      const created = await createCustomerProductRequest({
        requestType: "inquiry",
        assignments: [],
        productSummary: [],
        customerNote: note,
        companyName: lead?.companyName || "",
        tenantId: lead?.tenantId || "",
        contactEmail: session?.email || "",
      });

      if (created?.id) {
        setRequests((current) => {
          const without = current.filter((entry) => entry.id !== created.id);
          return [created, ...without];
        });
      }
      setRequestActionMessage(
        "Your product inquiry was sent to the sales team. They will follow up shortly.",
      );
      setInquiryOpen(false);
      setInquiryNote("");
      await refreshProductRequests({ silent: true });
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Could not send product inquiry.";
      const existing = submitError?.existingRequest;
      if (existing?.id || /open product request already exists/i.test(message)) {
        try {
          const inquiry = existing || findOpenInquiryProductRequest(visibleRequests);
          if (inquiry?.id) {
            await notifyMyProductRequestAgain(inquiry.id);
            setRequestActionMessage("Sales was notified again about your product inquiry.");
            setInquiryOpen(false);
            setInquiryNote("");
            await refreshProductRequests({ silent: true });
            return;
          }
        } catch {
          // Fall through to show the original error in the modal.
        }
      }
      setInquiryError(message);
    } finally {
      setInquiryBusy(false);
    }
  }

  if (loading) {
    return <p className="customer-support-loading" role="status">Loading products...</p>;
  }

  if (error) {
    return <AdminPageToast error={error} />;
  }

  const requestBannerSuccess =
    requestBannerMode === "notified"
      ? "Sales was notified again about your existing product request."
      : requestBannerMode === "updated"
        ? "Your product request was updated and sales was notified."
        : requestBannerMode === "submitted"
          ? "Your product request was sent to the sales team. They will follow up with a quotation."
          : "";
  const pageError = goLiveError || requestActionError;
  const pageSuccess =
    cancellationMessage || goLiveMessage || requestActionMessage || requestBannerSuccess;

  return (
    <section className="lead-dashboard-page">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Customer portal</p>
          <h1>Products</h1>
          <p className="page-header__copy">
            Review subscriptions, request upgrades, or ask sales about new products.
          </p>
        </div>
        <div className="page-header__actions customer-products-actions">
          {branchDropBlocksNewProduct ? (
            <span className="lead-dashboard-badge">Branch drop pending — new products unavailable</span>
          ) : (
            <button
              className="primary-button"
              disabled={allCatalogProductsPurchased}
              onClick={openNewProductInquiry}
              title={
                allCatalogProductsPurchased
                  ? "All products already purchased"
                  : "Notify sales about a new product"
              }
              type="button"
            >
              <PlusCircle size={16} />
              Request new product
            </button>
          )}
        </div>
      </header>

      <AdminPageToast
        error={pageError}
        onDismiss={() => {
          setGoLiveError("");
          setRequestActionError("");
          setCancellationMessage("");
          setGoLiveMessage("");
          setRequestActionMessage("");
          setRequestBannerMode("");
        }}
        success={pageSuccess}
      />

      {goLiveProducts.length ? (
        <section className="onboarding-card lead-dashboard-panel">
          <h2>My Plans — Accept to purchase</h2>
          <p className="page-header__copy">
            After testing UAT, accept a product when you are ready to purchase. That creates the
            first prorated subscription invoice for finance, or request changes so sales can extend
            UAT after updates.
          </p>
          <div className="lead-dashboard-paid-history__list">
            {goLiveProducts.map((product) => {
              const inUat = ["uat", "uat_expired"].includes(product.lifecycleStatus);
              return (
                <div className="lead-dashboard-payment-row" key={product.id}>
                  <div className="lead-dashboard-payment-row__main">
                    <div className="lead-dashboard-payment-row__amount">
                      <strong>
                        {getProductName(product.productId)}
                        {/* Hidden for now — single-location UI.
                        {" · "}
                        {formatCustomerPortalBranchLabel(
                          lead,
                          product.branchId,
                          product.branchLabel,
                        )}
                        */}
                      </strong>
                      <span className="lead-dashboard-badge lead-dashboard-badge--in-progress">
                        {goLiveStatusLabel(product.lifecycleStatus)}
                      </span>
                    </div>
                    {product.uatExpiresAt ? (
                      <small>
                        UAT expires {new Date(product.uatExpiresAt).toLocaleString()}
                      </small>
                    ) : null}
                  </div>
                  {inUat ? (
                    <div className="lead-dashboard-payment-row__actions">
                      <button
                        className="primary-button"
                        disabled={goLiveBusyId === product.id}
                        onClick={() => void handleAcceptGoLive(product)}
                        type="button"
                      >
                        Accept — ready to purchase
                      </button>
                      <button
                        className="secondary-button"
                        disabled={goLiveBusyId === product.id}
                        onClick={() => void handleRequestGoLiveChanges(product)}
                        type="button"
                      >
                        Request changes
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="onboarding-card lead-dashboard-panel">
        <div className="lead-dashboard-panel__heading">
          <div className="lead-dashboard-panel__heading-icon">
            <Package size={18} strokeWidth={2} />
          </div>
          <div>
            <h2>Subscribed products</h2>
            <p>
              {dashboard?.summary?.activeProductCount || 0} active product
              {(dashboard?.summary?.activeProductCount || 0) === 1 ? "" : "s"} across your
              locations.
            </p>
          </div>
        </div>

        <CustomerPurchasedProducts
          cancellationBusyId={cancellationBusyId}
          dashboard={dashboard}
          emptyMessage="No products are linked to your portal account yet."
          lead={lead}
          onRequestCancellation={openCancellationModal}
          onWithdrawCancellation={handleWithdrawCancellation}
          pendingCancellationBySubscriptionId={pendingCancellationBySubscriptionId}
          pendingDropBranchIds={pendingDropBranchIds}
          showCancellationActions
          showUpgradeActions
        />
      </section>

      <section className="onboarding-card lead-dashboard-panel">
        <div className="lead-dashboard-panel__heading">
          <div className="lead-dashboard-panel__heading-icon">
            <ArrowUpRight size={18} strokeWidth={2} />
          </div>
          <div>
            <h2>Product requests</h2>
            <p>Requests submitted to sales for new products or upgrades.</p>
          </div>
        </div>

        {requestsLoading ? (
          <p className="customer-support-loading" role="status">
            Loading requests...
          </p>
        ) : null}

        {!requestsLoading && !visibleRequests.length ? (
          <p className="sales-oversight-empty">
            No product requests yet. Use Request new product to notify sales, or Upgrade on a
            subscribed product.
          </p>
        ) : null}

        {!requestsLoading && visibleRequests.length > 0 ? (
          <div className="customer-product-requests">
            {visibleRequests.map((request) => {
              const newBranchSummary = formatProductRequestNewBranchSummary(request);
              const statusHint = customerProductRequestStatusHint(request);
              const canWithdraw = productRequestDisplayStatus(request) === "open";
              const canEdit = canEditCustomerProductRequest(request);
              const canNotify = canNotifyCustomerProductRequestAgain(request);

              return (
              <article className="customer-product-request-card" key={request.id}>
                <div className="customer-product-request-card__top">
                  <strong>{request.requestNumber}</strong>
                  <span className="lead-dashboard-badge">
                    {customerProductRequestStatusLabel(request)}
                  </span>
                </div>
                <p>
                  {(request.productSummary || [])
                    .map((entry) => entry.name)
                    .filter(Boolean)
                    .join(", ") || "Product request"}
                </p>
                {statusHint ? <small>{statusHint}</small> : null}
                {newBranchSummary ? <small>{newBranchSummary}</small> : null}
                <small>
                  {productRequestTypeLabel(request.requestType)} ·{" "}
                  {formatRequestDate(request.createdAt)}
                </small>
                {request.salespersonName ? (
                  <small>Salesperson · {request.salespersonName}</small>
                ) : null}
                <div className="customer-product-request-card__actions">
                  <button
                    className="secondary-button"
                    onClick={() => setSelectedRequest(request)}
                    type="button"
                  >
                    <Eye size={16} />
                    View details
                  </button>
                  {canEdit ? (
                    <button
                      className="secondary-button"
                      onClick={() => handleEditProductRequest(request)}
                      type="button"
                    >
                      <PencilLine size={16} />
                      Edit request
                    </button>
                  ) : null}
                  {canNotify ? (
                    <button
                      className="secondary-button"
                      disabled={notifyBusyId === request.id}
                      onClick={() => void handleNotifyProductRequestAgain(request.id)}
                      type="button"
                    >
                      <BellRing size={16} />
                      {notifyBusyId === request.id ? "Notifying..." : "Notify again"}
                    </button>
                  ) : null}
                  {canWithdraw ? (
                    <button
                      className="secondary-button customer-product-request-card__withdraw"
                      disabled={revokingId === request.id}
                      onClick={() => handleWithdrawRequest(request.id)}
                      type="button"
                    >
                      <XCircle size={16} />
                      {revokingId === request.id ? "Withdrawing..." : "Withdraw request"}
                    </button>
                  ) : null}
                </div>
              </article>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className="onboarding-card lead-dashboard-panel">
        <div className="lead-dashboard-panel__heading">
          <div className="lead-dashboard-panel__heading-icon">
            <XCircle size={18} strokeWidth={2} />
          </div>
          <div>
            <h2>Cancellation requests</h2>
            <p>Branch or product cancellation requests awaiting Worktual admin review.</p>
          </div>
        </div>

        {cancellationLoading ? (
          <p className="customer-support-loading" role="status">
            Loading cancellation requests...
          </p>
        ) : null}

        {!cancellationLoading && !cancellationRequests.length ? (
          <p className="sales-oversight-empty">No cancellation requests yet.</p>
        ) : null}

        {!cancellationLoading && cancellationRequests.length > 0 ? (
          <div className="customer-product-requests">
            {cancellationRequests.map((request) => (
              <article className="customer-product-request-card" key={request.id}>
                <div className="customer-product-request-card__top">
                  <strong>{request.requestNumber}</strong>
                  <span className="lead-dashboard-badge">
                    {cancellationStatusLabel(request.status)}
                  </span>
                </div>
                <p>
                  {cancellationRequestLabel(request)}
                  {/* Hidden for now — single-location UI.
                  {" · "}
                  {formatCustomerPortalBranchLabel(lead, request.branchId)}
                  */}
                  {request.productId ? ` · ${getProductName(request.productId)}` : ""}
                </p>
                <small>{formatRequestDate(request.createdAt)}</small>
                {request.status === "rejected" && request.adminNote ? (
                  <p className="customer-request-rejection-note">
                    Rejection note: {request.adminNote}
                  </p>
                ) : null}
                {request.status === "approved_scheduled" && request.effectiveAt ? (
                  <span className="lead-dashboard-badge">
                    Scheduled to drop on {formatRequestDate(request.effectiveAt)}
                  </span>
                ) : null}
                {canWithdrawCancellationRequest(request) ? (
                  <button
                    className="secondary-button customer-product-request-card__withdraw"
                    disabled={cancellationBusyId === request.id}
                    onClick={() => handleWithdrawCancellation(request.id)}
                    type="button"
                  >
                    <XCircle size={16} />
                    Withdraw request
                  </button>
                ) : request.status === "approved_scheduled" && !request.effectiveAt ? (
                  <span className="lead-dashboard-badge">Scheduled to drop at period end</span>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </section>

      {cancelTarget ? (
        <BranchDropTimingModal
          ariaLabel="Request product cancellation"
          busy={cancellationBusyId === cancelTarget.subscriptionId}
          branchLabel={`${cancelTarget.productName} at ${cancelTarget.branchLabel}`}
          copy="Choose when this product should stop. Worktual admin must approve before cancellation takes effect."
          eyebrow="Product cancellation"
          note={cancelNote}
          onCancel={() => {
            if (cancellationBusyId) {
              return;
            }
            setCancelTarget(null);
            setCancelNote("");
          }}
          onConfirm={confirmProductCancellation}
          onNoteChange={setCancelNote}
          title={`Cancel ${cancelTarget.productName}?`}
        />
      ) : null}

      {inquiryOpen ? (
        <NewProductInquiryModal
          busy={inquiryBusy}
          error={inquiryError}
          note={inquiryNote}
          onCancel={() => {
            if (inquiryBusy) {
              return;
            }
            setInquiryOpen(false);
            setInquiryNote("");
            setInquiryError("");
          }}
          onConfirm={() => void confirmNewProductInquiry()}
          onNoteChange={setInquiryNote}
        />
      ) : null}

      {selectedRequest ? (
        <ProductRequestDetailsModal
          onClose={() => {
            if (revokingId) {
              return;
            }
            setSelectedRequest(null);
          }}
          onWithdraw={handleWithdrawRequest}
          request={selectedRequest}
          withdrawing={revokingId === selectedRequest.id}
        />
      ) : null}
    </section>
  );
}
