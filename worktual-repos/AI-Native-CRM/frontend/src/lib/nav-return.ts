/**
 * Remembers the last page in each sidebar module, plus scroll and the row
 * the user left from, so coming back lands on that same place.
 */

const HREF_KEY = "crm-nav-href";
const SCROLL_KEY = "crm-nav-scroll";
const FOCUS_KEY = "crm-nav-focus";
const PAGE_KEY = "crm-nav-page";
const TRAIL_KEY = "crm-nav-trail";

const LIST_EXACT = new Set([
  "/",
  "/dashboard",
  "/inbox",
  "/contact",
  "/company",
  "/sales",
  "/sales/calendar",
  "/sales/quotes",
  "/sales/proposals",
  "/activities",
  "/product",
  "/commerce",
  "/communication",
  "/finance",
  "/service",
  "/reports",
  "/agents",
  "/configuration",
  "/marketing",
]);

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type ScrollNode = {
  parentElement: ScrollNode | null;
  children: { item(index: number): ScrollNode | null };
};

let showWorkspaceAfterNav = false;

export function markOpenWorkspace() {
  showWorkspaceAfterNav = true;
}

export function peekOpenWorkspace() {
  return showWorkspaceAfterNav;
}

export function clearOpenWorkspace() {
  showWorkspaceAfterNav = false;
}

function browserStore(): Store | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

function readJson<T>(store: Store, key: string, fallback: T): T {
  try {
    const raw = store.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(store: Store, key: string, value: unknown) {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or a full quota — navigation still works */
  }
}

export function navModuleKey(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  const root = parts[0] ?? "home";
  if (root === "sales" && parts[1] === "calendar") return "sales/calendar";
  if ((root === "marketing" || root === "configuration") && parts[1]) {
    return `${root}/${parts[1]}`;
  }
  return root;
}

export function locationHref(pathname: string, search = "", hash = ""): string {
  return `${pathname}${search}${hash}`;
}

export function rememberModuleHref(
  pathname: string,
  href: string,
  store: Store | null = browserStore(),
) {
  if (!store || pathname.startsWith("/login")) return;
  const map = readJson<Record<string, string>>(store, HREF_KEY, {});
  map[navModuleKey(pathname)] = href;
  writeJson(store, HREF_KEY, map);
}

/** Sidebar module target. A module click opens this page, not the last record. */
export function moduleHomeHref(href: string): string {
  const path = (href.split("?")[0] || href).split("#")[0] || href;
  return path.replace(/\/$/, "") || "/";
}

/** True only on the module's own main page, with no detail or filter query. */
export function isModuleHome(
  pathname: string,
  href: string,
  search = "",
  hash = "",
): boolean {
  const path = (pathname.split("?")[0] || pathname).split("#")[0] || pathname;
  const normalizedPath = path.replace(/\/$/, "") || "/";
  if (normalizedPath !== moduleHomeHref(href)) return false;
  return search.length === 0 && hash.length === 0;
}

export function returnHref(fallback: string, store: Store | null = browserStore()): string {
  if (!store) return fallback;
  const path = (fallback.split("?")[0] || fallback).split("#")[0] || fallback;
  const key = navModuleKey(path);
  const saved = readJson<Record<string, string>>(store, HREF_KEY, {})[key];
  if (!saved || !saved.startsWith("/")) return fallback;
  const savedPath = (saved.split("?")[0] || saved).split("#")[0] || saved;
  if (navModuleKey(savedPath) !== key) return fallback;
  return saved;
}

export function readScroll(
  href: string,
  store: Store | null = browserStore(),
): Record<string, number> | null {
  if (!store) return null;
  const map = readJson<Record<string, Record<string, number>>>(store, SCROLL_KEY, {});
  return map[href] ?? null;
}

export function writeScroll(
  href: string,
  positions: Record<string, number>,
  store: Store | null = browserStore(),
) {
  if (!store || Object.keys(positions).length === 0) return;
  const map = readJson<Record<string, Record<string, number>>>(store, SCROLL_KEY, {});
  map[href] = positions;
  writeJson(store, SCROLL_KEY, map);
}

export function readFocus(href: string, store: Store | null = browserStore()): string | null {
  if (!store) return null;
  return readJson<Record<string, string>>(store, FOCUS_KEY, {})[href] ?? null;
}

export function writeFocus(href: string, focusId: string, store: Store | null = browserStore()) {
  if (!store || !focusId) return;
  const map = readJson<Record<string, string>>(store, FOCUS_KEY, {});
  map[href] = focusId;
  writeJson(store, FOCUS_KEY, map);
}

export function readPageField(
  pathname: string,
  field: string,
  store: Store | null = browserStore(),
): string | null {
  if (!store) return null;
  const pages = readJson<Record<string, Record<string, string>>>(store, PAGE_KEY, {});
  return pages[pathname]?.[field] ?? null;
}

export function writePageField(
  pathname: string,
  field: string,
  value: string,
  store: Store | null = browserStore(),
) {
  if (!store) return;
  const pages = readJson<Record<string, Record<string, string>>>(store, PAGE_KEY, {});
  const page = pages[pathname] ?? {};
  page[field] = value;
  pages[pathname] = page;
  writeJson(store, PAGE_KEY, pages);
}

export function noteNavigation(
  href: string,
  type: "POP" | "PUSH" | "REPLACE",
  store: Store | null = browserStore(),
) {
  if (!store || href.startsWith("/login")) return;
  const trail = readJson<string[]>(store, TRAIL_KEY, []);
  if (type === "REPLACE") {
    if (trail.length === 0) trail.push(href);
    else trail[trail.length - 1] = href;
  } else if (type === "POP") {
    const index = trail.lastIndexOf(href);
    if (index >= 0) trail.splice(index + 1);
    else trail.push(href);
  } else if (trail[trail.length - 1] !== href) {
    trail.push(href);
  }
  if (trail.length > 50) trail.splice(0, trail.length - 50);
  writeJson(store, TRAIL_KEY, trail);
}

export function previousInAppHref(store: Store | null = browserStore()): string | null {
  if (!store) return null;
  const trail = readJson<string[]>(store, TRAIL_KEY, []);
  if (trail.length < 2) return null;
  return trail[trail.length - 2] ?? null;
}

function hrefPath(href: string): string {
  const path = (href.split("?")[0] || href).split("#")[0] || href;
  return path.replace(/\/$/, "") || "/";
}

/** The record a href opens, for lists that keep the detail on the list url. */
function hrefRecordId(href: string): string | null {
  const queryAt = href.indexOf("?");
  if (queryAt < 0) return null;
  const hashAt = href.indexOf("#");
  const query =
    hashAt > queryAt ? href.slice(queryAt + 1, hashAt) : href.slice(queryAt + 1);
  return new URLSearchParams(query).get("id");
}

/**
 * Same page, not just the same path. A module list and a record opened on that
 * same url (/contact vs /contact?view=detail&id=p-1) are different pages.
 */
export function isSameEntry(a: string, b: string): boolean {
  if (hrefPath(a) !== hrefPath(b)) return false;
  return hrefRecordId(a) === hrefRecordId(b);
}

/**
 * The page the user came from.
 *
 * The trail is written in a layout effect, so a render reads it before the
 * current page has been recorded. Going forward that is harmless: the last
 * entry is the page just left. After Back it is not — the trail still ends
 * with the page the user left, which is now ahead of them, so that entry is
 * located and everything past it ignored. The two cases cannot be told apart
 * from the trail alone, which is why the navigation type is required.
 */
export function arrivalHref(
  currentHref: string,
  store: Store | null = browserStore(),
  navigationType: "POP" | "PUSH" | "REPLACE" = "PUSH",
): string | null {
  if (!store) return null;
  const trail = readJson<string[]>(store, TRAIL_KEY, []);
  if (trail.length === 0) return null;
  if (navigationType === "POP") {
    for (let i = trail.length - 1; i >= 0; i -= 1) {
      const entry = trail[i];
      if (entry && isSameEntry(entry, currentHref)) {
        return i >= 1 ? (trail[i - 1] ?? null) : null;
      }
    }
    return trail[trail.length - 1] ?? null;
  }
  const last = trail[trail.length - 1];
  if (!last) return null;
  if (isSameEntry(last, currentHref)) {
    return trail.length >= 2 ? (trail[trail.length - 2] ?? null) : null;
  }
  return last;
}

/** Back target when the previous page is a record, not a module list. */
export function sourceRecordBack(href: string | null): { to: string; label: string } | null {
  if (!href || !href.startsWith("/")) return null;
  const hashAt = href.indexOf("#");
  const withoutHash = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const queryAt = withoutHash.indexOf("?");
  const path = hrefPath(withoutHash);
  const params = new URLSearchParams(queryAt >= 0 ? withoutHash.slice(queryAt + 1) : "");
  if (params.get("view") === "detail" && params.get("id")) {
    if (path === "/contact") return { to: href, label: "Back to contact" };
    if (path === "/company") return { to: href, label: "Back to company" };
    if (path === "/sales") return { to: href, label: "Back to deal" };
    if (path === "/product") return { to: href, label: "Back to product" };
    if (path === "/finance") return { to: href, label: "Back to invoice" };
    if (path === "/commerce") return { to: href, label: "Back to order" };
    if (path === "/activities") return { to: href, label: "Back to activity" };
  }
  if (backTargetIsList(path)) return null;
  const parts = path.split("/").filter(Boolean);
  const root = parts[0];
  const rest = parts[1];
  if (!rest || rest === "new") return null;
  if (root === "contact") return { to: href, label: "Back to contact" };
  if (root === "company" && parts[2] === "locations" && parts[3]) {
    return { to: href, label: "Back to location" };
  }
  if (root === "company") return { to: href, label: "Back to company" };
  if (root === "sales" && rest === "quotes" && parts[2]) {
    return { to: href, label: "Back to quote" };
  }
  if (root === "sales" && rest === "proposals" && parts[2]) {
    return { to: href, label: "Back to proposal" };
  }
  if (
    root === "sales" &&
    rest !== "calendar" &&
    rest !== "quotes" &&
    rest !== "proposals"
  ) {
    return { to: href, label: "Back to deal" };
  }
  if (root === "product") return { to: href, label: "Back to product" };
  if (root === "finance") return { to: href, label: "Back to invoice" };
  if (root === "commerce") return { to: href, label: "Back to order" };
  if (root === "activities") return { to: href, label: "Back to activity" };
  return null;
}

export function backTargetIsList(to: string): boolean {
  const path = (to.split("?")[0] || to).replace(/\/$/, "") || "/";
  if (LIST_EXACT.has(path)) return true;
  if (path.startsWith("/configuration/")) return true;
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "marketing" && parts.length === 2) return true;
  return false;
}

export function scrollPath(node: ScrollNode, root: ScrollNode): string {
  if (node === root) return "root";
  const parts: string[] = [];
  let current: ScrollNode | null = node;
  while (current && current !== root) {
    const parent: ScrollNode | null = current.parentElement;
    if (!parent) return "root";
    let index = -1;
    for (let i = 0; i < 80; i += 1) {
      const child = parent.children.item(i);
      if (!child) break;
      if (child === current) {
        index = i;
        break;
      }
    }
    if (index < 0) return "root";
    parts.push(String(index));
    current = parent;
  }
  return parts.reverse().join(".");
}

export function elementAtScrollPath(root: ScrollNode, path: string): ScrollNode | null {
  if (path === "root") return root;
  let current: ScrollNode = root;
  for (const part of path.split(".")) {
    const index = Number(part);
    if (!Number.isInteger(index) || index < 0) return null;
    const next = current.children.item(index);
    if (!next) return null;
    current = next;
  }
  return current;
}

export function clearNavReturnStorage(store: Store | null = browserStore()) {
  showWorkspaceAfterNav = false;
  if (!store) return;
  for (const key of [HREF_KEY, SCROLL_KEY, FOCUS_KEY, PAGE_KEY, TRAIL_KEY]) {
    try {
      store.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
