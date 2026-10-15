import type { CopilotPageSnapshot, CopilotSurface } from "./copilot-page-context";

const surfaceLabels: Record<CopilotSurface, string> = {
  "queues-list": "Queues",
  "queue-create": "Create queue",
  "queue-edit": "Manage queue",
  dashboard: "Dashboard",
  analytics: "Analytics",
  inbox: "Inbox",
  "contacts-list": "Contacts",
  "contacts-detail": "Contact profile",
  "tasks-list": "My Tasks",
  "tasks-detail": "Task detail",
  monitoring: "Live Monitoring",
  performance: "My Performance",
  other: "Contact Center",
};

export function copilotSurfaceLabel(surface: CopilotSurface) {
  return surfaceLabels[surface];
}

export function copilotContextLine(snapshot: CopilotPageSnapshot) {
  const base = surfaceLabels[snapshot.surface];
  if (snapshot.recordLabel && snapshot.surface === "queue-edit") {
    return `${base} · ${snapshot.recordLabel}`;
  }
  if (snapshot.recordLabel && snapshot.surface === "contacts-detail") {
    return `${base} · ${snapshot.recordLabel}`;
  }
  if (snapshot.recordLabel && snapshot.surface === "tasks-detail") {
    return `${base} · ${snapshot.recordLabel}`;
  }
  return base;
}

function escapeWelcome(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function welcomeParagraph(html: string) {
  return `<p>${html}</p>`;
}

export function copilotWelcome(snapshot: CopilotPageSnapshot, role: "admin" | "agent") {
  if (role === "agent") {
    if (snapshot.surface === "inbox") {
      return welcomeParagraph(
        "I'm your <strong>Worktual co-worker</strong>.<br>I can help with replies and summaries for this conversation.",
      );
    }
    if (snapshot.surface === "performance") {
      return welcomeParagraph(
        "I'm your <strong>Worktual co-worker</strong>. On <strong>My Performance</strong>, I can answer analytics questions, generate performance reports, and render real-time graphs.",
      );
    }
    if (snapshot.surface === "contacts-list" || snapshot.surface === "contacts-detail") {
      return welcomeParagraph(
        "I'm your <strong>Worktual co-worker</strong>. I can search, create, and update contacts in natural conversation — ask one thing at a time or share details in one message. When you're ready to save, I'll show a preview on the right for confirmation. Contacts can't be deleted, but I can mark them inactive.",
      );
    }
    if (snapshot.surface === "tasks-list" || snapshot.surface === "tasks-detail") {
      return welcomeParagraph(
        "I'm your <strong>Worktual co-worker</strong>. On <strong>My Tasks</strong>, I can surface callbacks, follow-ups, and suggested next actions from your conversations.",
      );
    }
    return welcomeParagraph(
      "I'm your <strong>Worktual co-worker</strong>. I can list queues, open your inbox, or answer questions about your workspace.",
    );
  }

  switch (snapshot.surface) {
    case "inbox":
      return welcomeParagraph(
        "I'm your <strong>Worktual co-worker</strong>.<br>I can help with replies and summaries for this conversation.",
      );
    case "queues-list":
      return welcomeParagraph(
        "I'm your <strong>Worktual co-worker</strong>. I can create and manage queues conversationally — I'll ask for anything missing and keep the setup preview on the right updated as we go.",
      );
    case "queue-create":
      return welcomeParagraph(
        "Let's create this queue together. I'll walk through it one step at a time — name, team, shifts, agents, and channels — and keep the setup preview on the right updated.",
      );
    case "queue-edit":
      return snapshot.recordLabel
        ? welcomeParagraph(
            `Managing <strong>${escapeWelcome(snapshot.recordLabel)}</strong>. Ask your co-worker to activate, deactivate, or delete it — or edit the form on the right.`,
          )
        : welcomeParagraph(
            "Edit the queue on the right, or ask your co-worker to help with status changes.",
          );
    case "dashboard":
      return welcomeParagraph(
        "I'm your <strong>Worktual co-worker</strong> on the <strong>Dashboard</strong>. Ask for KPI numbers, trends, or agent and channel breakdowns — or ask <strong>why</strong> a metric changed and I'll investigate its drivers and relationships. I can also help you open queues or other setup pages.",
      );
    case "analytics":
      return welcomeParagraph(
        "I'm your <strong>Worktual co-worker</strong> on <strong>Analytics</strong>. Ask about diagnostic incidents, missed-contact rate, contributing factors, forecasts, peak hour, or recommended actions — I'll use the live Analytics snapshot, not guesses.",
      );
    case "contacts-list":
      return welcomeParagraph(
        "I'm your <strong>Worktual co-worker</strong>. I can search, create, and update contacts conversationally — I'll ask for anything missing and show a confirmation preview on the right before saving. Contacts can't be deleted, but I can mark them inactive.",
      );
    case "contacts-detail":
      return snapshot.recordLabel
        ? welcomeParagraph(
            `Viewing <strong>${escapeWelcome(snapshot.recordLabel)}</strong>. Ask me to update this contact, or say <strong>make inactive</strong> instead of delete. I'll show a preview on the right before anything is saved.`,
          )
        : welcomeParagraph(
            "Review this contact profile on the right, or ask your co-worker to update it.",
          );
    case "tasks-list":
      return welcomeParagraph(
        "I'm your <strong>Worktual co-worker</strong>. I can help you review callbacks, follow-ups, and suggested next actions assigned to you.",
      );
    case "tasks-detail":
      return snapshot.recordLabel
        ? welcomeParagraph(
            `Reviewing <strong>${escapeWelcome(snapshot.recordLabel)}</strong>. Ask me to summarize it, suggest next steps, or open the related conversation.`,
          )
        : welcomeParagraph(
            "Review this task on the right, or ask your co-worker what to do next.",
          );
    case "monitoring":
      return welcomeParagraph(
        "I'm your <strong>Worktual co-worker</strong> on <strong>Live Monitoring</strong>. Ask about waiting contacts, missed calls, open callbacks, queue backlog, SLA risk, agent presence, channel capacity, or attendance.",
      );
    case "performance":
      return welcomeParagraph(
        "I'm your <strong>Worktual co-worker</strong>. On <strong>My Performance</strong>, I can answer analytics questions, generate performance reports, and render real-time graphs.",
      );
    default:
      return welcomeParagraph(
        "I'm your <strong>Worktual co-worker</strong>. I can run setup actions, help you navigate, and work through operational tasks with you.",
      );
  }
}

export function copilotQuickPrompts(snapshot: CopilotPageSnapshot, role: "admin" | "agent") {
  if (role === "agent") {
    if (snapshot.surface === "inbox") {
      return ["Summarize this thread", "Draft a reply", "What can you do?"];
    }
    if (snapshot.surface === "performance") {
      return ["Generate my performance report", "Show my performance trend", "Show channel mix graph"];
    }
    if (snapshot.surface === "contacts-list" || snapshot.surface === "contacts-detail") {
      return ["Find contact by email", "Create a contact", "Update a contact", "Go to inbox"];
    }
    if (snapshot.surface === "tasks-list" || snapshot.surface === "tasks-detail") {
      return ["Show overdue tasks", "What callbacks are due today?", "Go to inbox"];
    }
    return ["Show my queues", "Go to inbox", "What can you do?"];
  }

  switch (snapshot.surface) {
    case "inbox":
      return ["Summarize open conversations", "Draft a reply", "Go to queues"];
    case "queues-list":
      return [
        "List queues",
        "Create queue Billing for sales team",
        "Deactivate test queue",
        "Open create queue",
      ];
    case "queue-create":
      return [
        "Billing for sales team",
        "List queues",
        "What can you do?",
      ];
    case "queue-edit":
      if (snapshot.recordLabel) {
        return [
          `Deactivate ${snapshot.recordLabel}`,
          `Delete ${snapshot.recordLabel}`,
          "List queues",
          "Back to queues",
        ];
      }
      return ["List queues", "Deactivate this queue", "Back to queues"];
    case "dashboard":
      return [
        "Total calls yesterday by agent",
        "Show channel mix for this period",
        "What's our resolution rate?",
        "Go to queues",
      ];
    case "analytics":
      return [
        "Why is missed-contact rate this high?",
        "What changed versus last week?",
        "Show hourly volume for the peak hour",
        "What should we do next?",
      ];
    case "contacts-list":
      return [
        "List recent contacts",
        "Find contact by email",
        "Create a contact",
        "What can you do?",
      ];
    case "contacts-detail":
      return snapshot.recordLabel
        ? [`Update ${snapshot.recordLabel}`, `Make ${snapshot.recordLabel} inactive`, "Back to contacts"]
        : ["Back to contacts", "What can you do?"];
    case "tasks-list":
      return ["Show overdue tasks", "What is due today?", "Go to inbox"];
    case "tasks-detail":
      return snapshot.recordLabel
        ? [`Summarize ${snapshot.recordLabel}`, "Mark this complete", "Back to tasks"]
        : ["Back to tasks", "What can you do?"];
    case "monitoring":
      return [
        "Who is waiting right now?",
        "Show missed contacts without callbacks",
        "Which agents are not ready?",
      ];
    default:
      return [
        "Go to queues",
        "Create queue Billing for sales team",
        "Disable thinking mode",
        "What can you do?",
      ];
  }
}

export function copilotPlaceholder(snapshot: CopilotPageSnapshot) {
  switch (snapshot.surface) {
    case "inbox":
      return "e.g. Summarize my waiting conversations";
    case "queue-create":
      return "e.g. Billing for sales team";
    case "queue-edit":
      return "e.g. Deactivate this queue";
    case "queues-list":
      return "e.g. Create queue Billing for sales team";
    case "contacts-list":
      return "e.g. Find contact by email or phone";
    case "contacts-detail":
      return "e.g. Update company or mark inactive";
    case "tasks-list":
      return "e.g. What callbacks are due today?";
    case "tasks-detail":
      return "e.g. Summarize this task and suggest next steps";
    case "monitoring":
      return "e.g. Who has been waiting longer than five minutes?";
    case "dashboard":
      return "e.g. Total calls yesterday by agent";
    case "analytics":
      return "e.g. Why did missed-contact rate change?";
    default:
      return "Ask your Worktual co-worker…";
  }
}
