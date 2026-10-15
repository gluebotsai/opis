using System.Net;
using System.Text;
using System.Text.Json;
using Worktual.Ticketing;
using Xunit;

namespace Worktual.Ticketing.Tests;

public sealed class ClientTests
{
    [Fact]
    public async Task Session_uses_partner_key_and_locale()
    {
        var handler = new StubHandler
        {
            Respond = _ => Json("""
                {"sessionToken":"jwt","sessionId":"9","expiresAt":"2026-10-06T00:00:00.000Z","locale":"es","organizationId":"1000","actor":{"id":"2","name":"Jane","email":"jane@worktual.com","role":"admin"}}
                """, HttpStatusCode.Created),
        };
        using var client = Client(handler, partnerApiKey: "wt_live_partner", locale: "en");
        var session = await client.Auth.CreateSessionAsync(new CreateSessionInput
        {
            Actor = new SdkActorInput { Email = "jane@worktual.com" },
            Locale = "es",
        });
        Assert.Equal("jwt", session.SessionToken);
        Assert.Equal("admin", session.Actor.Role);
        var call = handler.Calls[0];
        Assert.Equal("http://127.0.0.1:3001/api/sdk/sessions", call.Url);
        Assert.Equal("wt_live_partner", call.Headers["X-Api-Key"]);
        Assert.Equal("""{"actor":{"email":"jane@worktual.com"},"locale":"es"}""", call.Body);
    }

    [Fact]
    public async Task Turn_confirm_and_reject()
    {
        var handler = new StubHandler
        {
            Respond = _ => Json("""
                {"assistantText":"Listo","agent":"ticket_lifecycle_executor","toolProposals":[{"name":"escalate_ticket","args":{"ticket":"#1"},"risk":"high","auto":false}]}
                """),
        };
        using var client = Client(handler, accessToken: "session.jwt", locale: "es");
        var turn = await client.Ai.TurnAsync(new AiTurnInput
        {
            SessionToken = "session.jwt",
            Message = "Escala este ticket",
            FocusedTicketId = "#1",
        });
        Assert.Equal("confirmation_required", turn.Status);
        Assert.Equal("es", turn.Locale);
        Assert.Equal("Bearer session.jwt", handler.Calls[0].Headers["Authorization"]);
        Assert.Equal("ai.turn", handler.Calls[0].Headers["X-Worktual-Sdk-Feature"]);
        using (var sent = JsonDocument.Parse(handler.Calls[0].Body!))
        {
            Assert.Equal("Escala este ticket", sent.RootElement.GetProperty("message").GetString());
            Assert.Equal("es", sent.RootElement.GetProperty("locale").GetString());
            Assert.Equal("#1", sent.RootElement.GetProperty("entity_id").GetString());
            Assert.Equal("#1", sent.RootElement.GetProperty("focused_entity").GetProperty("ticketNumber").GetString());
            Assert.False(sent.RootElement.TryGetProperty("sql", out _));
        }

        handler.Respond = _ => Json("""
            {"assistantText":"Hecho","agent":"general","toolProposals":[{"name":"update_ticket","auto":true,"risk":"low"}]}
            """);
        var confirmed = await client.Ai.ConfirmAsync(new AiTurnInput
        {
            ConfirmTool = new ConfirmTool
            {
                Name = "update_ticket",
                Args = new Dictionary<string, object?> { ["status"] = "Resolved" },
            },
        });
        Assert.Equal("applied", confirmed.Status);
        Assert.Equal("ai.confirm", handler.Calls[1].Headers["X-Worktual-Sdk-Feature"]);
        using (var sent = JsonDocument.Parse(handler.Calls[1].Body!))
            Assert.Equal("confirm", sent.RootElement.GetProperty("message").GetString());

        await client.Ai.RejectAsync(new AiTurnInput { Message = "No", SessionToken = "session.jwt" });
        using var rejected = JsonDocument.Parse(handler.Calls[2].Body!);
        Assert.Equal("No", rejected.RootElement.GetProperty("message").GetString());
        Assert.False(rejected.RootElement.TryGetProperty("confirm_tool", out _));
        Assert.Equal("ai.reject", handler.Calls[2].Headers["X-Worktual-Sdk-Feature"]);
    }

    [Fact]
    public async Task Help_widget_create_uses_the_key_and_public_submit_does_not()
    {
        var handler = new StubHandler
        {
            Respond = request => request.Url.Contains("/api/sdk/widgets")
                ? Json("""{"widget":{"id":"4","publicId":"wgt_abc","name":"Help"},"embed":{"script":"<script data-widget-id=\"wgt_abc\"></script>","iframe":"help.html?id=wgt_abc"}}""", HttpStatusCode.Created)
                : Json("""{"ticketId":"9","ticketNumber":"TKT-9","status":"Open","channel":"Web","subject":"Cannot log in","createdAt":"2026-10-06T00:00:00.000Z","updatedAt":"2026-10-06T00:00:00.000Z"}"""),
        };
        using var client = Client(handler, apiKey: "wt_live_partner");
        var created = await client.Widgets.CreateAsync(new HelpWidgetCreateInput
        {
            Name = "Help",
            AllowedOrigins = new[] { "https://partner.example" },
        });
        Assert.Equal("wgt_abc", created.Widget.PublicId);
        Assert.Contains("wgt_abc", created.Embed.Iframe);
        Assert.Equal("wt_live_partner", handler.Calls[0].Headers["X-Api-Key"]);

        var filed = await client.Widgets.SubmitTicketAsync("wgt_abc", new Dictionary<string, object?>
        {
            ["subject"] = "Cannot log in",
            ["email"] = "riya@clienta.com",
        });
        Assert.Equal("TKT-9", filed["ticketNumber"]?.ToString());
        Assert.False(handler.Calls[1].Headers.ContainsKey("X-Api-Key"));
        Assert.Contains("/api/public/widgets/wgt_abc/tickets", handler.Calls[1].Url);
    }

    [Fact]
    public async Task Debug_trace_and_usage_events()
    {
        var handler = new StubHandler
        {
            Respond = _ => Json("""
                {"assistantText":"Listo","agent":"ticket_lifecycle_executor","trace":{"agents":["ticketing_coworker","ticket_lifecycle_executor"],"routes":[{"from":"ticketing_coworker","to":"ticket_lifecycle_executor","query":"secret"}]}}
                """),
        };
        using var client = Client(handler, accessToken: "session.jwt");
        var turn = await client.Ai.TurnAsync(new AiTurnInput { Message = "Hola", Debug = true });
        using (var sent = JsonDocument.Parse(handler.Calls[0].Body!))
            Assert.True(sent.RootElement.GetProperty("debug").GetBoolean());
        Assert.NotNull(turn.Trace);
        Assert.Equal("ticket_lifecycle_executor", turn.Trace!.Routes[0].To);
        Assert.DoesNotContain("secret", JsonSerializer.Serialize(turn.Trace));

        handler.Respond = _ => Json("""
            {"organizationId":"1000","events":[{"id":"9","partnerId":"42","tenantId":"1000","feature":"ai.turn","agentTurns":1,"confirmRequired":true,"ok":true}]}
            """);
        using var partner = Client(handler, apiKey: "wt_live_partner");
        var listed = await partner.Usage.EventsAsync(new UsageRange { Limit = 20 });
        Assert.Equal("42", listed.Events[0].PartnerId);
        Assert.Equal(1, listed.Events[0].AgentTurns);
        Assert.True(listed.Events[0].ConfirmRequired);
        Assert.Contains("/api/sdk/usage/events", handler.Calls[1].Url);
    }

    [Fact]
    public async Task Usage_summary_uses_the_partner_key()
    {
        var handler = new StubHandler
        {
            Respond = _ => Json("""
                {"from":"2026-09-01T00:00:00.000Z","to":"2026-10-01T00:00:00.000Z","organizationId":"1000","logins":1,"sessionEnds":0,"turns":2,"streams":0,"confirms":1,"rejects":0,"byFeature":[{"feature":"ai.turn","count":2}],"bySkill":[{"skill":"analytics-query","count":2}]}
                """),
        };
        using var client = Client(handler, apiKey: "wt_live_partner");
        var summary = await client.Usage.SummaryAsync(new UsageRange { From = "2026-09-01T00:00:00.000Z" });
        Assert.Equal(2, summary.Turns);
        Assert.Equal("ai.turn", summary.ByFeature[0].Feature);
        Assert.Equal("analytics-query", summary.BySkill[0].Skill);
        Assert.Equal(2, summary.BySkill[0].Count);
        Assert.Contains("from=2026-09-01", handler.Calls[0].Url);
        Assert.Equal("wt_live_partner", handler.Calls[0].Headers["X-Api-Key"]);
    }

    [Fact]
    public async Task Named_tasks_and_deflect()
    {
        var handler = new StubHandler
        {
            Respond = _ => Json("""
                {"assistantText":"VPN outage, waiting on the customer.","agent":"investigation_summary_executor","toolProposals":[{"name":"update_ticket","auto":true,"risk":"low"}]}
                """),
        };
        using var client = Client(handler, accessToken: "session.jwt", locale: "es");
        var missing = await Assert.ThrowsAsync<TicketingApiError>(() => client.Ai.Tasks.SummarizeAsync(new AiTaskInput()));
        Assert.Equal(400, missing.Status);
        Assert.Empty(handler.Calls);

        var card = await client.Ai.Tasks.SummarizeAsync(new AiTaskInput { TicketNumber = "#128" });
        Assert.Equal("ticket.summarize", card.Task);
        Assert.Equal("applied", card.Status);
        Assert.Equal("http://127.0.0.1:3001/api/coworker/agent-turn", handler.Calls[0].Url);
        Assert.Equal("ai.tasks.summarize", handler.Calls[0].Headers["X-Worktual-Sdk-Feature"]);
        using (var sent = JsonDocument.Parse(handler.Calls[0].Body!))
        {
            Assert.Equal("ticket.summarize", sent.RootElement.GetProperty("sdk_task").GetString());
            Assert.Equal("Summarize this ticket.", sent.RootElement.GetProperty("message").GetString());
            Assert.Equal("#128", sent.RootElement.GetProperty("entity_id").GetString());
        }

        handler.Respond = _ => Json("""
            {"assistantText":"Hola, ya revisamos la VPN.","agent":"customer_reply_drafting_executor","data":{"tickets":[{"ticketNumber":"#90","subject":"VPN"}]},"toolProposals":[{"name":"add_ticket_note","auto":false,"risk":"high","args":{"ticket_number":"#128"}}]}
            """);
        var draft = await client.Ai.Tasks.DraftReplyAsync(new AiTaskInput { TicketNumber = "#128" });
        Assert.Equal("confirmation_required", draft.Status);
        Assert.Equal("Hola, ya revisamos la VPN.", draft.Draft);
        Assert.Equal("add_ticket_note", draft.Proposal?.Name);
        var similar = await client.Ai.Tasks.SimilarAsync(new AiTaskInput { TicketNumber = "#128" });
        Assert.Equal("recommendation", similar.Status);
        Assert.Equal("#90", similar.Tickets[0].TicketNumber);
        Assert.Equal("ai.tasks.similar", handler.Calls[2].Headers["X-Worktual-Sdk-Feature"]);

        await Assert.ThrowsAsync<TicketingApiError>(() => client.Ai.Tasks.DeflectAsync(new AiTaskInput()));
        handler.Respond = _ => Json("""
            {"assistantText":"Reset the VPN from Settings.","agent":"dssa","data":{"dssa_deflected":true,"articles":[{"title":"Reset VPN"}]}}
            """);
        var deflected = await client.Ai.Tasks.DeflectAsync(new AiTaskInput { Message = "How do I reset VPN?" });
        Assert.Equal("deflected", deflected.Status);
        Assert.True(deflected.Deflected);
        Assert.Equal("Reset VPN", deflected.Articles[0].Title);
    }

    [Fact]
    public async Task Proposals()
    {
        var handler = new StubHandler
        {
            Respond = call => call.Url.Contains("/decide")
                ? Json("""{"id":"approval:12","ok":true,"status":"applied"}""")
                : Json("""
                    {"items":[{"id":"approval:12","kind":"approval","status":"confirmation_required","agentId":"crda","ticketNumber":"#128","summary":"Send this reply","draft":"Hola"}]}
                    """),
        };
        using var client = Client(handler, accessToken: "session.jwt");
        var listed = await client.Ai.Proposals.ListAsync("#128", "open");
        Assert.Equal("approval:12", listed.Items[0].Id);
        Assert.Contains("ticketNumber=%23128", handler.Calls[0].Url);
        Assert.Equal("ai.proposals.list", handler.Calls[0].Headers["X-Worktual-Sdk-Feature"]);
        var decided = await client.Ai.Proposals.DecideAsync("approval:12", "confirm", new ProposalEdits { Text = "Hola, listo" });
        Assert.Equal("applied", decided.Status);
        using (var sent = JsonDocument.Parse(handler.Calls[1].Body!))
        {
            Assert.Equal("confirm", sent.RootElement.GetProperty("decision").GetString());
            Assert.Equal("Hola, listo", sent.RootElement.GetProperty("edits").GetProperty("text").GetString());
        }
        Assert.Contains("/api/sdk/proposals/approval%3A12/decide", handler.Calls[1].Url);
        Assert.Equal("ai.proposals.confirm", handler.Calls[1].Headers["X-Worktual-Sdk-Feature"]);

        var bare = new StubHandler { Respond = handler.Respond };
        using var other = Client(bare, accessToken: "session.jwt");
        var bad = await Assert.ThrowsAsync<TicketingApiError>(() => other.Ai.Proposals.DecideAsync("12", "reject"));
        Assert.Equal(400, bad.Status);
        Assert.Empty(bare.Calls);
    }

    [Fact]
    public async Task Metrics_copy_the_tool_payload_and_drop_invented_numbers()
    {
        var handler = new StubHandler
        {
            Respond = _ => Json("""
                {"assistantText":"There are 12 open tickets.","agent":"analytics_audit_query_executor","sessionMemoryPatch":{"lastToolOutcome":{"success":true,"payload":{"metrics":[{"id":"open_tickets","label":"Open","value":12}]}}}}
                """),
        };
        using var client = Client(handler, accessToken: "session.jwt");
        var card = await client.Ai.Tasks.AskMetricsAsync(new AiTaskInput { Message = "How many open tickets?" });
        Assert.Equal("answered", card.Status);
        Assert.Equal("open_tickets", card.Metrics[0].Id);
        Assert.Equal("Open", card.Metrics[0].Label);
        Assert.Equal(12, Convert.ToInt32(card.Metrics[0].Value, System.Globalization.CultureInfo.InvariantCulture));
        using (var sent = JsonDocument.Parse(handler.Calls[0].Body!))
        {
            Assert.Equal("analytics.ask", sent.RootElement.GetProperty("sdk_task").GetString());
            Assert.Equal("How many open tickets?", sent.RootElement.GetProperty("message").GetString());
            Assert.False(sent.RootElement.TryGetProperty("sql", out _));
        }
        Assert.Equal("ai.tasks.askMetrics", handler.Calls[0].Headers["X-Worktual-Sdk-Feature"]);

        var empty = await Assert.ThrowsAsync<TicketingApiError>(() => client.Ai.Tasks.AskWhyAsync(new AiTaskInput { Message = "" }));
        Assert.Equal(400, empty.Status);

        handler.Respond = _ => Json("""{"assistantText":"SLA fell because of 40 breaches.","data":{"code":"temporarily_unavailable"}}""");
        var why = await client.Ai.Tasks.AskWhyAsync(new AiTaskInput { Message = "Why did SLA drop?" });
        Assert.Equal("temporarily_unavailable", why.Status);
        Assert.Equal("This answer is temporarily unavailable.", why.Reply);
        Assert.Equal("temporarily_unavailable", why.Code);
        Assert.Empty(why.Metrics);
        Assert.Null(why.Why);
        Assert.DoesNotContain("40", why.Reply);
    }

    [Fact]
    public async Task Missing_credentials_and_locale_do_not_call()
    {
        var handler = new StubHandler { Respond = _ => Json("{}") };
        using var client = Client(handler);
        await Assert.ThrowsAsync<TicketingAuthError>(() => client.Auth.CreateSessionAsync(new CreateSessionInput
        {
            Actor = new SdkActorInput { Email = "jane@worktual.com" },
        }));
        await Assert.ThrowsAsync<TicketingAuthError>(() => client.Ai.TurnAsync(new AiTurnInput { Message = "Hola" }));
        await Assert.ThrowsAsync<TicketingAuthError>(() => client.Ai.TurnAsync(new AiTurnInput
        {
            Message = "Hola",
            SessionToken = "jwt",
            Locale = "not a locale",
        }));
        Assert.Throws<TicketingAuthError>(() => Client(handler, baseUrl: "  "));
        Assert.Empty(handler.Calls);
    }

    [Fact]
    public async Task Stream_login_inbox_and_workload()
    {
        var handler = new StubHandler
        {
            Respond = call =>
            {
                if (call.Url.EndsWith("/api/auth/login"))
                {
                    Assert.False(call.Headers.ContainsKey("Authorization"));
                    Assert.False(call.Headers.ContainsKey("X-Api-Key"));
                    return Json("""{"token":"staff.jwt","user":{"email":"jane@worktual.com"}}""");
                }
                if (call.Url.EndsWith("/api/notifications"))
                    return Json("""[{"id":"n1","title":"Assigned","message":"You own #128","ticketId":"#128","read":false}]""");
                if (call.Url.Contains("/stream"))
                    return Json("event: progress\ndata: {\"step\":\"intake\"}\n\nevent: result\ndata: {\"assistantText\":\"Ready to file\",\"agent\":\"ticket_creation_executor\",\"toolProposals\":[]}\n\n", HttpStatusCode.OK);
                return Json("""{"assistantText":"Move two tickets off Alex.","agent":"workload_optimization_executor","toolProposals":[{"name":"assign_ticket","auto":false,"risk":"high"}]}""");
            },
        };
        using var client = Client(handler, accessToken: "session.jwt");
        var steps = new List<string>();
        var streamed = await client.Ai.StreamAsync(
            new AiTurnInput { Message = "VPN is down", SdkTask = "ticket.create" },
            progress => steps.Add(progress["step"]?.ToString() ?? ""));
        Assert.Equal(new[] { "intake" }, steps);
        Assert.Equal("Ready to file", streamed.Reply);
        Assert.Equal("ai.tasks.createTicket", handler.Calls[0].Headers["X-Worktual-Sdk-Feature"]);

        await Assert.ThrowsAsync<TicketingApiError>(() => client.Ai.Tasks.CreateTicketAsync(new AiTaskInput()));
        var load = await client.Ai.Tasks.WorkloadAsync(new AiTaskInput());
        Assert.Equal("recommendation", load.Status);

        var staff = await client.Auth.LoginAsync(new StaffLoginInput { Email = "jane@worktual.com", Password = "secret" });
        Assert.Equal("staff.jwt", staff.SessionToken);
        var inbox = await client.Inbox.ListAsync();
        Assert.Equal("#128", inbox.Items[0].TicketNumber);
        Assert.False(inbox.Items[0].Read);
    }

    [Fact]
    public async Task Logins_report_marks_a_widget_surface()
    {
        var handler = new StubHandler
        {
            Respond = _ => Json("""{"organizationId":"1000","logins":[{"id":"1","actorId":"2","sessionId":"9","locale":"es","createdAt":"2026-10-01T00:00:00.000Z"}]}"""),
        };
        using var client = new TicketingClient(new TicketingClientOptions
        {
            BaseUrl = "http://127.0.0.1:3001",
            PartnerApiKey = "wt_live_partner",
            Surface = "ui",
            Component = "worktual-chat",
        }, new HttpClient(handler));
        var listed = await client.Usage.LoginsAsync(new UsageRange { From = "2026-10-01T00:00:00.000Z" });
        Assert.Equal("1000", listed.OrganizationId);
        Assert.Equal("2", listed.Logins[0].ActorId);
        Assert.Equal("es", listed.Logins[0].Locale);
        Assert.Contains("/api/sdk/usage/logins", handler.Calls[0].Url);
        Assert.Equal("ui", handler.Calls[0].Headers["X-Worktual-Sdk-Surface"]);
        Assert.Equal("worktual-chat", handler.Calls[0].Headers["X-Worktual-Sdk-Component"]);
    }

    [Fact]
    public async Task Refusal_and_missing_customer_use_the_locale_sentence()
    {
        var handler = new StubHandler
        {
            Respond = _ => Json("""{"assistantText":"Payroll is outside Ticketing.","data":{"refusal":{"code":"unsupported_product","message":"Payroll is outside Ticketing."}}}"""),
        };
        using var client = Client(handler, accessToken: "session.jwt");
        var refused = await client.Ai.TurnAsync(new AiTurnInput { Message = "Refund payroll", Locale = "es", SessionToken = "session.jwt" });
        Assert.Equal("unsupported_operation", refused.Code);
        Assert.Equal("Esta solicitud no está admitida.", refused.Reply);
        Assert.DoesNotContain("Payroll", refused.Reply);

        handler.Respond = _ => Json("""{"assistantText":"I could not find that person.","data":{"ticket_draft":{"customer_not_found":true}}}""");
        var missing = await client.Ai.TurnAsync(new AiTurnInput { Message = "Open a ticket for Ada", Locale = "de", SessionToken = "session.jwt" });
        Assert.Equal("customer_not_found", missing.Code);
        Assert.Equal("Es wurde kein passender Kunde gefunden.", missing.Reply);
    }

    private static TicketingClient Client(
        StubHandler handler,
        string? apiKey = null,
        string? partnerApiKey = null,
        string? accessToken = null,
        string? locale = null,
        string baseUrl = "http://127.0.0.1:3001/")
    {
        return new TicketingClient(new TicketingClientOptions
        {
            BaseUrl = baseUrl,
            ApiKey = apiKey,
            PartnerApiKey = partnerApiKey,
            AccessToken = accessToken,
            Locale = locale,
        }, new HttpClient(handler));
    }

    private static HttpResponseMessage Json(string json, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
}

public sealed class CapturedRequest
{
    public string Url { get; init; } = "";
    public Dictionary<string, string> Headers { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public string? Body { get; init; }
}

public sealed class StubHandler : HttpMessageHandler
{
    public List<CapturedRequest> Calls { get; } = new();
    public Func<CapturedRequest, HttpResponseMessage> Respond { get; set; } = _ => new HttpResponseMessage(HttpStatusCode.OK);

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content == null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var header in request.Headers)
            headers[header.Key] = string.Join(",", header.Value);
        if (request.Content != null)
        {
            foreach (var header in request.Content.Headers)
                headers[header.Key] = string.Join(",", header.Value);
        }
        var captured = new CapturedRequest
        {
            Url = request.RequestUri!.ToString(),
            Headers = headers,
            Body = body,
        };
        Calls.Add(captured);
        return Respond(captured);
    }
}
