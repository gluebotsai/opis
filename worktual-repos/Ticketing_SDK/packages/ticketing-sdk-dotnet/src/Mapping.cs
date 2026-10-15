using System.Text.RegularExpressions;

namespace Worktual.Ticketing;

internal static class TurnMap
{
    public const string Unavailable = "This answer is temporarily unavailable.";
    private static readonly Regex ConfigUrl = new("CONTEXT_LAYER_URL|ONTOLOGY_CHAT_URL", RegexOptions.CultureInvariant);

    public static readonly IReadOnlyDictionary<string, (string Feature, bool NeedsTicket, string Message)> CardTasks =
        new Dictionary<string, (string, bool, string)>
        {
            ["ticket.summarize"] = ("ai.tasks.summarize", true, "Summarize this ticket."),
            ["ticket.classify"] = ("ai.tasks.classify", true, "Classify and prioritize this ticket."),
            ["ticket.draftReply"] = ("ai.tasks.draftReply", true, "Draft a customer reply for this ticket. Do not send it."),
            ["ticket.similar"] = ("ai.tasks.similar", true, "Find similar tickets. Recommend only. Do not merge or update."),
            ["ticket.kb"] = ("ai.tasks.recommendKb", true, "Recommend published knowledge articles for this ticket. Do not change the ticket."),
            ["intake.deflect"] = ("ai.tasks.deflect", false, ""),
            ["ticket.create"] = ("ai.tasks.createTicket", false, ""),
            ["ticket.assign"] = ("ai.tasks.assign", true, "Choose the best assignee for this ticket. Confirm if it already has an owner."),
            ["ticket.resolveSuggest"] = ("ai.tasks.resolveSuggest", true, "Suggest resolve or reopen for this ticket. Do not change status until confirmed."),
            ["ticket.quality"] = ("ai.tasks.qualityCheck", true, "Review resolution quality for this ticket."),
            ["sla.advise"] = ("ai.tasks.slaAdvise", true, "Explain SLA risk for this ticket. Escalate only with confirmation."),
            ["ticket.workload"] = ("ai.tasks.workload", false, "Review open workload and recommend a balance. Do not reassign."),
        };

    public static readonly IReadOnlyDictionary<string, string> InsightTasks = new Dictionary<string, string>
    {
        ["analytics.ask"] = "ai.tasks.askMetrics",
        ["analytics.why"] = "ai.tasks.askWhy",
        ["ticket.list"] = "ai.tasks.listTickets",
    };

    public static Dictionary<string, object?>? AsRecord(object? value) => value as Dictionary<string, object?>;

    public static AiTurnResult ToResult(Dictionary<string, object?> payload, string locale)
    {
        var proposals = ProposalsFrom(payload.GetValueOrDefault("toolProposals"));
        var uiActions = new List<Dictionary<string, object?>>();
        if (payload.GetValueOrDefault("ui_actions") is List<object?> rawUi)
        {
            foreach (var item in rawUi)
            {
                if (item is Dictionary<string, object?> row) uiActions.Add(row);
            }
        }
        var patch = AsRecord(payload.GetValueOrDefault("sessionMemoryPatch")) ?? new Dictionary<string, object?>();
        var last = AsRecord(patch.GetValueOrDefault("lastToolOutcome")) ?? AsRecord(patch.GetValueOrDefault("last_tool_outcome"));
        var data = AsRecord(payload.GetValueOrDefault("data"));
        Dictionary<string, object?>? merged = data;
        if (last != null)
        {
            merged = new Dictionary<string, object?>(data ?? new Dictionary<string, object?>())
            {
                ["lastToolOutcome"] = last,
            };
        }
        var code = TurnCode(payload, merged, patch);
        var catalog = code == null ? null : SdkErrorText.Message(code, locale);
        var reply = catalog ?? ReplyOf(payload);
        if (reply.Length == 0)
        {
            var detail = payload.TryGetValue("detail", out var detailValue) ? detailValue as string : null;
            var error = payload.TryGetValue("error", out var errorValue) ? errorValue as string : null;
            throw new TicketingApiError(detail ?? error ?? "Empty co-worker reply", 502, payload);
        }
        return new AiTurnResult
        {
            Reply = reply,
            Status = TurnStatus(proposals),
            Agent = payload.GetValueOrDefault("agent") as string ?? "general",
            UiActions = uiActions,
            ToolProposals = proposals,
            Locale = locale,
            SessionId = payload.GetValueOrDefault("session_id")?.ToString(),
            RequestId = payload.GetValueOrDefault("request_id")?.ToString(),
            Data = merged,
            Code = code,
            Trace = ReadTrace(payload),
        };
    }

    public static RoutingTrace? ReadTrace(Dictionary<string, object?> payload)
    {
        var data = AsRecord(payload.GetValueOrDefault("data"));
        return NormalizeTrace(AsRecord(payload.GetValueOrDefault("trace")))
            ?? (data == null ? null : NormalizeTrace(AsRecord(data.GetValueOrDefault("trace"))));
    }

    private static RoutingTrace? NormalizeTrace(Dictionary<string, object?>? raw)
    {
        if (raw == null) return null;
        var agents = new List<string>();
        if (raw.GetValueOrDefault("agents") is List<object?> rawAgents)
        {
            foreach (var item in rawAgents)
            {
                var name = item?.ToString()?.Trim();
                if (!string.IsNullOrEmpty(name)) agents.Add(name);
            }
        }
        var routes = new List<RoutingHop>();
        if (raw.GetValueOrDefault("routes") is List<object?> rawRoutes)
        {
            foreach (var item in rawRoutes)
            {
                if (item is not Dictionary<string, object?> row) continue;
                var to = row.GetValueOrDefault("to")?.ToString()?.Trim() ?? "";
                if (to.Length == 0) continue;
                routes.Add(new RoutingHop { From = row.GetValueOrDefault("from")?.ToString()?.Trim() ?? "", To = to });
            }
        }
        if (agents.Count == 0 && routes.Count == 0) return null;
        return new RoutingTrace { Agents = agents, Routes = routes };
    }

    private static string? TurnCode(
        Dictionary<string, object?> payload,
        Dictionary<string, object?>? data,
        Dictionary<string, object?> patch)
    {
        var refusal = data == null ? null : AsRecord(data.GetValueOrDefault("refusal"));
        return SdkErrorText.StableCode(payload.GetValueOrDefault("code"))
            ?? SdkErrorText.StableCode(data?.GetValueOrDefault("code"))
            ?? SdkErrorText.StableCode(refusal?.GetValueOrDefault("code"))
            ?? (CustomerMissing(data) || CustomerMissing(patch) ? "customer_not_found" : null);
    }

    private static bool CustomerMissing(object? value, int depth = 0)
    {
        if (depth > 5 || value == null) return false;
        if (value is List<object?> list) return list.Exists(item => CustomerMissing(item, depth + 1));
        if (value is not Dictionary<string, object?> row) return false;
        if (row.GetValueOrDefault("customer_not_found") is true || row.GetValueOrDefault("customerNotFound") is true) return true;
        foreach (var key in new[] { "ticket_draft", "ticketDraft", "draft", "collected", "durable", "lastToolOutcome", "last_tool_outcome" })
        {
            if (row.ContainsKey(key) && CustomerMissing(row[key], depth + 1)) return true;
        }
        return false;
    }

    public static AiTaskResult ToCard(string task, AiTurnResult result)
    {
        var deflected = task == "intake.deflect" && Deflected(result);
        return new AiTaskResult
        {
            Reply = result.Reply,
            Status = TaskStatus(task, result),
            Agent = result.Agent,
            Task = task,
            UiActions = result.UiActions,
            ToolProposals = result.ToolProposals,
            Articles = Articles(result.Data),
            Tickets = Tickets(result.Data),
            Proposal = Gated(result.ToolProposals),
            Deflected = deflected,
            Locale = result.Locale,
            SessionId = result.SessionId,
            RequestId = result.RequestId,
            Data = result.Data,
            Draft = task == "ticket.draftReply" ? result.Reply : null,
            Code = result.Code,
        };
    }

    public static AiInsightResult ToInsight(string task, AiTurnResult result)
    {
        if (IsUnavailable(result))
        {
            return new AiInsightResult
            {
                Reply = string.IsNullOrWhiteSpace(result.Reply) ? Unavailable : result.Reply,
                Status = "temporarily_unavailable",
                Agent = result.Agent,
                Task = task,
                Code = "temporarily_unavailable",
                Locale = result.Locale,
                SessionId = result.SessionId,
                RequestId = result.RequestId,
                Data = result.Data,
                UiActions = result.UiActions,
                ToolProposals = result.ToolProposals,
            };
        }
        var (metrics, rows, why) = InsightParts(result);
        return new AiInsightResult
        {
            Reply = result.Reply,
            Status = "answered",
            Agent = result.Agent,
            Task = task,
            Metrics = metrics,
            Rows = rows,
            Why = why,
            Locale = result.Locale,
            SessionId = result.SessionId,
            RequestId = result.RequestId,
            Data = result.Data,
            UiActions = result.UiActions,
            ToolProposals = result.ToolProposals,
        };
    }

    private static string ReplyOf(Dictionary<string, object?> payload)
    {
        foreach (var key in new[] { "assistantText", "reply" })
        {
            if (payload.TryGetValue(key, out var value) && value is string text && text.Trim().Length > 0)
                return text.Trim();
        }
        return "";
    }

    private static List<AiToolProposal> ProposalsFrom(object? raw)
    {
        var outList = new List<AiToolProposal>();
        if (raw is not List<object?> items) return outList;
        foreach (var item in items)
        {
            if (item is not Dictionary<string, object?> row) continue;
            var name = (row.GetValueOrDefault("name") as string ?? "").Trim();
            if (name.Length == 0) continue;
            outList.Add(new AiToolProposal
            {
                Name = name,
                Args = AsRecord(row.GetValueOrDefault("args")),
                Risk = row.GetValueOrDefault("risk") as string,
                Auto = row.GetValueOrDefault("auto") is bool auto ? auto : null,
            });
        }
        return outList;
    }

    private static string TurnStatus(IReadOnlyList<AiToolProposal> proposals)
    {
        if (proposals.Any(proposal => proposal.Auto == false || proposal.Risk == "high"))
            return "confirmation_required";
        if (proposals.Any(proposal => proposal.Auto == true))
            return "applied";
        return "answered";
    }

    private static string TaskStatus(string task, AiTurnResult result)
    {
        if (task is "ticket.similar" or "ticket.kb" or "ticket.workload") return "recommendation";
        if (task == "ticket.quality")
        {
            if (result.Status is "confirmation_required" or "applied") return result.Status;
            return "recommendation";
        }
        if (task == "intake.deflect")
        {
            if (result.Status == "confirmation_required") return "confirmation_required";
            return Deflected(result) ? "deflected" : "answered";
        }
        return result.Status;
    }

    private static bool Deflected(AiTurnResult result)
    {
        var data = result.Data;
        if (data != null && (JsTruthy(data.GetValueOrDefault("dssa_deflected")) || JsTruthy(data.GetValueOrDefault("deflected"))))
            return true;
        return result.Agent == "dssa";
    }

    private static List<AiTaskArticle> Articles(Dictionary<string, object?>? data)
    {
        var articles = new List<AiTaskArticle>();
        if (data?.GetValueOrDefault("articles") is not List<object?> raw) return articles;
        foreach (var item in raw)
        {
            if (item is not Dictionary<string, object?> row) continue;
            var title = FirstText(row, "title", "name");
            if (title.Length == 0) continue;
            articles.Add(new AiTaskArticle
            {
                Title = title,
                Id = row.GetValueOrDefault("id")?.ToString(),
                Url = row.GetValueOrDefault("url")?.ToString(),
            });
        }
        return articles;
    }

    private static List<AiTaskTicket> Tickets(Dictionary<string, object?>? data)
    {
        var tickets = new List<AiTaskTicket>();
        var source = data ?? new Dictionary<string, object?>();
        if (JsOr(source.GetValueOrDefault("tickets"), source.GetValueOrDefault("similarTickets"), source.GetValueOrDefault("similar")) is not List<object?> raw)
            return tickets;
        foreach (var item in raw)
        {
            if (item is not Dictionary<string, object?> row) continue;
            var number = FirstText(row, "ticketNumber", "ticket_number", "number", "id");
            if (number.Length == 0) continue;
            tickets.Add(new AiTaskTicket
            {
                TicketNumber = number,
                Subject = row.GetValueOrDefault("subject")?.ToString(),
            });
        }
        return tickets;
    }

    private static AiToolProposal? Gated(IReadOnlyList<AiToolProposal> proposals) =>
        proposals.FirstOrDefault(proposal => proposal.Auto == false || proposal.Risk == "high");

    private static bool IsUnavailable(AiTurnResult result)
    {
        var data = result.Data;
        if (data != null && data.GetValueOrDefault("code") as string == "temporarily_unavailable")
            return true;
        var last = AsRecord(data?.GetValueOrDefault("lastToolOutcome"));
        var message = last?.GetValueOrDefault("message") as string ?? "";
        return ConfigUrl.IsMatch(message);
    }

    private static (List<AiMetricValue> Metrics, List<Dictionary<string, object?>> Rows, string? Why) InsightParts(AiTurnResult result)
    {
        var data = result.Data ?? new Dictionary<string, object?>();
        var last = AsRecord(data.GetValueOrDefault("lastToolOutcome")) ?? new Dictionary<string, object?>();
        var payload = AsRecord(last.GetValueOrDefault("payload")) ?? data;
        var nested = AsRecord(payload.GetValueOrDefault("data")) ?? new Dictionary<string, object?>();
        var metricSource = JsOr(
            payload.GetValueOrDefault("metrics"),
            nested.GetValueOrDefault("metrics"),
            payload.GetValueOrDefault("rows"),
            nested.GetValueOrDefault("rows"));
        var metrics = new List<AiMetricValue>();
        var rows = new List<Dictionary<string, object?>>();
        if (metricSource is List<object?> source)
        {
            foreach (var item in source)
            {
                if (item is not Dictionary<string, object?> row) continue;
                if (IsTicketRow(row))
                {
                    rows.Add(row);
                    continue;
                }
                var metric = MetricValue(row);
                if (metric != null) metrics.Add(metric);
            }
        }
        if (rows.Count == 0)
        {
            var rowSource = JsOr(payload.GetValueOrDefault("rows"), nested.GetValueOrDefault("rows"), payload.GetValueOrDefault("tickets"));
            if (rowSource is List<object?> list)
            {
                foreach (var item in list)
                {
                    if (item is Dictionary<string, object?> row && IsTicketRow(row))
                        rows.Add(row);
                }
            }
        }
        var why = payload.GetValueOrDefault("answer") as string;
        return (metrics, rows, why);
    }

    private static AiMetricValue? MetricValue(Dictionary<string, object?> row)
    {
        var value = FirstPresent(row, "value", "metric_value", "count");
        if (value is not string && !IsNumber(value)) return null;
        return new AiMetricValue
        {
            Value = value,
            Id = FirstPresent(row, "id", "metric", "metric_id")?.ToString(),
            Label = FirstPresent(row, "label", "name", "metric")?.ToString(),
        };
    }

    private static bool IsTicketRow(Dictionary<string, object?> row) =>
        row.ContainsKey("ticketNumber") || row.ContainsKey("ticket_number") || row.ContainsKey("subject");

    private static object? FirstPresent(Dictionary<string, object?> row, params string[] keys)
    {
        foreach (var key in keys)
        {
            if (row.TryGetValue(key, out var value) && value is not null)
                return value;
        }
        return null;
    }

    private static string FirstText(Dictionary<string, object?> row, params string[] keys)
    {
        foreach (var key in keys)
        {
            if (!row.TryGetValue(key, out var value) || value is null) continue;
            var text = value switch
            {
                string s => s.Trim(),
                _ when IsNumber(value) => value.ToString()?.Trim() ?? "",
                _ => "",
            };
            if (text.Length > 0) return text;
        }
        return "";
    }

    private static bool IsNumber(object? value) =>
        value is byte or sbyte or short or ushort or int or uint or long or ulong or float or double or decimal;

    private static bool JsTruthy(object? value)
    {
        switch (value)
        {
            case null:
            case false:
                return false;
            case string text:
                return text.Length > 0;
            case long number:
                return number != 0;
            case int number:
                return number != 0;
            case double number:
                return number != 0;
            case float number:
                return number != 0;
            default:
                return true;
        }
    }

    private static object? JsOr(params object?[] values)
    {
        foreach (var value in values)
        {
            if (JsTruthy(value)) return value;
        }
        return null;
    }

    public static Dictionary<string, object?> ParseSse(string text, Action<Dictionary<string, object?>>? onProgress)
    {
        Dictionary<string, object?>? result = null;
        Dictionary<string, object?>? error = null;
        var blocks = text.Replace("\r\n", "\n").Split("\n\n");
        foreach (var block in blocks)
        {
            if (string.IsNullOrWhiteSpace(block)) continue;
            var eventName = "message";
            var dataLines = new List<string>();
            foreach (var line in block.Split('\n'))
            {
                if (line.StartsWith("event:", StringComparison.Ordinal)) eventName = line[6..].Trim();
                else if (line.StartsWith("data:", StringComparison.Ordinal)) dataLines.Add(line[5..].Trim());
            }
            if (dataLines.Count == 0) continue;
            var parsed = JsonValues.Parse(string.Join("\n", dataLines));
            var record = parsed as Dictionary<string, object?> ?? new Dictionary<string, object?>();
            if (eventName == "progress") onProgress?.Invoke(record);
            if (eventName == "result") result = record;
            if (eventName == "error")
            {
                var nested = record.GetValueOrDefault("payload") as Dictionary<string, object?> ?? record;
                error = new Dictionary<string, object?>(nested);
                if (record.GetValueOrDefault("status") is long statusLong) error["status"] = statusLong;
            }
        }
        if (error != null)
        {
            var status = error.GetValueOrDefault("status") is long code ? (int)code : 502;
            var detail = error.GetValueOrDefault("detail") as string
                ?? error.GetValueOrDefault("error") as string
                ?? "Co-worker stream failed";
            throw new TicketingApiError(detail, status, error);
        }
        if (result == null)
            throw new TicketingApiError("Co-worker stream ended without a result", 502, null);
        return result;
    }
}
