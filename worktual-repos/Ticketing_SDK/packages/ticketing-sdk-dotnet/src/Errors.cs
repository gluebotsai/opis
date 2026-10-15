namespace Worktual.Ticketing;

/// <summary>Missing base URL, credential, or an invalid locale. No request was sent.</summary>
public sealed class TicketingAuthError : Exception
{
    public string Code { get; } = "AUTH_CONFIG";

    public TicketingAuthError(string message) : base(message) { }
}

/// <summary>Non-2xx response, or a co-worker payload the client will not surface.</summary>
public sealed class TicketingApiError : Exception
{
    public int Status { get; }
    public object? Body { get; }
    public string? Code { get; }

    public TicketingApiError(string message, int status, object? body, string? code = null) : base(message)
    {
        Status = status;
        Body = body;
        Code = code;
    }
}
