/**
 * Side-effect import: registers all module rails (Waves 1–8).
 * Wave 0 ships with this file; modules are enabled by registering here.
 *
 * List modules with AgentModuleShell keep create in-shell via chips/prompts
 * (`set_workspace`). Quick links use `?view=create` on the list route so the
 * shell stays mounted; `/…/new` remains available as deep-link escapes.
 */
import { registerModuleRail } from "./module-rail-registry";
import type { PageCoworkerContext } from "./page-context";

function surfaceLabel(ctx: PageCoworkerContext) {
  return ctx.surface === "edit"
    ? "editing"
    : ctx.surface === "detail"
      ? "this record"
      : "this list";
}

registerModuleRail({
  key: "contact",
  label: "Contacts",
  welcome: (ctx) =>
    `I'm your **Worktual co-worker** on **Contacts** (${surfaceLabel(ctx)}). Ask to create or find someone — I'll switch the workspace without leaving this chat.`,
  chips: () => [
    {
      id: "new",
      label: "New contact",
      prompt: "Help me create a new contact",
    },
    {
      id: "email",
      label: "Find by email",
      prompt: "How do I find a contact by email on this page?",
    },
  ],
  quickLinks: () => [
    { type: "navigate", label: "New contact", href: "/contact?view=create" },
  ],
});

registerModuleRail({
  key: "company",
  label: "Companies",
  welcome: (ctx) =>
    `I'm your **Worktual co-worker** on **Companies** (${surfaceLabel(ctx)}). Ask to add a company — the draft opens in the workspace on the right.`,
  chips: (ctx) => [
    {
      id: "new-co",
      label: "New company",
      prompt: "I want to create a new company",
    },
    {
      id: "loc",
      label: "Add location",
      prompt: ctx.entityId
        ? `Add a location for this company`
        : "How do I add a location to a company?",
    },
  ],
  quickLinks: (ctx) => {
    const links = [
      {
        type: "navigate" as const,
        label: "New company",
        href: "/company?view=create",
      },
    ];
    if (ctx.entityId && ctx.pathname.startsWith("/company/")) {
      const companyId = ctx.pathname.split("/")[2];
      if (companyId && companyId !== "new") {
        links.push({
          type: "navigate",
          label: "New location",
          href: `/company/${companyId}/locations/new`,
        });
      }
    }
    return links;
  },
});

registerModuleRail({
  key: "sales",
  label: "Sales",
  welcome: (ctx) =>
    ctx.surface === "detail"
      ? `I'm your **Worktual co-worker** on this **deal**. Ask about next steps, a quote, or stage changes — I'll never update the deal without your confirmation in the UI.`
      : `I'm your **Worktual co-worker** on **Sales** (${surfaceLabel(ctx)}). Ask to create a deal — the draft opens beside this chat.`,
  chips: (ctx) => [
    {
      id: "deal",
      label: "New deal",
      prompt: "Help me create a new deal",
    },
    {
      id: "quote",
      label: "New quote",
      prompt: "I want to create a quote",
    },
    ...(ctx.surface === "detail"
      ? [
          {
            id: "stage",
            label: "Next stage tips",
            prompt: "What stage should this deal move to next and why?",
          },
        ]
      : []),
  ],
  quickLinks: (ctx) => {
    const links = [
      {
        type: "navigate" as const,
        label: "New deal",
        href: "/sales?view=create",
      },
      {
        type: "navigate" as const,
        label: "New quote",
        href: "/sales/quotes?view=create",
      },
    ];
    if (ctx.entityId && ctx.surface === "detail") {
      links.push({
        type: "navigate",
        label: "Open quotes for deal",
        href: `/sales/${ctx.entityId}`,
      });
    }
    return links;
  },
});

registerModuleRail({
  key: "product",
  label: "Products",
  welcome: (ctx) =>
    `I'm your **Worktual co-worker** on **Products** (${surfaceLabel(ctx)}). Ask to create a product — the draft opens in the workspace.`,
  chips: () => [
    {
      id: "new",
      label: "New product",
      prompt: "Help me create a product",
    },
    {
      id: "sku",
      label: "SKU tips",
      prompt: "What should I put for SKU and billing fields?",
    },
  ],
  quickLinks: () => [
    { type: "navigate", label: "New product", href: "/product?view=create" },
  ],
});

registerModuleRail({
  key: "finance",
  label: "Finance",
  welcome: (ctx) =>
    `I'm your **Worktual co-worker** on **Finance** (${surfaceLabel(ctx)}). Ask to create an invoice — the draft opens beside chat. Not available on B2C.`,
  chips: () => [
    {
      id: "inv",
      label: "New invoice",
      prompt: "Help me create an invoice",
    },
    {
      id: "deal",
      label: "Link a deal",
      prompt: "How do I invoice from an accepted deal?",
    },
  ],
  quickLinks: () => [
    { type: "navigate", label: "New invoice", href: "/finance?view=create" },
  ],
});

registerModuleRail({
  key: "activities",
  label: "Activities",
  welcome: () =>
    `I'm your **Worktual co-worker** on **Activities**. Ask to log a call, task, or meeting — the draft opens in the workspace. I won't write activities silently.`,
  chips: () => [
    {
      id: "log",
      label: "Log activity",
      prompt: "I want to log an activity",
    },
  ],
  quickLinks: () => [
    {
      type: "navigate",
      label: "Log activity",
      href: "/activities?view=create",
    },
  ],
});

registerModuleRail({
  key: "marketing",
  label: "Marketing",
  welcome: () =>
    `I'm your **Worktual co-worker** on **Marketing**. Campaign create already has a hybrid chat — I can guide you there. Marketing inbox has no co-worker.`,
  chips: () => [
    {
      id: "create",
      label: "Create campaign",
      prompt: "Help me start a campaign",
    },
  ],
  quickLinks: () => [
    { type: "navigate", label: "Create campaign", href: "/marketing/create" },
    { type: "navigate", label: "Digital Marketing", href: "/marketing/seo" },
  ],
});

registerModuleRail({
  key: "dashboard",
  label: "Dashboard",
  welcome: () =>
    `I'm your **Worktual co-worker** on the **Dashboard**. Ask what to do next — I'll deep-link into Contacts, Sales, or other modules.`,
  chips: () => [
    {
      id: "pipeline",
      label: "Open pipeline",
      prompt: "Take me to the sales pipeline",
    },
    {
      id: "contacts",
      label: "Open contacts",
      prompt: "Open contacts",
    },
  ],
  quickLinks: () => [
    { type: "navigate", label: "Sales", href: "/sales" },
    { type: "navigate", label: "Contacts", href: "/contact" },
  ],
});

registerModuleRail({
  key: "reports",
  label: "Reports",
  welcome: () =>
    `I'm your **Worktual co-worker** on **Reports**. I can explain what you're seeing and link to source modules.`,
  chips: () => [
    {
      id: "sales",
      label: "Sales module",
      prompt: "Open sales to act on pipeline numbers",
    },
  ],
  quickLinks: () => [
    { type: "navigate", label: "Sales", href: "/sales" },
  ],
});

registerModuleRail({
  key: "agents",
  label: "Agents",
  welcome: () =>
    `I'm your **Worktual co-worker** on **Agents** metrics. Specialist LangGraph agents run on their own schedules — I only help you navigate and interpret this dashboard.`,
  chips: () => [
    {
      id: "contacts",
      label: "Contacts",
      prompt: "Open contacts related to enrichment",
    },
  ],
  quickLinks: () => [
    { type: "navigate", label: "Contacts", href: "/contact" },
  ],
});

registerModuleRail({
  key: "commerce",
  label: "Commerce",
  welcome: () =>
    `I'm your **Worktual co-worker** on **Commerce**. Orders are primarily inbound — I can help you find your way around the list and details.`,
  chips: () => [
    {
      id: "list",
      label: "Explain orders",
      prompt: "What can I do on the commerce orders page?",
    },
  ],
});

registerModuleRail({
  key: "service",
  label: "Service",
  welcome: () =>
    `I'm your **Worktual co-worker** on **Service**. Tickets live in the Service microservice — I can explain the handoff, not edit tickets here.`,
  chips: () => [
    {
      id: "how",
      label: "How Service links",
      prompt: "How does Service connect to this CRM?",
    },
  ],
});

registerModuleRail({
  key: "configuration",
  label: "Configuration",
  welcome: () =>
    `I'm your **Worktual co-worker** on **Configuration**. I can guide email connect and other setup — OAuth still happens in the setup UI.`,
  chips: () => [
    {
      id: "email",
      label: "Email setup",
      prompt: "How do I connect email?",
    },
  ],
  quickLinks: () => [
    { type: "navigate", label: "Email", href: "/configuration/email" },
    {
      type: "navigate",
      label: "Proposal patterns",
      href: "/configuration/proposal-patterns",
    },
    {
      type: "navigate",
      label: "Quote templates",
      href: "/configuration/quote-templates",
    },
    {
      type: "navigate",
      label: "Invoice templates",
      href: "/configuration/invoice-templates",
    },
  ],
});

registerModuleRail({
  key: "process-approvals",
  label: "Approvals",
  welcome: () =>
    `I'm your **Worktual co-worker** on **Process approvals**. I can explain the queue — approvals still require your explicit action.`,
  chips: () => [
    {
      id: "how",
      label: "How approvals work",
      prompt: "Explain what I should do on this approvals page",
    },
  ],
});
