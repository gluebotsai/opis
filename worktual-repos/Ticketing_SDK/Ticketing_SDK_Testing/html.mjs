import { PRIORITIES, STATUSES } from "./db.mjs";
import { recommendOrigin, recommendUrl } from "./worktual.mjs";

const STATUS_LABEL = {
  open: "Open",
  in_progress: "In progress",
  waiting: "Waiting",
  resolved: "Resolved",
};

const PRIORITY_LABEL = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

const NOTICES = {
  created: "Ticket created.",
  status: "Status updated.",
  note: "Note added.",
};

export function loginPage({ csrf, email = "", error = "" }) {
  return layout({
    title: "Sign in",
    csrf,
    body: `
      <main class="auth">
        <section class="auth-card">
          <p class="brand">Acme Support</p>
          <h1>Staff desk</h1>
          <p class="lede">Sign in with this desk. A successful sign-in also opens a Worktual session.</p>
          ${error ? `<p class="banner error" role="alert">${esc(error)}</p>` : ""}
          <form method="post" action="/login" class="stack">
            ${hiddenCsrf(csrf)}
            <label>
              Email
              <input name="email" type="email" autocomplete="username" required value="${esc(email)}">
            </label>
            <label>
              Password
              <input name="password" type="password" autocomplete="current-password" required>
            </label>
            <button type="submit">Sign in</button>
          </form>
          <aside class="demo">
            <p>Demo staff</p>
            <p><code>maya@acme.test</code></p>
            <p><code>desk-pass</code></p>
          </aside>
        </section>
      </main>
    `,
  });
}

export function listPage({ user, csrf, tickets, total, status, q, notice }) {
  const filters = ["", ...STATUSES]
    .map((value) => {
      const params = new URLSearchParams();
      if (value) params.set("status", value);
      if (q) params.set("q", q);
      const href = params.size ? `/?${params.toString()}` : "/";
      const label = value ? STATUS_LABEL[value] : "All";
      const current = (status || "") === value;
      return `<a class="${current ? "chip current" : "chip"}" href="${esc(href)}">${esc(label)}</a>`;
    })
    .join("");

  const rows = tickets.length
    ? tickets.map((ticket) => `
        <tr>
          <td><a href="/tickets/${esc(ticket.number)}">${esc(ticket.number)}</a></td>
          <td><a href="/tickets/${esc(ticket.number)}">${esc(ticket.subject)}</a></td>
          <td>
            <span class="who">${esc(ticket.requester_name)}</span>
            <span class="muted">${esc(ticket.requester_email)}</span>
          </td>
          <td>${priorityPill(ticket.priority)}</td>
          <td>${statusPill(ticket.status)}</td>
          <td class="muted">${esc(formatWhen(ticket.updated_at))}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="6" class="empty">No tickets match this view.</td></tr>`;

  return layout({
    title: "Tickets",
    user,
    csrf,
    notice,
    body: `
      <main class="page">
        <header class="page-head">
          <div>
            <h1>Tickets</h1>
            <p class="muted">${esc(String(tickets.length))} shown · ${esc(String(total))} in the desk</p>
          </div>
          <a class="button" href="/tickets/new">New ticket</a>
        </header>
        <form class="filters" method="get" action="/">
          ${status ? `<input type="hidden" name="status" value="${esc(status)}">` : ""}
          <div class="chips" role="navigation" aria-label="Status">${filters}</div>
          <label class="search">
            <span class="sr">Search tickets</span>
            <input name="q" type="search" placeholder="Search number, subject, or requester" value="${esc(q)}">
          </label>
          <button type="submit">Search</button>
        </form>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Number</th>
                <th scope="col">Subject</th>
                <th scope="col">Requester</th>
                <th scope="col">Priority</th>
                <th scope="col">Status</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </main>
    `,
  });
}

export function newTicketPage({ user, csrf, values, errors }) {
  const field = (name) => values[name] || "";
  return layout({
    title: "New ticket",
    user,
    csrf,
    body: `
      <main class="page narrow">
        <a class="back" href="/">← Tickets</a>
        <h1>New ticket</h1>
        <form method="post" action="/tickets" class="stack card">
          ${hiddenCsrf(csrf)}
          ${fieldBlock("Subject", "subject", errors.subject, `<input name="subject" required maxlength="160" value="${esc(field("subject"))}">`)}
          ${fieldBlock("Description", "description", errors.description, `<textarea name="description" required maxlength="8000" rows="7">${esc(field("description"))}</textarea>`)}
          <div class="split">
            ${fieldBlock("Requester name", "requesterName", errors.requesterName, `<input name="requesterName" required maxlength="120" value="${esc(field("requesterName"))}">`)}
            ${fieldBlock("Requester email", "requesterEmail", errors.requesterEmail, `<input name="requesterEmail" type="email" required maxlength="180" value="${esc(field("requesterEmail"))}">`)}
          </div>
          ${fieldBlock("Priority", "priority", errors.priority, `<select name="priority">${PRIORITIES.map((item) => option(item, PRIORITY_LABEL[item], field("priority") || "normal")).join("")}</select>`)}
          <div class="actions">
            <button type="submit">Create ticket</button>
            <a class="button quiet" href="/">Cancel</a>
          </div>
        </form>
      </main>
    `,
  });
}

export function ticketPage({ user, csrf, ticket, notes, suggestion = null, notice, noteError = "" }) {
  const noteItems = notes.length
    ? notes.map((note) => `
        <article class="note">
          <header>
            <strong>${esc(note.author_name)}</strong>
            <time datetime="${esc(note.created_at)}">${esc(formatWhen(note.created_at))}</time>
          </header>
          <p>${esc(note.body)}</p>
        </article>
      `).join("")
    : `<p class="empty-copy">No internal notes yet.</p>`;

  return layout({
    title: ticket.number,
    user,
    csrf,
    notice,
    body: `
      <main class="page">
        <a class="back" href="/">← Tickets</a>
        <header class="ticket-head">
          <div>
            <p class="kicker">${esc(ticket.number)}</p>
            <h1>${esc(ticket.subject)}</h1>
          </div>
          <div class="pills">
            ${statusPill(ticket.status)}
            ${priorityPill(ticket.priority)}
          </div>
        </header>
        <div class="detail">
          <section class="card">
            <h2>Request</h2>
            <p class="prose">${esc(ticket.description)}</p>
            <dl class="meta">
              <div><dt>Opened</dt><dd>${esc(formatWhen(ticket.created_at))}</dd></div>
              <div><dt>Updated</dt><dd>${esc(formatWhen(ticket.updated_at))}</dd></div>
            </dl>
          </section>
          <aside class="card">
            <h2>Requester</h2>
            <p class="who">${esc(ticket.requester_name)}</p>
            <p class="muted">${esc(ticket.requester_email)}</p>
            <form method="post" action="/tickets/${esc(ticket.number)}/status" class="stack tight">
              ${hiddenCsrf(csrf)}
              <label>
                Status
                <select name="status">
                  ${STATUSES.map((item) => option(item, STATUS_LABEL[item], ticket.status)).join("")}
                </select>
              </label>
              <button type="submit">Update status</button>
            </form>
          </aside>
        </div>
        <div class="beside">
          ${suggestionCard(suggestion)}
          <section class="card notes">
          <h2>Internal notes</h2>
          <div class="note-list">${noteItems}</div>
          <form method="post" action="/tickets/${esc(ticket.number)}/notes" class="stack">
            ${hiddenCsrf(csrf)}
            <label>
              Add a note
              <textarea name="body" maxlength="4000" rows="4" required placeholder="Only staff can see this."></textarea>
            </label>
            ${noteError ? `<p class="field-error" role="alert">${esc(noteError)}</p>` : ""}
            <div class="actions">
              <button type="submit">Add note</button>
            </div>
          </form>
        </section>
        </div>
        ${deskAssist({ user, csrf, ticket, notice, suggestion })}
      </main>
    `,
  });
}

export function messagePage({ title, user, csrf, text }) {
  return layout({
    title,
    user,
    csrf,
    body: `
      <main class="auth">
        <section class="auth-card">
          <p class="brand">Acme Support</p>
          <h1>${esc(title)}</h1>
          <p class="lede">${esc(text)}</p>
          <a class="button" href="/">Back to tickets</a>
        </section>
      </main>
    `,
  });
}

function layout({ title, user, csrf, body, notice }) {
  const header = user
    ? `
      <header class="top">
        <a class="brand-link" href="/">Acme Support</a>
        <nav>
          <a href="/">Tickets</a>
          <a href="/tickets/new">New ticket</a>
        </nav>
        <div class="session">
          <span class="worktual">${esc(worktualStatus(user))}</span>
          <span class="who">${esc(user.name)}</span>
          <form method="post" action="/logout">
            ${hiddenCsrf(csrf)}
            <button class="linkish" type="submit">Sign out</button>
          </form>
        </div>
      </header>
    `
    : "";
  const flash = notice && NOTICES[notice]
    ? `<p class="banner ok" role="status">${esc(NOTICES[notice])}</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · Acme Support</title>
  <link rel="stylesheet" href="/desk.css?v=4">
</head>
<body>
  ${header}
  ${flash}
  ${body}
  ${chatLauncher(user)}
</body>
</html>`;
}

function fieldBlock(label, name, error, control) {
  return `
    <label>
      ${esc(label)}
      ${control}
      ${error ? `<span class="field-error" role="alert">${esc(error)}</span>` : ""}
    </label>
  `;
}

function option(value, label, current) {
  const selected = value === current ? " selected" : "";
  return `<option value="${esc(value)}"${selected}>${esc(label)}</option>`;
}

function statusPill(status) {
  return `<span class="pill status-${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>`;
}

function priorityPill(priority) {
  return `<span class="pill priority-${esc(priority)}">${esc(PRIORITY_LABEL[priority] || priority)}</span>`;
}

function suggestionCard(suggestion) {
  const hidden = suggestion ? "" : " hidden";
  return `
    <section class="card suggestion" data-suggestion-slot${hidden}>
      <h2>Suggestion</h2>
      <p class="suggestion-guidance" data-suggestion-guidance${suggestion?.guidance ? "" : " hidden"}>${esc(suggestion?.guidance || "")}</p>
      <p class="suggestion-reply" data-suggestion-reply>${esc(suggestion?.reply || "")}</p>
    </section>
  `;
}

function deskAssist({ user, csrf, ticket, notice, suggestion }) {
  if (!user || notice === "note" || suggestion) return "";
  const issue = [
    `Subject: ${ticket.subject}`,
    `Requester: ${ticket.requester_name} <${ticket.requester_email}>`,
    ticket.description,
  ].filter(Boolean).join("\n\n");
  return `
    <worktual-desk-assist
      recommend-url="${esc(recommendUrl())}"
      ticket="${esc(ticket.number)}"
      save-url="/tickets/${esc(ticket.number)}/notes"
      keep-url="/tickets/${esc(ticket.number)}/suggestion"
      csrf="${esc(csrf)}"
      locale="en"
      theme-primary-color="#0f6e56"
      theme-font="Segoe UI, system-ui, sans-serif"
      issue="${esc(issue)}"></worktual-desk-assist>
    <script type="module" src="/sdk-ui-v2/index.js"></script>
  `;
}

function chatLauncher(user) {
  if (!user) return "";
  return `
    <worktual-chat-launcher endpoint="${esc(recommendOrigin())}" token="${esc(user.worktual_token || "desk")}" locale="en" theme-primary-color="#0f6e56" theme-font="Segoe UI, system-ui, sans-serif"></worktual-chat-launcher>
    <script type="importmap">
      { "imports": { "@worktual/ticketing": "/ticketing-browser.js" } }
    </script>
    <script type="module" src="/sdk-ui/index.js"></script>
  `;
}

function worktualStatus(user) {
  if (user.worktual_session_id) {
    return `Worktual ${user.worktual_actor_email || "session"} · ${user.worktual_session_id}`;
  }
  if (user.worktual_error) return user.worktual_error;
  return "Worktual not signed in";
}

function hiddenCsrf(csrf) {
  return `<input type="hidden" name="csrf" value="${esc(csrf)}">`;
}

function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
