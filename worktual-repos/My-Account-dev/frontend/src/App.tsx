// @ts-nocheck
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";

import { AdminRoute, CustomerRoute, FinanceRoute, NumberManagementRoute, PartnerRoute, ResellerRoute, SalesAdminRoute, SalesOversightRoute, SalesWorkspaceRoute } from "./components/ProtectedRoute.tsx";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary.tsx";
import { RedirectPathPrefix } from "./components/RedirectPathPrefix.tsx";
import { AdminShell } from "./layouts/AdminShell.tsx";
import { CustomerPortalShell } from "./layouts/CustomerPortalShell.tsx";
import { PartnerShell } from "./layouts/PartnerShell.tsx";
import { ResellerShell } from "./layouts/ResellerShell.tsx";
import { FinanceShell } from "./layouts/FinanceShell.tsx";
import { NumberManagementShell } from "./layouts/NumberManagementShell.tsx";
import { SalesOversightLayout } from "./layouts/SalesOversightLayout.tsx";
import { SalesWorkspaceShell } from "./layouts/SalesWorkspaceShell.tsx";
/* Re-apply after route/page CSS chunks so dark overrides win the cascade. */
import "./styles/theme-dark.css";

const ComposeEmailPage = lazy(() =>
  import("./pages/ComposeEmailPage.tsx").then((module) => ({
    default: module.ComposeEmailPage,
  })),
);
const MailPage = lazy(() =>
  import("./pages/MailPage.tsx").then((module) => ({ default: module.MailPage })),
);
const MailOAuthCallbackPage = lazy(() =>
  import("./pages/MailOAuthCallbackPage.tsx").then((module) => ({
    default: module.MailOAuthCallbackPage,
  })),
);
const FinanceQueuePage = lazy(() =>
  import("./pages/FinanceQueuePage.tsx").then((module) => ({
    default: module.FinanceQueuePage,
  })),
);
const AdminPricingPage = lazy(() =>
  import("./pages/AdminPricingPage.tsx").then((module) => ({
    default: module.AdminPricingPage,
  })),
);
const AdminUsersPage = lazy(() =>
  import("./pages/AdminUsersPage.tsx").then((module) => ({
    default: module.AdminUsersPage,
  })),
);
const AdminCancellationQueuePage = lazy(() =>
  import("./pages/admin/AdminCancellationQueuePage.tsx").then((module) => ({
    default: module.AdminCancellationQueuePage,
  })),
);
const AccountSettingsPage = lazy(() =>
  import("./pages/AccountSettingsPage.tsx").then((module) => ({
    default: module.AccountSettingsPage,
  })),
);
const SalesAccountPage = lazy(() =>
  import("./pages/SalesAccountPage.tsx").then((module) => ({
    default: module.SalesAccountPage,
  })),
);
const NumberManagementAccountPage = lazy(() =>
  import("./pages/NumberManagementAccountPage.tsx").then((module) => ({
    default: module.NumberManagementAccountPage,
  })),
);
const AdminAccountPage = lazy(() =>
  import("./pages/admin/AdminAccountPage.tsx").then((module) => ({
    default: module.AdminAccountPage,
  })),
);
const SalesSupportPage = lazy(() =>
  import("./pages/SalesSupportPage.tsx").then((module) => ({
    default: module.SalesSupportPage,
  })),
);

function OnboardingEditRedirect() {
  const { leadId } = useParams();
  return <Navigate replace state={{ openEditLeadId: leadId }} to="/products" />;
}
const LoginPage = lazy(() =>
  import("./pages/LoginPage.tsx").then((module) => ({ default: module.LoginPage })),
);
const CustomerDashboardPage = lazy(() =>
  import("./pages/customer/CustomerDashboardPage.tsx").then((module) => ({
    default: module.CustomerDashboardPage,
  })),
);
const CustomerProductsPage = lazy(() =>
  import("./pages/customer/CustomerProductsPage.tsx").then((module) => ({
    default: module.CustomerProductsPage,
  })),
);
const CustomerProductRequestPage = lazy(() =>
  import("./pages/customer/CustomerProductRequestPage.tsx").then((module) => ({
    default: module.CustomerProductRequestPage,
  })),
);
const CustomerProductOverviewPage = lazy(() =>
  import("./pages/customer/CustomerProductOverviewPage.tsx").then((module) => ({
    default: module.CustomerProductOverviewPage,
  })),
);
const CustomerOnboardingPage = lazy(() =>
  import("./pages/customer/CustomerOnboardingPage.tsx").then((module) => ({
    default: module.CustomerOnboardingPage,
  })),
);
const CustomerOperationalHubPage = lazy(() =>
  import("./pages/customer/CustomerOperationalHubPage.tsx").then((module) => ({
    default: module.CustomerOperationalHubPage,
  })),
);
const CustomerSupportPage = lazy(() =>
  import("./pages/customer/CustomerSupportPage.tsx").then((module) => ({
    default: module.CustomerSupportPage,
  })),
);
const CustomerAccountPage = lazy(() =>
  import("./pages/customer/CustomerAccountPage.tsx").then((module) => ({
    default: module.CustomerAccountPage,
  })),
);
const CustomerInvoicesPage = lazy(() =>
  import("./pages/customer/CustomerInvoicesPage.tsx").then((module) => ({
    default: module.CustomerInvoicesPage,
  })),
);
const ProductsPage = lazy(() =>
  import("./pages/ProductsPage.tsx").then((module) => ({ default: module.ProductsPage })),
);
const CustomersPage = lazy(() =>
  import("./pages/CustomersPage.tsx").then((module) => ({ default: module.CustomersPage })),
);
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage.tsx").then((module) => ({
    default: module.DashboardPage,
  })),
);
const LeadDashboardPage = lazy(() =>
  import("./pages/LeadDashboardPage.tsx").then((module) => ({
    default: module.LeadDashboardPage,
  })),
);
const LeadProductOverviewPage = lazy(() =>
  import("./pages/LeadProductOverviewPage.tsx").then((module) => ({
    default: module.LeadProductOverviewPage,
  })),
);
const ProductWorkflowPage = lazy(() =>
  import("./pages/ProductWorkflowPage.tsx").then((module) => ({
    default: module.ProductWorkflowPage,
  })),
);
const ImplementationUatPage = lazy(() =>
  import("./pages/ImplementationUatPage.tsx").then((module) => ({
    default: module.ImplementationUatPage,
  })),
);
const ForwardPaymentPage = lazy(() =>
  import("./pages/ForwardPaymentPage.tsx").then((module) => ({
    default: module.ForwardPaymentPage,
  })),
);
const SalesOversightHomePage = lazy(() =>
  import("./pages/SalesOversightRoutePages.tsx").then((module) => ({
    default: module.SalesOversightHomePage,
  })),
);
const SalesOversightAgentsPage = lazy(() =>
  import("./pages/SalesOversightRoutePages.tsx").then((module) => ({
    default: module.SalesOversightAgentsPage,
  })),
);
const SalesOversightAgentDetailPage = lazy(() =>
  import("./pages/SalesOversightRoutePages.tsx").then((module) => ({
    default: module.SalesOversightAgentDetailPage,
  })),
);
const SalesOversightLeadPage = lazy(() =>
  import("./pages/SalesOversightRoutePages.tsx").then((module) => ({
    default: module.SalesOversightLeadPage,
  })),
);
const SalesOversightLeadProductPage = lazy(() =>
  import("./pages/SalesOversightRoutePages.tsx").then((module) => ({
    default: module.SalesOversightLeadProductPage,
  })),
);
const ResellersPage = lazy(() =>
  import("./pages/admin/ResellersPage.tsx").then((module) => ({
    default: module.ResellersPage,
  })),
);
const PartnersPage = lazy(() =>
  import("./pages/admin/PartnersPage.tsx").then((module) => ({
    default: module.PartnersPage,
  })),
);
const AdminCustomerPortalUsersPage = lazy(() =>
  import("./pages/admin/AdminCustomerPortalUsersPage.tsx").then((module) => ({
    default: module.AdminCustomerPortalUsersPage,
  })),
);
const PartnerCreatePage = lazy(() =>
  import("./pages/admin/PartnerCreatePage.tsx").then((module) => ({
    default: module.PartnerCreatePage,
  })),
);
const PartnerEditPage = lazy(() =>
  import("./pages/admin/PartnerEditPage.tsx").then((module) => ({
    default: module.PartnerEditPage,
  })),
);
const AdminCommissionSlabsPage = lazy(() =>
  import("./pages/admin/AdminCommissionSlabsPage.tsx").then((module) => ({
    default: module.AdminCommissionSlabsPage,
  })),
);
const AdminInvoiceSettingsPage = lazy(() =>
  import("./pages/admin/AdminInvoiceSettingsPage.tsx").then((module) => ({
    default: module.AdminInvoiceSettingsPage,
  })),
);
const FinancePartnerCommissionsPage = lazy(() =>
  import("./pages/FinancePartnerCommissionsPage.tsx").then((module) => ({
    default: module.FinancePartnerCommissionsPage,
  })),
);
const FinancePartnerCommissionDetailPage = lazy(() =>
  import("./pages/FinancePartnerCommissionDetailPage.tsx").then((module) => ({
    default: module.FinancePartnerCommissionDetailPage,
  })),
);
const FinanceAccountPage = lazy(() =>
  import("./pages/FinanceAccountPage.tsx").then((module) => ({
    default: module.FinanceAccountPage,
  })),
);
const NumberManagementDashboardPage = lazy(() =>
  import("./pages/numberManagement/NumberManagementDashboardPage.tsx").then((module) => ({
    default: module.NumberManagementDashboardPage,
  })),
);
const NumberMappingPage = lazy(() =>
  import("./pages/numberManagement/NumberMappingPage.tsx").then((module) => ({
    default: module.NumberMappingPage,
  })),
);
const NumberInventoryPage = lazy(() =>
  import("./pages/numberManagement/NumberInventoryPage.tsx").then((module) => ({
    default: module.NumberInventoryPage,
  })),
);
const NumberManagementCustomerDetailPage = lazy(() =>
  import("./pages/numberManagement/NumberManagementCustomerDetailPage.tsx").then((module) => ({
    default: module.NumberManagementCustomerDetailPage,
  })),
);
const CommissionSlabsViewPage = lazy(() =>
  import("./pages/CommissionSlabsViewPage.tsx").then((module) => ({
    default: module.CommissionSlabsViewPage,
  })),
);
const PartnerBankDetailsPage = lazy(() =>
  import("./pages/partner/PartnerBankDetailsPage.tsx").then((module) => ({
    default: module.PartnerBankDetailsPage,
  })),
);
const PartnerCommissionsPage = lazy(() =>
  import("./pages/partner/PartnerCommissionsPage.tsx").then((module) => ({
    default: module.PartnerCommissionsPage,
  })),
);
const ResellerCreatePage = lazy(() =>
  import("./pages/admin/ResellerCreatePage.tsx").then((module) => ({
    default: module.ResellerCreatePage,
  })),
);
const ResellerEditPage = lazy(() =>
  import("./pages/admin/ResellerEditPage.tsx").then((module) => ({
    default: module.ResellerEditPage,
  })),
);
const PartnerDashboardPage = lazy(() =>
  import("./pages/partner/PartnerDashboardPage.tsx").then((module) => ({
    default: module.PartnerDashboardPage,
  })),
);
const PartnerLeadsPage = lazy(() =>
  import("./pages/partner/PartnerLeadsPage.tsx").then((module) => ({
    default: module.PartnerLeadsPage,
  })),
);
const PartnerLeadDetailPage = lazy(() =>
  import("./pages/partner/PartnerLeadDetailPage.tsx").then((module) => ({
    default: module.PartnerLeadDetailPage,
  })),
);
const PartnerCreateLeadPage = lazy(() =>
  import("./pages/partner/PartnerCreateLeadPage.tsx").then((module) => ({
    default: module.PartnerCreateLeadPage,
  })),
);
const ResellerDashboardPage = lazy(() =>
  import("./pages/reseller/ResellerDashboardPage.tsx").then((module) => ({
    default: module.ResellerDashboardPage,
  })),
);
const ResellerLeadsPage = lazy(() =>
  import("./pages/reseller/ResellerLeadsPage.tsx").then((module) => ({
    default: module.ResellerLeadsPage,
  })),
);
const ResellerLeadDetailPage = lazy(() =>
  import("./pages/reseller/ResellerLeadDetailPage.tsx").then((module) => ({
    default: module.ResellerLeadDetailPage,
  })),
);
const ResellerRenewalsPage = lazy(() =>
  import("./pages/reseller/ResellerRenewalsPage.tsx").then((module) => ({
    default: module.ResellerRenewalsPage,
  })),
);
const ResellerInvoicesPage = lazy(() =>
  import("./pages/reseller/ResellerInvoicesPage.tsx").then((module) => ({
    default: module.ResellerInvoicesPage,
  })),
);
const ResellerCreateLeadPage = lazy(() =>
  import("./pages/reseller/ResellerCreateLeadPage.tsx").then((module) => ({
    default: module.ResellerCreateLeadPage,
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

function AdminLayout() {
  return (
    <AdminRoute>
      <AdminShell />
    </AdminRoute>
  );
}

function FinanceLayout() {
  return (
    <FinanceRoute>
      <FinanceShell />
    </FinanceRoute>
  );
}

function NumberManagementLayout() {
  return (
    <NumberManagementRoute>
      <NumberManagementShell />
    </NumberManagementRoute>
  );
}

function SalesWorkspaceLayout() {
  return (
    <SalesWorkspaceRoute>
      <SalesWorkspaceShell />
    </SalesWorkspaceRoute>
  );
}

function CustomerLayout() {
  return (
    <CustomerRoute>
      <CustomerPortalShell />
    </CustomerRoute>
  );
}

function PartnerLayout() {
  return (
    <PartnerRoute>
      <PartnerShell />
    </PartnerRoute>
  );
}

function ResellerLayout() {
  return (
    <ResellerRoute>
      <ResellerShell />
    </ResellerRoute>
  );
}

function SalesOversightShellLayout() {
  return (
    <SalesOversightRoute>
      <SalesOversightLayout />
    </SalesOversightRoute>
  );
}

export default function App() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <RouteErrorBoundary>
        <Routes>
          <Route path="/" element={<LoginPage />} />
          <Route path="/finance/login" element={<Navigate to="/" replace />} />
          <Route path="/customer/login" element={<Navigate to="/" replace />} />
          <Route path="/mail/oauth-callback" element={<MailOAuthCallbackPage />} />

          <Route element={<CustomerLayout />}>
            <Route path="/customer/dashboard" element={<CustomerDashboardPage />} />
            <Route path="/customer/products" element={<CustomerProductsPage />} />
            <Route path="/customer/products/request" element={<CustomerProductRequestPage />} />
            <Route
              path="/customer/products/:productKey/request"
              element={<CustomerProductRequestPage />}
            />
            <Route path="/customer/products/:productKey" element={<CustomerProductOverviewPage />} />
            <Route path="/customer/onboarding" element={<CustomerOnboardingPage />} />
            <Route path="/customer/operational-hub" element={<CustomerOperationalHubPage />} />
            <Route path="/customer/account" element={<CustomerAccountPage />} />
            <Route path="/customer/invoices" element={<CustomerInvoicesPage />} />
            <Route path="/customer/support" element={<CustomerSupportPage />} />
          </Route>
          <Route path="/customer/mail" element={<Navigate to="/customer/dashboard" replace />} />
          <Route path="/customer" element={<Navigate to="/customer/dashboard" replace />} />

          <Route element={<ResellerLayout />}>
            <Route path="/reseller/dashboard" element={<ResellerDashboardPage />} />
            <Route path="/reseller/leads/:leadId" element={<ResellerLeadDetailPage />} />
            <Route path="/reseller/leads" element={<ResellerLeadsPage />} />
            <Route path="/reseller/renewals" element={<ResellerRenewalsPage />} />
            <Route path="/reseller/invoices" element={<ResellerInvoicesPage />} />
            <Route path="/reseller/create-lead" element={<ResellerCreateLeadPage />} />
          </Route>
          <Route path="/reseller" element={<Navigate to="/reseller/dashboard" replace />} />

          <Route element={<PartnerLayout />}>
            <Route path="/partner/dashboard" element={<PartnerDashboardPage />} />
            <Route path="/partner/lead-creation" element={<PartnerCreateLeadPage />} />
            <Route
              path="/partner/create-lead"
              element={<Navigate to="/partner/lead-creation" replace />}
            />
            <Route path="/partner/leads/:leadId" element={<PartnerLeadDetailPage />} />
            <Route path="/partner/leads" element={<PartnerLeadsPage />} />
            <Route path="/partner/commissions" element={<PartnerCommissionsPage />} />
            <Route path="/partner/bank-details" element={<PartnerBankDetailsPage />} />
            <Route
              path="/partner/commission-slabs"
              element={<CommissionSlabsViewPage eyebrow="Partner" title="Commission slabs" />}
            />
          </Route>
          <Route path="/partner" element={<Navigate to="/partner/dashboard" replace />} />

          <Route element={<FinanceLayout />}>
            <Route path="/finance/account" element={<FinanceAccountPage />} />
            <Route path="/finance/queue" element={<FinanceQueuePage />} />
            <Route path="/finance/commissions" element={<FinancePartnerCommissionsPage />} />
            <Route
              path="/finance/commissions/partners/:partnerId"
              element={<FinancePartnerCommissionDetailPage />}
            />
            <Route
              path="/finance/commission-slabs"
              element={<Navigate replace to="/finance/commissions" />}
            />
            <Route path="/finance/mail" element={<MailPage />} />
          </Route>

          <Route
            path="/number-management"
            element={<Navigate replace to="/number-management/dashboard" />}
          />
          <Route element={<NumberManagementLayout />}>
            <Route path="/number-management/dashboard" element={<NumberManagementDashboardPage />} />
            <Route path="/number-management/inventory" element={<NumberInventoryPage />} />
            <Route path="/number-management/mappings" element={<NumberMappingPage />} />
            <Route
              path="/number-management/customers/:organizationId"
              element={<NumberManagementCustomerDetailPage />}
            />
            <Route path="/number-management/mail" element={<MailPage />} />
            <Route path="/number-management/account" element={<NumberManagementAccountPage />} />
          </Route>

          <Route element={<AdminLayout />}>
            <Route path="/admin/partners/new" element={<PartnerCreatePage />} />
            <Route path="/admin/partners/:partnerId/edit" element={<PartnerEditPage />} />
            <Route path="/admin/partners" element={<PartnersPage />} />
            <Route path="/admin/commission-slabs" element={<AdminCommissionSlabsPage />} />
            <Route path="/admin/invoice-settings" element={<AdminInvoiceSettingsPage />} />
            <Route path="/admin/resellers/new" element={<ResellerCreatePage />} />
            <Route path="/admin/resellers/:resellerId/edit" element={<ResellerEditPage />} />
            <Route path="/admin/resellers" element={<ResellersPage />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/admin/customer-portal-users" element={<AdminCustomerPortalUsersPage />} />
            <Route path="/admin/cancellation-requests" element={<AdminCancellationQueuePage />} />
            <Route path="/admin/pricing" element={<AdminPricingPage />} />
            <Route path="/admin/mail" element={<MailPage />} />
            <Route path="/admin/account" element={<AdminAccountPage />} />
          </Route>

          <Route element={<SalesOversightShellLayout />}>
            <Route path="/sales-oversight" element={<SalesOversightHomePage />} />
            <Route path="/sales-oversight/agents" element={<SalesOversightAgentsPage />} />
            <Route path="/sales-oversight/agents/:userId" element={<SalesOversightAgentDetailPage />} />
            <Route
              path="/sales-oversight/leads/:leadId/products/*"
              element={<SalesOversightLeadProductPage />}
            />
            <Route path="/sales-oversight/leads/:leadId" element={<SalesOversightLeadPage />} />
          </Route>

          <Route
            path="/admin/sales/*"
            element={<RedirectPathPrefix from="/admin/sales" to="/sales-oversight" />}
          />
          <Route
            path="/sales-admin/agents/*"
            element={<RedirectPathPrefix from="/sales-admin/agents" to="/sales-oversight/agents" />}
          />
          <Route
            path="/sales-admin/leads/*"
            element={<RedirectPathPrefix from="/sales-admin/leads" to="/sales-oversight/leads" />}
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

          <Route element={<SalesWorkspaceLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/onboarding/:leadId/edit" element={<OnboardingEditRedirect />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/customers/:leadId" element={<LeadDashboardPage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/products/:leadId/products/*" element={<LeadProductOverviewPage />} />
            <Route path="/products/:leadId" element={<LeadDashboardPage />} />
            <Route path="/products/:leadId/workflow" element={<ProductWorkflowPage />} />
            <Route path="/customers/:leadId/implementation-uat" element={<ImplementationUatPage />} />
            <Route path="/products/:leadId/implementation-uat" element={<ImplementationUatPage />} />
            <Route path="/products/:leadId/payment-forward" element={<ForwardPaymentPage />} />
            <Route path="/products/:leadId/compose" element={<ComposeEmailPage />} />
            <Route path="/account" element={<SalesAccountPage />} />
            <Route path="/mail" element={<MailPage />} />
            <Route path="/support" element={<SalesSupportPage />} />
          </Route>
          <Route
            path="/onboarding"
            element={<Navigate to="/products" replace state={{ openCreate: true }} />}
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </RouteErrorBoundary>
    </Suspense>
  );
}
