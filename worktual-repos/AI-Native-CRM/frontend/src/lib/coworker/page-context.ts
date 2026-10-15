import type { ModuleId } from "@/config/modules";

export type CoworkerSurface =
  | "list"
  | "detail"
  | "edit"
  | "create"
  | "other";

export type PageCoworkerContext = {
  pathname: string;
  module: ModuleId | "marketing" | "process-approvals" | null;
  surface: CoworkerSurface;
  entityId: string | null;
  /** Never show rail (Inbox, create hybrids, etc.) */
  excluded: boolean;
  /** Module is in the enable registry */
  moduleKey: string | null;
};

const CREATE_HYBRID_PREFIXES = [
  "/sales/new",
  "/sales/quotes/new",
  "/contact/new",
  "/company/new",
  "/product/new",
  "/finance/new",
  "/activities/log",
];

function isCreateHybrid(pathname: string): boolean {
  if (CREATE_HYBRID_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}?`))) {
    return true;
  }
  if (/^\/company\/[^/]+\/locations\/new\/?$/.test(pathname)) return true;
  if (/^\/marketing\/create\/[^/]+\/?$/.test(pathname)) return true;
  return false;
}

function isExcludedPath(pathname: string): boolean {
  if (pathname === "/inbox" || pathname.startsWith("/inbox/")) return true;
  if (pathname === "/marketing/inbox" || pathname.startsWith("/marketing/inbox/")) {
    return true;
  }
  if (pathname === "/marketing/seo" || pathname.startsWith("/marketing/seo/")) {
    return true;
  }
  if (isCreateHybrid(pathname)) return true;
  return false;
}

/**
 * Derive co-worker page context from the current CRM pathname.
 */
export function resolvePageCoworkerContext(pathname: string): PageCoworkerContext {
  const path = pathname.split("?")[0].replace(/\/$/, "") || "/";
  const parts = path.split("/").filter(Boolean);

  if (isExcludedPath(path) || parts.length === 0) {
    return {
      pathname: path,
      module: null,
      surface: "other",
      entityId: null,
      excluded: isExcludedPath(path) || parts.length === 0,
      moduleKey: null,
    };
  }

  const root = parts[0];

  // Marketing uses submodule paths under /marketing/*
  if (root === "marketing") {
    const sub = parts[1] ?? "dashboard";
    if (sub === "inbox") {
      return {
        pathname: path,
        module: "marketing",
        surface: "list",
        entityId: null,
        excluded: true,
        moduleKey: null,
      };
    }
    const surface: CoworkerSurface =
      sub === "create" && parts[2]
        ? "create"
        : sub === "create"
          ? "list"
          : "list";
    return {
      pathname: path,
      module: "marketing",
      surface: isCreateHybrid(path) ? "create" : surface,
      entityId: null,
      excluded: isCreateHybrid(path),
      moduleKey: "marketing",
    };
  }

  if (root === "process-approvals") {
    return {
      pathname: path,
      module: "process-approvals",
      surface: "list",
      entityId: null,
      excluded: false,
      moduleKey: "process-approvals",
    };
  }

  const module = root as ModuleId;
  let surface: CoworkerSurface = "list";
  let entityId: string | null = null;

  if (parts[1] === "new") {
    surface = "create";
  } else if (parts.includes("edit")) {
    surface = "edit";
    entityId = parts[1] && parts[1] !== "edit" ? parts[1] : null;
  } else if (parts[1] && parts[1] !== "quotes" && parts[1] !== "calendar" && parts[1] !== "log") {
    // detail-ish: /contact/:id, /sales/:dealId, /finance/:id, locations, etc.
    if (root === "sales" && (parts[1] === "quotes" || parts[1] === "calendar")) {
      surface = "list";
    } else if (root === "company" && parts[2] === "locations") {
      surface = parts[4] === "edit" ? "edit" : parts[3] === "new" ? "create" : "detail";
      entityId = parts[3] && parts[3] !== "new" ? parts[3] : parts[1] ?? null;
    } else if (root === "configuration") {
      surface = "other";
    } else {
      surface = "detail";
      entityId = parts[1] ?? null;
    }
  }

  if (root === "sales" && parts[1] === "quotes" && !parts[2]) {
    surface = "list";
    entityId = null;
  }
  if (root === "sales" && parts[1] === "calendar") {
    surface = "list";
    entityId = null;
  }
  if (root === "sales" && parts[1] && parts[1] !== "quotes" && parts[1] !== "calendar" && parts[1] !== "new") {
    surface = parts[2] === "edit" ? "edit" : "detail";
    entityId = parts[1];
  }

  const excluded = isExcludedPath(path) || surface === "create";

  return {
    pathname: path,
    module,
    surface,
    entityId,
    excluded,
    moduleKey: root,
  };
}
