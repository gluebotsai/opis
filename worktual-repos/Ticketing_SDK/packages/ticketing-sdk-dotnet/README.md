# Worktual.Ticketing

Headless C# client for a partner server. It calls the same Express routes as `@worktual/ticketing`. Widgets stay in `@worktual/ticketing-ui`.

The org API key (`wt_live_…`) stays on the server. Browser code receives only the session token from `Auth.CreateSessionAsync`.

```csharp
using var client = new TicketingClient(new TicketingClientOptions
{
    BaseUrl = "https://rebuild-ticketing-api.worktual.com",
    PartnerApiKey = "wt_live_…",
    Locale = "es",
});

var session = await client.Auth.CreateSessionAsync(new CreateSessionInput
{
    Actor = new SdkActorInput { Email = "jane@partner.com" },
    Locale = "es",
});

var turn = await client.Ai.TurnAsync(new AiTurnInput
{
    SessionToken = session.SessionToken,
    Message = "Clasifica el ticket",
    FocusedTicketId = "#128",
    Locale = "es",
});
if (turn.Status == "confirmation_required")
{
    await client.Ai.ConfirmAsync(new AiTurnInput
    {
        SessionToken = session.SessionToken,
        ConfirmTool = new ConfirmTool { Name = turn.ToolProposals[0].Name, Args = turn.ToolProposals[0].Args },
    });
}

var card = await client.Ai.Tasks.SummarizeAsync(new AiTaskInput
{
    SessionToken = session.SessionToken,
    TicketNumber = "#128",
});
var created = await client.Ai.StreamAsync(new AiTurnInput
{
    SessionToken = session.SessionToken,
    Message = "VPN is down",
    SdkTask = "ticket.create",
});
var staff = await client.Auth.LoginAsync(new StaffLoginInput { Email = "jane@partner.com", Password = "secret" });
var inbox = await client.Inbox.ListAsync(staff.SessionToken);
var metrics = await client.Ai.Tasks.AskMetricsAsync(new AiTaskInput
{
    SessionToken = session.SessionToken,
    Message = "How many open tickets?",
});
var listed = await client.Ai.Proposals.ListAsync("#128", sessionToken: session.SessionToken);
var usage = await client.Usage.SummaryAsync(new UsageRange { From = "2026-10-01T00:00:00.000Z" });
```

`StreamAsync` reads the same SSE stream as the TypeScript client. `SdkTask = "ticket.create"` is billed as `ai.tasks.createTicket`. `LoginAsync` and `Portal` do not send the org API key.

`UsageRange.From` is the `from` query parameter. `Summary.BySkill` is the billing breakdown by Skill. `Summary.Quota` is the active cap. `Usage.EventsAsync` returns `PartnerId`, `AgentTurns`, and `ConfirmRequired`. `Debug = true` on `TurnAsync` adds `Trace`. `AskMetricsAsync`, `AskWhyAsync`, and `ListTicketsAsync` take a question and do not accept SQL. Counts and rows are copied from the tool payload. When Context Layer or the knowledge graph URL is unset, `Status` is `temporarily_unavailable` and `Reply` is the unavailable sentence.

`TicketingAuthError` means the call never left the process. `TicketingApiError` carries `Status`, `Body`, and `Code`. A refused turn sets `Code` and replaces `Reply` with the sentence for the turn locale.
