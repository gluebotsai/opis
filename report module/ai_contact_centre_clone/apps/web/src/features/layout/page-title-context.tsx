import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router";

import { getNavForRole } from "@/config/navigation";
import { useAuth } from "@/hooks/use-auth";
import type { UserRole } from "@/types/auth";

type PageTitleContextValue = {
  title: string;
  setTitle: (title: string | null) => void;
};

const PageTitleContext = createContext<PageTitleContextValue | null>(null);

function titleFromPath(pathname: string, role: UserRole) {
  const sections = getNavForRole(role);
  for (const section of sections) {
    const match = section.items.find((item) => item.path === pathname);
    if (match) return match.label;
  }

  const segment = pathname.split("/").filter(Boolean).pop() ?? "Page";
  return segment
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const [overrideTitle, setOverrideTitle] = useState<string | null>(null);

  const routeTitle = useMemo(
    () => titleFromPath(location.pathname, user?.role ?? "agent"),
    [location.pathname, user?.role],
  );

  useEffect(() => {
    setOverrideTitle(null);
  }, [location.pathname]);

  const setTitle = useCallback((next: string | null) => {
    setOverrideTitle(next);
  }, []);

  const title = overrideTitle ?? routeTitle;

  const value = useMemo(
    () => ({ title, setTitle }),
    [setTitle, title],
  );

  return <PageTitleContext.Provider value={value}>{children}</PageTitleContext.Provider>;
}

export function usePageTitle() {
  const ctx = useContext(PageTitleContext);
  if (!ctx) {
    throw new Error("usePageTitle must be used within PageTitleProvider");
  }
  return ctx.title;
}

export function useSetPageTitle(title: string) {
  const ctx = useContext(PageTitleContext);
  if (!ctx) {
    throw new Error("useSetPageTitle must be used within PageTitleProvider");
  }

  useEffect(() => {
    ctx.setTitle(title);
    return () => ctx.setTitle(null);
  }, [ctx.setTitle, title]);
}
