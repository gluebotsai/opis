import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { WorkspaceViewSelect } from "../components/WorkspaceViewSelect.jsx";
import { SalesOversightDashboard } from "../components/salesOversight/SalesOversightDashboard.jsx";
import { isSalesAdminSession } from "../lib/auth.js";
import {
  DASHBOARD_VIEW_OPTIONS,
  DASHBOARD_VIEWS,
  parseDashboardView,
} from "../lib/workspaceViews.js";
import { SalesDashboardPage } from "./SalesDashboardPage.jsx";

const VIEW_COPY = {
  [DASHBOARD_VIEWS.TEAM]: {
    eyebrow: "Sales Admin",
    description: "Monitor sales performance, pipeline health, and agent workload.",
  },
  [DASHBOARD_VIEWS.MINE]: {
    eyebrow: "Sales workspace",
    description:
      "Real-time portfolio insights across your customers, subscriptions, usage, renewals, and financial health.",
  },
};

export function DashboardPage() {
  const isSalesAdmin = isSalesAdminSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = isSalesAdmin
    ? parseDashboardView(searchParams.get("view"))
    : DASHBOARD_VIEWS.MINE;

  const copy = VIEW_COPY[view];

  function handleViewChange(nextView) {
    if (!isSalesAdmin) {
      return;
    }

    const params = new URLSearchParams(searchParams);
    if (nextView === DASHBOARD_VIEWS.TEAM) {
      params.delete("view");
    } else {
      params.set("view", nextView);
    }
    setSearchParams(params, { replace: true });
  }

  const title = useMemo(() => {
    if (!isSalesAdmin) {
      return "Sales overview";
    }

    return (
      <WorkspaceViewSelect
        aria-label="Dashboard view"
        onChange={handleViewChange}
        options={DASHBOARD_VIEW_OPTIONS}
        value={view}
      />
    );
  }, [isSalesAdmin, view, searchParams]);

  if (isSalesAdmin && view === DASHBOARD_VIEWS.TEAM) {
    return (
      <SalesOversightDashboard
        basePath="/sales-admin"
        headerDescription={copy.description}
        headerEyebrow={copy.eyebrow}
        headerTitle={title}
        hideDefaultTitle
      />
    );
  }

  return (
    <SalesDashboardPage
      headerDescription={copy.description}
      headerEyebrow={isSalesAdmin ? copy.eyebrow : null}
      headerTitle={isSalesAdmin ? title : "Sales overview"}
      hideDefaultTitle={isSalesAdmin}
      leadScope={isSalesAdmin ? "mine" : undefined}
    />
  );
}
