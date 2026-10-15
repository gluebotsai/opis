// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Mail,
  MapPin,
  Package,
  Phone,
  TrendingUp,
  User,
  XCircle,
} from "lucide-react";

import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import { BranchAddRequestModal } from "../../components/customer/BranchAddRequestModal.tsx";
import { BranchDropTimingModal } from "../../components/customer/BranchDropTimingModal.tsx";
import { CustomerPurchasedProducts } from "../../components/customer/CustomerPurchasedProducts.tsx";
import { useCustomerDashboard } from "../../hooks/useCustomerDashboard.js";
import {
  branchAddStatusLabel,
  canWithdrawBranchAddRequest,
  listMyBranchAddRequests,
  submitBranchAddRequest,
  withdrawBranchAddRequest,
} from "../../lib/branchAddRequests.js";
import {
  cancellationStatusLabel,
  canWithdrawCancellationRequest,
  effectiveTimingLabel,
  isOpenCancellationRequest,
  listMyCancellationRequests,
  submitCancellationRequest,
  withdrawCancellationRequest,
} from "../../lib/branchCancellationRequests.js";
import { getLeadCountryDefaults } from "../../lib/countryDefaults.js";
import { formatCurrency, formatDashboardDate } from "../../lib/leadDashboard.js";
import { getCustomerSession, isCustomerBranchUser } from "../../lib/customerAuth.js";
import { subscribeToAppEvents } from "../../lib/eventStream.js";

const ACCOUNT_STATS = [
  {
    key: "activeProducts",
    label: "Active products",
    hint: "Your subscribed products",
    icon: Package,
    tone: "subscriptions",
    getValue: (summary) => summary.activeProductCount,
  },
  /* Hidden for now — single-location UI.
  {
    key: "locations",
    label: "Locations",
    hint: "Account locations",
    icon: MapPin,
    tone: "customers",
    getValue: (summary) => summary.branchCount,
  },
  */
  {
    key: "mrr",
    label: "Monthly recurring",
    hint: "Estimated subscription total",
    icon: TrendingUp,
    tone: "mrr",
    getValue: (summary, format) => format(summary.monthlyRecurring, summary.currency),
  },
  {
    key: "customerSince",
    label: "Customer since",
    hint: "Account start date",
    icon: CalendarDays,
    tone: "renewals",
    getValue: (summary) => summary.customerSince,
  },
];

/** Flip to true to restore Locations panel UI (single-location hide). */
const SHOW_CUSTOMER_LOCATIONS_UI = false;

export function CustomerDashboardPage() {
  const { dashboard, lead, loading, error, refresh, entitlements } = useCustomerDashboard();
  const session = getCustomerSession();
  const branchUser = isCustomerBranchUser(session);
  const organizationId = session?.organizationId || null;

  const [branchDropMessage, setBranchDropMessage] = useState("");
  const [branchDropError, setBranchDropError] = useState("");
  const [branchDropBusy, setBranchDropBusy] = useState("");
  const [dropTarget, setDropTarget] = useState(null);
  const [dropNote, setDropNote] = useState("");
  const [cancellationRequests, setCancellationRequests] = useState([]);
  const [selectedLocationId, setSelectedLocationId] = useState(null);
  const [branchAddOpen, setBranchAddOpen] = useState(false);
  const [branchAddBusy, setBranchAddBusy] = useState(false);
  const [branchAddError, setBranchAddError] = useState("");
  const [branchAddMessage, setBranchAddMessage] = useState("");
  const [branchAddRequests, setBranchAddRequests] = useState([]);
  const [branchAddWithdrawBusy, setBranchAddWithdrawBusy] = useState("");

  const refreshCancellationRequests = useCallback(async () => {
    try {
      const rows = await listMyCancellationRequests();
      setCancellationRequests(rows);
    } catch {
      setCancellationRequests([]);
    }
  }, []);

  const refreshBranchAddRequests = useCallback(async () => {
    try {
      const rows = await listMyBranchAddRequests();
      setBranchAddRequests(rows);
    } catch {
      setBranchAddRequests([]);
    }
  }, []);

  useEffect(() => {
    void refreshCancellationRequests();
  }, [branchDropMessage, refreshCancellationRequests]);

  useEffect(() => {
    void refreshBranchAddRequests();
  }, [branchAddMessage, refreshBranchAddRequests]);

  useEffect(() => {
    let reloadTimer = null;
    const unsubscribe = subscribeToAppEvents({
      channels: ["cancellations", "payments", "quotations", "requests"],
      onEvent: (payload) => {
        const eventName = String(payload?.event || "");
        const isCancellation = eventName.startsWith("cancellation.");
        const isBranchAdd = eventName.startsWith("branch_add.");
        const isProductRequest = eventName.startsWith("product_request.");
        const isPaymentOrQuote =
          eventName === "payment.reported" ||
          eventName === "payment.paid" ||
          eventName === "payment.failed" ||
          eventName === "payment.welcome_email_updated" ||
          eventName === "payment.uat_updated" ||
          eventName === "quotation.approved" ||
          eventName === "quotation.rejected" ||
          eventName === "quotation.paid" ||
          eventName === "quotation.submitted";

        if (!isCancellation && !isBranchAdd && !isProductRequest && !isPaymentOrQuote) {
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
            void refreshCancellationRequests();
          }
          if (isBranchAdd) {
            void refreshBranchAddRequests();
          }
          void refresh({ silent: true });
        }, 400);
      },
    });

    return () => {
      unsubscribe();
      if (reloadTimer) {
        window.clearTimeout(reloadTimer);
      }
    };
  }, [organizationId, refresh, refreshBranchAddRequests, refreshCancellationRequests]);

  const pendingBranchDrops = useMemo(
    () =>
      cancellationRequests.filter(
        (entry) => entry.requestKind === "drop_branch" && isOpenCancellationRequest(entry),
      ),
    [cancellationRequests],
  );

  const pendingCancellationBySubscriptionId = useMemo(() => {
    const map = {};
    for (const entry of cancellationRequests) {
      if (
        isOpenCancellationRequest(entry) &&
        entry.requestKind === "cancel_product" &&
        entry.subscriptionId
      ) {
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

  const recentBranchDropOutcomes = useMemo(
    () =>
      cancellationRequests
        .filter(
          (entry) =>
            entry.requestKind === "drop_branch" &&
            (entry.status === "rejected" || entry.status === "approved_scheduled"),
        )
        .slice(0, 5),
    [cancellationRequests],
  );

  const pendingDropLocationIds = useMemo(
    () => new Set(pendingBranchDrops.map((entry) => entry.branchId).filter(Boolean)),
    [pendingBranchDrops],
  );

  function openBranchDropModal(location) {
    if ((location.status || "active") === "inactive" || location.scheduledDropAt) {
      return;
    }
    if (pendingDropLocationIds.has(location.id)) {
      return;
    }
    setBranchDropError("");
    setBranchDropMessage("");
    setDropNote("");
    setDropTarget(location);
  }

  async function confirmBranchDrop(effectiveTiming) {
    if (!dropTarget) {
      return;
    }

    setBranchDropBusy(dropTarget.id);
    setBranchDropError("");
    setBranchDropMessage("");

    try {
      await submitCancellationRequest({
        requestKind: "drop_branch",
        branchId: dropTarget.id,
        customerNote: dropNote.trim(),
        effectiveTiming,
        companyName: lead?.companyName || "",
        tenantId: lead?.tenantId || "",
      });
      setBranchDropMessage(
        effectiveTiming === "immediate"
          ? "Immediate branch drop request submitted to Worktual admin."
          : "Branch drop at end of billing period submitted to Worktual admin.",
      );
      setDropTarget(null);
      setDropNote("");
      await refreshCancellationRequests();
    } catch (dropError) {
      setBranchDropError(
        dropError instanceof Error ? dropError.message : "Could not submit branch drop request.",
      );
    } finally {
      setBranchDropBusy("");
    }
  }

  async function handleWithdrawBranchDrop(requestId) {
    setBranchDropBusy(requestId);
    setBranchDropError("");
    try {
      const withdrawn = await withdrawCancellationRequest(requestId);
      if (!withdrawn) {
        setBranchDropError("This branch drop request can no longer be withdrawn.");
        return;
      }
      setBranchDropMessage("Branch drop request withdrawn.");
      await refreshCancellationRequests();
    } catch (withdrawError) {
      setBranchDropError(
        withdrawError instanceof Error
          ? withdrawError.message
          : "Could not withdraw branch drop request.",
      );
    } finally {
      setBranchDropBusy("");
    }
  }

  const isHeadOfficeUser = Boolean(
    entitlements?.user?.isHeadOffice === true ||
      dashboard?.locations?.some(
        (entry) =>
          entry.isPrimary === true &&
          session?.branchId &&
          String(entry.id) === String(session.branchId),
      ),
  );

  const pendingBranchAddRequests = useMemo(
    () => branchAddRequests.filter((entry) => entry.status === "submitted"),
    [branchAddRequests],
  );

  function openBranchAddModal() {
    setBranchAddError("");
    setBranchAddOpen(true);
  }

  async function handleSubmitBranchAdd() {
    setBranchAddBusy(true);
    setBranchAddError("");
    try {
      const created = await submitBranchAddRequest({});
      if (created?.id) {
        setBranchAddRequests((current) => {
          if (current.some((entry) => entry.id === created.id)) {
            return current;
          }
          return [created, ...current];
        });
      }
      setBranchAddMessage("Branch add request sent to your sales team.");
      setBranchAddOpen(false);
      // Refresh in the background; optimistic row already keeps the session UX intact.
      void refreshBranchAddRequests();
    } catch (submitError) {
      setBranchAddError(
        submitError instanceof Error ? submitError.message : "Could not send branch add request.",
      );
    } finally {
      setBranchAddBusy(false);
    }
  }

  async function handleWithdrawBranchAdd(requestId) {
    setBranchAddWithdrawBusy(requestId);
    setBranchAddError("");
    try {
      const withdrawn = await withdrawBranchAddRequest(requestId);
      if (!withdrawn) {
        setBranchAddError("This branch add request can no longer be withdrawn.");
        return;
      }
      setBranchAddMessage("Branch add request withdrawn.");
      await refreshBranchAddRequests();
    } catch (withdrawError) {
      setBranchAddError(
        withdrawError instanceof Error
          ? withdrawError.message
          : "Could not withdraw branch add request.",
      );
    } finally {
      setBranchAddWithdrawBusy("");
    }
  }

  useEffect(() => {
    const locations = dashboard?.locations || [];
    const sessionBranchId = session?.branchId || null;
    const preferredId =
      (sessionBranchId &&
        locations.some((entry) => String(entry.id) === String(sessionBranchId)) &&
        sessionBranchId) ||
      locations.find((entry) => entry.isPrimary)?.id ||
      locations[0]?.id ||
      null;
    setSelectedLocationId((current) => {
      if (current && locations.some((entry) => entry.id === current)) {
        return current;
      }
      return preferredId;
    });
  }, [dashboard?.locations, lead?.id, session?.branchId]);

  const selectedLocation = useMemo(() => {
    const locations = dashboard?.locations || [];
    if (!locations.length) {
      return null;
    }
    return locations.find((entry) => entry.id === selectedLocationId) || locations[0];
  }, [dashboard?.locations, selectedLocationId]);

  if (loading) {
    return <p className="route-loading" role="status">Loading dashboard...</p>;
  }

  if (error) {
    return <AdminPageToast error={error} />;
  }

  if (!dashboard) {
    return null;
  }

  const pageError = branchDropError || (!branchAddOpen ? branchAddError : "");
  const pageSuccess = branchDropMessage || branchAddMessage;
  const taxLabel =
    getLeadCountryDefaults(selectedLocation?.country || lead?.country || "").taxLabel || "GST";

  return (
    <section className="lead-dashboard-page">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Customer portal</p>
          <h1>{dashboard.contact.companyName}</h1>
          <p className="page-header__copy">
            Welcome{session?.displayName ? `, ${session.displayName}` : ""}.
            {isHeadOfficeUser
              ? " Review your subscriptions, usage, and account details across all branches."
              : ` Showing ${session?.branchLabel || "your branch"} only. Products and branch drop apply to this location.`}
          </p>
        </div>
      </header>

      <AdminPageToast
        error={pageError}
        onDismiss={() => {
          setBranchDropError("");
          setBranchDropMessage("");
          setBranchAddError("");
          setBranchAddMessage("");
        }}
        success={pageSuccess}
      />

      <div className="lead-dashboard-stats">
        {ACCOUNT_STATS.map((stat) => {
          const Icon = stat.icon;
          const value =
            stat.key === "mrr"
              ? stat.getValue(dashboard.summary, formatCurrency)
              : stat.getValue(dashboard.summary);
          const hint =
            stat.key === "locations" && !isHeadOfficeUser
              ? "Your branch location"
              : stat.hint;

          return (
            <article key={stat.key} className="sales-dashboard-stat-card onboarding-card">
              <div
                className={`sales-dashboard-stat-card__icon sales-dashboard-stat-card__icon--${stat.tone}`}
              >
                <Icon size={20} strokeWidth={2} />
              </div>
              <div className="sales-dashboard-stat-card__body">
                <span className="sales-dashboard-stat-card__label">{stat.label}</span>
                <strong className="sales-dashboard-stat-card__value">{value}</strong>
                <span className="sales-dashboard-stat-card__hint">{hint}</span>
              </div>
            </article>
          );
        })}
      </div>

      <div className="lead-dashboard-grid">
        <section className="onboarding-card lead-dashboard-panel">
          <h2>Account contact</h2>
          {selectedLocation?.label ? (
            <p className="lead-dashboard-panel__caption">{selectedLocation.label}</p>
          ) : null}
          <dl className="lead-dashboard-details">
            <div>
              <dt>
                <User size={14} /> Contact
              </dt>
              <dd>{selectedLocation?.contactName || "—"}</dd>
            </div>
            <div>
              <dt>Tenant ID</dt>
              <dd>{dashboard.contact.tenantId || "—"}</dd>
            </div>
            <div>
              <dt>
                <Mail size={14} /> Work email
              </dt>
              <dd>{selectedLocation?.workEmail || dashboard.contact.workEmail || "—"}</dd>
            </div>
            <div>
              <dt>
                <Phone size={14} /> Mobile
              </dt>
              <dd>{selectedLocation?.mobile || "—"}</dd>
            </div>
            {selectedLocation?.secondaryMobile ? (
              <div>
                <dt>
                  <Phone size={14} /> Secondary mobile
                </dt>
                <dd>{selectedLocation.secondaryMobile}</dd>
              </div>
            ) : null}
            <div>
              <dt>Industry</dt>
              <dd>{selectedLocation?.industryType || "—"}</dd>
            </div>
            <div>
              <dt>{taxLabel}</dt>
              <dd>{selectedLocation?.taxNumber || "—"}</dd>
            </div>
            <div>
              <dt>
                <MapPin size={14} /> Address
              </dt>
              <dd>{selectedLocation?.address || "—"}</dd>
            </div>
          </dl>
        </section>

        {/* Hidden for now — single-location UI (set SHOW_CUSTOMER_LOCATIONS_UI to restore). */}
        {SHOW_CUSTOMER_LOCATIONS_UI ? (
        <section className="onboarding-card lead-dashboard-panel">
          <h2>Locations</h2>
          <ul className="lead-dashboard-locations">
            {dashboard.locations.map((entry) => {
              const isSelected = selectedLocation?.id === entry.id;
              return (
                <li
                  className={isSelected ? "is-active" : undefined}
                  key={entry.id || `${entry.label}-${entry.address}`}
                >
                  <button
                    aria-pressed={isSelected}
                    className="lead-dashboard-location-select"
                    onClick={() => setSelectedLocationId(entry.id)}
                    type="button"
                  >
                    <MapPin size={16} />
                    <span>
                      <strong>
                        {entry.label}
                        {(entry.status || "active") === "inactive"
                          ? " (Inactive)"
                          : entry.scheduledDropAt
                            ? ` (Scheduled to drop on ${formatDashboardDate(entry.scheduledDropAt)})`
                            : pendingDropLocationIds.has(entry.id)
                              ? " (Drop pending)"
                              : ""}
                      </strong>
                      <small>{entry.address}</small>
                    </span>
                  </button>
                  {(entry.status || "active") !== "inactive" &&
                  !entry.scheduledDropAt &&
                  !pendingDropLocationIds.has(entry.id) &&
                  (!branchUser || session?.branchId === entry.id) ? (
                    <button
                      className="secondary-button"
                      disabled={Boolean(branchDropBusy)}
                      onClick={() => openBranchDropModal(entry)}
                      type="button"
                    >
                      <XCircle size={14} />
                      Request branch drop
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {pendingBranchDrops.length ? (
            <div className="customer-branch-drop-requests">
              <h3>Pending branch drop requests</h3>
              <ul>
                {pendingBranchDrops.map((request) => (
                  <li key={request.id}>
                    <div>
                      <strong>
                        {dashboard.locations.find((entry) => entry.id === request.branchId)
                          ?.label ||
                          request.branchId ||
                          "Branch"}
                      </strong>
                      <small>
                        {cancellationStatusLabel(request.status)} ·{" "}
                        {effectiveTimingLabel(request.effectiveTiming)}
                        {request.status === "approved_scheduled" && request.effectiveAt
                          ? ` · Scheduled to drop on ${formatDashboardDate(request.effectiveAt)}`
                          : ""}
                      </small>
                    </div>
                    {canWithdrawCancellationRequest(request) ? (
                      <button
                        className="secondary-button"
                        disabled={branchDropBusy === request.id}
                        onClick={() => handleWithdrawBranchDrop(request.id)}
                        type="button"
                      >
                        Withdraw
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {recentBranchDropOutcomes.length ? (
            <div className="customer-branch-drop-requests">
              <h3>Recent branch drop decisions</h3>
              <ul>
                {recentBranchDropOutcomes.map((request) => (
                  <li key={`outcome-${request.id}`}>
                    <div>
                      <strong>
                        {dashboard.locations.find((entry) => entry.id === request.branchId)
                          ?.label ||
                          request.branchId ||
                          "Branch"}
                      </strong>
                      <small>
                        {cancellationStatusLabel(request.status)}
                        {request.status === "approved_scheduled" && request.effectiveAt
                          ? ` · Scheduled to drop on ${formatDashboardDate(request.effectiveAt)}`
                          : ""}
                      </small>
                      {request.status === "rejected" && request.adminNote ? (
                        <small className="customer-request-rejection-note">
                          Rejection note: {request.adminNote}
                        </small>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {isHeadOfficeUser ? (
            <>
              {/* Hidden for now — request new branch UI not needed.
              <div className="customer-branch-add-actions">
                <button
                  className="primary-button"
                  onClick={openBranchAddModal}
                  type="button"
                >
                  <MapPin size={16} />
                  Request new branch
                </button>
                <p className="customer-branch-add-actions__hint">
                  Ask sales to add another location to this account.
                </p>
              </div>
              */}
            </>
          ) : (
            <p className="customer-branch-add-actions__hint">
              Only the head-office portal user can request a new branch. You are signed in to{" "}
              {session?.branchLabel || "a branch location"}.
            </p>
          )}

          {pendingBranchAddRequests.length ? (
            <div className="customer-branch-drop-requests">
              <h3>Pending branch add requests</h3>
              <ul>
                {pendingBranchAddRequests.map((request) => (
                  <li key={request.id}>
                    <div>
                      <strong>{request.payload?.label || "New branch request"}</strong>
                      <small>
                        {branchAddStatusLabel(request.status)}
                        {request.createdAt
                          ? ` · ${formatDashboardDate(request.createdAt)}`
                          : ""}
                      </small>
                      <small>Sales will follow up for location details.</small>
                    </div>
                    {canWithdrawBranchAddRequest(request) ? (
                      <button
                        className="secondary-button"
                        disabled={branchAddWithdrawBusy === request.id}
                        onClick={() => handleWithdrawBranchAdd(request.id)}
                        type="button"
                      >
                        Withdraw
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
        ) : null}
      </div>

      <section className="onboarding-card lead-dashboard-panel">
        <div className="lead-dashboard-panel__heading">
          <div className="lead-dashboard-panel__heading-icon">
            <Package size={18} strokeWidth={2} />
          </div>
          <div>
            <h2>Your products</h2>
            <p>Active subscriptions with renewal dates and current usage.</p>
          </div>
        </div>

        <CustomerPurchasedProducts
          dashboard={dashboard}
          lead={lead}
          pendingCancellationBySubscriptionId={pendingCancellationBySubscriptionId}
          pendingDropBranchIds={pendingDropBranchIds}
        />
      </section>

      {dropTarget ? (
        <BranchDropTimingModal
          busy={branchDropBusy === dropTarget.id}
          branchLabel={dropTarget.label || "this branch"}
          note={dropNote}
          onCancel={() => {
            if (branchDropBusy) {
              return;
            }
            setDropTarget(null);
            setDropNote("");
          }}
          onConfirm={confirmBranchDrop}
          onNoteChange={setDropNote}
        />
      ) : null}

      {branchAddOpen ? (
        <BranchAddRequestModal
          busy={branchAddBusy}
          error={branchAddError}
          onCancel={() => {
            if (branchAddBusy) {
              return;
            }
            setBranchAddOpen(false);
            setBranchAddError("");
          }}
          onConfirm={handleSubmitBranchAdd}
        />
      ) : null}
    </section>
  );
}
