import { useMemo } from "react";
import {
  BookOpen,
  Building2,
  Headphones,
  LayoutDashboard,
  Link2,
  MessageSquare,
  Package,
  Settings2,
  UserRound,
  Users,
  UsersRound,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { SidebarFooter } from "../components/SidebarFooter.jsx";
import { useCustomerDashboard } from "../hooks/useCustomerDashboard.js";
import { logoutCustomer, getCustomerSession, isCustomerBranchUser } from "../lib/customerAuth.js";
import { getPurchasedProductCatalog } from "../lib/productCatalog.js";
import { ShellLayout } from "./ShellLayout.jsx";

function buildCustomerNavItems(hasCcaas) {
  const organizationChildren = [
    { label: "Business Profile", path: "/customer/setup/business-profile" },
    { label: "Branches", path: "/customer/setup/branches" },
    { label: "Business Hours", path: "/customer/setup/business-hours" },
    { label: "Teams", path: "/customer/setup/teams" },
  ];
  if (hasCcaas) {
    organizationChildren.push({
      label: "Queue",
      path: "/customer/setup/queues",
    });
  }

  return [
    { label: "Dashboard", path: "/customer/dashboard", icon: LayoutDashboard },
    { label: "Products", path: "/customer/products", icon: Package },
    {
      label: "Setup Workspace",
      path: "/customer/setup",
      icon: Settings2,
      children: [
        {
          label: "Organization",
          icon: Building2,
          children: organizationChildren,
        },
        {
          label: "User onboard",
          icon: Users,
          children: [
            { label: "User details", path: "/customer/setup/people" },
            { label: "Roles & permissions", path: "/customer/setup/roles" },
          ],
        },
        {
          label: "Knowledge Base",
          path: "/customer/setup/knowledge-base",
          icon: BookOpen,
        },
        {
          label: "Channel Setup",
          path: "/customer/setup/communication",
          icon: MessageSquare,
        },
        {
          label: "Integrations",
          icon: Link2,
          children: [
            { label: "Connected Apps", path: "/customer/setup/integrations" },
            { label: "APIs & Webhooks", path: "/customer/setup/integrations", stub: true },
          ],
        },
        {
          label: "Customer Hub",
          icon: UsersRound,
          children: [
            { label: "Companies & Profiles", path: "/customer/setup/customer-hub" },
            { label: "Import & Sync", path: "/customer/setup/customer-hub", stub: true },
          ],
        },
      ],
    },
    { label: "Support", path: "/customer/support", icon: Headphones },
    { label: "Account", path: "/customer/account", icon: UserRound },
  ];
}

export function CustomerPortalShell({ children }) {
  const navigate = useNavigate();
  const session = getCustomerSession();
  const branchUser = isCustomerBranchUser(session);
  const { dashboard } = useCustomerDashboard();

  const hasCcaas = useMemo(() => {
    const purchased = getPurchasedProductCatalog(dashboard?.activeProducts);
    return purchased.some((product) => product.id === "contact-center");
  }, [dashboard?.activeProducts]);

  const navItems = useMemo(() => buildCustomerNavItems(hasCcaas), [hasCcaas]);

  function handleLogout() {
    logoutCustomer();
    navigate("/", { replace: true });
  }

  return (
    <ShellLayout
      ariaLabel="Customer portal navigation"
      footer={<SidebarFooter onLogout={handleLogout} />}
      navItems={navItems}
      sectionLabel="Customer portal"
      shellClassName="app-shell--customer"
      sidebarClassName="sidebar--customer"
    >
      <div className="customer-portal-context">
        <span className={`customer-portal-role-badge ${branchUser ? "is-branch" : "is-admin"}`}>
          {branchUser
            ? `Branch access · ${session?.locationLabel || "Your branch"}`
            : "Company admin · all branches"}
        </span>
      </div>
      {children}
    </ShellLayout>
  );
}
