/**
 * Prefetch lazy page chunks on sidebar hover / focus.
 * Keys are pathname prefixes or exact paths used in nav.
 */

const prefetchersByPath = {
  "/admin/users": () => import("../pages/AdminUsersPage.tsx"),
  "/admin/customer-portal-users": () => import("../pages/admin/AdminCustomerPortalUsersPage.tsx"),
  "/admin/partners": () => import("../pages/admin/PartnersPage.tsx"),
  "/admin/commission-slabs": () => import("../pages/admin/AdminCommissionSlabsPage.tsx"),
  "/admin/resellers": () => import("../pages/admin/ResellersPage.tsx"),
  "/admin/cancellation-requests": () => import("../pages/admin/AdminCancellationQueuePage.tsx"),
  "/admin/pricing": () => import("../pages/AdminPricingPage.tsx"),
  "/admin/mail": () => import("../pages/MailPage.tsx"),
  "/admin/account": () => import("../pages/admin/AdminAccountPage.tsx"),
  "/sales-oversight": () => import("../pages/SalesOversightRoutePages.tsx"),
  "/sales-oversight/agents": () => import("../pages/SalesOversightRoutePages.tsx"),
  "/finance/queue": () => import("../pages/FinanceQueuePage.tsx"),
  "/finance/commissions": () => import("../pages/FinancePartnerCommissionsPage.tsx"),
  "/finance/commissions/partners": () =>
    import("../pages/FinancePartnerCommissionDetailPage.tsx"),
  "/finance/mail": () => import("../pages/MailPage.tsx"),
  "/finance/account": () => import("../pages/FinanceAccountPage.tsx"),
  "/number-management/dashboard": () =>
    import("../pages/numberManagement/NumberManagementDashboardPage.tsx"),
  "/number-management/inventory": () =>
    import("../pages/numberManagement/NumberInventoryPage.tsx"),
  "/number-management/mappings": () =>
    import("../pages/numberManagement/NumberMappingPage.tsx"),
  "/number-management/mail": () => import("../pages/MailPage.tsx"),
  "/dashboard": () => import("../pages/DashboardPage.tsx"),
  "/products": () => import("../pages/ProductsPage.tsx"),
  "/customers": () => import("../pages/CustomersPage.tsx"),
  "/support": () => import("../pages/SalesSupportPage.tsx"),
  "/mail": () => import("../pages/MailPage.tsx"),
  "/account": () => import("../pages/SalesAccountPage.tsx"),
  "/partner/dashboard": () => import("../pages/partner/PartnerDashboardPage.tsx"),
  "/partner/leads": () => import("../pages/partner/PartnerLeadsPage.tsx"),
  "/partner/commissions": () => import("../pages/partner/PartnerCommissionsPage.tsx"),
  "/partner/bank-details": () => import("../pages/partner/PartnerBankDetailsPage.tsx"),
  "/reseller/dashboard": () => import("../pages/reseller/ResellerDashboardPage.tsx"),
  "/reseller/renewals": () => import("../pages/reseller/ResellerRenewalsPage.tsx"),
  "/reseller/invoices": () => import("../pages/reseller/ResellerInvoicesPage.tsx"),
  "/customer/dashboard": () => import("../pages/customer/CustomerDashboardPage.tsx"),
  "/customer/products": () => import("../pages/customer/CustomerProductsPage.tsx"),
  "/customer/onboarding": () => import("../pages/customer/CustomerOnboardingPage.tsx"),
  "/customer/operational-hub": () => import("../pages/customer/CustomerOperationalHubPage.tsx"),
  "/customer/support": () => import("../pages/customer/CustomerSupportPage.tsx"),
  "/customer/invoices": () => import("../pages/customer/CustomerInvoicesPage.tsx"),
  "/customer/account": () => import("../pages/customer/CustomerAccountPage.tsx"),
};

const warmed = new Set();

export function prefetchRoute(path) {
  const pathname = String(path || "").split("?")[0];
  if (!pathname || warmed.has(pathname)) {
    return;
  }

  const loader = prefetchersByPath[pathname];
  if (!loader) {
    return;
  }

  warmed.add(pathname);
  void loader().catch(() => {
    warmed.delete(pathname);
  });
}
