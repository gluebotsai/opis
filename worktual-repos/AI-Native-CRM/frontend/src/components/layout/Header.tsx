import { Link, useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import {
  ALL_MODULES,
  getConfigurationSubmoduleByPath,
  getMarketingCampaignNavItemByPath,
  getSalesSubmoduleByPath,
  isValidModuleId,
} from "@/config/modules";
import { normalizeRole } from "@/lib/rbac";
import { setMobileNavOpen, useAppDispatch, useAppSelector } from "@/store";
import { HeaderUserMenu } from "@/components/layout/HeaderUserMenu";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { HeaderPresence } from "@/features/voice/header-presence";
import { HeaderDialpad } from "@/features/voice/header-dialpad";
import { WORKTUAL_HEADER_ICON_GROUP, WORKTUAL_ICON_BUTTON } from "@/lib/worktual-control-tokens";

type Breadcrumb = { label: string; href?: string };

function breadcrumbsFromPath(
  pathname: string,
  roleRaw?: string | null,
): Breadcrumb[] {
  if (normalizeRole(roleRaw) === "marketing") {
    if (
      pathname === "/configuration" ||
      pathname.startsWith("/configuration/")
    ) {
      const sub = getConfigurationSubmoduleByPath(pathname);
      const subLabel = sub?.label ?? "Email";
      const subHref = sub?.href ?? "/configuration/email";
      const subIsCurrent =
        pathname === subHref || pathname.startsWith(`${subHref}/`);
      return [
        { label: "Configuration", href: "/configuration/email" },
        { label: subLabel, href: subIsCurrent ? undefined : subHref },
      ];
    }
    const item = getMarketingCampaignNavItemByPath(pathname);
    if (item) {
      return [{ label: item.label }];
    }
    if (pathname === "/" || pathname === "/dashboard") {
      return [{ label: "Dashboard" }];
    }
  }

  if (pathname === "/" || pathname === "/dashboard") {
    return [{ label: "Dashboard" }];
  }

  if (pathname === "/sales" || pathname.startsWith("/sales/")) {
    const sub = getSalesSubmoduleByPath(pathname);
    const subLabel = sub?.label ?? "Pipeline";
    const subHref = sub?.href ?? "/sales";
    const subIsCurrent =
      sub?.id === "calendar"
        ? pathname === "/sales/calendar" ||
          pathname.startsWith("/sales/calendar/")
        : pathname === "/sales";

    return [
      { label: "Sales", href: "/sales" },
      { label: subLabel, href: subIsCurrent ? undefined : subHref },
    ];
  }

  if (pathname === "/marketing" || pathname.startsWith("/marketing/")) {
    const item = getMarketingCampaignNavItemByPath(pathname);
    const subLabel =
      item?.label ??
      (pathname.startsWith("/marketing/create")
        ? "Create campaign"
        : pathname.startsWith("/marketing/campaigns")
          ? "Campaign monitoring"
          : pathname.startsWith("/marketing/events")
            ? "Events tracking"
            : pathname.startsWith("/marketing/seo")
              ? "Digital Marketing"
              : pathname.startsWith("/marketing/audience")
                ? "Customers"
                : "Marketing");
    const subHref = item?.href;
    const onRoot = pathname === "/marketing" || pathname === "/marketing/";
    return [
      { label: "Marketing", href: onRoot ? undefined : "/marketing/create" },
      {
        label: subLabel,
        href:
          subHref &&
          (pathname === subHref || pathname.startsWith(`${subHref}/`))
            ? undefined
            : subHref,
      },
    ];
  }

  if (
    pathname === "/configuration" ||
    pathname.startsWith("/configuration/")
  ) {
    const sub = getConfigurationSubmoduleByPath(pathname);
    const subLabel = sub?.label ?? "Email";
    const subHref = sub?.href ?? "/configuration/email";
    const subIsCurrent =
      pathname === subHref || pathname.startsWith(`${subHref}/`);

    return [
      {
        label: "Configuration",
        href: ALL_MODULES.configuration.href,
      },
      { label: subLabel, href: subIsCurrent ? undefined : subHref },
    ];
  }

  const segment = pathname.split("/").filter(Boolean)[0];
  if (segment && isValidModuleId(segment)) {
    const mod = ALL_MODULES[segment];
    const onModuleRoot =
      pathname === mod.href || pathname.startsWith(`${mod.href}/`);
    return [
      {
        label: mod.label,
        href: onModuleRoot && pathname === mod.href ? undefined : mod.href,
      },
    ];
  }
  return [];
}

export function Header() {
  const { pathname } = useLocation();
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user);

  if (!user) return null;

  const crumbs = breadcrumbsFromPath(pathname, user.role);

  return (
    <header className="flex h-14 w-full shrink-0 items-center justify-between gap-2 border-b border-[#bfbfbf]/80 bg-[#f3f4f6] px-2 py-3 sm:px-3 lg:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button
          type="button"
          className={`${WORKTUAL_ICON_BUTTON} md:hidden`}
          onClick={() => dispatch(setMobileNavOpen(true))}
          aria-label="Open menu"
        >
          <Menu strokeWidth={2.25} />
        </button>

        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 items-center gap-2 overflow-hidden text-sm"
        >
          {crumbs.map((crumb, index) => {
            const isCurrent = !crumb.href;
            return (
              <span
                key={`${crumb.label}-${index}`}
                className="flex min-w-0 items-center gap-2"
              >
                {index > 0 ? (
                  <span className="shrink-0 text-text-caption">/</span>
                ) : null}
                {crumb.href ? (
                  <Link
                    to={crumb.href}
                    className="truncate text-neutral-500 transition-colors hover:text-neutral-900"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    className={`truncate ${
                      isCurrent
                        ? "text-xl font-semibold tracking-tight text-neutral-900 sm:text-2xl"
                        : "text-neutral-500"
                    }`}
                  >
                    {crumb.label}
                  </span>
                )}
              </span>
            );
          })}
        </nav>
        <div className="ml-auto">
          <HeaderPresence />
        </div>
      </div>

      <div className={`${WORKTUAL_HEADER_ICON_GROUP} sm:gap-3`}>
        <HeaderDialpad />

        <NotificationBell />

        <HeaderUserMenu user={user} />
      </div>
    </header>
  );
}
