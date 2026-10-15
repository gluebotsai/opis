import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  LogOut,
  X,
  type LucideIcon,
} from "lucide-react";
import { WorktualLogo } from "@/components/brand/WorktualLogo";
import {
  CONFIGURATION_SUBMODULES,
  getModulesForAccess,
  isConfigurationSubmoduleActive,
  isMarketingSubmoduleActive,
  isSalesSubmoduleActive,
  MARKETING_CAMPAIGN_NAV,
  MARKETING_SUBMODULES,
  SALES_SUBMODULES,
  type AppSubmodule,
} from "@/config/modules";
import {
  canEditFinance,
  canEditInvoiceTemplates,
  canManageApiKeys,
  canManageDocumentTemplates,
  normalizeRole,
} from "@/lib/rbac";
import {
  setMobileNavOpen,
  setUser,
  toggleSidebarCollapsed,
  useAppDispatch,
  useAppSelector,
} from "@/store";
import { logoutRequest } from "@/services/auth";
import { resetDailyBriefingSession } from "@/components/home/DailyBriefingPlayer";
import { resetAudioUnlock } from "@/lib/unlock-audio";
import { clearCoworkerClientStorage } from "@/lib/coworker/coworker-client-storage";
import { preloadNavModule } from "@/lib/nav-module-preload";
import { clearNavReturnStorage, isModuleHome } from "@/lib/nav-return";
import { clearAllListCaches } from "@/lib/list-cache";
import { writeSidebarCollapsedPreference } from "@/lib/sidebar-preference";

function keepCurrentPage(
  event: MouseEvent,
  pathname: string,
  href: string,
  search = "",
  hash = "",
) {
  if (isModuleHome(pathname, href, search, hash)) event.preventDefault();
}

const SIDEBAR_EXPANDED_W = "w-[260px]";
const SIDEBAR_COLLAPSED_W = "w-[72px]";

function NavTooltip({
  label,
  show,
  children,
}: {
  label: string;
  show: boolean;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  function placeAndOpen() {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({
      top: rect.top + rect.height / 2,
      left: rect.right + 10,
    });
    setOpen(true);
  }

  if (!show) return <>{children}</>;

  return (
    <div
      ref={rootRef}
      className="relative flex w-full justify-center"
      onMouseEnter={placeAndOpen}
      onMouseLeave={() => setOpen(false)}
      onFocus={placeAndOpen}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && typeof document !== "undefined"
        ? createPortal(
            <span
              role="tooltip"
              className="pointer-events-none fixed z-[90] -translate-y-1/2 whitespace-nowrap rounded-md bg-[#1a1a22] px-2.5 py-1.5 text-xs font-medium text-text-on-dark shadow-lg ring-1 ring-white/15"
              style={{ top: pos.top, left: pos.left }}
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </div>
  );
}

function SubmoduleLinks({
  items,
  pathname,
  search,
  hash,
  onNavigate,
  isActive,
  compact = false,
}: {
  items: AppSubmodule[];
  pathname: string;
  search: string;
  hash: string;
  onNavigate?: () => void;
  isActive: (sub: AppSubmodule, pathname: string) => boolean;
  compact?: boolean;
}) {
  return (
    <ul className={compact ? "space-y-0.5" : "mt-1 space-y-0.5"}>
      {items.map((sub) => {
        const SubIcon = sub.icon;
        const active = isActive(sub, pathname);
        return (
          <li key={sub.id}>
            <Link
              to={sub.href}
              onPointerDown={() => preloadNavModule(sub.href)}
              onFocus={() => preloadNavModule(sub.href)}
              onClick={(event) => {
                keepCurrentPage(event, pathname, sub.href, search, hash);
                onNavigate?.();
              }}
              className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors ${
                active
                  ? "bg-white/10 text-white"
                  : "text-white/70 hover:bg-white/5 hover:text-white"
              }`}
            >
              <SubIcon className="size-3.5 shrink-0" strokeWidth={1.75} />
              <span className="truncate">{sub.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Fixed flyout for collapsed sidebar — escapes overflow clipping. */
function CollapsedSubmenuFlyout({
  open,
  top,
  left,
  label,
  items,
  pathname,
  search,
  hash,
  onNavigate,
  isActive,
  onMouseEnter,
  onMouseLeave,
}: {
  open: boolean;
  top: number;
  left: number;
  label: string;
  items: AppSubmodule[];
  pathname: string;
  search: string;
  hash: string;
  onNavigate?: () => void;
  isActive: (sub: AppSubmodule, pathname: string) => boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      id={`nav-flyout-${label}`}
      role="menu"
      aria-label={`${label} submenu`}
      className="fixed z-[80] w-56 rounded-xl border border-white/10 bg-[#16161d] p-2 shadow-2xl"
      data-theme="inverse"
      style={{ top, left }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <p className="mb-1.5 flex items-center justify-between gap-2 truncate px-2.5 pt-1 text-[10px] font-medium tracking-wider text-text-on-dark-muted uppercase">
        <span className="truncate">{label}</span>
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-text-on-dark">
          {items.length}
        </span>
      </p>
      <SubmoduleLinks
        items={items}
        pathname={pathname}
        search={search}
        hash={hash}
        onNavigate={onNavigate}
        isActive={isActive}
        compact
      />
    </div>,
    document.body,
  );
}

/** Parent module with children — hover flyout on the right (collapsed + expanded). */
function NavBranch({
  label,
  href,
  icon: Icon,
  active,
  collapsed,
  items,
  pathname,
  search,
  hash,
  onNavigate,
  isActive,
}: {
  label: string;
  href: string;
  icon: LucideIcon;
  active: boolean;
  collapsed: boolean;
  items: AppSubmodule[];
  pathname: string;
  search: string;
  hash: string;
  onNavigate?: () => void;
  isActive: (sub: AppSubmodule, pathname: string) => boolean;
}) {
  const itemRef = useRef<HTMLLIElement>(null);
  const closeTimer = useRef<number | null>(null);
  const navigate = useNavigate();
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const [flyoutPos, setFlyoutPos] = useState({ top: 0, left: 0 });

  function clearCloseTimer() {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function openFlyout() {
    clearCloseTimer();
    const rect = itemRef.current?.getBoundingClientRect();
    if (rect) {
      const menuHeight = Math.min(320, 48 + items.length * 40);
      const maxTop = window.innerHeight - menuHeight - 8;
      setFlyoutPos({
        top: Math.max(8, Math.min(rect.top, maxTop)),
        left: rect.right + 8,
      });
    }
    setFlyoutOpen(true);
  }

  function scheduleCloseFlyout() {
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => {
      setFlyoutOpen(false);
      closeTimer.current = null;
    }, 150);
  }

  function openFlyoutFromHover() {
    openFlyout();
    preloadNavModule(href);
    for (const item of items) preloadNavModule(item.href);
  }

  useEffect(() => {
    if (!flyoutOpen) return;
    function onScrollOrResize() {
      setFlyoutOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (itemRef.current?.contains(target)) return;
      const flyout = document.getElementById(`nav-flyout-${label}`);
      if (flyout?.contains(target)) return;
      setFlyoutOpen(false);
    }
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [flyoutOpen, label]);

  useEffect(() => () => clearCloseTimer(), []);

  const rowClass = active
    ? "bg-white/10 text-white"
    : "text-white/70 hover:bg-white/5 hover:text-white";

  return (
    <li
      ref={itemRef}
      className={`relative w-full ${collapsed ? undefined : ""}`}
      onMouseEnter={openFlyoutFromHover}
      onMouseLeave={scheduleCloseFlyout}
    >
      {collapsed ? (
        <div className="relative flex w-full justify-center">
          <button
            type="button"
            onClick={() => {
              openFlyoutFromHover();
              if (!isModuleHome(pathname, href, search, hash)) {
                navigate(href);
                onNavigate?.();
              }
            }}
            className={`relative inline-flex size-10 items-center justify-center rounded-xl transition-colors ${rowClass}`}
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={flyoutOpen}
          >
            <Icon className="size-4 shrink-0" strokeWidth={2.25} />
            {active ? (
              <span className="absolute left-0 top-[20%] h-[60%] w-[3px] rounded-r-[2px] bg-white" />
            ) : (
              <span
                className="absolute top-1.5 right-1 size-1.5 rounded-full bg-white/50 ring-2 ring-[#111111]"
                aria-hidden
              />
            )}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            openFlyoutFromHover();
            if (!isModuleHome(pathname, href, search, hash)) {
              navigate(href);
              onNavigate?.();
            }
          }}
          className={`relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${rowClass}`}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={flyoutOpen}
        >
          <Icon className="size-4 shrink-0" strokeWidth={2.25} />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {active ? (
            <span className="absolute left-0 top-[20%] h-[60%] w-[3px] rounded-r-[2px] bg-white" />
          ) : null}
        </button>
      )}
      <CollapsedSubmenuFlyout
        open={flyoutOpen}
        top={flyoutPos.top}
        left={flyoutPos.left}
        label={label}
        items={items}
        pathname={pathname}
        search={search}
        hash={hash}
        onNavigate={() => {
          setFlyoutOpen(false);
          onNavigate?.();
        }}
        isActive={isActive}
        onMouseEnter={clearCloseTimer}
        onMouseLeave={scheduleCloseFlyout}
      />
    </li>
  );
}

function SidebarNav({
  showClose,
  onClose,
  collapsed = false,
}: {
  showClose?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
}) {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const dispatch = useAppDispatch();
  const session = user
    ? {
        businessType: user.businessType,
        user: {
          name: user.name,
          role: user.role,
          initials: user.initials,
        },
      }
    : null;

  const logout = async () => {
    await logoutRequest();
    clearCoworkerClientStorage();
    clearNavReturnStorage();
    clearAllListCaches();
    dispatch(setUser(null));
    resetDailyBriefingSession();
    resetAudioUnlock();
    navigate("/login", { replace: true });
  };

  const salesPathActive =
    pathname === "/sales" ||
    (pathname.startsWith("/sales/") &&
      !pathname.startsWith("/sales/activities"));
  const configPathActive =
    pathname === "/configuration" || pathname.startsWith("/configuration/");

  if (!session) return null;

  const role = normalizeRole(session.user.role);
  const isMarketingNav = role === "marketing";

  const modules = getModulesForAccess(
    session.businessType,
    session.user.role,
  );

  const configSubmodules = CONFIGURATION_SUBMODULES.filter((sub) => {
    if (sub.status === "coming_soon") return false;
    const r = normalizeRole(session.user.role);
    if (sub.id === "proposal-templates") return false;
    if (sub.id === "proposal-patterns" || sub.id === "quote-templates") {
      return canManageDocumentTemplates(r);
    }
    if (sub.id === "invoice-templates") return canEditInvoiceTemplates(r);
    if (sub.id === "billing") return canEditFinance(r);
    if (sub.id === "developers") return canManageApiKeys(r);
    return true;
  });

  const handleLogout = () => {
    onClose?.();
    logout();
  };

  const linkClass = (active: boolean) =>
    collapsed
      ? `relative inline-flex size-10 items-center justify-center rounded-xl transition-colors ${
          active
            ? "bg-white/10 text-white"
            : "text-white/70 hover:bg-white/5 hover:text-white"
        }`
      : `relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
          active
            ? "bg-white/10 text-white"
            : "text-white/70 hover:bg-white/5 hover:text-white"
        }`;

  return (
    <>
      <div
        className={`flex items-center border-b border-white/10 ${
          collapsed ? "justify-center px-2 py-4" : "px-4 py-4"
        }`}
      >
        <WorktualLogo
          inverted
          wordmark={!collapsed}
          markClassName={collapsed ? "size-8 rounded-md" : "h-8"}
        />
        {showClose ? (
          <button
            type="button"
            className="ml-auto inline-flex size-9 items-center justify-center rounded-lg text-text-on-dark-muted hover:bg-state-hover-on-dark hover:text-text-on-dark"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X className="size-5" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>

      <nav
        className={`scrollbar-hover-inverse min-h-0 flex-1 py-3 ${
          collapsed ? "overflow-y-auto overflow-x-hidden px-2" : "overflow-y-auto px-3"
        }`}
      >
        {!collapsed ? (
          <p className="mb-2 px-3 text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">
            Modules
          </p>
        ) : null}

        {isMarketingNav ? (
          <ul
            className={`flex flex-col ${collapsed ? "items-center gap-1" : "gap-1"}`}
          >
            {MARKETING_CAMPAIGN_NAV.map((mod) => {
              const Icon = mod.icon;
              const active =
                pathname === mod.href ||
                pathname.startsWith(`${mod.href}/`) ||
                (mod.id === "dashboard" &&
                  (pathname === "/marketing" ||
                    pathname === "/marketing/dashboard" ||
                    pathname === "/marketing/inbox" ||
                    pathname === "/" ||
                    pathname === "/dashboard")) ||
                (mod.id === "customers" &&
                  (pathname.startsWith("/marketing/audience") ||
                    pathname.startsWith("/marketing/customers"))) ||
                (mod.id === "create_campaign" &&
                  pathname.startsWith("/marketing/create"));

              return (
                <li key={mod.id} className={collapsed ? "w-full" : undefined}>
                  <NavTooltip label={mod.label} show={collapsed}>
                    <Link
                      to={mod.href}
                      onPointerDown={() => preloadNavModule(mod.href)}
                      onFocus={() => preloadNavModule(mod.href)}
                      onClick={(event) => {
                        keepCurrentPage(event, pathname, mod.href, search, hash);
                        onClose?.();
                      }}
                      className={linkClass(active)}
                      aria-label={mod.label}
                    >
                      <Icon className="size-4 shrink-0" strokeWidth={2.25} />
                      {!collapsed ? (
                        <>
                          <span className="truncate">{mod.label}</span>
                          {active ? (
                            <span className="absolute left-0 top-[20%] h-[60%] w-[3px] rounded-r-[2px] bg-white" />
                          ) : null}
                        </>
                      ) : null}
                    </Link>
                  </NavTooltip>
                </li>
              );
            })}
          </ul>
        ) : (
          <ul
            className={`flex flex-col ${collapsed ? "items-center gap-1" : "gap-1"}`}
          >
            {modules.map((mod) => {
              const Icon = mod.icon;

              if (mod.id === "sales") {
                return (
                  <NavBranch
                    key={mod.id}
                    label={mod.label}
                    href={mod.href}
                    icon={Icon}
                    active={salesPathActive}
                    collapsed={collapsed}
                    items={SALES_SUBMODULES}
                    pathname={pathname}
                    search={search}
                    hash={hash}
                    onNavigate={onClose}
                    isActive={(sub, path) =>
                      isSalesSubmoduleActive(
                        sub as (typeof SALES_SUBMODULES)[number],
                        path,
                      )
                    }
                  />
                );
              }

              if (mod.id === "marketing") {
                const marketingPathActive =
                  pathname === "/marketing" ||
                  pathname.startsWith("/marketing/");
                return (
                  <NavBranch
                    key={mod.id}
                    label={mod.label}
                    href={mod.href}
                    icon={Icon}
                    active={marketingPathActive}
                    collapsed={collapsed}
                    items={MARKETING_SUBMODULES}
                    pathname={pathname}
                    search={search}
                    hash={hash}
                    onNavigate={onClose}
                    isActive={(sub, path) =>
                      isMarketingSubmoduleActive(sub, path)
                    }
                  />
                );
              }

              if (mod.id === "configuration") {
                return (
                  <NavBranch
                    key={mod.id}
                    label={mod.label}
                    href={mod.href}
                    icon={Icon}
                    active={configPathActive}
                    collapsed={collapsed}
                    items={configSubmodules}
                    pathname={pathname}
                    search={search}
                    hash={hash}
                    onNavigate={onClose}
                    isActive={(sub, path) =>
                      isConfigurationSubmoduleActive(
                        sub as (typeof CONFIGURATION_SUBMODULES)[number],
                        path,
                      )
                    }
                  />
                );
              }

              const active =
                pathname === mod.href || pathname.startsWith(`${mod.href}/`);

              return (
                <li key={mod.id} className={collapsed ? "w-full" : undefined}>
                  <NavTooltip label={mod.label} show={collapsed}>
                    <Link
                      to={mod.href}
                      onPointerDown={() => preloadNavModule(mod.href)}
                      onFocus={() => preloadNavModule(mod.href)}
                      onClick={(event) => {
                        keepCurrentPage(event, pathname, mod.href, search, hash);
                        onClose?.();
                      }}
                      className={linkClass(active)}
                      aria-label={mod.label}
                    >
                      <Icon className="size-4 shrink-0" strokeWidth={2.25} />
                      {!collapsed ? (
                        <>
                          <span className="truncate">{mod.label}</span>
                          {active ? (
                            <span className="absolute left-0 top-[20%] h-[60%] w-[3px] rounded-r-[2px] bg-white" />
                          ) : null}
                        </>
                      ) : null}
                    </Link>
                  </NavTooltip>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <div
        className={`mt-auto border-t border-white/10 ${
          collapsed ? "px-2 py-3" : "px-3 py-4"
        }`}
      >
        <NavTooltip label="Logout" show={collapsed}>
          <button
            type="button"
            onClick={handleLogout}
            className={
              collapsed
                ? `${linkClass(false)} w-full`
                : "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white"
            }
            aria-label="Logout"
          >
            <LogOut className="size-4" strokeWidth={2.25} />
            {!collapsed ? "Logout" : null}
          </button>
        </NavTooltip>
      </div>
    </>
  );
}

export function Sidebar() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user);
  const session = user ? { businessType: user.businessType, user } : null;
  const collapsed = useAppSelector((s) => s.shell.sidebarCollapsed);
  const open = useAppSelector((s) => s.shell.mobileNavOpen);

  useEffect(() => {
    writeSidebarCollapsedPreference(collapsed);
  }, [collapsed]);

  if (!session) return null;

  const desktopWidth = collapsed ? SIDEBAR_COLLAPSED_W : SIDEBAR_EXPANDED_W;
  const closeNav = () => dispatch(setMobileNavOpen(false));

  return (
    <>
      <aside
        className={`relative hidden h-full shrink-0 flex-col overflow-visible bg-[#111111] text-white transition-[width] duration-200 ease-out md:flex ${desktopWidth}`}
      >
        <SidebarNav collapsed={collapsed} />
        <button
          type="button"
          onClick={() => dispatch(toggleSidebarCollapsed())}
          className="absolute top-[24px] -right-2.5 z-10 flex size-6 items-center justify-center rounded-full bg-white text-neutral-900 shadow-sm ring-[0.6px] ring-[#bfbfbf] transition-colors hover:bg-white/95"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={collapsed}
        >
          {collapsed ? (
            <ChevronRight className="size-3.5" strokeWidth={2.5} />
          ) : (
            <ChevronLeft className="size-3.5" strokeWidth={2.5} />
          )}
        </button>
      </aside>

      <div
        className={`fixed inset-0 z-50 md:hidden ${open ? "pointer-events-auto" : "pointer-events-none"}`}
        aria-hidden={!open}
      >
        <button
          type="button"
          className={`absolute inset-0 bg-black/55 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
          aria-label="Close menu"
          onClick={closeNav}
        />
        <aside
          className={`absolute inset-y-0 left-0 flex h-full w-[min(280px,88vw)] flex-col overflow-visible bg-[#111111] text-white shadow-xl transition-transform duration-200 ease-out ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <SidebarNav showClose onClose={closeNav} />
        </aside>
      </div>
    </>
  );
}
