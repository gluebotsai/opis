import type { ReactNode } from "react";
import { ActivitiesPageSkeleton } from "@/pages/ActivitiesPageSkeleton";
import { AgentsPageSkeleton } from "@/pages/AgentsPageSkeleton";
import { CompaniesPageSkeleton } from "@/pages/CompaniesPageSkeleton";
import { CompanyDetailPageSkeleton } from "@/pages/CompanyDetailPageSkeleton";
import { CompanyFormFieldsSkeleton } from "@/pages/CompanyFormPageSkeleton";
import { ContactDetailPageSkeleton } from "@/pages/ContactDetailPageSkeleton";
import { ContactFormPageSkeleton } from "@/pages/ContactFormPageSkeleton";
import { ContactsPageSkeleton } from "@/pages/ContactsPageSkeleton";
import { DashboardPageSkeleton } from "@/pages/DashboardPageSkeleton";
import { DealDetailPageSkeleton } from "@/pages/DealDetailPageSkeleton";
import { DealFormPageSkeleton } from "@/pages/DealFormPageSkeleton";
import {
  FinanceInvoiceCreateSkeleton,
  FinanceInvoiceDetailSkeleton,
  FinancePageSkeleton,
} from "@/pages/FinancePageSkeleton";
import { InboxPageSkeleton } from "@/pages/InboxPageSkeleton";
import { ProcessApprovalsPageSkeleton } from "@/pages/ProcessApprovalsPageSkeleton";
import { ProductsPageSkeleton } from "@/pages/ProductsPageSkeleton";
import { ReportsPageSkeleton } from "@/pages/ReportsPageSkeleton";
import {
  SalesCalendarAsideSkeleton,
  SalesCalendarGridSkeleton,
} from "@/pages/SalesCalendarPageSkeleton";
import { SalesPipelineKanbanSkeleton } from "@/pages/SalesPipelinePageSkeleton";
import { MODULE_WORKSPACE_DESCRIPTION } from "@/lib/module-workspace-copy";
import {
  GenericWorkspaceSkeleton,
  ModuleShellSkeleton,
} from "./ModuleShellSkeleton";

function shell(title: string, workspace?: ReactNode, subtitle?: string) {
  return (
    <ModuleShellSkeleton
      title={title}
      subtitle={subtitle}
      workspace={workspace}
    />
  );
}

function CalendarSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 xl:flex-row">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-default bg-surface">
        <SalesCalendarGridSkeleton />
      </section>
      <aside className="flex w-full shrink-0 flex-col gap-4 overflow-hidden xl:w-[300px]">
        <SalesCalendarAsideSkeleton />
      </aside>
    </div>
  );
}

type RouteSkeleton = {
  test: RegExp;
  render: () => ReactNode;
};

/** Most-specific routes must stay above their list/detail parents. */
const ROUTE_SKELETONS: RouteSkeleton[] = [
  {
    test: /^\/contact\/new\/?$/,
    render: () => shell("Contact", <ContactFormPageSkeleton />),
  },
  {
    test: /^\/contact\/[^/]+\/edit\/?$/,
    render: () => shell("Contact", <ContactFormPageSkeleton />),
  },
  {
    test: /^\/contact\/[^/]+\/?$/,
    render: () => shell("Contact", <ContactDetailPageSkeleton />),
  },
  {
    test: /^\/contact\/?$/,
    render: () =>
      shell(
        "Contacts",
        <ContactsPageSkeleton />,
        MODULE_WORKSPACE_DESCRIPTION.contacts,
      ),
  },
  {
    test: /^\/company\/new\/?$/,
    render: () => shell("Company", <CompanyFormFieldsSkeleton />),
  },
  {
    test: /^\/company\/[^/]+\/locations\/.*$/,
    render: () => shell("Company", <GenericWorkspaceSkeleton />),
  },
  {
    test: /^\/company\/[^/]+\/edit\/?$/,
    render: () => shell("Company", <CompanyFormFieldsSkeleton />),
  },
  {
    test: /^\/company\/[^/]+\/?$/,
    render: () => shell("Company", <CompanyDetailPageSkeleton />),
  },
  {
    test: /^\/company\/?$/,
    render: () =>
      shell(
        "Companies",
        <CompaniesPageSkeleton />,
        MODULE_WORKSPACE_DESCRIPTION.companies,
      ),
  },
  {
    test: /^\/sales\/quotes(?:\/.*)?$/,
    render: () =>
      shell("Quotes", <GenericWorkspaceSkeleton />, MODULE_WORKSPACE_DESCRIPTION.quotes),
  },
  {
    test: /^\/sales\/proposals\/[^/]+\/?$/,
    render: () => shell("Proposal", <GenericWorkspaceSkeleton />),
  },
  {
    test: /^\/sales\/calendar\/?$/,
    render: () => shell("Calendar", <CalendarSkeleton />),
  },
  {
    test: /^\/sales\/new\/?$/,
    render: () => shell("Deal", <DealFormPageSkeleton />),
  },
  {
    test: /^\/sales\/[^/]+\/edit\/?$/,
    render: () => shell("Deal", <DealFormPageSkeleton />),
  },
  {
    test: /^\/sales\/[^/]+\/?$/,
    render: () => shell("Deal", <DealDetailPageSkeleton />),
  },
  {
    test: /^\/sales\/?$/,
    render: () =>
      shell(
        "Pipeline",
        <SalesPipelineKanbanSkeleton />,
        MODULE_WORKSPACE_DESCRIPTION.pipelineKanban,
      ),
  },
  {
    test: /^\/finance\/new\/?$/,
    render: () => shell("Invoice", <FinanceInvoiceCreateSkeleton />),
  },
  {
    test: /^\/finance\/[^/]+\/?$/,
    render: () => shell("Invoice", <FinanceInvoiceDetailSkeleton />),
  },
  {
    test: /^\/finance\/?$/,
    render: () =>
      shell(
        "Finance",
        <FinancePageSkeleton />,
        MODULE_WORKSPACE_DESCRIPTION.finance,
      ),
  },
  {
    test: /^\/product(?:\/.*)?$/,
    render: () =>
      shell(
        "Products",
        <ProductsPageSkeleton />,
        MODULE_WORKSPACE_DESCRIPTION.products,
      ),
  },
  {
    test: /^\/activities(?:\/.*)?$/,
    render: () =>
      shell(
        "Activities",
        <ActivitiesPageSkeleton />,
        MODULE_WORKSPACE_DESCRIPTION.activities,
      ),
  },
  {
    test: /^\/dashboard\/?$/,
    render: () =>
      shell(
        "Dashboard",
        <DashboardPageSkeleton />,
        MODULE_WORKSPACE_DESCRIPTION.dashboard,
      ),
  },
  {
    test: /^\/reports\/?$/,
    render: () =>
      shell(
        "Reports & Analytics",
        <ReportsPageSkeleton />,
        MODULE_WORKSPACE_DESCRIPTION.reportsMarketing,
      ),
  },
  {
    test: /^\/agents\/?$/,
    render: () =>
      shell(
        "Agents",
        <AgentsPageSkeleton />,
        MODULE_WORKSPACE_DESCRIPTION.agents,
      ),
  },
  {
    test: /^\/agents\/.*$/,
    render: () => shell("Agents", <GenericWorkspaceSkeleton />),
  },
  {
    test: /^\/process-approvals\/?$/,
    render: () => shell("Process approvals", <ProcessApprovalsPageSkeleton />),
  },
  {
    test: /^\/inbox\/?$/,
    render: () => <InboxPageSkeleton />,
  },
  {
    test: /^\/commerce(?:\/.*)?$/,
    render: () =>
      shell(
        "Commerce",
        <GenericWorkspaceSkeleton />,
        MODULE_WORKSPACE_DESCRIPTION.commerce,
      ),
  },
  {
    test: /^\/service\/?$/,
    render: () =>
      shell(
        "Service",
        <GenericWorkspaceSkeleton />,
        MODULE_WORKSPACE_DESCRIPTION.service,
      ),
  },
  {
    test: /^\/configuration(?:\/.*)?$/,
    render: () => shell("Configuration", <GenericWorkspaceSkeleton />),
  },
  {
    test: /^\/privacy-requests(?:\/.*)?$/,
    render: () => shell("Privacy requests", <GenericWorkspaceSkeleton />),
  },
  {
    test: /^\/marketing\/seo\/?$/,
    render: () => shell("SEO", <GenericWorkspaceSkeleton />),
  },
];

export function RouteFallbackSkeleton({ pathname }: { pathname: string }) {
  const match = ROUTE_SKELETONS.find((entry) => entry.test.test(pathname));
  return match ? match.render() : <GenericWorkspaceSkeleton />;
}
