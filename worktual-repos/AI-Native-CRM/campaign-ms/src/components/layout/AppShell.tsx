"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { LogOut, Menu, UserRound, X } from "lucide-react";
import { WorktualLogo } from "@/components/brand/WorktualLogo";
import { APP_MODULES, getModuleByPath } from "@/config/modules";
import type { CampaignSessionUser } from "@/server/auth/types";
import { logoutAction } from "@/server/auth/login-action";

function isModuleActive(href: string, pathname: string, moduleId: string) {
  if (moduleId === "create_campaign") {
    return (
      pathname === "/campaigns/create" ||
      pathname.startsWith("/campaigns/create/") ||
      pathname === "/campaigns/new" ||
      pathname.startsWith("/campaigns/new/")
    );
  }
  if (moduleId === "monitoring") {
    return (
      pathname === "/campaigns" ||
      (pathname.startsWith("/campaigns/") &&
        !pathname.startsWith("/campaigns/create") &&
        !pathname.startsWith("/campaigns/new"))
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarNav({
  session,
  showClose,
  onClose,
}: {
  session: CampaignSessionUser;
  showClose?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <>
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-5">
        <div>
          <WorktualLogo inverted markClassName="size-8" />
          <p className="mt-1.5 px-0.5 text-[10px] font-medium tracking-wider text-text-on-dark-muted uppercase">
            Campaign
          </p>
        </div>
        {showClose ? (
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-lg text-text-on-dark-muted hover:bg-state-hover-on-dark hover:text-text-on-dark"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X className="size-5" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <p className="mb-2 px-3 text-[10px] font-medium tracking-wider text-text-on-dark-muted uppercase">
          Modules
        </p>
        <ul className="flex flex-col gap-1">
          {APP_MODULES.map((mod) => {
            const Icon = mod.icon;
            const active = isModuleActive(mod.href, pathname, mod.id);

            return (
              <li key={mod.id}>
                <Link
                  href={mod.href}
                  onClick={() => onClose?.()}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? "bg-brand text-text-on-dark"
                      : "text-text-on-dark-muted hover:bg-state-hover-on-dark hover:text-text-on-dark"
                  }`}
                >
                  <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{mod.label}</span>
                  {active ? (
                    <span className="ml-auto size-1.5 rounded-full bg-white" />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-auto border-t border-white/10 px-3 py-4">
        <div className="mb-2 flex items-center gap-3 rounded-lg px-3 py-2.5">
          <span className="inline-flex size-8 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">
            {session.initials}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-text-on-dark">
              {session.name}
            </p>
            <p className="truncate text-xs text-text-on-dark-muted">
              {session.role}
            </p>
          </div>
          <UserRound className="ml-auto size-4 shrink-0 text-text-on-dark-muted" />
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            onClose?.();
            startTransition(() => {
              void logoutAction();
            });
          }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-on-dark-muted transition-colors hover:bg-state-hover-on-dark hover:text-text-on-dark disabled:opacity-60"
        >
          <LogOut className="size-4" strokeWidth={1.75} />
          Logout
        </button>
      </div>
    </>
  );
}

export function Sidebar({
  session,
  open = false,
  onClose,
}: {
  session: CampaignSessionUser;
  open?: boolean;
  onClose?: () => void;
}) {
  return (
    <>
      <aside className="hidden h-full w-[260px] shrink-0 flex-col bg-canvas-inverse text-text-on-dark md:flex">
        <SidebarNav session={session} />
      </aside>

      <div
        className={`fixed inset-0 z-50 md:hidden ${open ? "pointer-events-auto" : "pointer-events-none"}`}
        aria-hidden={!open}
      >
        <button
          type="button"
          className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
          aria-label="Close menu"
          onClick={onClose}
        />
        <aside
          className={`absolute inset-y-0 left-0 flex h-full w-[min(280px,88vw)] flex-col bg-canvas-inverse text-text-on-dark shadow-xl transition-transform duration-200 ease-out ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <SidebarNav session={session} showClose onClose={onClose} />
        </aside>
      </div>
    </>
  );
}

export function AppShell({
  session,
  children,
}: {
  session: CampaignSessionUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [navOpen]);

  return (
    <div className="flex h-dvh overflow-hidden bg-subtle">
      <Sidebar
        session={session}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header session={session} onMenuClick={() => setNavOpen(true)} />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function Header({
  session,
  onMenuClick,
}: {
  session: CampaignSessionUser;
  onMenuClick?: () => void;
}) {
  const pathname = usePathname();
  const mod = getModuleByPath(pathname);
  const label = mod?.label ?? "Campaign";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border-default bg-surface px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {onMenuClick ? (
          <button
            type="button"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-icon-on-light hover:bg-state-hover md:hidden"
            onClick={onMenuClick}
            aria-label="Open menu"
          >
            <Menu className="size-5" strokeWidth={1.75} />
          </button>
        ) : null}

        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 items-center gap-2 overflow-hidden text-sm"
        >
          <span className="truncate font-medium text-text-primary">{label}</span>
        </nav>
      </div>

      <span className="inline-flex size-9 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">
        {session.initials}
      </span>
    </header>
  );
}
