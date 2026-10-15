import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowUpRight, Package, PlusCircle, XCircle } from "lucide-react";

import { CustomerPurchasedProducts } from "../../components/customer/CustomerPurchasedProducts.jsx";
import { useCustomerDashboard } from "../../hooks/useCustomerDashboard.js";
import {
  cancellationRequestLabel,
  cancellationStatusLabel,
  isOpenCancellationRequest,
  listMyCancellationRequests,
  submitCancellationRequest,
  withdrawCancellationRequest,
} from "../../lib/branchCancellationRequests.js";
import {
  cancelMyProductRequest,
  listMyProductRequests,
} from "../../lib/customerProductRequests.js";
import { isProductActiveAnywhere } from "../../lib/activeProducts.js";
import { PRODUCT_CATALOG } from "../../lib/productCatalog.js";

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
  const { dashboard, lead, loading, error } = useCustomerDashboard();
  const [requests, setRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [cancellationRequests, setCancellationRequests] = useState([]);
  const [cancellationLoading, setCancellationLoading] = useState(true);
  const [revokingId, setRevokingId] = useState("");
  const [cancellationBusyId, setCancellationBusyId] = useState("");
  const [requestActionError, setRequestActionError] = useState("");
  const [cancellationMessage, setCancellationMessage] = useState("");

  const availableNewProducts = PRODUCT_CATALOG.filter(
    (product) => !isProductActiveAnywhere(lead, product.id),
  );

  useEffect(() => {
    let active = true;

    async function loadRequests() {
      setRequestsLoading(true);
      try {
        const rows = await listMyProductRequests();
        if (active) {
          setRequests(rows);
        }
      } catch {
        if (active) {
          setRequests([]);
        }
      } finally {
        if (active) {
          setRequestsLoading(false);
        }
      }
    }

    loadRequests();
    return () => {
      active = false;
    };
  }, [location.state?.requestSubmitted]);

  useEffect(() => {
    let active = true;

    async function loadCancellationRequests() {
      setCancellationLoading(true);
      try {
        const rows = await listMyCancellationRequests();
        if (active) {
          setCancellationRequests(rows);
        }
      } catch {
        if (active) {
          setCancellationRequests([]);
        }
      } finally {
        if (active) {
          setCancellationLoading(false);
        }
      }
    }

    loadCancellationRequests();
    return () => {
      active = false;
    };
  }, [location.state?.cancellationSubmitted, cancellationMessage]);

  const pendingCancellationBySubscriptionId = useMemo(() => {
    const map = {};
    for (const entry of cancellationRequests) {
      if (isOpenCancellationRequest(entry) && entry.subscriptionId) {
        map[entry.subscriptionId] = entry;
      }
    }
    return map;
  }, [cancellationRequests]);

  function askEffectiveTiming(productLabel) {
    const endOfPeriod = window.confirm(
      `Request cancellation for ${productLabel}?\n\nCancel at end of the current billing period? (Recommended — the product stays active until then.)\n\nOK = End of billing period\nCancel = Choose immediate cancellation instead`,
    );

    if (endOfPeriod) {
      return "end_of_period";
    }

    const immediate = window.confirm(
      "Cancel immediately? Access stops as soon as Worktual admin approves the request.",
    );
    return immediate ? "immediate" : null;
  }

  async function handleRequestCancellation(entry) {
    const effectiveTiming = askEffectiveTiming(`${entry.productName} at ${entry.branchLabel}`);
    if (!effectiveTiming) {
      return;
    }

    const note = window.prompt("Optional note for Worktual admin:", "");
    if (note === null) {
      return;
    }

    setCancellationBusyId(entry.subscriptionId);
    setRequestActionError("");
    setCancellationMessage("");

    try {
      await submitCancellationRequest({
        requestKind: "cancel_product",
        locationId: entry.branchId,
        productId: entry.productId,
        subscriptionId: entry.subscriptionId,
        customerNote: note.trim(),
        effectiveTiming,
        companyName: lead?.companyName || "",
        domainId: lead?.domainId || "",
      });
      setCancellationMessage(
        effectiveTiming === "immediate"
          ? "Immediate cancellation request submitted to Worktual admin."
          : "Cancellation at end of billing period submitted to Worktual admin.",
      );
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

  async function handleWithdrawRequest(requestId) {
    setRequestActionError("");
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

  if (loading) {
    return <p className="customer-support-loading" role="status">Loading products...</p>;
  }

  if (error) {
    return <div className="form-error-banner">{error}</div>;
  }

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
          {availableNewProducts.length > 0 ? (
            <button
              className="primary-button"
              onClick={() => navigate("/customer/products/request")}
              type="button"
            >
              <PlusCircle size={16} />
              Request new product
            </button>
          ) : null}
        </div>
      </header>

      {cancellationMessage ? <div className="form-success-banner">{cancellationMessage}</div> : null}
      {requestActionError ? <div className="form-error-banner">{requestActionError}</div> : null}

      {location.state?.requestSubmitted ? (
        <div className="form-success-banner">
          Your product request was sent to the sales team. They will follow up with a quotation.
        </div>
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
          onRequestCancellation={handleRequestCancellation}
          onWithdrawCancellation={handleWithdrawCancellation}
          pendingCancellationBySubscriptionId={pendingCancellationBySubscriptionId}
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

        {!requestsLoading && !requests.length ? (
          <p className="sales-oversight-empty">
            No product requests yet. Use Request new product or Upgrade on a subscribed product.
          </p>
        ) : null}

        {!requestsLoading && requests.length > 0 ? (
          <div className="customer-product-requests">
            {requests.map((request) => (
              <article className="customer-product-request-card" key={request.id}>
                <div className="customer-product-request-card__top">
                  <strong>{request.requestNumber}</strong>
                  <span className="lead-dashboard-badge">{request.status}</span>
                </div>
                <p>
                  {(request.productSummary || [])
                    .map((entry) => entry.name)
                    .filter(Boolean)
                    .join(", ") || "Product request"}
                </p>
                <small>
                  {request.requestType} · {formatRequestDate(request.createdAt)}
                </small>
                {request.status === "submitted" ? (
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
              </article>
            ))}
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
                  {cancellationRequestLabel(request)} · {request.locationId}
                  {request.productId ? ` · ${request.productId}` : ""}
                </p>
                <small>{formatRequestDate(request.createdAt)}</small>
                {isOpenCancellationRequest(request) && request.triggerSource === "customer" ? (
                  <button
                    className="secondary-button customer-product-request-card__withdraw"
                    disabled={cancellationBusyId === request.id}
                    onClick={() => handleWithdrawCancellation(request.id)}
                    type="button"
                  >
                    <XCircle size={16} />
                    Withdraw request
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </section>
  );
}
