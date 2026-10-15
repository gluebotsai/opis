namespace Worktual.Ticketing;

public sealed class TicketingClientOptions
{
    public string BaseUrl { get; init; } = "";
    public string? ApiKey { get; init; }
    public string? PartnerApiKey { get; init; }
    public string? AccessToken { get; init; }
    public string? Locale { get; init; }
    public string? Surface { get; init; }
    public string? Component { get; init; }
}

public sealed class SdkActorInput
{
    public string? Id { get; init; }
    public string? Email { get; init; }
}

public sealed class CreateSessionInput
{
    public SdkActorInput Actor { get; init; } = new();
    public string? TenantId { get; init; }
    public string? Locale { get; init; }
}

public sealed class SdkActor
{
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public string Email { get; init; } = "";
    public string Role { get; init; } = "";
}

public sealed class SdkSession
{
    public string SessionToken { get; init; } = "";
    public string SessionId { get; init; } = "";
    public string ExpiresAt { get; init; } = "";
    public string OrganizationId { get; init; } = "";
    public SdkActor Actor { get; init; } = new();
    public string? Locale { get; init; }
}

public sealed class UsageRange
{
    public string? From { get; init; }
    public string? To { get; init; }
    public string? TenantId { get; init; }
    public int? Limit { get; init; }
}

public sealed class UsageLogin
{
    public string Id { get; init; } = "";
    public string? ActorId { get; init; }
    public string? SessionId { get; init; }
    public string? Locale { get; init; }
    public string CreatedAt { get; init; } = "";
}

public sealed class UsageLoginList
{
    public string OrganizationId { get; init; } = "";
    public IReadOnlyList<UsageLogin> Logins { get; init; } = Array.Empty<UsageLogin>();
}

public sealed class UsageFeature
{
    public string Feature { get; init; } = "";
    public int Count { get; init; }
}

public sealed class UsageSkill
{
    public string Skill { get; init; } = "";
    public int Count { get; init; }
}

public sealed class UsageSummary
{
    public string From { get; init; } = "";
    public string To { get; init; } = "";
    public string OrganizationId { get; init; } = "";
    public int Logins { get; init; }
    public int SessionEnds { get; init; }
    public int Turns { get; init; }
    public int Streams { get; init; }
    public int Confirms { get; init; }
    public int Rejects { get; init; }
    public int QuotaExceeded { get; init; }
    public IReadOnlyList<UsageFeature> ByFeature { get; init; } = Array.Empty<UsageFeature>();
    public IReadOnlyList<UsageSkill> BySkill { get; init; } = Array.Empty<UsageSkill>();
    public UsageQuota Quota { get; init; } = new();
}

public sealed class UsageQuota
{
    public int RatePerMinute { get; init; }
    public int Concurrent { get; init; }
}

public sealed class UsageEvent
{
    public string Id { get; init; } = "";
    public string? PartnerId { get; init; }
    public string TenantId { get; init; } = "";
    public string? ActorId { get; init; }
    public string? SessionId { get; init; }
    public string Surface { get; init; } = "headless";
    public string? Component { get; init; }
    public string Feature { get; init; } = "";
    public string? Skill { get; init; }
    public string? Executor { get; init; }
    public string? Locale { get; init; }
    public int AgentTurns { get; init; }
    public bool ConfirmRequired { get; init; }
    public bool Ok { get; init; } = true;
    public string CreatedAt { get; init; } = "";
}

public sealed class UsageEventList
{
    public string OrganizationId { get; init; } = "";
    public IReadOnlyList<UsageEvent> Events { get; init; } = Array.Empty<UsageEvent>();
}

public sealed class RoutingHop
{
    public string From { get; init; } = "";
    public string To { get; init; } = "";
}

public sealed class RoutingTrace
{
    public IReadOnlyList<string> Agents { get; init; } = Array.Empty<string>();
    public IReadOnlyList<RoutingHop> Routes { get; init; } = Array.Empty<RoutingHop>();
}

public sealed class ConfirmTool
{
    public string Name { get; init; } = "";
    public Dictionary<string, object?>? Args { get; init; }
}

public sealed class AiTurnInput
{
    public string? Message { get; init; }
    public string? Locale { get; init; }
    public string? SessionToken { get; init; }
    public string? SessionId { get; init; }
    public string? Module { get; init; }
    public string? Page { get; init; }
    public List<Dictionary<string, string>>? History { get; init; }
    public string? FocusedTicketId { get; init; }
    public Dictionary<string, object?>? FocusedEntity { get; init; }
    public Dictionary<string, object?>? TicketDraft { get; init; }
    public Dictionary<string, object?>? SessionMemory { get; init; }
    public ConfirmTool? ConfirmTool { get; init; }
    public string? SdkTask { get; init; }
    public bool Debug { get; init; }
}

public sealed class AiTaskInput
{
    public string? TicketNumber { get; init; }
    public string? Message { get; init; }
    public string? Locale { get; init; }
    public string? SessionToken { get; init; }
    public string? SessionId { get; init; }
    public Dictionary<string, object?>? SessionMemory { get; init; }
}

public sealed class AiToolProposal
{
    public string Name { get; init; } = "";
    public Dictionary<string, object?>? Args { get; init; }
    public string? Risk { get; init; }
    public bool? Auto { get; init; }
}

public sealed class AiTurnResult
{
    public string Reply { get; init; } = "";
    public string Status { get; init; } = "";
    public string Agent { get; init; } = "";
    public IReadOnlyList<Dictionary<string, object?>> UiActions { get; init; } = Array.Empty<Dictionary<string, object?>>();
    public IReadOnlyList<AiToolProposal> ToolProposals { get; init; } = Array.Empty<AiToolProposal>();
    public string? Locale { get; init; }
    public string? SessionId { get; init; }
    public string? RequestId { get; init; }
    public Dictionary<string, object?>? Data { get; init; }
    public string? Code { get; init; }
    public RoutingTrace? Trace { get; init; }
}

public sealed class AiTaskArticle
{
    public string Title { get; init; } = "";
    public string? Id { get; init; }
    public string? Url { get; init; }
}

public sealed class AiTaskTicket
{
    public string TicketNumber { get; init; } = "";
    public string? Subject { get; init; }
}

public sealed class AiTaskResult
{
    public string Reply { get; init; } = "";
    public string Status { get; init; } = "";
    public string Agent { get; init; } = "";
    public string Task { get; init; } = "";
    public IReadOnlyList<Dictionary<string, object?>> UiActions { get; init; } = Array.Empty<Dictionary<string, object?>>();
    public IReadOnlyList<AiToolProposal> ToolProposals { get; init; } = Array.Empty<AiToolProposal>();
    public IReadOnlyList<AiTaskArticle> Articles { get; init; } = Array.Empty<AiTaskArticle>();
    public IReadOnlyList<AiTaskTicket> Tickets { get; init; } = Array.Empty<AiTaskTicket>();
    public AiToolProposal? Proposal { get; init; }
    public bool Deflected { get; init; }
    public string? Locale { get; init; }
    public string? SessionId { get; init; }
    public string? RequestId { get; init; }
    public Dictionary<string, object?>? Data { get; init; }
    public string? Draft { get; init; }
    public string? Code { get; init; }
}

public sealed class AiMetricValue
{
    public object? Value { get; init; }
    public string? Id { get; init; }
    public string? Label { get; init; }
}

public sealed class AiInsightResult
{
    public string Reply { get; init; } = "";
    public string Status { get; init; } = "";
    public string Agent { get; init; } = "";
    public string Task { get; init; } = "";
    public IReadOnlyList<AiMetricValue> Metrics { get; init; } = Array.Empty<AiMetricValue>();
    public IReadOnlyList<Dictionary<string, object?>> Rows { get; init; } = Array.Empty<Dictionary<string, object?>>();
    public IReadOnlyList<Dictionary<string, object?>> UiActions { get; init; } = Array.Empty<Dictionary<string, object?>>();
    public IReadOnlyList<AiToolProposal> ToolProposals { get; init; } = Array.Empty<AiToolProposal>();
    public string? Locale { get; init; }
    public string? SessionId { get; init; }
    public string? RequestId { get; init; }
    public Dictionary<string, object?>? Data { get; init; }
    public string? Code { get; init; }
    public string? Why { get; init; }
}

public sealed class SdkProposal
{
    public string Id { get; init; } = "";
    public string Kind { get; init; } = "";
    public string Status { get; init; } = "";
    public string AgentId { get; init; } = "";
    public string Summary { get; init; } = "";
    public string? TicketNumber { get; init; }
    public string? Draft { get; init; }
    public string? ToolName { get; init; }
    public string? CreatedAt { get; init; }
}

public sealed class ProposalList
{
    public IReadOnlyList<SdkProposal> Items { get; init; } = Array.Empty<SdkProposal>();
}

public sealed class ProposalEdits
{
    public string? Text { get; init; }
    public Dictionary<string, object?>? ToolArgs { get; init; }
}

public sealed class ProposalDecision
{
    public string Id { get; init; } = "";
    public bool Ok { get; init; }
    public string Status { get; init; } = "";
}

public sealed class StaffLoginInput
{
    public string Email { get; init; } = "";
    public string Password { get; init; } = "";
    public bool? Force { get; init; }
}

public sealed class StaffLoginResult
{
    public string SessionToken { get; init; } = "";
    public Dictionary<string, object?> User { get; init; } = new();
}

public sealed class PortalOtpRequest
{
    public bool Ok { get; init; }
    public string? Channel { get; init; }
    public string? Masked { get; init; }
}

public sealed class PortalLoginResult
{
    public string SessionToken { get; init; } = "";
    public Dictionary<string, object?> Customer { get; init; } = new();
}

public sealed class InboxItem
{
    public string Id { get; init; } = "";
    public string Title { get; init; } = "";
    public string Message { get; init; } = "";
    public bool Read { get; init; }
    public string? TicketNumber { get; init; }
    public string? CreatedAt { get; init; }
    public string? Kind { get; init; }
}

public sealed class InboxList
{
    public IReadOnlyList<InboxItem> Items { get; init; } = Array.Empty<InboxItem>();
}

public sealed class HelpWidget
{
    public string Id { get; init; } = "";
    public string PublicId { get; init; } = "";
    public string Name { get; init; } = "";
    public string OrganizationId { get; init; } = "";
    public string ButtonLabel { get; init; } = "Help";
    public bool Enabled { get; init; } = true;
    public IReadOnlyList<string> AllowedOrigins { get; init; } = Array.Empty<string>();
}

public sealed class HelpWidgetEmbed
{
    public string Script { get; init; } = "";
    public string Iframe { get; init; } = "";
}

public sealed class HelpWidgetCreated
{
    public HelpWidget Widget { get; init; } = new();
    public HelpWidgetEmbed Embed { get; init; } = new();
}

public sealed class HelpWidgetCreateInput
{
    public string? Name { get; init; }
    public string? ButtonLabel { get; init; }
    public IReadOnlyList<string>? AllowedOrigins { get; init; }
    public string? TenantId { get; init; }
}
