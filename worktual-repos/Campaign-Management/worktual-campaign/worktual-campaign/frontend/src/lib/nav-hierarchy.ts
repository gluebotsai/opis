/**
 * Industrial IA: module → list → detail → sub-detail.
 * Back / Up = parent in this tree (not history.back(), not module home).
 */

import { createCampaignHubHref } from "@/lib/create-campaign-active-session";
import { isConfigurationUiHidden } from "@/lib/campaign-channels";
import type { MonitoringTab } from "@/lib/campaign-monitoring-summary";

export type NavCrumb = {
  label: string;
  href: string;
};

export type NavLabels = {
  entity?: string;
  campaign?: string;
  contact?: string;
  event?: string;
  draft?: string;
  recommendation?: string;
  thread?: string;
  template?: string;
};

export type NavResolveInput = {
  pathname: string;
  search?: string;
  /** Cross-tree entry: calendar | dashboard | reports | or a path. */
  from?: string | null;
  /** location.state.listHref (chat workspaces). */
  entryHref?: string | null;
  labels?: NavLabels;
};

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  whatsapp: "WhatsApp",
  web_push: "Web push",
  app_push: "App push",
  ppc: "PPC",
  voice: "Voice",
};

const PPC_LABELS: Record<string, string> = {
  meta: "Meta",
  facebook: "Meta",
  google: "Google",
  linkedin: "LinkedIn",
};

const MONITOR_TABS = new Set([
  "live",
  "scheduled",
  "past",
  "on-demand",
  "personalised-crm",
]);

function titleCase(raw: string): string {
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function monitorTabLabel(tab: string): string {
  if (tab === "personalised-crm") return "Personalised CRM";
  if (tab === "on-demand") return "On-demand";
  return titleCase(tab);
}

function qs(search?: string): URLSearchParams {
  return new URLSearchParams((search || "").replace(/^\?/, ""));
}

function partsOf(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

export function resolveFromParam(
  from: string | null | undefined,
): string | null {
  if (!from) return null;
  const f = from.trim();
  if (!f) return null;
  if (f.startsWith("/")) return f;
  const key = f.toLowerCase();
  if (key === "dashboard") return "/dashboard";
  if (key === "calendar") return "/campaigns/calendar";
  if (key === "reports") return "/dashboard";
  if (key === "audience") return "/audience";
  if (key === "monitoring") return "/campaigns";
  if (key === "events") return "/events";
  if (key === "create" || key === "create_campaign") return "/campaigns/create";
  if (key === "configuration" || key === "config") {
    return isConfigurationUiHidden() ? "/dashboard" : "/configuration";
  }
  return null;
}

export function hrefWithFrom(href: string, from: string): string {
  const join = href.includes("?") ? "&" : "?";
  return `${href}${join}from=${encodeURIComponent(from)}`;
}

function currentHref(pathname: string, search?: string): string {
  const q = (search || "").replace(/^\?/, "");
  return q ? `${pathname}?${q}` : pathname;
}

function entityLabel(
  labels: NavLabels | undefined,
  fallback: string,
  key?: keyof NavLabels,
): string {
  if (key && labels?.[key]?.trim()) return labels[key]!.trim();
  if (labels?.entity?.trim()) return labels.entity.trim();
  return fallback;
}

/**
 * Full trail including the current screen (last crumb).
 * Depth 1 = module root (no Up). Depth 2+ = show crumbs + Up to parent.
 */
export function getNavCrumbs(input: NavResolveInput): NavCrumb[] {
  const pathname = input.pathname || "/";
  const search = input.search || "";
  const labels = input.labels || {};
  const sp = qs(search);
  const parts = partsOf(pathname);
  const here = currentHref(pathname, search);
  const fromHref =
    resolveFromParam(input.from) ||
    (input.entryHref?.startsWith("/") ? input.entryHref : null);

  const pushHere = (crumbs: NavCrumb[], label: string) => {
    crumbs.push({ label, href: here });
    return crumbs;
  };

  // —— Audience ——
  if (parts[0] === "audience") {
    const root: NavCrumb[] = [{ label: "Audience", href: "/audience" }];
    if (parts[1] === "chat" && parts[2]) {
      if (fromHref && fromHref.startsWith("/audience/") && fromHref !== "/audience") {
        return [
          ...root,
          { label: entityLabel(labels, "Contact", "contact"), href: fromHref },
          { label: "Chat", href: here },
        ];
      }
      return pushHere(root, "Chat");
    }
    if (parts[1] === "create" && parts[2] === "chat") {
      return pushHere(root, "New contact");
    }
    if (parts[1] === "new") {
      return pushHere(root, "New contact");
    }
    // List, contact profile (/audience/:id), etc. — flat "Audience"; back is in the right panel.
    return root;
  }

  // —— Configuration ——
  if (parts[0] === "configuration") {
    if (isConfigurationUiHidden()) {
      return [{ label: "Dashboard", href: "/dashboard" }];
    }
    const root: NavCrumb[] = [
      { label: "Configuration", href: "/configuration" },
    ];
    if (parts[1]) {
      return pushHere(
        root,
        CHANNEL_LABELS[parts[1]] || titleCase(parts[1]),
      );
    }
    return root;
  }

  // —— Events tracking ——
  if (parts[0] === "events") {
    const root: NavCrumb[] = [
      { label: "Events tracking", href: "/events" },
    ];
    if (parts[1] === "create") {
      const createCrumbs: NavCrumb[] = [
        ...root,
        { label: "Draft", href: "/events?tab=draft" },
      ];
      if (parts[2]) {
        return pushHere(createCrumbs, entityLabel(labels, "Event", "event"));
      }
      return createCrumbs;
    }
    if (parts[1]) {
      return pushHere(root, entityLabel(labels, "Event", "event"));
    }
    return root;
  }

  // —— Reports (legacy URL) ——
  if (parts[0] === "reports") {
    return [{ label: "Dashboard", href: "/dashboard" }];
  }

  // —— Dashboard ——
  if (parts[0] === "dashboard") {
    return [{ label: "Dashboard", href: "/dashboard" }];
  }

  // —— Create campaign tree ——
  if (
    parts[0] === "campaigns" &&
    (parts[1] === "create" || parts[1] === "new")
  ) {
    const workspace: NavCrumb = {
      label: "Create campaign",
      // hub=1: Back must open Create hub, not soft-resume an in-progress draft.
      href: createCampaignHubHref(),
    };
    if (!parts[2]) {
      const tool = sp.get("tool");
      if (tool === "templates") {
        return [
          workspace,
          {
            label: "Template library",
            href: "/campaigns/create?tool=templates",
          },
        ];
      }
      if (tool === "drafts") {
        return [
          workspace,
          { label: "Drafts", href: "/campaigns/create?tool=drafts" },
        ];
      }
      return [{ label: "Create campaign", href: "/campaigns/create" }];
    }

    if (parts[2] === "templates") {
      const lib: NavCrumb[] = [
        workspace,
        {
          label: "Template library",
          href: "/campaigns/create?tool=templates",
        },
      ];
      return parts[3] ? pushHere(lib, entityLabel(labels, "Template", "template")) : lib;
    }

    if (parts[2] === "whatsapp") {
      const wa: NavCrumb[] = [
        workspace,
        {
          label: "WhatsApp approvals",
          href: "/campaigns/create/whatsapp",
        },
      ];
      if (parts[3] && parts[4]) {
        return [
          ...wa,
          {
            label:
              parts[3] === "rejected" ? "Rejected template" : "Approved template",
            href: here,
          },
        ];
      }
      return wa;
    }

    if (parts[2] === "recommendations") {
      const recs: NavCrumb[] = [
        workspace,
        {
          label: "Recommendations",
          href: "/campaigns/create/recommendations",
        },
      ];
      if (sp.get("chat") === "1") {
        return pushHere(recs, "Manager chat");
      }
      if (parts[3]) {
        return pushHere(
          recs,
          entityLabel(labels, "Recommendation", "recommendation"),
        );
      }
      return recs;
    }

    if (parts[2] === "on-demand") {
      return [
        workspace,
        {
          label: "On-demand send",
          href: "/campaigns/create/on-demand",
        },
      ];
    }

    if (parts[2] === "ppc") {
      const ppc: NavCrumb[] = [
        workspace,
        { label: "PPC ads", href: "/campaigns/create/ppc" },
      ];
      if (parts[3]) {
        return pushHere(
          ppc,
          PPC_LABELS[parts[3].toLowerCase()] || titleCase(parts[3]),
        );
      }
      return ppc;
    }

    if (parts[2] === "events") {
      const ev: NavCrumb[] = [
        workspace,
        { label: "Draft", href: "/events?tab=draft" },
      ];
      if (parts[3]) {
        return pushHere(ev, entityLabel(labels, "Event", "event"));
      }
      return ev;
    }

    // Draft workspace: /campaigns/create/:draftId[/templates/...]
    // Same pattern as Recommendations / WhatsApp: ← Create campaign (back to hub).
    const draftId = parts[2];
    const draftHref = `/campaigns/create/${draftId}`;
    if (parts[3] === "templates") {
      return [
        workspace,
        { label: "Create campaign", href: draftHref },
        {
          label: entityLabel(labels, "Template", "template"),
          href: here,
        },
      ];
    }
    return [workspace, { label: "Create campaign", href: here }];
  }

  // —— Calendar ——
  if (parts[0] === "campaigns" && parts[1] === "calendar") {
    return [{ label: "Calendar", href: "/campaigns/calendar" }];
  }

  // —— On-demand sends (legacy path; list lives at /campaigns?tab=on-demand) ——
  if (parts[0] === "campaigns" && parts[1] === "on-demand") {
    const listHref = "/campaigns?tab=on-demand";
    const list: NavCrumb[] = [
      { label: "Campaign monitoring", href: "/campaigns" },
      { label: "On-demand", href: listHref },
    ];
    if (parts[2]) {
      return pushHere(list, entityLabel(labels, "On-demand send", "run"));
    }
    return list;
  }

  if (parts[0] === "campaigns" && parts[1] === "personalised-crm") {
    const listHref = "/campaigns?tab=personalised-crm";
    const list: NavCrumb[] = [
      { label: "Campaign monitoring", href: "/campaigns" },
      { label: "Personalised CRM", href: listHref },
    ];
    if (parts[2]) {
      return pushHere(list, entityLabel(labels, "Personalised CRM send", "campaign"));
    }
    return list;
  }

  // —— Monitor chat ——
  if (parts[0] === "campaigns" && parts[1] === "monitor" && parts[2] === "chat") {
    if (fromHref === "/dashboard") {
      return [
        { label: "Dashboard", href: "/dashboard" },
        { label: "Monitor chat", href: here },
      ];
    }
    return [
      { label: "Campaign monitoring", href: "/campaigns" },
      { label: "Monitor chat", href: here },
    ];
  }

  // —— Campaign detail (full page) ——
  if (
    parts[0] === "campaigns" &&
    parts[1] &&
    parts[1] !== "create" &&
    parts[1] !== "new" &&
    parts[1] !== "calendar" &&
    parts[1] !== "monitor" &&
    parts[1] !== "on-demand" &&
    parts[1] !== "personalised-crm"
  ) {
    const name = entityLabel(labels, "Campaign", "campaign");
    if (fromHref === "/campaigns/calendar") {
      return [
        { label: "Calendar", href: "/campaigns/calendar" },
        { label: name, href: here },
      ];
    }
    if (fromHref === "/dashboard" || fromHref === "/reports") {
      return [
        { label: "Dashboard", href: "/dashboard" },
        { label: name, href: here },
      ];
    }
    if (fromHref && fromHref !== pathname) {
      return [
        { label: "Back", href: fromHref },
        { label: name, href: here },
      ];
    }
    const tab = sp.get("tab");
    const listHref =
      tab && MONITOR_TABS.has(tab) ? `/campaigns?tab=${tab}` : "/campaigns";
    const crumbs: NavCrumb[] = [
      { label: "Campaign monitoring", href: listHref },
    ];
    if (tab && MONITOR_TABS.has(tab)) {
      crumbs.push({ label: monitorTabLabel(tab), href: listHref });
    }
    return pushHere(crumbs, name);
  }

  // —— Campaign monitoring list / in-pane detail (?tab=&id=) ——
  if (parts[0] === "campaigns" && !parts[1]) {
    const tab = sp.get("tab");
    const id = sp.get("id");
    const listHref =
      tab && MONITOR_TABS.has(tab) ? `/campaigns?tab=${tab}` : "/campaigns";
    const root: NavCrumb[] = [
      { label: "Campaign monitoring", href: "/campaigns" },
    ];
    if (!id) {
      if (tab && MONITOR_TABS.has(tab)) {
        return [{ label: "Campaign monitoring", href: listHref }];
      }
      return root;
    }
    const crumbs: NavCrumb[] = [
      { label: "Campaign monitoring", href: listHref },
    ];
    if (tab && MONITOR_TABS.has(tab)) {
      crumbs.push({ label: monitorTabLabel(tab), href: listHref });
    }
    return pushHere(
      crumbs,
      entityLabel(labels, "Campaign", "campaign"),
    );
  }

  return [{ label: "Campaign", href: pathname || "/" }];
}

/** Parent in the IA tree. Null on module roots. */
export function getParentHref(input: NavResolveInput): string | null {
  const crumbs = getNavCrumbs(input);
  if (crumbs.length < 2) return null;
  return crumbs[crumbs.length - 2]?.href ?? null;
}

export function parseMonitorTab(
  raw: string | null | undefined,
): MonitoringTab | null {
  const t = String(raw || "").toLowerCase();
  if (t === "live" || t === "scheduled" || t === "past" || t === "on-demand" || t === "personalised-crm") {
    return t;
  }
  return null;
}
