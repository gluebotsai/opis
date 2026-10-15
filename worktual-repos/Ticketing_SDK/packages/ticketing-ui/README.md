# @worktual/ticketing-ui

`<worktual-chat>` is a white-label co-worker widget. It renders inside shadow DOM, streams `POST /api/coworker/agent-turn/stream`, and shows a confirm card when the turn needs approval.

The browser receives a session token from your backend (`auth.createSession`). It never receives the org API key.

```html
<script type="module" src="./dist/index.js"></script>

<worktual-chat
  endpoint="https://rebuild-ticketing-api.worktual.com"
  token="SESSION_JWT"
  session-id="chat_441"
  locale="es"
  focused-ticket="#128"
  theme-primary-color="#0F172A"
  theme-border-radius="8px"
  theme-font="Inter, system-ui, sans-serif"
  mode="embedded">
</worktual-chat>
```

`mode="sidebar"` stretches the shell to the host height. `powered-by="false"` hides the footer. `dir` follows the locale (`ar` is RTL). `lists` makes the chat apply `refresh_list` and `open_ticket` from the turn. Without `lists`, those hints stay on the `worktual-action` event for the host.

Listen on the host for confirmations:

```js
document.querySelector("worktual-chat").addEventListener("worktual-action", (event) => {
  console.log(event.detail.feature, event.detail.status, event.detail.proposal);
});
```

`feature` is `ai.stream`, `ai.tasks.createTicket` when `mode="create"`, `ai.confirm`, or `ai.reject`.

Named tasks are separate chips. Each one pins a Skill. The reply draft is editable, and Send posts the public note. Similar tickets and knowledge suggestions do not write.

```html
<worktual-summary
  endpoint="https://rebuild-ticketing-api.worktual.com"
  token="SESSION_JWT"
  ticket="#128"
  locale="es">
</worktual-summary>

<worktual-reply-draft endpoint="https://rebuild-ticketing-api.worktual.com" token="SESSION_JWT" ticket="#128"></worktual-reply-draft>
<worktual-classify-card endpoint="https://rebuild-ticketing-api.worktual.com" token="SESSION_JWT" ticket="#128"></worktual-classify-card>
<worktual-similar-tickets endpoint="https://rebuild-ticketing-api.worktual.com" token="SESSION_JWT" ticket="#128"></worktual-similar-tickets>
<worktual-kb-suggest endpoint="https://rebuild-ticketing-api.worktual.com" token="SESSION_JWT" ticket="#128"></worktual-kb-suggest>
<worktual-deflection endpoint="https://rebuild-ticketing-api.worktual.com" token="SESSION_JWT" locale="ar" issue="كيف أعيد تعيين VPN؟"></worktual-deflection>
<worktual-assign-card endpoint="https://rebuild-ticketing-api.worktual.com" token="SESSION_JWT" ticket="#128"></worktual-assign-card>
<worktual-resolve-card endpoint="https://rebuild-ticketing-api.worktual.com" token="SESSION_JWT" ticket="#128"></worktual-resolve-card>
<worktual-quality-card endpoint="https://rebuild-ticketing-api.worktual.com" token="SESSION_JWT" ticket="#128"></worktual-quality-card>
<worktual-sla-card endpoint="https://rebuild-ticketing-api.worktual.com" token="SESSION_JWT" ticket="#128"></worktual-sla-card>
<worktual-workload endpoint="https://rebuild-ticketing-api.worktual.com" token="SESSION_JWT"></worktual-workload>

<worktual-approvals endpoint="https://rebuild-ticketing-api.worktual.com" token="SESSION_JWT" ticket="#128" locale="es"></worktual-approvals>

<worktual-insights endpoint="https://rebuild-ticketing-api.worktual.com" token="SESSION_JWT" locale="es"></worktual-insights>

<worktual-login endpoint="https://rebuild-ticketing-api.worktual.com" mode="staff" locale="es"></worktual-login>
<worktual-login endpoint="https://rebuild-ticketing-api.worktual.com" mode="portal" slug="acme" locale="ar"></worktual-login>
<worktual-inbox endpoint="https://rebuild-ticketing-api.worktual.com" token="SESSION_JWT" locale="es"></worktual-inbox>
```

`mode="create"` on `<worktual-chat>` pins `ticket.create`. Assign, resolve, and SLA show Confirm only when the turn is `confirmation_required`. Quality does the same. Workload, similar tickets, knowledge, and deflection do not write. Login dispatches `worktual-action` with the session token. The org API key never goes in the browser. Inbox reads `GET /api/notifications` and marks an item read on click.

`<worktual-insights>` asks Metrics, Why, or Tickets. It renders metric and ticket tables from the tool payload. An unavailable answer shows the locale sentence and no figures. Login and inbox chrome is localized for `en`, `es`, `fr`, `de`, `pt`, `hi`, and `ar`.

`mountWorktualFrame({ container, appUrl, token })` iframes the Ticketing app with `embed=1` and posts `{ type: "worktual:ticketing-auth", token }`. `mountHelpFrame({ container, appUrl, widgetId })` iframes `/embed/help.html?id=wgt_…`. The public id is safe in the page. The org API key is not.
