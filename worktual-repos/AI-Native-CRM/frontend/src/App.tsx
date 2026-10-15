import {
  lazy,
  Suspense,
  useEffect,
  type ComponentType,
  type LazyExoticComponent,
} from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { useAuthBootstrap } from "./hooks/useAuthBootstrap";
import { useCrmSessionWatch } from "./hooks/useCrmSessionWatch";
import { useAppSelector } from "./store";
import { normalizeRole } from "./lib/rbac";
import {
  preloadNavModules,
  registerNavModulePreload,
  registerRoutePreload,
} from "./lib/nav-module-preload";

type LazyPage = LazyExoticComponent<ComponentType> & {
  preload: () => Promise<void>;
};

/** Already-loaded pages resolve in the same turn so Suspense does not blank the shell. */
function fulfilledDefault(
  component: ComponentType,
): Promise<{ default: ComponentType }> {
  const moduleObject = { default: component };
  return {
    then(onFulfilled: (value: { default: ComponentType }) => void) {
      onFulfilled(moduleObject);
    },
    status: "fulfilled",
    value: moduleObject,
  } as unknown as Promise<{ default: ComponentType }>;
}

function lazyPage(
  load: () => Promise<Record<string, ComponentType>>,
  name: string,
): LazyPage {
  let component: ComponentType | null = null;
  let pending: Promise<void> | null = null;

  const preload = () => {
    if (component) return Promise.resolve();
    if (!pending) {
      pending = loadWithRetry(load)
        .then((mod) => {
          const resolved = mod[name];
          if (!resolved) {
            throw new Error(`Missing page export ${name}`);
          }
          component = resolved;
        })
        .catch((error: unknown) => {
          pending = null;
          throw error;
        });
    }
    return pending;
  };

  const Lazy = lazy(() => {
    if (component) return fulfilledDefault(component);
    return preload().then(() => {
      if (!component) {
        throw new Error(`Missing page export ${name}`);
      }
      return { default: component };
    });
  }) as LazyPage;

  Lazy.preload = preload;
  return Lazy;
}

/** Keep transient chunk failures away from React.lazy's permanent rejection cache. */
async function loadWithRetry<T>(load: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) =>
          window.setTimeout(resolve, 250 * 2 ** attempt),
        );
      }
    }
  }
  throw lastError;
}

export function signedInHomePath(role: string | null | undefined): string {
  return normalizeRole(role) === "marketing"
    ? "/marketing/dashboard"
    : "/dashboard";
}

const AppLayout = lazyPage(() => import("./layouts/AppLayout"), "AppLayout");
const ContactDetailPage = lazyPage(() => import("./pages/ContactDetailPage"), "ContactDetailPage");
const ContactFormPage = lazyPage(() => import("./pages/ContactFormPage"), "ContactFormPage");
const ContactCreateCoworkerPage = lazyPage(() => import("./pages/ContactCreateCoworkerPage"), "ContactCreateCoworkerPage");
const ContactsPage = lazyPage(() => import("./pages/ContactsPage"), "ContactsPage");
const CompaniesPage = lazyPage(() => import("./pages/CompaniesPage"), "CompaniesPage");
const CompanyDetailPage = lazyPage(() => import("./pages/CompanyDetailPage"), "CompanyDetailPage");
const CompanyFormPage = lazyPage(() => import("./pages/CompanyFormPage"), "CompanyFormPage");
const CompanyCreateCoworkerPage = lazyPage(() => import("./pages/CompanyCreateCoworkerPage"), "CompanyCreateCoworkerPage");
const LocationDetailPage = lazyPage(() => import("./pages/LocationDetailPage"), "LocationDetailPage");
const LocationFormPage = lazyPage(() => import("./pages/LocationFormPage"), "LocationFormPage");
const LocationCreateCoworkerPage = lazyPage(() => import("./pages/LocationCreateCoworkerPage"), "LocationCreateCoworkerPage");
const ProductDetailPage = lazyPage(() => import("./pages/ProductDetailPage"), "ProductDetailPage");
const ProductFormPage = lazyPage(() => import("./pages/ProductFormPage"), "ProductFormPage");
const ProductCreateCoworkerPage = lazyPage(() => import("./pages/ProductCreateCoworkerPage"), "ProductCreateCoworkerPage");
const ProductsPage = lazyPage(() => import("./pages/ProductsPage"), "ProductsPage");
const DealDetailPage = lazyPage(() => import("./pages/DealDetailPage"), "DealDetailPage");
const DealFormPage = lazyPage(() => import("./pages/DealFormPage"), "DealFormPage");
const DealCreateCoworkerPage = lazyPage(() => import("./pages/DealCreateCoworkerPage"), "DealCreateCoworkerPage");
const SalesPipelinePage = lazyPage(() => import("./pages/SalesPipelinePage"), "SalesPipelinePage");
const QuotesPage = lazyPage(() => import("./pages/QuotesPage"), "QuotesPage");
const QuoteCreateCoworkerPage = lazyPage(() => import("./pages/QuoteCreateCoworkerPage"), "QuoteCreateCoworkerPage");
const QuoteDetailPage = lazyPage(() => import("./pages/QuoteDetailPage"), "QuoteDetailPage");
const ProposalDetailPage = lazyPage(() => import("./pages/ProposalDetailPage"), "ProposalDetailPage");
const QuoteTemplatesPage = lazyPage(() => import("./pages/QuoteTemplatesPage"), "QuoteTemplatesPage");
const InvoiceTemplatesPage = lazyPage(() => import("./pages/InvoiceTemplatesPage"), "InvoiceTemplatesPage");
const FinanceBillingSettingsPage = lazyPage(() => import("./pages/FinanceBillingSettingsPage"), "FinanceBillingSettingsPage");
const ResearchProvidersPage = lazyPage(() => import("./pages/ResearchProvidersPage"), "ResearchProvidersPage");
const LeadNurtureSettingsPage = lazyPage(() => import("./pages/LeadNurtureSettingsPage"), "LeadNurtureSettingsPage");
const ProposalPatternsPage = lazyPage(() => import("./pages/ProposalPatternsPage"), "ProposalPatternsPage");
const ApiDevelopersPage = lazyPage(() => import("./pages/ApiDevelopersPage"), "ApiDevelopersPage");
const PrivacyRequestsPage = lazyPage(() => import("./pages/PrivacyRequestsPage"), "PrivacyRequestsPage");
const FinancePage = lazyPage(() => import("./pages/FinancePage"), "FinancePage");
const InvoiceDetailPage = lazyPage(() => import("./pages/InvoiceDetailPage"), "InvoiceDetailPage");
const InvoiceCreateCoworkerPage = lazyPage(() => import("./pages/InvoiceCreateCoworkerPage"), "InvoiceCreateCoworkerPage");
const InboxPage = lazyPage(() => import("./pages/InboxPage"), "InboxPage");
const EmailConfigurationPage = lazyPage(() => import("./pages/EmailConfigurationPage"), "EmailConfigurationPage");
const PriceBooksPage = lazyPage(() => import("./pages/PriceBooksPage"), "PriceBooksPage");
const ActivitiesPage = lazyPage(() => import("./pages/ActivitiesPage"), "ActivitiesPage");
const ActivityLogCoworkerPage = lazyPage(() => import("./pages/ActivityLogCoworkerPage"), "ActivityLogCoworkerPage");
const SalesCalendarPage = lazyPage(() => import("./pages/SalesCalendarPage"), "SalesCalendarPage");
const CommerceOrdersPage = lazyPage(() => import("./pages/CommerceOrdersPage"), "CommerceOrdersPage");
const CommerceOrderDetailPage = lazyPage(() => import("./pages/CommerceOrderDetailPage"), "CommerceOrderDetailPage");
const DashboardPage = lazyPage(() => import("./pages/DashboardPage"), "DashboardPage");

/** Warm the post-login shell while the login request is in flight. */
export function preloadSignedInShell(): Promise<void> {
  void preloadNavModules();
  return Promise.all([AppLayout.preload(), DashboardPage.preload()]).then(
    () => undefined,
  );
}

const ReportsPage = lazyPage(() => import("./pages/ReportsPage"), "ReportsPage");
const AgentsPage = lazyPage(() => import("./pages/AgentsPage"), "AgentsPage");
const AgentRunsPage = lazyPage(() => import("./pages/AgentRunsPage"), "AgentRunsPage");
const AgentRunDetailPage = lazyPage(() => import("./pages/AgentRunDetailPage"), "AgentRunDetailPage");
const ServicePage = lazyPage(() => import("./pages/ServicePage"), "ServicePage");
const MeetingAssistPanelPage = lazyPage(() => import("./pages/MeetingAssistPanelPage"), "MeetingAssistPanelPage");
const MeetingAssistLinkPage = lazyPage(() => import("./pages/MeetingAssistLinkPage"), "MeetingAssistLinkPage");
const MeetingAssistListenPage = lazyPage(() => import("./pages/MeetingAssistListenPage"), "MeetingAssistListenPage");
const MeetAssistHostPage = lazyPage(() => import("./pages/hosts/MeetAssistHostPage"), "MeetAssistHostPage");
const ZoomAssistHostPage = lazyPage(() => import("./pages/hosts/ZoomAssistHostPage"), "ZoomAssistHostPage");
const TeamsAssistHostPage = lazyPage(() => import("./pages/hosts/TeamsAssistHostPage"), "TeamsAssistHostPage");
const LoginPage = lazyPage(() => import("./pages/LoginPage"), "LoginPage");
const OnboardingPage = lazyPage(() => import("./pages/OnboardingPage"), "OnboardingPage");
const ModulePendingPage = lazyPage(() => import("./pages/ModulePendingPage"), "ModulePendingPage");
const ProcessApprovalsPage = lazyPage(() => import("./pages/ProcessApprovalsPage"), "ProcessApprovalsPage");
const MarketingSeoPage = lazyPage(() => import("./pages/marketing/MarketingSeoPage"), "MarketingSeoPage");

registerNavModulePreload("/dashboard", () => DashboardPage.preload());
registerNavModulePreload("/inbox", () => InboxPage.preload());
registerNavModulePreload("/contact", () => ContactsPage.preload());
registerNavModulePreload("/company", () => CompaniesPage.preload());
registerNavModulePreload("/product", () => ProductsPage.preload());
registerNavModulePreload("/sales", () => SalesPipelinePage.preload());
registerNavModulePreload("/activities", () => ActivitiesPage.preload());
registerNavModulePreload("/commerce", () => CommerceOrdersPage.preload());
registerNavModulePreload("/finance", () => FinancePage.preload());
registerNavModulePreload("/service", () => ServicePage.preload());
registerNavModulePreload("/reports", () => ReportsPage.preload());
registerNavModulePreload("/agents", () => AgentsPage.preload());
registerRoutePreload("/sales/calendar", () => SalesCalendarPage.preload());
registerRoutePreload("/sales/quotes", () => QuotesPage.preload());
registerRoutePreload("/process-approvals", () => ProcessApprovalsPage.preload());
registerRoutePreload("/privacy-requests", () => PrivacyRequestsPage.preload());
registerRoutePreload("/configuration/email", () =>
  EmailConfigurationPage.preload(),
);
registerRoutePreload("/configuration/price-books", () => PriceBooksPage.preload());
registerRoutePreload("/configuration/proposal-templates", () =>
  ProposalPatternsPage.preload(),
);
registerRoutePreload("/configuration/proposal-patterns", () =>
  ProposalPatternsPage.preload(),
);
registerRoutePreload("/configuration/quote-templates", () =>
  QuoteTemplatesPage.preload(),
);
registerRoutePreload("/configuration/invoice-templates", () =>
  InvoiceTemplatesPage.preload(),
);
registerRoutePreload("/configuration/billing", () =>
  FinanceBillingSettingsPage.preload(),
);
registerRoutePreload("/configuration/research", () =>
  ResearchProvidersPage.preload(),
);
registerRoutePreload("/configuration/lead-nurture", () =>
  LeadNurtureSettingsPage.preload(),
);
registerRoutePreload("/configuration/developers", () =>
  ApiDevelopersPage.preload(),
);
registerRoutePreload("/marketing/seo", () => MarketingSeoPage.preload());

function BootLoader() {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#f3f4f6]">
      <img
        src="/crm-boot-loader.gif"
        alt=""
        width={140}
        height={79}
        className="mx-auto block h-auto w-[140px]"
      />
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, bootstrapped } = useAppSelector((s) => s.auth);
  if (!bootstrapped) {
    return <BootLoader />;
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function HomeRedirect() {
  const user = useAppSelector((s) => s.auth.user);
  return <Navigate to={signedInHomePath(user?.role)} replace />;
}

/** Old fullscreen CRM companion → shared in-meeting panel. */
function LegacyLiveAssistRedirect() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return (
    <Navigate
      to={`/meeting-assist/panel/${encodeURIComponent(sessionId || "")}`}
      replace
    />
  );
}

/** Old Configuration privacy queue → deep-link review surface. */
function LegacyPrivacyRequestRedirect() {
  const { requestId } = useParams<{ requestId: string }>();
  return (
    <Navigate
      to={
        requestId
          ? `/privacy-requests/${encodeURIComponent(requestId)}`
          : "/privacy-requests"
      }
      replace
    />
  );
}

export function App() {
  useAuthBootstrap();
  useCrmSessionWatch();
  const bootstrapped = useAppSelector((s) => s.auth.bootstrapped);
  const user = useAppSelector((s) => s.auth.user);
  const signedIn = bootstrapped && Boolean(user);
  useEffect(() => {
    if (!bootstrapped) return;
    window.__crmBootReady?.();
  }, [bootstrapped]);

  useEffect(() => {
    if (!signedIn) return;
    void preloadNavModules();
  }, [signedIn]);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
    <Suspense fallback={<BootScreen />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/onboarding" element={<OnboardingPage />} />
      {/* Old CRM companion URL → shared in-meeting panel */}
      <Route
        path="/meeting-assist/live/:sessionId"
        element={<LegacyLiveAssistRedirect />}
      />
      {/* In-meeting hosts + shared panel — panel JWT auth (cookies often blocked) */}
      <Route
        path="/meeting-assist/panel/:sessionId"
        element={<MeetingAssistPanelPage />}
      />
      <Route path="/meeting-assist/link" element={<MeetingAssistLinkPage />} />
      <Route
        path="/meeting-assist/listen"
        element={<MeetingAssistListenPage />}
      />
      <Route
        path="/meeting-assist/hosts/meet"
        element={<MeetAssistHostPage />}
      />
      <Route
        path="/meeting-assist/hosts/zoom"
        element={<ZoomAssistHostPage />}
      />
      <Route
        path="/meeting-assist/hosts/teams"
        element={<TeamsAssistHostPage />}
      />
      {/* Manifest-compatible Meet add-on aliases */}
      <Route path="/meet-addon/sidepanel" element={<MeetAssistHostPage />} />
      <Route path="/meet-addon/link" element={<MeetingAssistLinkPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route index element={<HomeRedirect />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="contact" element={<ContactsPage />} />
        <Route path="contact/new" element={<ContactCreateCoworkerPage />} />
        <Route path="contact/:id" element={<ContactDetailPage />} />
        <Route path="contact/:id/edit" element={<ContactFormPage />} />
        <Route path="company" element={<CompaniesPage />} />
        <Route path="company/new" element={<CompanyCreateCoworkerPage />} />
        <Route path="company/:id" element={<CompanyDetailPage />} />
        <Route path="company/:id/edit" element={<CompanyFormPage />} />
        <Route
          path="company/:id/locations/new"
          element={<LocationCreateCoworkerPage />}
        />
        <Route
          path="company/:id/locations/:locationId"
          element={<LocationDetailPage />}
        />
        <Route
          path="company/:id/locations/:locationId/edit"
          element={<LocationFormPage />}
        />
        <Route path="product/new" element={<ProductCreateCoworkerPage />} />
        <Route path="product/:id/edit" element={<ProductFormPage />} />
        <Route path="product/:id" element={<ProductDetailPage />} />
        <Route path="product" element={<ProductsPage />} />
        <Route path="sales" element={<SalesPipelinePage />} />
        <Route path="sales/new" element={<DealCreateCoworkerPage />} />
        <Route path="sales/quotes" element={<QuotesPage />} />
        <Route path="sales/quotes/new" element={<QuoteCreateCoworkerPage />} />
        <Route path="sales/quotes/:quoteId" element={<QuoteDetailPage />} />
        <Route path="sales/proposals/:proposalId" element={<ProposalDetailPage />} />
        <Route path="sales/calendar" element={<SalesCalendarPage />} />
        <Route
          path="sales/activities"
          element={<Navigate to="/activities" replace />}
        />
        <Route path="sales/:dealId" element={<DealDetailPage />} />
        <Route path="sales/:dealId/edit" element={<DealFormPage />} />
        <Route path="finance" element={<FinancePage />} />
        <Route path="finance/new" element={<InvoiceCreateCoworkerPage />} />
        <Route path="finance/:invoiceId" element={<InvoiceDetailPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="activities" element={<ActivitiesPage />} />
        <Route path="activities/log" element={<ActivityLogCoworkerPage />} />
        <Route path="commerce" element={<CommerceOrdersPage />} />
        <Route path="commerce/:orderId" element={<CommerceOrderDetailPage />} />
        <Route path="configuration" element={<Navigate to="/configuration/email" replace />} />
        <Route path="configuration/email" element={<EmailConfigurationPage />} />
        <Route
          path="configuration/assignment"
          element={<Navigate to="/configuration/email" replace />}
        />
        <Route
          path="configuration/catalog"
          element={<Navigate to="/configuration/email" replace />}
        />
        <Route path="configuration/price-books" element={<PriceBooksPage />} />
        <Route
          path="configuration/proposal-templates"
          element={<Navigate to="/configuration/proposal-patterns" replace />}
        />
        <Route
          path="configuration/proposal-patterns"
          element={<ProposalPatternsPage />}
        />
        <Route
          path="configuration/quote-templates"
          element={<QuoteTemplatesPage />}
        />
        <Route
          path="configuration/invoice-templates"
          element={<InvoiceTemplatesPage />}
        />
        <Route
          path="configuration/billing"
          element={<FinanceBillingSettingsPage />}
        />
        <Route
          path="configuration/research"
          element={<ResearchProvidersPage />}
        />
        <Route
          path="configuration/lead-nurture"
          element={<LeadNurtureSettingsPage />}
        />
        <Route
          path="configuration/developers"
          element={<ApiDevelopersPage />}
        />
        <Route
          path="configuration/privacy-requests"
          element={<Navigate to="/privacy-requests" replace />}
        />
        <Route
          path="configuration/privacy-requests/:requestId"
          element={<LegacyPrivacyRequestRedirect />}
        />
        <Route path="privacy-requests" element={<PrivacyRequestsPage />} />
        <Route
          path="privacy-requests/:requestId"
          element={<PrivacyRequestsPage />}
        />
        <Route
          path="configuration/vertical"
          element={<Navigate to="/configuration" replace />}
        />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="agents/:agentId/runs" element={<AgentRunsPage />} />
        <Route
          path="agents/:agentId/runs/:jobId"
          element={<AgentRunDetailPage />}
        />
        <Route path="process-approvals" element={<ProcessApprovalsPage />} />
        <Route path="service" element={<ServicePage />} />
        {/* Marketing iframe is keep-alive mounted in AppLayout; routes only sync the URL. */}
        <Route path="marketing" element={<Navigate to="/marketing/dashboard" replace />} />
        <Route
          path="marketing/inbox"
          element={<Navigate to="/marketing/dashboard" replace />}
        />
        <Route
          path="marketing/templates"
          element={<Navigate to="/marketing/create?tool=templates" replace />}
        />
        <Route
          path="marketing/customers"
          element={<Navigate to="/marketing/audience" replace />}
        />
        <Route
          path="marketing/recommendations"
          element={<Navigate to="/marketing/create/recommendations" replace />}
        />
        <Route path="marketing/seo" element={<MarketingSeoPage />} />
        <Route path="marketing/*" element={null} />
        <Route path="configuration/campaign" element={null} />
        <Route path="*" element={<ModulePendingPage />} />
      </Route>
    </Routes>
    </Suspense>
    </div>
  );
}

function BootScreen() {
  return <BootLoader />;
}
