import { Link, useLocation } from "react-router-dom";
import { CONFIGURATION_SUBMODULES } from "@/config/modules";
import {
  canEditFinance,
  canEditInvoiceTemplates,
  canEditOrgSettings,
  canManageApiKeys,
  canManageDocumentTemplates,
  normalizeRole,
} from "@/lib/rbac";
import { useAppSelector } from "@/store";
import { TONE_ACCENT } from "@/lib/ui-tones";

export function ConfigurationShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const { pathname } = useLocation();
  const role = normalizeRole(useAppSelector((s) => s.auth.user?.role));
  const showDocTemplates = canManageDocumentTemplates(role);
  const showInvoiceTemplates = canEditInvoiceTemplates(role);
  const showBilling = canEditFinance(role);
  const showDevelopers = canManageApiKeys(role);
  const showLeadNurture = canEditOrgSettings(role);

  const items = CONFIGURATION_SUBMODULES.filter((s) => {
    if (s.status === "coming_soon") return false;
    if (s.id === "proposal-templates") return false;
    if (s.id === "quote-templates" || s.id === "proposal-patterns") {
      return showDocTemplates;
    }
    if (s.id === "invoice-templates") return showInvoiceTemplates;
    if (s.id === "billing") return showBilling;
    if (s.id === "developers") return showDevelopers;
    if (s.id === "lead-nurture") return showLeadNurture;
    return true;
  });

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border-default bg-surface">
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pt-4 sm:px-6">
          {items.map((item) => {
            const active =
              pathname === item.href ||
              (item.id === "email" &&
                (pathname === "/configuration" ||
                  pathname.startsWith("/configuration/email"))) ||
              (item.id === "price-books" &&
                pathname.startsWith("/configuration/price-books")) ||
              (item.id === "proposal-templates" &&
                pathname.startsWith("/configuration/proposal-templates")) ||
              (item.id === "proposal-patterns" &&
                pathname.startsWith("/configuration/proposal-patterns")) ||
              (item.id === "quote-templates" &&
                pathname.startsWith("/configuration/quote-templates")) ||
              (item.id === "invoice-templates" &&
                pathname.startsWith("/configuration/invoice-templates")) ||
              (item.id === "billing" &&
                pathname.startsWith("/configuration/billing")) ||
              (item.id === "research" &&
                pathname.startsWith("/configuration/research")) ||
              (item.id === "developers" &&
                pathname.startsWith("/configuration/developers")) ||
              (item.id === "lead-nurture" &&
                pathname.startsWith("/configuration/lead-nurture"));
            return (
              <Link
                key={item.id}
                to={item.href}
                className={`rounded-t-lg px-3 py-2 text-sm font-medium ${
                  active
                    ? `border-b-2 border-brand ${TONE_ACCENT}`
                    : "text-text-caption hover:text-text-primary"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
      <div className="scrollbar-hover min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
        {children}
      </div>
    </div>
  );
}
