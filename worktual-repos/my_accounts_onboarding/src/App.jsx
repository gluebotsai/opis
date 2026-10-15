import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AdminRoute, CustomerRoute, FinanceRoute, SalesAdminRoute, SalesWorkspaceRoute } from "./components/ProtectedRoute.jsx";
import { AdminShell } from "./layouts/AdminShell.jsx";
import { CustomerPortalShell } from "./layouts/CustomerPortalShell.jsx";
import { FinanceShell } from "./layouts/FinanceShell.jsx";
import { SalesAdminShell } from "./layouts/SalesAdminShell.jsx";
import { SalesWorkspaceShell } from "./layouts/SalesWorkspaceShell.jsx";
import { SetupWorkspaceLayout } from "./pages/customer/setup/SetupWorkspaceLayout.jsx";

const ComposeEmailPage = lazy(() =>
  import("./pages/ComposeEmailPage.jsx").then((module) => ({
    default: module.ComposeEmailPage,
  })),
);
const MailPage = lazy(() =>
  import("./pages/MailPage.jsx").then((module) => ({ default: module.MailPage })),
);
const FinanceQueuePage = lazy(() =>
  import("./pages/FinanceQueuePage.jsx").then((module) => ({
    default: module.FinanceQueuePage,
  })),
);
const AdminPricingPage = lazy(() =>
  import("./pages/AdminPricingPage.jsx").then((module) => ({
    default: module.AdminPricingPage,
  })),
);
const AdminUsersPage = lazy(() =>
  import("./pages/AdminUsersPage.jsx").then((module) => ({
    default: module.AdminUsersPage,
  })),
);
const AdminCancellationQueuePage = lazy(() =>
  import("./pages/admin/AdminCancellationQueuePage.jsx").then((module) => ({
    default: module.AdminCancellationQueuePage,
  })),
);
const AccountSettingsPage = lazy(() =>
  import("./pages/AccountSettingsPage.jsx").then((module) => ({
    default: module.AccountSettingsPage,
  })),
);
const SalesSupportPage = lazy(() =>
  import("./pages/SalesSupportPage.jsx").then((module) => ({
    default: module.SalesSupportPage,
  })),
);
const LoginPage = lazy(() =>
  import("./pages/LoginPage.jsx").then((module) => ({ default: module.LoginPage })),
);
const SetupUserSetPasswordPage = lazy(() =>
  import("./pages/SetupUserSetPasswordPage.jsx").then((module) => ({
    default: module.SetupUserSetPasswordPage,
  })),
);
const CustomerDashboardPage = lazy(() =>
  import("./pages/customer/CustomerDashboardPage.jsx").then((module) => ({
    default: module.CustomerDashboardPage,
  })),
);
const CustomerProductsPage = lazy(() =>
  import("./pages/customer/CustomerProductsPage.jsx").then((module) => ({
    default: module.CustomerProductsPage,
  })),
);
const CustomerProductRequestPage = lazy(() =>
  import("./pages/customer/CustomerProductRequestPage.jsx").then((module) => ({
    default: module.CustomerProductRequestPage,
  })),
);
const CustomerProductOverviewPage = lazy(() =>
  import("./pages/customer/CustomerProductOverviewPage.jsx").then((module) => ({
    default: module.CustomerProductOverviewPage,
  })),
);
const CustomerSupportPage = lazy(() =>
  import("./pages/customer/CustomerSupportPage.jsx").then((module) => ({
    default: module.CustomerSupportPage,
  })),
);
const CustomerAccountPage = lazy(() =>
  import("./pages/customer/CustomerAccountPage.jsx").then((module) => ({
    default: module.CustomerAccountPage,
  })),
);
const SetupBusinessProfilePage = lazy(() =>
  import("./pages/customer/setup/SetupBusinessProfilePage.jsx").then((module) => ({
    default: module.SetupBusinessProfilePage,
  })),
);
const SetupBranchesPage = lazy(() =>
  import("./pages/customer/setup/SetupBranchesPage.jsx").then((module) => ({
    default: module.SetupBranchesPage,
  })),
);
const SetupBusinessHoursPage = lazy(() =>
  import("./pages/customer/setup/SetupBusinessHoursPage.jsx").then((module) => ({
    default: module.SetupBusinessHoursPage,
  })),
);
const SetupTeamsPage = lazy(() =>
  import("./pages/customer/setup/SetupTeamsPage.jsx").then((module) => ({
    default: module.SetupTeamsPage,
  })),
);
const SetupQueuesPage = lazy(() =>
  import("./pages/customer/setup/SetupQueuesPage.jsx").then((module) => ({
    default: module.SetupQueuesPage,
  })),
);
const SetupQueueDetailPage = lazy(() =>
  import("./pages/customer/setup/SetupQueueDetailPage.jsx").then((module) => ({
    default: module.SetupQueueDetailPage,
  })),
);
const SetupTeamDetailPage = lazy(() =>
  import("./pages/customer/setup/SetupTeamDetailPage.jsx").then((module) => ({
    default: module.SetupTeamDetailPage,
  })),
);
const SetupPeoplePage = lazy(() =>
  import("./pages/customer/setup/SetupPeoplePage.jsx").then((module) => ({
    default: module.SetupPeoplePage,
  })),
);
const SetupRolesPage = lazy(() =>
  import("./pages/customer/setup/SetupRolesPage.jsx").then((module) => ({
    default: module.SetupRolesPage,
  })),
);
const SetupKnowledgeBasePage = lazy(() =>
  import("./pages/customer/setup/SetupKnowledgeBasePage.jsx").then((module) => ({
    default: module.SetupKnowledgeBasePage,
  })),
);
const SetupCommunicationPage = lazy(() =>
  import("./pages/customer/setup/SetupCommunicationPage.jsx").then((module) => ({
    default: module.SetupCommunicationPage,
  })),
);
const SetupEmailConfigPage = lazy(() =>
  import("./pages/customer/setup/SetupEmailConfigPage.jsx").then((module) => ({
    default: module.SetupEmailConfigPage,
  })),
);
const SetupWebchatConfigPage = lazy(() =>
  import("./pages/customer/setup/SetupWebchatConfigPage.jsx").then((module) => ({
    default: module.SetupWebchatConfigPage,
  })),
);
const SetupIntegrationsPage = lazy(() =>
  import("./pages/customer/setup/SetupIntegrationsPage.jsx").then((module) => ({
    default: module.SetupIntegrationsPage,
  })),
);
const SetupCustomerHubPage = lazy(() =>
  import("./pages/customer/setup/SetupCustomerHubPage.jsx").then((module) => ({
    default: module.SetupCustomerHubPage,
  })),
);
const OnboardingPage = lazy(() =>
  import("./pages/OnboardingPage.jsx").then((module) => ({ default: module.OnboardingPage })),
);
const ProductsPage = lazy(() =>
  import("./pages/ProductsPage.jsx").then((module) => ({ default: module.ProductsPage })),
);
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage.jsx").then((module) => ({
    default: module.DashboardPage,
  })),
);
const LeadDashboardPage = lazy(() =>
  import("./pages/LeadDashboardPage.jsx").then((module) => ({
    default: module.LeadDashboardPage,
  })),
);
const LeadProductOverviewPage = lazy(() =>
  import("./pages/LeadProductOverviewPage.jsx").then((module) => ({
    default: module.LeadProductOverviewPage,
  })),
);
const ProductWorkflowPage = lazy(() =>
  import("./pages/ProductWorkflowPage.jsx").then((module) => ({
    default: module.ProductWorkflowPage,
  })),
);
const ForwardPaymentPage = lazy(() =>
  import("./pages/ForwardPaymentPage.jsx").then((module) => ({
    default: module.ForwardPaymentPage,
  })),
);
const SalesAdminAgentsPage = lazy(() =>
  import("./pages/SalesAdminAgentsPage.jsx").then((module) => ({
    default: module.SalesAdminAgentsPage,
  })),
);
const SalesAdminAgentDetailPage = lazy(() =>
  import("./pages/SalesAdminAgentDetailPage.jsx").then((module) => ({
    default: module.SalesAdminAgentDetailPage,
  })),
);
const SalesAdminLeadPage = lazy(() =>
  import("./pages/SalesAdminLeadPage.jsx").then((module) => ({
    default: module.SalesAdminLeadPage,
  })),
);
const SalesAdminLeadProductPage = lazy(() =>
  import("./pages/SalesAdminLeadProductPage.jsx").then((module) => ({
    default: module.SalesAdminLeadProductPage,
  })),
);
const AdminSalesOversightPage = lazy(() =>
  import("./pages/AdminSalesOversightPage.jsx").then((module) => ({
    default: module.AdminSalesOversightPage,
  })),
);
const AdminSalesAgentsPage = lazy(() =>
  import("./pages/AdminSalesAgentsPage.jsx").then((module) => ({
    default: module.AdminSalesAgentsPage,
  })),
);
const AdminSalesAgentDetailPage = lazy(() =>
  import("./pages/AdminSalesAgentDetailPage.jsx").then((module) => ({
    default: module.AdminSalesAgentDetailPage,
  })),
);
const AdminSalesLeadPage = lazy(() =>
  import("./pages/AdminSalesLeadPage.jsx").then((module) => ({
    default: module.AdminSalesLeadPage,
  })),
);
const AdminSalesLeadProductPage = lazy(() =>
  import("./pages/AdminSalesLeadProductPage.jsx").then((module) => ({
    default: module.AdminSalesLeadProductPage,
  })),
);

function RouteLoading() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      <span className="route-loading__spinner" aria-hidden="true" />
      Loading workspace...
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/invite/set-password" element={<SetupUserSetPasswordPage />} />
        <Route path="/finance/login" element={<Navigate to="/" replace />} />
        <Route path="/customer/login" element={<Navigate to="/" replace />} />

        <Route
          path="/customer/dashboard"
          element={
            <CustomerRoute>
              <CustomerPortalShell>
                <CustomerDashboardPage />
              </CustomerPortalShell>
            </CustomerRoute>
          }
        />
        <Route
          path="/customer/products"
          element={
            <CustomerRoute>
              <CustomerPortalShell>
                <CustomerProductsPage />
              </CustomerPortalShell>
            </CustomerRoute>
          }
        />
        <Route
          path="/customer/products/request"
          element={
            <CustomerRoute>
              <CustomerPortalShell>
                <CustomerProductRequestPage requestIntent="new" />
              </CustomerPortalShell>
            </CustomerRoute>
          }
        />
        <Route
          path="/customer/products/:productKey/request"
          element={
            <CustomerRoute>
              <CustomerPortalShell>
                <CustomerProductRequestPage requestIntent="upgrade" />
              </CustomerPortalShell>
            </CustomerRoute>
          }
        />
        <Route
          path="/customer/products/:productKey"
          element={
            <CustomerRoute>
              <CustomerPortalShell>
                <CustomerProductOverviewPage />
              </CustomerPortalShell>
            </CustomerRoute>
          }
        />
        <Route
          path="/customer/setup"
          element={
            <CustomerRoute>
              <CustomerPortalShell>
                <SetupWorkspaceLayout />
              </CustomerPortalShell>
            </CustomerRoute>
          }
        >
          <Route index element={<Navigate to="business-profile" replace />} />
          <Route path="business-profile" element={<SetupBusinessProfilePage />} />
          <Route path="branches" element={<SetupBranchesPage />} />
          <Route path="business-hours" element={<SetupBusinessHoursPage />} />
          <Route path="departments" element={<Navigate to="../teams" replace />} />
          <Route path="teams" element={<SetupTeamsPage />} />
          <Route path="teams/:teamId" element={<SetupTeamDetailPage />} />
          <Route path="queues" element={<SetupQueuesPage />} />
          <Route path="queues/:queueId" element={<SetupQueueDetailPage />} />
          <Route path="people" element={<SetupPeoplePage />} />
          <Route path="roles" element={<SetupRolesPage />} />
          <Route path="knowledge-base" element={<SetupKnowledgeBasePage />} />
          <Route path="communication" element={<SetupCommunicationPage />} />
          <Route path="communication/email/:configId" element={<SetupEmailConfigPage />} />
          <Route path="communication/web-chat/:configId" element={<SetupWebchatConfigPage />} />
          <Route path="integrations" element={<SetupIntegrationsPage />} />
          <Route path="customer-hub" element={<SetupCustomerHubPage />} />
        </Route>
        <Route path="/customer/onboarding" element={<Navigate to="/customer/setup" replace />} />
        <Route path="/customer/operational-hub" element={<Navigate to="/customer/setup" replace />} />
        <Route
          path="/customer/account"
          element={
            <CustomerRoute>
              <CustomerPortalShell>
                <CustomerAccountPage />
              </CustomerPortalShell>
            </CustomerRoute>
          }
        />
        <Route path="/customer/mail" element={<Navigate to="/customer/dashboard" replace />} />
        <Route
          path="/customer/support"
          element={
            <CustomerRoute>
              <CustomerPortalShell>
                <CustomerSupportPage />
              </CustomerPortalShell>
            </CustomerRoute>
          }
        />
        <Route path="/customer" element={<Navigate to="/customer/dashboard" replace />} />

        <Route
          path="/finance/account"
          element={
            <FinanceRoute>
              <FinanceShell>
                <AccountSettingsPage title="Finance account" />
              </FinanceShell>
            </FinanceRoute>
          }
        />

        <Route
          path="/finance/queue"
          element={
            <FinanceRoute>
              <FinanceShell>
                <FinanceQueuePage />
              </FinanceShell>
            </FinanceRoute>
          }
        />

        <Route
          path="/finance/mail"
          element={
            <FinanceRoute>
              <FinanceShell>
                <MailPage />
              </FinanceShell>
            </FinanceRoute>
          }
        />

        <Route
          path="/admin/users"
          element={
            <AdminRoute>
              <AdminShell>
                <AdminUsersPage />
              </AdminShell>
            </AdminRoute>
          }
        />

        <Route
          path="/admin/cancellation-requests"
          element={
            <AdminRoute>
              <AdminShell>
                <AdminCancellationQueuePage />
              </AdminShell>
            </AdminRoute>
          }
        />

        <Route
          path="/admin/pricing"
          element={
            <AdminRoute>
              <AdminShell>
                <AdminPricingPage />
              </AdminShell>
            </AdminRoute>
          }
        />

        <Route
          path="/admin/mail"
          element={
            <AdminRoute>
              <AdminShell>
                <MailPage />
              </AdminShell>
            </AdminRoute>
          }
        />

        <Route
          path="/admin/account"
          element={
            <AdminRoute>
              <AdminShell>
                <AccountSettingsPage title="Admin account" />
              </AdminShell>
            </AdminRoute>
          }
        />

        <Route
          path="/admin/sales"
          element={
            <AdminRoute>
              <AdminShell>
                <AdminSalesOversightPage />
              </AdminShell>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/sales/agents"
          element={
            <AdminRoute>
              <AdminShell>
                <AdminSalesAgentsPage />
              </AdminShell>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/sales/agents/:userId"
          element={
            <AdminRoute>
              <AdminShell>
                <AdminSalesAgentDetailPage />
              </AdminShell>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/sales/leads/:leadId/products/*"
          element={
            <AdminRoute>
              <AdminShell>
                <AdminSalesLeadProductPage />
              </AdminShell>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/sales/leads/:leadId"
          element={
            <AdminRoute>
              <AdminShell>
                <AdminSalesLeadPage />
              </AdminShell>
            </AdminRoute>
          }
        />

        <Route
          path="/sales-admin/dashboard"
          element={
            <SalesAdminRoute>
              <Navigate replace to="/dashboard" />
            </SalesAdminRoute>
          }
        />
        <Route
          path="/sales-admin/agents"
          element={
            <SalesAdminRoute>
              <SalesAdminShell>
                <SalesAdminAgentsPage />
              </SalesAdminShell>
            </SalesAdminRoute>
          }
        />
        <Route
          path="/sales-admin/agents/:userId"
          element={
            <SalesAdminRoute>
              <SalesAdminShell>
                <SalesAdminAgentDetailPage />
              </SalesAdminShell>
            </SalesAdminRoute>
          }
        />
        <Route
          path="/sales-admin/leads/:leadId/products/*"
          element={
            <SalesAdminRoute>
              <SalesAdminShell>
                <SalesAdminLeadProductPage />
              </SalesAdminShell>
            </SalesAdminRoute>
          }
        />
        <Route
          path="/sales-admin/leads/:leadId"
          element={
            <SalesAdminRoute>
              <SalesAdminShell>
                <SalesAdminLeadPage />
              </SalesAdminShell>
            </SalesAdminRoute>
          }
        />
        <Route
          path="/sales-admin/mail"
          element={
            <SalesAdminRoute>
              <Navigate replace to="/mail" />
            </SalesAdminRoute>
          }
        />
        <Route
          path="/sales-admin/support"
          element={
            <SalesAdminRoute>
              <Navigate replace to="/support" />
            </SalesAdminRoute>
          }
        />
        <Route
          path="/sales-admin/account"
          element={
            <SalesAdminRoute>
              <Navigate replace to="/account" />
            </SalesAdminRoute>
          }
        />

        <Route
          path="/dashboard"
          element={
            <SalesWorkspaceRoute>
              <SalesWorkspaceShell>
                <DashboardPage />
              </SalesWorkspaceShell>
            </SalesWorkspaceRoute>
          }
        />
        <Route
          path="/onboarding"
          element={
            <SalesWorkspaceRoute>
              <SalesWorkspaceShell>
                <OnboardingPage />
              </SalesWorkspaceShell>
            </SalesWorkspaceRoute>
          }
        />
        <Route
          path="/onboarding/:leadId/edit"
          element={
            <SalesWorkspaceRoute>
              <SalesWorkspaceShell>
                <OnboardingPage />
              </SalesWorkspaceShell>
            </SalesWorkspaceRoute>
          }
        />
        <Route
          path="/products"
          element={
            <SalesWorkspaceRoute>
              <SalesWorkspaceShell>
                <ProductsPage />
              </SalesWorkspaceShell>
            </SalesWorkspaceRoute>
          }
        />
        <Route
          path="/products/:leadId/products/*"
          element={
            <SalesWorkspaceRoute>
              <SalesWorkspaceShell>
                <LeadProductOverviewPage />
              </SalesWorkspaceShell>
            </SalesWorkspaceRoute>
          }
        />
        <Route
          path="/products/:leadId"
          element={
            <SalesWorkspaceRoute>
              <SalesWorkspaceShell>
                <LeadDashboardPage />
              </SalesWorkspaceShell>
            </SalesWorkspaceRoute>
          }
        />
        <Route
          path="/products/:leadId/workflow"
          element={
            <SalesWorkspaceRoute>
              <SalesWorkspaceShell>
                <ProductWorkflowPage />
              </SalesWorkspaceShell>
            </SalesWorkspaceRoute>
          }
        />
        <Route
          path="/products/:leadId/payment-forward"
          element={
            <SalesWorkspaceRoute>
              <SalesWorkspaceShell>
                <ForwardPaymentPage />
              </SalesWorkspaceShell>
            </SalesWorkspaceRoute>
          }
        />
        <Route
          path="/products/:leadId/compose"
          element={
            <SalesWorkspaceRoute>
              <SalesWorkspaceShell>
                <ComposeEmailPage />
              </SalesWorkspaceShell>
            </SalesWorkspaceRoute>
          }
        />

        <Route
          path="/account"
          element={
            <SalesWorkspaceRoute>
              <SalesWorkspaceShell>
                <AccountSettingsPage title="My Profile" />
              </SalesWorkspaceShell>
            </SalesWorkspaceRoute>
          }
        />

        <Route
          path="/mail"
          element={
            <SalesWorkspaceRoute>
              <SalesWorkspaceShell>
                <MailPage />
              </SalesWorkspaceShell>
            </SalesWorkspaceRoute>
          }
        />

        <Route
          path="/support"
          element={
            <SalesWorkspaceRoute>
              <SalesWorkspaceShell>
                <SalesSupportPage />
              </SalesWorkspaceShell>
            </SalesWorkspaceRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
