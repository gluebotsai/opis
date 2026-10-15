namespace Worktual.Ticketing;

public sealed class TicketingClient : IDisposable
{
    private readonly HttpClient _http;
    private readonly bool _ownsHttp;

    public AuthResource Auth { get; }
    public UsageResource Usage { get; }
    public AiResource Ai { get; }
    public InboxResource Inbox { get; }
    public WidgetResource Widgets { get; }

    public TicketingClient(TicketingClientOptions options, HttpClient? http = null)
    {
        ArgumentNullException.ThrowIfNull(options);
        _ownsHttp = http == null;
        _http = http ?? new HttpClient();
        var normalized = new TicketingClientOptions
        {
            BaseUrl = PartnerHttp.NormalizeBaseUrl(options.BaseUrl),
            ApiKey = options.ApiKey,
            PartnerApiKey = options.PartnerApiKey,
            AccessToken = options.AccessToken,
            Locale = options.Locale,
            Surface = options.Surface,
            Component = options.Component,
        };
        var gateway = new PartnerHttp(_http, normalized);
        Auth = new AuthResource(gateway);
        Usage = new UsageResource(gateway);
        Ai = new AiResource(gateway);
        Inbox = new InboxResource(gateway);
        Widgets = new WidgetResource(gateway);
    }

    public void Dispose()
    {
        if (_ownsHttp) _http.Dispose();
    }
}

public sealed class AuthResource
{
    private readonly PartnerHttp _http;
    internal AuthResource(PartnerHttp http) => _http = http;

    public async Task<SdkSession> CreateSessionAsync(CreateSessionInput input, CancellationToken cancellationToken = default)
    {
        var locale = PartnerHttp.ResolveLocale(input.Locale, _http.Options.Locale);
        var actor = new Dictionary<string, object?>();
        if (!string.IsNullOrWhiteSpace(input.Actor.Id)) actor["id"] = input.Actor.Id;
        if (!string.IsNullOrWhiteSpace(input.Actor.Email)) actor["email"] = input.Actor.Email;
        var body = new Dictionary<string, object?> { ["actor"] = actor, ["locale"] = locale };
        if (!string.IsNullOrWhiteSpace(input.TenantId)) body["tenantId"] = input.TenantId;
        var payload = await _http.RequestAsync("POST", "/api/sdk/sessions", "partnerKey", body: body, cancellationToken: cancellationToken).ConfigureAwait(false);
        return ReadSession(payload);
    }

    public async Task<Dictionary<string, object?>> EndSessionAsync(string? sessionToken = null, CancellationToken cancellationToken = default)
    {
        var payload = await _http.RequestAsync("POST", "/api/sdk/sessions/end", "accessToken", accessToken: sessionToken, cancellationToken: cancellationToken).ConfigureAwait(false);
        return payload as Dictionary<string, object?> ?? new Dictionary<string, object?> { ["ok"] = true };
    }

    public async Task<SdkSession> RefreshSessionAsync(string? sessionToken = null, CancellationToken cancellationToken = default)
    {
        var payload = await _http.RequestAsync("POST", "/api/sdk/sessions/refresh", "accessToken", accessToken: sessionToken, cancellationToken: cancellationToken).ConfigureAwait(false);
        return ReadSession(payload);
    }

    public PortalAuth Portal => new(_http);

    public async Task<StaffLoginResult> LoginAsync(StaffLoginInput input, CancellationToken cancellationToken = default)
    {
        var body = new Dictionary<string, object?>
        {
            ["email"] = input.Email,
            ["password"] = input.Password,
        };
        if (input.Force == true) body["force"] = true;
        var payload = await _http.RequestAsync("POST", "/api/auth/login", "none", body: body, cancellationToken: cancellationToken).ConfigureAwait(false);
        var (token, row) = RequireToken(payload, "Staff login");
        return new StaffLoginResult
        {
            SessionToken = token,
            User = row.GetValueOrDefault("user") as Dictionary<string, object?> ?? new Dictionary<string, object?>(),
        };
    }

    internal static (string Token, Dictionary<string, object?> Row) RequireToken(object? payload, string label)
    {
        var row = payload as Dictionary<string, object?> ?? new Dictionary<string, object?>();
        var token = (row.GetValueOrDefault("token") ?? row.GetValueOrDefault("sessionToken"))?.ToString()?.Trim() ?? "";
        if (token.Length == 0)
            throw new TicketingApiError($"{label} did not return a token", 502, payload);
        return (token, row);
    }

    private static SdkSession ReadSession(object? payload)
    {
        var row = payload as Dictionary<string, object?> ?? new Dictionary<string, object?>();
        var actor = row.GetValueOrDefault("actor") as Dictionary<string, object?> ?? new Dictionary<string, object?>();
        return new SdkSession
        {
            SessionToken = row.GetValueOrDefault("sessionToken")?.ToString() ?? "",
            SessionId = row.GetValueOrDefault("sessionId")?.ToString() ?? "",
            ExpiresAt = row.GetValueOrDefault("expiresAt")?.ToString() ?? "",
            OrganizationId = row.GetValueOrDefault("organizationId")?.ToString() ?? "",
            Locale = row.GetValueOrDefault("locale")?.ToString(),
            Actor = new SdkActor
            {
                Id = actor.GetValueOrDefault("id")?.ToString() ?? "",
                Name = actor.GetValueOrDefault("name")?.ToString() ?? "",
                Email = actor.GetValueOrDefault("email")?.ToString() ?? "",
                Role = actor.GetValueOrDefault("role")?.ToString() ?? "",
            },
        };
    }
}

public sealed class PortalAuth
{
    private readonly PartnerHttp _http;
    internal PortalAuth(PartnerHttp http) => _http = http;

    public async Task<PortalOtpRequest> RequestOtpAsync(string slug, string identifier, CancellationToken cancellationToken = default)
    {
        var payload = await _http.RequestAsync(
            "POST",
            "/api/public/support/" + Uri.EscapeDataString(slug) + "/otp/request",
            "none",
            body: new Dictionary<string, object?> { ["identifier"] = identifier },
            cancellationToken: cancellationToken).ConfigureAwait(false);
        var row = payload as Dictionary<string, object?> ?? new Dictionary<string, object?>();
        return new PortalOtpRequest
        {
            Ok = row.GetValueOrDefault("ok") is not false,
            Channel = row.GetValueOrDefault("channel")?.ToString(),
            Masked = row.GetValueOrDefault("masked")?.ToString(),
        };
    }

    public async Task<PortalLoginResult> VerifyOtpAsync(string slug, string identifier, string code, CancellationToken cancellationToken = default)
    {
        var payload = await _http.RequestAsync(
            "POST",
            "/api/public/support/" + Uri.EscapeDataString(slug) + "/otp/verify",
            "none",
            body: new Dictionary<string, object?> { ["identifier"] = identifier, ["code"] = code },
            cancellationToken: cancellationToken).ConfigureAwait(false);
        var (token, row) = AuthResource.RequireToken(payload, "Portal verification");
        return new PortalLoginResult
        {
            SessionToken = token,
            Customer = row.GetValueOrDefault("customer") as Dictionary<string, object?> ?? new Dictionary<string, object?>(),
        };
    }

    public async Task<PortalLoginResult> LoginAsync(string slug, string email, string password, CancellationToken cancellationToken = default)
    {
        var payload = await _http.RequestAsync(
            "POST",
            "/api/public/support/" + Uri.EscapeDataString(slug) + "/login",
            "none",
            body: new Dictionary<string, object?> { ["email"] = email, ["password"] = password },
            cancellationToken: cancellationToken).ConfigureAwait(false);
        var (token, row) = AuthResource.RequireToken(payload, "Portal login");
        return new PortalLoginResult
        {
            SessionToken = token,
            Customer = row.GetValueOrDefault("customer") as Dictionary<string, object?> ?? new Dictionary<string, object?>(),
        };
    }
}

public sealed class UsageResource
{
    private readonly PartnerHttp _http;
    internal UsageResource(PartnerHttp http) => _http = http;

    public async Task<UsageSummary> SummaryAsync(UsageRange? range = null, CancellationToken cancellationToken = default)
    {
        range ??= new UsageRange();
        var payload = await _http.RequestAsync(
            "GET",
            "/api/sdk/usage/summary",
            "partnerKey",
            query: new Dictionary<string, string?>
            {
                ["from"] = range.From,
                ["to"] = range.To,
                ["tenantId"] = range.TenantId,
            },
            cancellationToken: cancellationToken).ConfigureAwait(false);
        return ReadSummary(payload);
    }

    public async Task<UsageLoginList> LoginsAsync(UsageRange? range = null, CancellationToken cancellationToken = default)
    {
        range ??= new UsageRange();
        var payload = await _http.RequestAsync(
            "GET",
            "/api/sdk/usage/logins",
            "partnerKey",
            query: new Dictionary<string, string?>
            {
                ["from"] = range.From,
                ["to"] = range.To,
                ["tenantId"] = range.TenantId,
            },
            cancellationToken: cancellationToken).ConfigureAwait(false);
        var row = payload as Dictionary<string, object?> ?? new Dictionary<string, object?>();
        var logins = new List<UsageLogin>();
        if (row.GetValueOrDefault("logins") is List<object?> rawLogins)
        {
            foreach (var item in rawLogins)
            {
                if (item is not Dictionary<string, object?> login) continue;
                logins.Add(new UsageLogin
                {
                    Id = login.GetValueOrDefault("id")?.ToString() ?? "",
                    ActorId = login.GetValueOrDefault("actorId")?.ToString(),
                    SessionId = login.GetValueOrDefault("sessionId")?.ToString(),
                    Locale = login.GetValueOrDefault("locale")?.ToString(),
                    CreatedAt = login.GetValueOrDefault("createdAt")?.ToString() ?? "",
                });
            }
        }
        return new UsageLoginList
        {
            OrganizationId = row.GetValueOrDefault("organizationId")?.ToString() ?? "",
            Logins = logins,
        };
    }

    private static UsageSummary ReadSummary(object? payload)
    {
        var row = payload as Dictionary<string, object?> ?? new Dictionary<string, object?>();
        var features = new List<UsageFeature>();
        if (row.GetValueOrDefault("byFeature") is List<object?> raw)
        {
            foreach (var item in raw)
            {
                if (item is Dictionary<string, object?> feature && feature.GetValueOrDefault("feature") is string name)
                {
                    var count = feature.GetValueOrDefault("count");
                    features.Add(new UsageFeature { Feature = name, Count = count is null ? 0 : Convert.ToInt32(count) });
                }
            }
        }
        var skills = new List<UsageSkill>();
        if (row.GetValueOrDefault("bySkill") is List<object?> rawSkills)
        {
            foreach (var item in rawSkills)
            {
                if (item is Dictionary<string, object?> skill && skill.GetValueOrDefault("skill") is string skillName && skillName.Trim().Length > 0)
                {
                    var count = skill.GetValueOrDefault("count");
                    skills.Add(new UsageSkill { Skill = skillName, Count = count is null ? 0 : Convert.ToInt32(count) });
                }
            }
        }
        return new UsageSummary
        {
            From = row.GetValueOrDefault("from")?.ToString() ?? "",
            To = row.GetValueOrDefault("to")?.ToString() ?? "",
            OrganizationId = row.GetValueOrDefault("organizationId")?.ToString() ?? "",
            Logins = Convert.ToInt32(row.GetValueOrDefault("logins") ?? 0),
            SessionEnds = Convert.ToInt32(row.GetValueOrDefault("sessionEnds") ?? 0),
            Turns = Convert.ToInt32(row.GetValueOrDefault("turns") ?? 0),
            Streams = Convert.ToInt32(row.GetValueOrDefault("streams") ?? 0),
            Confirms = Convert.ToInt32(row.GetValueOrDefault("confirms") ?? 0),
            Rejects = Convert.ToInt32(row.GetValueOrDefault("rejects") ?? 0),
            QuotaExceeded = Convert.ToInt32(row.GetValueOrDefault("quotaExceeded") ?? 0),
            ByFeature = features,
            BySkill = skills,
            Quota = ReadQuota(row.GetValueOrDefault("quota")),
        };
    }

    private static UsageQuota ReadQuota(object? payload)
    {
        var row = payload as Dictionary<string, object?> ?? new Dictionary<string, object?>();
        return new UsageQuota
        {
            RatePerMinute = Convert.ToInt32(row.GetValueOrDefault("ratePerMinute") ?? 0),
            Concurrent = Convert.ToInt32(row.GetValueOrDefault("concurrent") ?? 0),
        };
    }

    public async Task<UsageEventList> EventsAsync(UsageRange? range = null, CancellationToken cancellationToken = default)
    {
        range ??= new UsageRange();
        var payload = await _http.RequestAsync(
            "GET",
            "/api/sdk/usage/events",
            "partnerKey",
            query: new Dictionary<string, string?>
            {
                ["from"] = range.From,
                ["to"] = range.To,
                ["tenantId"] = range.TenantId,
                ["limit"] = range.Limit?.ToString(),
            },
            cancellationToken: cancellationToken).ConfigureAwait(false);
        var row = payload as Dictionary<string, object?> ?? new Dictionary<string, object?>();
        var organizationId = row.GetValueOrDefault("organizationId")?.ToString() ?? "";
        var events = new List<UsageEvent>();
        if (row.GetValueOrDefault("events") is List<object?> raw)
        {
            foreach (var item in raw)
            {
                if (item is Dictionary<string, object?> record) events.Add(ReadEvent(record, organizationId));
            }
        }
        return new UsageEventList { OrganizationId = organizationId, Events = events };
    }

    private static UsageEvent ReadEvent(Dictionary<string, object?> row, string organizationId)
    {
        return new UsageEvent
        {
            Id = row.GetValueOrDefault("id")?.ToString() ?? "",
            PartnerId = row.GetValueOrDefault("partnerId")?.ToString(),
            TenantId = row.GetValueOrDefault("tenantId")?.ToString() ?? organizationId,
            ActorId = row.GetValueOrDefault("actorId")?.ToString(),
            SessionId = row.GetValueOrDefault("sessionId")?.ToString(),
            Surface = row.GetValueOrDefault("surface")?.ToString() ?? "headless",
            Component = row.GetValueOrDefault("component")?.ToString(),
            Feature = row.GetValueOrDefault("feature")?.ToString() ?? "",
            Skill = row.GetValueOrDefault("skill")?.ToString(),
            Executor = row.GetValueOrDefault("executor")?.ToString(),
            Locale = row.GetValueOrDefault("locale")?.ToString(),
            AgentTurns = Convert.ToInt32(row.GetValueOrDefault("agentTurns") ?? 0),
            ConfirmRequired = row.GetValueOrDefault("confirmRequired") is true,
            Ok = row.GetValueOrDefault("ok") is not false,
            CreatedAt = row.GetValueOrDefault("createdAt")?.ToString() ?? "",
        };
    }
}

public sealed class WidgetResource
{
    private readonly PartnerHttp _http;
    internal WidgetResource(PartnerHttp http) => _http = http;

    public async Task<HelpWidgetCreated> CreateAsync(HelpWidgetCreateInput? input = null, CancellationToken cancellationToken = default)
    {
        input ??= new HelpWidgetCreateInput();
        var payload = await _http.RequestAsync(
            "POST",
            "/api/sdk/widgets",
            "partnerKey",
            body: new Dictionary<string, object?>
            {
                ["name"] = input.Name,
                ["buttonLabel"] = input.ButtonLabel,
                ["allowedOrigins"] = input.AllowedOrigins,
                ["tenantId"] = input.TenantId,
            },
            cancellationToken: cancellationToken).ConfigureAwait(false);
        return ReadCreated(payload);
    }

    public async Task<Dictionary<string, object?>> SubmitTicketAsync(
        string publicId,
        Dictionary<string, object?> body,
        CancellationToken cancellationToken = default)
    {
        var payload = await _http.RequestAsync(
            "POST",
            "/api/public/widgets/" + Uri.EscapeDataString(publicId) + "/tickets",
            "none",
            body: body,
            cancellationToken: cancellationToken).ConfigureAwait(false);
        return payload as Dictionary<string, object?> ?? new Dictionary<string, object?>();
    }

    private static HelpWidgetCreated ReadCreated(object? payload)
    {
        var row = payload as Dictionary<string, object?> ?? new Dictionary<string, object?>();
        var widget = row.GetValueOrDefault("widget") as Dictionary<string, object?> ?? new Dictionary<string, object?>();
        var embed = row.GetValueOrDefault("embed") as Dictionary<string, object?> ?? new Dictionary<string, object?>();
        var origins = new List<string>();
        if (widget.GetValueOrDefault("allowedOrigins") is List<object?> raw)
        {
            foreach (var item in raw)
            {
                var text = item?.ToString();
                if (!string.IsNullOrEmpty(text)) origins.Add(text);
            }
        }
        return new HelpWidgetCreated
        {
            Widget = new HelpWidget
            {
                Id = widget.GetValueOrDefault("id")?.ToString() ?? "",
                PublicId = widget.GetValueOrDefault("publicId")?.ToString() ?? "",
                Name = widget.GetValueOrDefault("name")?.ToString() ?? "",
                OrganizationId = widget.GetValueOrDefault("organizationId")?.ToString() ?? "",
                ButtonLabel = widget.GetValueOrDefault("buttonLabel")?.ToString() ?? "Help",
                Enabled = widget.GetValueOrDefault("enabled") is not false,
                AllowedOrigins = origins,
            },
            Embed = new HelpWidgetEmbed
            {
                Script = embed.GetValueOrDefault("script")?.ToString() ?? "",
                Iframe = embed.GetValueOrDefault("iframe")?.ToString() ?? "",
            },
        };
    }
}

public sealed class AiResource
{
    private readonly PartnerHttp _http;
    public TaskResource Tasks { get; }
    public ProposalResource Proposals { get; }

    internal AiResource(PartnerHttp http)
    {
        _http = http;
        Tasks = new TaskResource(this);
        Proposals = new ProposalResource(http);
    }

    public Task<AiTurnResult> TurnAsync(AiTurnInput input, CancellationToken cancellationToken = default) =>
        PostAsync(input, "ai.turn", cancellationToken);

    public Task<AiTurnResult> StreamAsync(
        AiTurnInput input,
        Action<Dictionary<string, object?>>? onProgress = null,
        CancellationToken cancellationToken = default) =>
        StreamTurnAsync(input, onProgress, cancellationToken);

    public Task<AiTurnResult> ConfirmAsync(AiTurnInput input, CancellationToken cancellationToken = default) =>
        PostAsync(Copy(input, string.IsNullOrWhiteSpace(input.Message) ? "confirm" : input.Message, input.ConfirmTool), "ai.confirm", cancellationToken);

    public Task<AiTurnResult> RejectAsync(AiTurnInput input, CancellationToken cancellationToken = default) =>
        PostAsync(Copy(input, string.IsNullOrWhiteSpace(input.Message) ? "Do not apply the pending action." : input.Message, null), "ai.reject", cancellationToken);

    private static AiTurnInput Copy(AiTurnInput input, string? message, ConfirmTool? confirmTool) => new()
    {
        Message = message,
        Locale = input.Locale,
        SessionToken = input.SessionToken,
        SessionId = input.SessionId,
        Module = input.Module,
        Page = input.Page,
        History = input.History,
        FocusedTicketId = input.FocusedTicketId,
        FocusedEntity = input.FocusedEntity,
        TicketDraft = input.TicketDraft,
        SessionMemory = input.SessionMemory,
        ConfirmTool = confirmTool,
        SdkTask = input.SdkTask,
        Debug = input.Debug,
    };

    internal async Task<AiTurnResult> PostAsync(AiTurnInput input, string feature, CancellationToken cancellationToken)
    {
        var (locale, body) = BuildTurn(input);
        var payload = await _http.RequestAsync(
            "POST",
            "/api/coworker/agent-turn",
            "accessToken",
            body: body,
            headers: new Dictionary<string, string> { ["X-Worktual-Sdk-Feature"] = feature },
            accessToken: input.SessionToken,
            cancellationToken: cancellationToken).ConfigureAwait(false);
        return TurnMap.ToResult(payload as Dictionary<string, object?> ?? new Dictionary<string, object?>(), locale);
    }

    private async Task<AiTurnResult> StreamTurnAsync(
        AiTurnInput input,
        Action<Dictionary<string, object?>>? onProgress,
        CancellationToken cancellationToken)
    {
        var feature = input.SdkTask == "ticket.create" ? "ai.tasks.createTicket" : "ai.stream";
        var (locale, body) = BuildTurn(input);
        var text = await _http.RequestTextAsync(
            "POST",
            "/api/coworker/agent-turn/stream",
            "accessToken",
            body: body,
            headers: new Dictionary<string, string> { ["X-Worktual-Sdk-Feature"] = feature },
            accessToken: input.SessionToken,
            cancellationToken: cancellationToken).ConfigureAwait(false);
        return TurnMap.ToResult(TurnMap.ParseSse(text, onProgress), locale);
    }

    private (string Locale, Dictionary<string, object?> Body) BuildTurn(AiTurnInput input)
    {
        var locale = PartnerHttp.ResolveLocale(input.Locale, _http.Options.Locale);
        var ticket = (input.FocusedTicketId ?? "").Trim();
        var body = new Dictionary<string, object?>();
        Put(body, "message", input.Message);
        body["locale"] = locale;
        Put(body, "session_id", input.SessionId);
        Put(body, "module", input.Module);
        Put(body, "page", input.Page);
        Put(body, "history", input.History);
        Put(body, "focused_entity", Focused(input.FocusedEntity, input.FocusedTicketId));
        if (ticket.Length > 0) body["entity_id"] = ticket;
        Put(body, "ticket_draft", input.TicketDraft);
        Put(body, "session_memory", input.SessionMemory);
        if (input.ConfirmTool != null)
        {
            var tool = new Dictionary<string, object?> { ["name"] = input.ConfirmTool.Name };
            if (input.ConfirmTool.Args != null) tool["args"] = input.ConfirmTool.Args;
            body["confirm_tool"] = tool;
        }
        Put(body, "sdk_task", input.SdkTask);
        if (input.Debug) body["debug"] = true;
        return (locale, body);
    }

    private static Dictionary<string, object?>? Focused(Dictionary<string, object?>? focused, string? ticket)
    {
        if (focused != null) return focused;
        var number = (ticket ?? "").Trim();
        if (number.Length == 0) return null;
        return new Dictionary<string, object?>
        {
            ["type"] = "ticket",
            ["id"] = number,
            ["ticketNumber"] = number,
        };
    }

    private static void Put(Dictionary<string, object?> body, string key, object? value)
    {
        if (value is not null) body[key] = value;
    }
}

public sealed class TaskResource
{
    private readonly AiResource _ai;
    internal TaskResource(AiResource ai) => _ai = ai;

    public Task<AiTaskResult> SummarizeAsync(AiTaskInput input, CancellationToken cancellationToken = default) =>
        RunAsync("ticket.summarize", input, cancellationToken);

    public Task<AiTaskResult> ClassifyAsync(AiTaskInput input, CancellationToken cancellationToken = default) =>
        RunAsync("ticket.classify", input, cancellationToken);

    public Task<AiTaskResult> DraftReplyAsync(AiTaskInput input, CancellationToken cancellationToken = default) =>
        RunAsync("ticket.draftReply", input, cancellationToken);

    public Task<AiTaskResult> SimilarAsync(AiTaskInput input, CancellationToken cancellationToken = default) =>
        RunAsync("ticket.similar", input, cancellationToken);

    public Task<AiTaskResult> RecommendKbAsync(AiTaskInput input, CancellationToken cancellationToken = default) =>
        RunAsync("ticket.kb", input, cancellationToken);

    public Task<AiTaskResult> DeflectAsync(AiTaskInput input, CancellationToken cancellationToken = default) =>
        RunAsync("intake.deflect", input, cancellationToken);

    public Task<AiTaskResult> CreateTicketAsync(AiTaskInput input, CancellationToken cancellationToken = default) =>
        RunAsync("ticket.create", input, cancellationToken);

    public Task<AiTaskResult> AssignAsync(AiTaskInput input, CancellationToken cancellationToken = default) =>
        RunAsync("ticket.assign", input, cancellationToken);

    public Task<AiTaskResult> ResolveSuggestAsync(AiTaskInput input, CancellationToken cancellationToken = default) =>
        RunAsync("ticket.resolveSuggest", input, cancellationToken);

    public Task<AiTaskResult> QualityCheckAsync(AiTaskInput input, CancellationToken cancellationToken = default) =>
        RunAsync("ticket.quality", input, cancellationToken);

    public Task<AiTaskResult> SlaAdviseAsync(AiTaskInput input, CancellationToken cancellationToken = default) =>
        RunAsync("sla.advise", input, cancellationToken);

    public Task<AiTaskResult> WorkloadAsync(AiTaskInput input, CancellationToken cancellationToken = default) =>
        RunAsync("ticket.workload", input, cancellationToken);

    public Task<AiInsightResult> AskMetricsAsync(AiTaskInput input, CancellationToken cancellationToken = default) =>
        AskAsync("analytics.ask", input, cancellationToken);

    public Task<AiInsightResult> AskWhyAsync(AiTaskInput input, CancellationToken cancellationToken = default) =>
        AskAsync("analytics.why", input, cancellationToken);

    public Task<AiInsightResult> ListTicketsAsync(AiTaskInput input, CancellationToken cancellationToken = default) =>
        AskAsync("ticket.list", input, cancellationToken);

    private async Task<AiTaskResult> RunAsync(string task, AiTaskInput input, CancellationToken cancellationToken)
    {
        var spec = TurnMap.CardTasks[task];
        var ticket = (input.TicketNumber ?? "").Trim();
        if (spec.NeedsTicket && ticket.Length == 0)
            throw new TicketingApiError("ticketNumber is required", 400, null);
        var provided = (input.Message ?? "").Trim();
        if (task == "intake.deflect" && provided.Length == 0)
            throw new TicketingApiError("message is required to deflect", 400, null);
        if (task == "ticket.create" && provided.Length == 0)
            throw new TicketingApiError("message is required to create a ticket", 400, null);
        var result = await _ai.PostAsync(new AiTurnInput
        {
            Message = provided.Length > 0 ? provided : spec.Message,
            Locale = input.Locale,
            SessionToken = input.SessionToken,
            SessionId = input.SessionId,
            FocusedTicketId = ticket.Length > 0 ? ticket : null,
            SessionMemory = input.SessionMemory,
            SdkTask = task,
        }, spec.Feature, cancellationToken).ConfigureAwait(false);
        return TurnMap.ToCard(task, result);
    }

    private async Task<AiInsightResult> AskAsync(string task, AiTaskInput input, CancellationToken cancellationToken)
    {
        var message = (input.Message ?? "").Trim();
        if (message.Length == 0)
            throw new TicketingApiError("message is required", 400, null);
        var result = await _ai.PostAsync(new AiTurnInput
        {
            Message = message,
            Locale = input.Locale,
            SessionToken = input.SessionToken,
            SessionId = input.SessionId,
            SessionMemory = input.SessionMemory,
            SdkTask = task,
        }, TurnMap.InsightTasks[task], cancellationToken).ConfigureAwait(false);
        return TurnMap.ToInsight(task, result);
    }
}

public sealed class ProposalResource
{
    private static readonly System.Text.RegularExpressions.Regex ProposalId = new(@"^(approval|recommendation):\d+$", System.Text.RegularExpressions.RegexOptions.CultureInvariant);
    private readonly PartnerHttp _http;
    internal ProposalResource(PartnerHttp http) => _http = http;

    public async Task<ProposalList> ListAsync(string? ticketNumber = null, string? status = null, string? sessionToken = null, CancellationToken cancellationToken = default)
    {
        var payload = await _http.RequestAsync(
            "GET",
            "/api/sdk/proposals",
            "accessToken",
            query: new Dictionary<string, string?>
            {
                ["ticketNumber"] = ticketNumber,
                ["status"] = status,
            },
            headers: new Dictionary<string, string> { ["X-Worktual-Sdk-Feature"] = "ai.proposals.list" },
            accessToken: sessionToken,
            cancellationToken: cancellationToken).ConfigureAwait(false);
        var items = new List<SdkProposal>();
        if (payload is Dictionary<string, object?> row && row.GetValueOrDefault("items") is List<object?> raw)
        {
            foreach (var item in raw)
            {
                if (item is Dictionary<string, object?> proposal)
                {
                    items.Add(new SdkProposal
                    {
                        Id = proposal.GetValueOrDefault("id")?.ToString() ?? "",
                        Kind = proposal.GetValueOrDefault("kind")?.ToString() ?? "",
                        Status = proposal.GetValueOrDefault("status")?.ToString() ?? "",
                        AgentId = proposal.GetValueOrDefault("agentId")?.ToString() ?? "",
                        Summary = proposal.GetValueOrDefault("summary")?.ToString() ?? "",
                        TicketNumber = proposal.GetValueOrDefault("ticketNumber")?.ToString(),
                        Draft = proposal.GetValueOrDefault("draft")?.ToString(),
                        ToolName = proposal.GetValueOrDefault("toolName")?.ToString(),
                        CreatedAt = proposal.GetValueOrDefault("createdAt")?.ToString(),
                    });
                }
            }
        }
        return new ProposalList { Items = items };
    }

    public async Task<ProposalDecision> DecideAsync(string id, string decision, ProposalEdits? edits = null, string? sessionToken = null, CancellationToken cancellationToken = default)
    {
        var proposalId = (id ?? "").Trim();
        if (!ProposalId.IsMatch(proposalId))
            throw new TicketingApiError("Proposal id must look like approval:1 or recommendation:1", 400, null);
        if (decision is not ("confirm" or "reject"))
            throw new TicketingApiError("decision must be confirm or reject", 400, null);
        var feature = decision == "confirm" ? "ai.proposals.confirm" : "ai.proposals.reject";
        Dictionary<string, object?>? editBody = null;
        if (edits != null)
        {
            editBody = new Dictionary<string, object?>();
            if (edits.Text != null) editBody["text"] = edits.Text;
            if (edits.ToolArgs != null) editBody["toolArgs"] = edits.ToolArgs;
        }
        var body = new Dictionary<string, object?> { ["decision"] = decision };
        if (editBody != null) body["edits"] = editBody;
        var payload = await _http.RequestAsync(
            "POST",
            "/api/sdk/proposals/" + Uri.EscapeDataString(proposalId) + "/decide",
            "accessToken",
            body: body,
            headers: new Dictionary<string, string> { ["X-Worktual-Sdk-Feature"] = feature },
            accessToken: sessionToken,
            cancellationToken: cancellationToken).ConfigureAwait(false);
        var row = payload as Dictionary<string, object?> ?? new Dictionary<string, object?>();
        return new ProposalDecision
        {
            Id = row.GetValueOrDefault("id")?.ToString() ?? proposalId,
            Ok = row.GetValueOrDefault("ok") is true,
            Status = row.GetValueOrDefault("status")?.ToString() ?? "",
        };
    }
}

public sealed class InboxResource
{
    private readonly PartnerHttp _http;
    internal InboxResource(PartnerHttp http) => _http = http;

    public async Task<InboxList> ListAsync(string? sessionToken = null, CancellationToken cancellationToken = default)
    {
        var payload = await _http.RequestAsync(
            "GET",
            "/api/notifications",
            "accessToken",
            accessToken: sessionToken,
            cancellationToken: cancellationToken).ConfigureAwait(false);
        var rows = payload as List<object?>;
        if (payload is Dictionary<string, object?> wrapped && wrapped.GetValueOrDefault("items") is List<object?> items)
            rows = items;
        var list = new List<InboxItem>();
        if (rows == null) return new InboxList { Items = list };
        foreach (var entry in rows)
        {
            if (entry is not Dictionary<string, object?> row) continue;
            var id = row.GetValueOrDefault("id")?.ToString()?.Trim() ?? "";
            if (id.Length == 0) continue;
            var ticket = row.GetValueOrDefault("ticketNumber") ?? row.GetValueOrDefault("ticketId") ?? row.GetValueOrDefault("ticket_number");
            var ticketText = ticket?.ToString()?.Trim();
            list.Add(new InboxItem
            {
                Id = id,
                Title = row.GetValueOrDefault("title")?.ToString() ?? "",
                Message = row.GetValueOrDefault("message")?.ToString() ?? "",
                Read = row.GetValueOrDefault("read") is true || row.GetValueOrDefault("is_read") is true,
                TicketNumber = string.IsNullOrEmpty(ticketText) ? null : ticketText,
                CreatedAt = row.GetValueOrDefault("createdAt")?.ToString(),
                Kind = row.GetValueOrDefault("kind")?.ToString(),
            });
        }
        return new InboxList { Items = list };
    }

    public async Task<Dictionary<string, object?>> MarkReadAsync(string id, string? sessionToken = null, CancellationToken cancellationToken = default)
    {
        var payload = await _http.RequestAsync(
            "PATCH",
            "/api/notifications/" + Uri.EscapeDataString(id) + "/read",
            "accessToken",
            accessToken: sessionToken,
            cancellationToken: cancellationToken).ConfigureAwait(false);
        return payload as Dictionary<string, object?> ?? new Dictionary<string, object?> { ["ok"] = true };
    }

    public async Task<Dictionary<string, object?>> MarkAllReadAsync(string? sessionToken = null, CancellationToken cancellationToken = default)
    {
        var payload = await _http.RequestAsync(
            "POST",
            "/api/notifications/read-all",
            "accessToken",
            accessToken: sessionToken,
            cancellationToken: cancellationToken).ConfigureAwait(false);
        return payload as Dictionary<string, object?> ?? new Dictionary<string, object?> { ["ok"] = true };
    }
}
