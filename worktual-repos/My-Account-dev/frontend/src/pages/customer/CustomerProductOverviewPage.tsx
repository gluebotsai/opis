// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";

import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import { ProductSubscriptionOverview } from "../../components/salesOversight/ProductSubscriptionOverview.tsx";
import { useCustomerDashboard } from "../../hooks/useCustomerDashboard.js";
import { findActiveProductByKey } from "../../lib/activeProducts.js";
import {
  isOpenCancellationRequest,
  listMyCancellationRequests,
} from "../../lib/branchCancellationRequests.js";

export function CustomerProductOverviewPage() {
  const { productKey } = useParams();
  const navigate = useNavigate();
  const { dashboard, lead, usageBySubscriptionId, loading, error } = useCustomerDashboard();
  const [cancellationRequests, setCancellationRequests] = useState([]);

  useEffect(() => {
    let active = true;

    async function loadCancellationRequests() {
      try {
        const rows = await listMyCancellationRequests();
        if (active) {
          setCancellationRequests(rows);
        }
      } catch {
        if (active) {
          setCancellationRequests([]);
        }
      }
    }

    loadCancellationRequests();
    return () => {
      active = false;
    };
  }, []);

  const activeProduct = useMemo(
    () => findActiveProductByKey(dashboard?.activeProducts || [], productKey),
    [dashboard?.activeProducts, productKey],
  );

  const pendingDropBranchIds = useMemo(() => {
    const ids = new Set();
    for (const entry of cancellationRequests) {
      if (entry.requestKind === "drop_branch" && isOpenCancellationRequest(entry) && entry.branchId) {
        ids.add(entry.branchId);
      }
    }
    return ids;
  }, [cancellationRequests]);

  const upgradeBlocked = useMemo(() => {
    if (!activeProduct) {
      return false;
    }

    if (activeProduct.branchId && pendingDropBranchIds.has(activeProduct.branchId)) {
      return true;
    }

    if (!activeProduct.subscriptionId) {
      return false;
    }

    return cancellationRequests.some(
      (entry) =>
        isOpenCancellationRequest(entry) &&
        entry.requestKind === "cancel_product" &&
        entry.subscriptionId === activeProduct.subscriptionId,
    );
  }, [activeProduct, cancellationRequests, pendingDropBranchIds]);

  if (loading) {
    return (
      <p className="route-loading" role="status">
        Loading product…
      </p>
    );
  }

  if (error) {
    return <AdminPageToast error={error} />;
  }

  const headerActions = upgradeBlocked ? (
    <span className="lead-dashboard-badge">Cancellation pending — upgrades unavailable</span>
  ) : (
    <button
      className="secondary-button"
      onClick={() =>
        navigate(`/customer/products/${encodeURIComponent(productKey || "")}/request`)
      }
      type="button"
    >
      <ArrowUpRight size={16} />
      Request upgrade
    </button>
  );

  return (
    <ProductSubscriptionOverview
      basePath="/customer/products"
      headerActions={headerActions}
      leadId={lead?.id}
      loadLead={async () => ({ lead })}
      productKey={productKey}
      usageBySubscriptionId={usageBySubscriptionId}
    />
  );
}
