import { Mail, ShieldCheck, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { SidebarFooter } from "../components/SidebarFooter.jsx";
import { logout } from "../lib/auth.js";
import { ShellLayout } from "./ShellLayout.jsx";

const financeNavItems = [
  { label: "Quotation queue", path: "/finance/queue", icon: ShieldCheck },
  { label: "Inbox", path: "/finance/mail", icon: Mail },
  { label: "My Profile", path: "/finance/account", icon: UserRound },
];

export function FinanceShell({ children }) {
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/", { replace: true });
  }

  return (
    <ShellLayout
      ariaLabel="Finance navigation"
      footer={<SidebarFooter onLogout={handleLogout} />}
      navItems={financeNavItems}
      sectionLabel="Finance"
      shellClassName="app-shell--finance"
      sidebarClassName="sidebar--finance"
    >
      {children}
    </ShellLayout>
  );
}
