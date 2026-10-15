# Use the partner SDK locally

The packages are not on npm yet. A test app installs them from this repo with a `file:` path. The names you will publish later are `@worktual/ticketing` and `@worktual/ticketing-ui`. There is no package named `@worktual/ticketing_sdk`.

| Package | Folder | What a partner imports |
|---|---|---|
| TypeScript client | `packages/ticketing-sdk` | `createTicketingClient` from `@worktual/ticketing` |
| Widgets and iframes | `packages/ticketing-ui` | `<worktual-chat>` and `mountWorktualFrame` from `@worktual/ticketing-ui` |
| Python client | `packages/ticketing-sdk-python` | `create_ticketing_client` from `worktual_ticketing` |
| C# client | `packages/ticketing-sdk-dotnet` | `TicketingClient` in namespace `Worktual.Ticketing` |

Ticket list, get, update, notes, customers, queues, and intake stay in the TypeScript package. Python and C# cover sessions, AI, proposals, login, inbox, usage, and help widgets.

## 1. Start the API

From the Ticketing-System root, with Postgres and `.env` already set the way you run the product:

```bash
npm run dev:api
```

That listens on `http://127.0.0.1:3001`.

AI turns also need the agent service:

```bash
npm run dev:agents
```

That listens on `http://127.0.0.1:8012`. Metrics and “why” answers also need `CONTEXT_LAYER_URL` and `ONTOLOGY_CHAT_URL`. If those are unset, the SDK still returns `temporarily_unavailable` and a fixed sentence. It does not invent a count.

## 2. Build the packages

The published entry is `dist/`, not `src/`. Build before any test app imports them:

```bash
npm run sdk:build
```

Run that again after you change SDK or widget source. `npm run sdk:test`, `npm run sdk:test:ui`, `npm run sdk:test:python`, and `npm run sdk:test:dotnet` check the packages without a partner app.

## 3. Two credentials

You give a partner an org API key. Their server turns that key into a short session for a real Ticketing user. The browser only ever sees the session.

| Secret | Looks like | Where it lives | What it can do |
|---|---|---|---|
| Org API key | `wt_live_…` | Partner server only | `auth.createSession`, `usage.*`, `widgets.list/create/update`, `intake.createTicket` |
| Session token | staff JWT | Browser, widget `token`, or `sessionToken` on a call | Chat, named tasks, proposals, inbox, ticket reads and updates |

Create the key while logged in as an admin: Org preferences, or `POST /api/integration/keys`. Copy the secret once. The user you pass to `createSession` must already exist in that key’s organization (`actor.email` or `actor.id`).

Do not put `wt_live_…` in HTML, a widget attribute, or a mobile app. A public help form uses `wgt_…`, which is a widget id, not a secret.

## 4. TypeScript test app

Create a folder outside this repo, for example `~/wt-sdk-try`.

```bash
mkdir ~/wt-sdk-try
cd ~/wt-sdk-try
npm init -y
npm pkg set type=module
npm install file:/Users/uxuiteam/Documents/SDK/Ticketing-System/packages/ticketing-sdk
```

Use your real path to `packages/ticketing-sdk`. `npm install @worktual/ticketing` fails until the package is published.

`try.mjs`:

```js
import { createTicketingClient } from "@worktual/ticketing";

const client = createTicketingClient({
  baseUrl: "http://127.0.0.1:3001",
  partnerApiKey: process.env.WORKTUAL_API_KEY,
  locale: "en",
});

const session = await client.auth.createSession({
  actor: { email: "jane@your-org.com" },
  locale: "en",
});

console.log("session", session.sessionId, session.expiresAt);

const turn = await client.ai.turn({
  sessionToken: session.sessionToken,
  sessionId: session.sessionId,
  message: "How many open tickets are there?",
  locale: "en",
});

console.log(turn.status, turn.reply, turn.code || "");

if (turn.status === "confirmation_required" && turn.toolProposals[0]) {
  const confirmed = await client.ai.confirm({
    sessionToken: session.sessionToken,
    sessionId: session.sessionId,
    confirmTool: {
      name: turn.toolProposals[0].name,
      args: turn.toolProposals[0].args,
    },
  });
  console.log("confirmed", confirmed.status, confirmed.reply);
}

const usage = await client.usage.summary();
console.log("turns", usage.turns, "quota", usage.quota);
```

```bash
WORKTUAL_API_KEY='wt_live_…' node try.mjs
```

`createSession` returns `sessionToken`, `sessionId`, `expiresAt`, `organizationId`, and `actor`. The token lasts 8 hours. `auth.refreshSession(session.sessionToken)` issues another. `auth.endSession(session.sessionToken)` revokes it.

A named task pins one skill. Pass the ticket the skill needs:

```js
const card = await client.ai.tasks.summarize({
  sessionToken: session.sessionToken,
  ticketNumber: "#128",
  locale: "es",
});
```

The task methods are `summarize`, `classify`, `draftReply`, `similar`, `recommendKb`, `deflect`, `createTicket`, `assign`, `resolveSuggest`, `qualityCheck`, `slaAdvise`, `workload`, `askMetrics`, `askWhy`, and `listTickets`. `askMetrics`, `askWhy`, and `listTickets` take a `message`. They do not take SQL.

`debug: true` on `ai.turn` or `ai.stream` adds `trace.agents` and `trace.routes` (`from` and `to` only).

Ticket CRUD uses the same session token:

```js
const tickets = await client.tickets.list({ scope: "org", limit: 20 });
const one = await client.tickets.get("#128");
await client.notes.add("#128", { text: "Called the customer", visibility: "internal" });
```

Intake does not use a session. It uses the org key:

```js
await client.intake.createTicket({
  channel: "api",
  requester: { name: "Riya", email: "riya@clienta.com" },
  subject: "VPN not connecting",
  description: "Unable to connect since morning",
});
```

Help widget admin uses the org key. The public submit does not:

```js
const created = await client.widgets.create({
  name: "Help",
  allowedOrigins: ["http://127.0.0.1:5500"],
});
console.log(created.widget.publicId);
console.log(created.embed.script);
console.log(created.embed.iframe);

await client.widgets.submitTicket(created.widget.publicId, {
  name: "Riya",
  email: "riya@clienta.com",
  subject: "Cannot log in",
  description: "The reset link expired.",
});
```

`widgets.getPublic(publicId)` reads the button label. Empty `allowedOrigins` allows any browser origin. Set origins before a real site uses the widget.

Failures throw `TicketingApiError` with `status`, `code`, and `message`. A missing key throws `TicketingAuthError` before any HTTP call. Locales for the fixed error sentences are `en`, `es`, `fr`, `de`, `pt`, `hi`, and `ar`.

## 5. Widget page

Build both packages (`npm run sdk:build`). The widget bundle imports `@worktual/ticketing`, so a browser page needs an import map. Serve the page over HTTP. Opening the file with `file://` will not load the modules.

`~/wt-sdk-try/demo.html`, with the paths adjusted:

Save this as `~/wt-sdk-try/public/index.html`. The import map and the module script match the static server below.

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Worktual local widget</title>
    <script type="importmap">
      {
        "imports": {
          "@worktual/ticketing": "/sdk/index.js"
        }
      }
    </script>
  </head>
  <body>
    <worktual-chat
      endpoint="http://127.0.0.1:3001"
      token="PASTE_SESSION_TOKEN"
      locale="en"
      lists>
    </worktual-chat>
    <script type="module">
      import "/sdk-ui/index.js";
      document.querySelector("worktual-chat").addEventListener("worktual-action", (event) => {
        console.log(event.detail);
      });
    </script>
  </body>
</html>
```

A small static server mounts that page and the two `dist` folders. Save it as `~/wt-sdk-try/serve.mjs`:

```js
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("public");
const sdk = "/Users/uxuiteam/Documents/SDK/Ticketing-System/packages/ticketing-sdk/dist";
const ui = "/Users/uxuiteam/Documents/SDK/Ticketing-System/packages/ticketing-ui/dist";

const types = { ".html": "text/html", ".js": "text/javascript" };

http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  const file = url.startsWith("/sdk-ui/")
    ? path.join(ui, url.slice("/sdk-ui/".length))
    : url.startsWith("/sdk/")
      ? path.join(sdk, url.slice("/sdk/".length))
      : path.join(root, url === "/" ? "index.html" : url);
  fs.readFile(file, (err, body) => {
    if (err) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "text/plain" });
    res.end(body);
  });
}).listen(5500, () => console.log("http://127.0.0.1:5500"));
```

Run `node serve.mjs` and open `http://127.0.0.1:5500`. Paste `session.sessionToken` from the Node script into the `token` attribute. Reload the page after `npm run sdk:build`.

Chat attributes:

| Attribute | Meaning |
|---|---|
| `endpoint` | API origin, `http://127.0.0.1:3001` |
| `token` | `sessionToken` from `createSession` |
| `locale` | Reply language |
| `session-id` | Optional. Same id continues the thread |
| `focused-ticket` | Ticket number, such as `#128` |
| `mode="create"` | Pins ticket create |
| `lists` | Draws ticket rows from `refresh_list` and focuses `open_ticket` |
| `theme-primary-color`, `theme-border-radius`, `theme-font` | Host brand |

Other elements use the same `endpoint`, `token`, and `locale`. Add `ticket` where the skill needs one: `worktual-summary`, `worktual-classify-card`, `worktual-reply-draft`, `worktual-similar-tickets`, `worktual-kb-suggest`, `worktual-deflection`, `worktual-assign-card`, `worktual-resolve-card`, `worktual-quality-card`, `worktual-sla-card`, `worktual-workload`, `worktual-approvals`, `worktual-insights`, `worktual-inbox`. `worktual-login` does not take the org API key. `mode="staff"` or `mode="portal"` plus `slug` for the portal.

`element.endSession()` revokes the session and fires `worktual-session-end`.

Staff and AI routes do not send a general CORS header. A page on port 5500 that calls port 3001 can be blocked by the browser. Node scripts are not affected. The public help widget does send CORS when the page origin is in `allowedOrigins`. For a chat widget on another origin, put a tiny proxy on your test server or serve the demo from the API host.

Iframe helpers, from `@worktual/ticketing-ui` or `@worktual/ticketing-ui/embed`:

```js
import { mountWorktualFrame, mountHelpFrame } from "@worktual/ticketing-ui";

mountWorktualFrame({
  container: document.querySelector("#app"),
  appUrl: "http://127.0.0.1:3001",
  token: sessionToken,
  path: "/dashboard",
});

mountHelpFrame({
  container: document.querySelector("#help"),
  appUrl: "http://127.0.0.1:3001",
  widgetId: "wgt_…",
});
```

`mountWorktualFrame` loads `embed=1` and posts `{ type: "worktual:ticketing-auth", token }`. `mountHelpFrame` loads `/embed/help.html?id=wgt_…`.

## 6. Python

Use Python 3.11 or newer. On this machine that is `python3.12`, not the system `python3`.

```bash
python3.12 -m venv ~/wt-sdk-try/.venv
source ~/wt-sdk-try/.venv/bin/activate
pip install -e /Users/uxuiteam/Documents/SDK/Ticketing-System/packages/ticketing-sdk-python
```

```python
from worktual_ticketing import create_ticketing_client

client = create_ticketing_client(
    base_url="http://127.0.0.1:3001",
    partner_api_key="wt_live_…",
    locale="en",
)

session = client.auth.create_session(actor={"email": "jane@your-org.com"}, locale="en")
turn = client.ai.turn(
    session_token=session.session_token,
    message="Summarize ticket #128",
    focused_ticket_id="#128",
)
print(turn.status, turn.reply)

usage = client.usage.summary()
print(usage.turns, usage.quota.rate_per_minute, usage.quota.concurrent)
```

`from_` is the `from` query on `usage.summary`. `debug=True` adds `trace`. Widget create is `client.widgets.create(name="Help")`. Public submit is `client.widgets.submit_ticket(public_id, {"subject": "Cannot log in", "email": "riya@clienta.com"})`.

## 7. C#

Add a project reference. This does not use NuGet.

```xml
<ItemGroup>
  <ProjectReference Include="/Users/uxuiteam/Documents/SDK/Ticketing-System/packages/ticketing-sdk-dotnet/src/Worktual.Ticketing.csproj" />
</ItemGroup>
```

```csharp
using Worktual.Ticketing;

using var client = new TicketingClient(new TicketingClientOptions
{
    BaseUrl = "http://127.0.0.1:3001",
    PartnerApiKey = "wt_live_…",
    Locale = "en",
});

var session = await client.Auth.CreateSessionAsync(new CreateSessionInput
{
    Actor = new SdkActorInput { Email = "jane@your-org.com" },
    Locale = "en",
});

var turn = await client.Ai.TurnAsync(new AiTurnInput
{
    SessionToken = session.SessionToken,
    Message = "Summarize ticket #128",
    FocusedTicketId = "#128",
});

Console.WriteLine($"{turn.Status} {turn.Reply}");
```

`Usage.SummaryAsync`, `Usage.EventsAsync`, and `Widgets.CreateAsync` match the TypeScript methods. .NET 8 is required (`dotnet --version`).

## 8. What to expect when a call fails

| `code` | Usual cause |
|---|---|
| `auth_required` | No `wt_live_…` on a partner call, or no session token on an AI call |
| `session_expired` | The 8-hour token was revoked or expired |
| `forbidden` | The user is a customer, or a viewer tried a write skill |
| `ticketing_not_purchased` | The org has no Ticketing grant |
| `missing_context` | A ticket skill was called with no ticket |
| `customer_not_found` | Create could not find that person |
| `quota_exceeded` | The org is over its turn cap |
| `temporarily_unavailable` | Agents, Context Layer, or the model did not answer |
| `unsupported_operation` | The co-worker refused the capability |

## 9. Later, when you publish

Log in to npm as an owner of the `worktual` org, then from this repo:

```bash
npm run sdk:publish
```

Partners can then run `npm install @worktual/ticketing` and `npm install @worktual/ticketing-ui`. Until that publish succeeds, keep the `file:` install in section 4.
