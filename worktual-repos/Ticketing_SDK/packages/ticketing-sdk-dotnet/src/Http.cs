using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Worktual.Ticketing;

internal static class JsonValues
{
    public static readonly JsonSerializerOptions Options = new()
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    public static object? FromJson(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                var record = new Dictionary<string, object?>();
                foreach (var property in element.EnumerateObject())
                    record[property.Name] = FromJson(property.Value);
                return record;
            case JsonValueKind.Array:
                var list = new List<object?>();
                foreach (var item in element.EnumerateArray())
                    list.Add(FromJson(item));
                return list;
            case JsonValueKind.String:
                return element.GetString();
            case JsonValueKind.Number:
                return element.TryGetInt64(out var whole) ? whole : element.GetDouble();
            case JsonValueKind.True:
                return true;
            case JsonValueKind.False:
                return false;
            default:
                return null;
        }
    }

    public static object? Parse(string text)
    {
        if (string.IsNullOrEmpty(text)) return null;
        try
        {
            using var document = JsonDocument.Parse(text);
            return FromJson(document.RootElement);
        }
        catch (JsonException)
        {
            return text;
        }
    }
}

internal sealed class PartnerHttp
{
    private static readonly Regex LocaleRe = new(@"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$", RegexOptions.CultureInvariant);

    private readonly HttpClient _http;
    public TicketingClientOptions Options { get; }

    public PartnerHttp(HttpClient http, TicketingClientOptions options)
    {
        _http = http;
        Options = options;
    }

    public static string NormalizeBaseUrl(string baseUrl)
    {
        var trimmed = (baseUrl ?? "").Trim().TrimEnd('/');
        if (trimmed.Length == 0)
            throw new TicketingAuthError("baseUrl is required");
        return trimmed;
    }

    public static string ResolveLocale(string? explicitLocale, string? fallback)
    {
        var raw = (explicitLocale ?? fallback ?? "en").Trim();
        if (raw.Length == 0) raw = "en";
        if (!LocaleRe.IsMatch(raw))
            throw new TicketingAuthError("locale must be a BCP 47 tag such as en or es-MX");
        return raw;
    }

    public string PartnerKey() => (Options.PartnerApiKey ?? Options.ApiKey ?? "").Trim();

    public async Task<object?> RequestAsync(
        string method,
        string path,
        string auth,
        IReadOnlyDictionary<string, string?>? query = null,
        Dictionary<string, object?>? body = null,
        IReadOnlyDictionary<string, string>? headers = null,
        string? accessToken = null,
        CancellationToken cancellationToken = default)
    {
        var (status, text) = await SendRaw(method, path, auth, query, body, headers, accessToken, cancellationToken).ConfigureAwait(false);
        ThrowIfFailed(status, text);
        if (status == 204) return null;
        return JsonValues.Parse(text);
    }

    public async Task<string> RequestTextAsync(
        string method,
        string path,
        string auth,
        IReadOnlyDictionary<string, string?>? query = null,
        Dictionary<string, object?>? body = null,
        IReadOnlyDictionary<string, string>? headers = null,
        string? accessToken = null,
        CancellationToken cancellationToken = default)
    {
        var (status, text) = await SendRaw(method, path, auth, query, body, headers, accessToken, cancellationToken).ConfigureAwait(false);
        ThrowIfFailed(status, text);
        return text;
    }

    private async Task<(int Status, string Text)> SendRaw(
        string method,
        string path,
        string auth,
        IReadOnlyDictionary<string, string?>? query,
        Dictionary<string, object?>? body,
        IReadOnlyDictionary<string, string>? headers,
        string? accessToken,
        CancellationToken cancellationToken)
    {
        var url = Options.BaseUrl + path + Query(query);
        using var request = new HttpRequestMessage(new HttpMethod(method), url);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        foreach (var header in AuthHeaders(auth, accessToken))
            request.Headers.TryAddWithoutValidation(header.Key, header.Value);
        foreach (var header in MeteringHeaders())
            request.Headers.TryAddWithoutValidation(header.Key, header.Value);
        if (headers != null)
        {
            foreach (var header in headers)
                request.Headers.TryAddWithoutValidation(header.Key, header.Value);
        }
        if (body != null)
            request.Content = new StringContent(JsonSerializer.Serialize(body, JsonValues.Options), Encoding.UTF8, "application/json");

        using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var text = response.Content == null ? "" : await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        return ((int)response.StatusCode, text);
    }

    private static void ThrowIfFailed(int status, string text)
    {
        if (status >= 200 && status < 300) return;
        var parsed = JsonValues.Parse(text);
        string? code = null;
        if (parsed is Dictionary<string, object?> record && record.TryGetValue("code", out var raw) && raw is string textCode)
            code = textCode;
        throw new TicketingApiError(MessageFromBody(parsed, status), status, parsed, code);
    }

    private Dictionary<string, string> AuthHeaders(string mode, string? accessToken)
    {
        if (mode == "none") return new Dictionary<string, string>();
        if (mode is "apiKey" or "partnerKey")
        {
            var key = mode == "partnerKey" ? PartnerKey() : (Options.ApiKey ?? "").Trim();
            if (key.Length == 0)
            {
                throw new TicketingAuthError(
                    mode == "partnerKey"
                        ? "partnerApiKey or apiKey is required (org key wt_live_…). Do not use this key in a browser."
                        : "apiKey is required for this call (org key wt_live_…). Do not use this key in a browser."
                );
            }
            return new Dictionary<string, string> { ["X-Api-Key"] = key };
        }
        var token = (accessToken ?? Options.AccessToken ?? "").Trim();
        if (token.Length == 0)
        {
            throw new TicketingAuthError(
                "accessToken is required for this call (staff or CRM JWT as Authorization Bearer)."
            );
        }
        return new Dictionary<string, string> { ["Authorization"] = "Bearer " + token };
    }

    private static readonly Regex ComponentRe = new("^[a-z0-9-]{1,64}$", RegexOptions.CultureInvariant);

    private Dictionary<string, string> MeteringHeaders()
    {
        if (Options.Surface != "ui") return new Dictionary<string, string>();
        var headers = new Dictionary<string, string> { ["X-Worktual-Sdk-Surface"] = "ui" };
        var component = (Options.Component ?? "").Trim().ToLowerInvariant();
        if (ComponentRe.IsMatch(component)) headers["X-Worktual-Sdk-Component"] = component;
        return headers;
    }

    private static string Query(IReadOnlyDictionary<string, string?>? query)
    {
        if (query == null || query.Count == 0) return "";
        var parts = new List<string>();
        foreach (var pair in query)
        {
            if (string.IsNullOrEmpty(pair.Value)) continue;
            parts.Add(Uri.EscapeDataString(pair.Key) + "=" + Uri.EscapeDataString(pair.Value).Replace("%20", "+"));
        }
        return parts.Count == 0 ? "" : "?" + string.Join("&", parts);
    }

    private static string MessageFromBody(object? body, int status)
    {
        if (body is Dictionary<string, object?> record)
        {
            if (record.TryGetValue("error", out var error) && error is string errorText && errorText.Trim().Length > 0)
                return errorText;
            if (record.TryGetValue("message", out var message) && message is string messageText && messageText.Trim().Length > 0)
                return messageText;
        }
        if (body is string text && text.Trim().Length > 0) return text;
        return $"Ticketing API request failed ({status})";
    }
}
