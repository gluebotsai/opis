"""Wire-level checks against a fake transport. No network."""

from __future__ import annotations

import json
import unittest

from worktual_ticketing import TicketingApiError, TicketingAuthError, create_ticketing_client


class Recorder:
    def __init__(self, handler):
        self.calls = []
        self.handler = handler

    def __call__(self, method, url, headers, body):
        self.calls.append({"method": method, "url": url, "headers": headers, "body": body})
        return self.handler(method, url, headers, body)


def json_of(payload, status=200):
    raw = json.dumps(payload).encode()

    def handle(method, url, headers, body):
        return status, raw

    return handle


def body_of(call):
    return json.loads(call["body"].decode())


class ClientTests(unittest.TestCase):
    def test_session_uses_partner_key_and_locale(self):
        transport = Recorder(
            json_of(
                {
                    "sessionToken": "jwt",
                    "sessionId": "9",
                    "expiresAt": "2026-10-06T00:00:00.000Z",
                    "locale": "es",
                    "organizationId": "1000",
                    "actor": {"id": "2", "name": "Jane", "email": "jane@worktual.com", "role": "admin"},
                },
                201,
            )
        )
        client = create_ticketing_client(
            base_url="http://127.0.0.1:3001/",
            partner_api_key="wt_live_partner",
            locale="en",
            transport=transport,
        )
        session = client.auth.create_session(actor={"email": "jane@worktual.com"}, locale="es")
        self.assertEqual(session.session_token, "jwt")
        self.assertEqual(session.actor.role, "admin")
        call = transport.calls[0]
        self.assertEqual(call["url"], "http://127.0.0.1:3001/api/sdk/sessions")
        self.assertEqual(call["headers"]["X-Api-Key"], "wt_live_partner")
        self.assertEqual(body_of(call), {"actor": {"email": "jane@worktual.com"}, "locale": "es"})

    def test_turn_confirm_and_reject(self):
        transport = Recorder(
            json_of(
                {
                    "assistantText": "Listo",
                    "agent": "ticket_lifecycle_executor",
                    "toolProposals": [{"name": "escalate_ticket", "args": {"ticket": "#1"}, "risk": "high", "auto": False}],
                }
            )
        )
        client = create_ticketing_client(
            base_url="http://127.0.0.1:3001",
            access_token="session.jwt",
            locale="es",
            transport=transport,
        )
        turn = client.ai.turn(session_token="session.jwt", message="Escala este ticket", focused_ticket_id="#1")
        self.assertEqual(turn.status, "confirmation_required")
        self.assertEqual(turn.locale, "es")
        call = transport.calls[0]
        self.assertEqual(call["headers"]["Authorization"], "Bearer session.jwt")
        self.assertEqual(call["headers"]["X-Worktual-Sdk-Feature"], "ai.turn")
        sent = body_of(call)
        self.assertEqual(sent["message"], "Escala este ticket")
        self.assertEqual(sent["locale"], "es")
        self.assertEqual(sent["entity_id"], "#1")
        self.assertEqual(sent["focused_entity"]["ticketNumber"], "#1")
        self.assertNotIn("sql", sent)

        transport.handler = json_of(
            {"assistantText": "Hecho", "agent": "general", "toolProposals": [{"name": "update_ticket", "auto": True, "risk": "low"}]}
        )
        confirmed = client.ai.confirm(confirm_tool={"name": "update_ticket", "args": {"status": "Resolved"}})
        self.assertEqual(confirmed.status, "applied")
        self.assertEqual(transport.calls[1]["headers"]["X-Worktual-Sdk-Feature"], "ai.confirm")
        self.assertEqual(body_of(transport.calls[1])["message"], "confirm")

        client.ai.reject(message="No", session_token="session.jwt")
        rejected = body_of(transport.calls[2])
        self.assertEqual(rejected["message"], "No")
        self.assertNotIn("confirm_tool", rejected)
        self.assertEqual(transport.calls[2]["headers"]["X-Worktual-Sdk-Feature"], "ai.reject")

    def test_debug_trace_and_usage_events(self):
        transport = Recorder(
            json_of(
                {
                    "assistantText": "Listo",
                    "agent": "ticket_lifecycle_executor",
                    "trace": {
                        "agents": ["ticketing_coworker", "ticket_lifecycle_executor"],
                        "routes": [{"from": "ticketing_coworker", "to": "ticket_lifecycle_executor", "query": "secret"}],
                    },
                }
            )
        )
        client = create_ticketing_client(base_url="http://127.0.0.1:3001", access_token="session.jwt", transport=transport)
        turn = client.ai.turn(message="Hola", debug=True)
        self.assertEqual(body_of(transport.calls[0])["debug"], True)
        self.assertEqual(turn.trace["routes"], [{"from": "ticketing_coworker", "to": "ticket_lifecycle_executor"}])
        self.assertNotIn("secret", str(turn.trace))

        transport.handler = json_of(
            {
                "organizationId": "1000",
                "events": [
                    {
                        "id": "9",
                        "partnerId": "42",
                        "tenantId": "1000",
                        "feature": "ai.turn",
                        "agentTurns": 1,
                        "confirmRequired": True,
                        "ok": True,
                    }
                ],
            }
        )
        listed = create_ticketing_client(
            base_url="http://127.0.0.1:3001", api_key="wt_live_partner", transport=transport
        ).usage.events(limit=20)
        self.assertEqual(listed.events[0].partner_id, "42")
        self.assertEqual(listed.events[0].agent_turns, 1)
        self.assertTrue(listed.events[0].confirm_required)
        self.assertIn("/api/sdk/usage/events", transport.calls[1]["url"])

    def test_usage_summary_uses_the_partner_key(self):
        transport = Recorder(
            json_of(
                {
                    "from": "2026-09-01T00:00:00.000Z",
                    "to": "2026-10-01T00:00:00.000Z",
                    "organizationId": "1000",
                    "logins": 1,
                    "sessionEnds": 0,
                    "turns": 2,
                    "streams": 0,
                    "confirms": 1,
                    "rejects": 0,
                    "byFeature": [{"feature": "ai.turn", "count": 2}],
                    "bySkill": [{"skill": "analytics-query", "count": 2}],
                }
            )
        )
        client = create_ticketing_client(base_url="http://127.0.0.1:3001", api_key="wt_live_partner", transport=transport)
        summary = client.usage.summary(from_="2026-09-01T00:00:00.000Z")
        self.assertEqual(summary.turns, 2)
        self.assertEqual(summary.by_feature[0].feature, "ai.turn")
        self.assertEqual(summary.by_skill[0].skill, "analytics-query")
        self.assertEqual(summary.by_skill[0].count, 2)
        self.assertIn("from=2026-09-01", transport.calls[0]["url"])
        self.assertEqual(transport.calls[0]["headers"]["X-Api-Key"], "wt_live_partner")

    def test_named_tasks_and_deflect(self):
        transport = Recorder(
            json_of(
                {
                    "assistantText": "VPN outage, waiting on the customer.",
                    "agent": "investigation_summary_executor",
                    "toolProposals": [{"name": "update_ticket", "auto": True, "risk": "low"}],
                }
            )
        )
        client = create_ticketing_client(
            base_url="http://127.0.0.1:3001",
            access_token="session.jwt",
            locale="es",
            transport=transport,
        )
        with self.assertRaises(TicketingApiError) as missing:
            client.ai.tasks.summarize()
        self.assertEqual(missing.exception.status, 400)
        self.assertEqual(transport.calls, [])

        card = client.ai.tasks.summarize(ticket_number="#128")
        self.assertEqual(card.task, "ticket.summarize")
        self.assertEqual(card.status, "applied")
        sent = body_of(transport.calls[0])
        self.assertEqual(transport.calls[0]["url"], "http://127.0.0.1:3001/api/coworker/agent-turn")
        self.assertEqual(transport.calls[0]["headers"]["X-Worktual-Sdk-Feature"], "ai.tasks.summarize")
        self.assertEqual(sent["sdk_task"], "ticket.summarize")
        self.assertEqual(sent["message"], "Summarize this ticket.")
        self.assertEqual(sent["entity_id"], "#128")

        transport.handler = json_of(
            {
                "assistantText": "Hola, ya revisamos la VPN.",
                "agent": "customer_reply_drafting_executor",
                "data": {"tickets": [{"ticketNumber": "#90", "subject": "VPN"}]},
                "toolProposals": [{"name": "add_ticket_note", "auto": False, "risk": "high", "args": {"ticket_number": "#128"}}],
            }
        )
        draft = client.ai.tasks.draft_reply(ticket_number="#128")
        self.assertEqual(draft.status, "confirmation_required")
        self.assertEqual(draft.draft, "Hola, ya revisamos la VPN.")
        self.assertEqual(draft.proposal.name, "add_ticket_note")
        similar = client.ai.tasks.similar(ticket_number="#128")
        self.assertEqual(similar.status, "recommendation")
        self.assertEqual(similar.tickets[0].ticket_number, "#90")
        self.assertEqual(transport.calls[2]["headers"]["X-Worktual-Sdk-Feature"], "ai.tasks.similar")

        with self.assertRaises(TicketingApiError):
            client.ai.tasks.deflect()
        transport.handler = json_of(
            {
                "assistantText": "Reset the VPN from Settings.",
                "agent": "dssa",
                "data": {"dssa_deflected": True, "articles": [{"title": "Reset VPN"}]},
            }
        )
        deflected = client.ai.tasks.deflect(message="How do I reset VPN?")
        self.assertEqual(deflected.status, "deflected")
        self.assertTrue(deflected.deflected)
        self.assertEqual(deflected.articles[0].title, "Reset VPN")

    def test_proposals(self):
        def handle(method, url, headers, body):
            if "/decide" in url:
                return 200, json.dumps({"id": "approval:12", "ok": True, "status": "applied"}).encode()
            return 200, json.dumps(
                {
                    "items": [
                        {
                            "id": "approval:12",
                            "kind": "approval",
                            "status": "confirmation_required",
                            "agentId": "crda",
                            "ticketNumber": "#128",
                            "summary": "Send this reply",
                            "draft": "Hola",
                        }
                    ]
                }
            ).encode()

        transport = Recorder(handle)
        client = create_ticketing_client(base_url="http://127.0.0.1:3001", access_token="session.jwt", transport=transport)
        listed = client.ai.proposals.list(ticket_number="#128", status="open")
        self.assertEqual(listed.items[0].id, "approval:12")
        self.assertIn("ticketNumber=%23128", transport.calls[0]["url"])
        self.assertEqual(transport.calls[0]["headers"]["X-Worktual-Sdk-Feature"], "ai.proposals.list")
        decided = client.ai.proposals.decide(id="approval:12", decision="confirm", edits={"text": "Hola, listo"})
        self.assertEqual(decided.status, "applied")
        self.assertEqual(body_of(transport.calls[1]), {"decision": "confirm", "edits": {"text": "Hola, listo"}})
        self.assertIn("/api/sdk/proposals/approval%3A12/decide", transport.calls[1]["url"])
        self.assertEqual(transport.calls[1]["headers"]["X-Worktual-Sdk-Feature"], "ai.proposals.confirm")

        bare_transport = Recorder(handle)
        bare = create_ticketing_client(base_url="http://127.0.0.1:3001", access_token="session.jwt", transport=bare_transport)
        with self.assertRaises(TicketingApiError) as bad:
            bare.ai.proposals.decide(id="12", decision="reject")
        self.assertEqual(bad.exception.status, 400)
        self.assertEqual(bare_transport.calls, [])

    def test_metrics_copy_the_tool_payload_and_drop_invented_numbers(self):
        transport = Recorder(
            json_of(
                {
                    "assistantText": "There are 12 open tickets.",
                    "agent": "analytics_audit_query_executor",
                    "sessionMemoryPatch": {
                        "lastToolOutcome": {
                            "success": True,
                            "payload": {"metrics": [{"id": "open_tickets", "label": "Open", "value": 12}]},
                        }
                    },
                }
            )
        )
        client = create_ticketing_client(base_url="http://127.0.0.1:3001", access_token="session.jwt", transport=transport)
        card = client.ai.tasks.ask_metrics(message="How many open tickets?")
        self.assertEqual(card.status, "answered")
        self.assertEqual(card.metrics[0].id, "open_tickets")
        self.assertEqual(card.metrics[0].label, "Open")
        self.assertEqual(card.metrics[0].value, 12)
        sent = body_of(transport.calls[0])
        self.assertEqual(sent["sdk_task"], "analytics.ask")
        self.assertEqual(sent["message"], "How many open tickets?")
        self.assertNotIn("sql", sent)
        self.assertEqual(transport.calls[0]["headers"]["X-Worktual-Sdk-Feature"], "ai.tasks.askMetrics")

        with self.assertRaises(TicketingApiError) as empty:
            client.ai.tasks.ask_why(message="")
        self.assertEqual(empty.exception.status, 400)

        transport.handler = json_of(
            {"assistantText": "SLA fell because of 40 breaches.", "data": {"code": "temporarily_unavailable"}}
        )
        why = client.ai.tasks.ask_why(message="Why did SLA drop?")
        self.assertEqual(why.status, "temporarily_unavailable")
        self.assertEqual(why.reply, "This answer is temporarily unavailable.")
        self.assertEqual(why.code, "temporarily_unavailable")
        self.assertEqual(why.metrics, [])
        self.assertIsNone(why.why)
        self.assertNotIn("40", why.reply)

    def test_stream_login_inbox_and_workload(self):
        def handle(method, url, headers, body):
            if url.endswith("/api/auth/login"):
                self.assertNotIn("Authorization", headers)
                self.assertNotIn("X-Api-Key", headers)
                return 200, json.dumps({"token": "staff.jwt", "user": {"email": "jane@worktual.com"}}).encode()
            if url.endswith("/api/notifications"):
                return 200, json.dumps(
                    [{"id": "n1", "title": "Assigned", "message": "You own #128", "ticketId": "#128", "read": False}]
                ).encode()
            if "/stream" in url:
                raw = (
                    'event: progress\ndata: {"step":"intake"}\n\n'
                    'event: result\ndata: {"assistantText":"Ready to file","agent":"ticket_creation_executor","toolProposals":[]}\n\n'
                )
                return 200, raw.encode()
            return 200, json.dumps(
                {
                    "assistantText": "Move two tickets off Alex.",
                    "agent": "workload_optimization_executor",
                    "toolProposals": [{"name": "assign_ticket", "auto": False, "risk": "high"}],
                }
            ).encode()

        transport = Recorder(handle)
        client = create_ticketing_client(base_url="http://127.0.0.1:3001", access_token="session.jwt", transport=transport)
        steps = []
        streamed = client.ai.stream(message="VPN is down", sdk_task="ticket.create", on_progress=lambda event: steps.append(event.get("step")))
        self.assertEqual(steps, ["intake"])
        self.assertEqual(streamed.reply, "Ready to file")
        self.assertEqual(transport.calls[0]["headers"]["X-Worktual-Sdk-Feature"], "ai.tasks.createTicket")
        self.assertEqual(body_of(transport.calls[0])["sdk_task"], "ticket.create")

        with self.assertRaises(TicketingApiError):
            client.ai.tasks.create_ticket()
        load = client.ai.tasks.workload()
        self.assertEqual(load.status, "recommendation")
        self.assertEqual(body_of(transport.calls[-1])["sdk_task"], "ticket.workload")

        guest = create_ticketing_client(base_url="http://127.0.0.1:3001", transport=transport)
        staff = guest.auth.login(email="jane@worktual.com", password="secret")
        self.assertEqual(staff.session_token, "staff.jwt")
        inbox = client.inbox.list()
        self.assertEqual(inbox.items[0].ticket_number, "#128")
        self.assertFalse(inbox.items[0].read)

    def test_logins_report_marks_a_widget_surface(self):
        transport = Recorder(
            json_of(
                {
                    "organizationId": "1000",
                    "logins": [
                        {
                            "id": "1",
                            "actorId": "2",
                            "sessionId": "9",
                            "locale": "es",
                            "createdAt": "2026-10-01T00:00:00.000Z",
                        }
                    ],
                }
            )
        )
        client = create_ticketing_client(
            base_url="http://127.0.0.1:3001",
            partner_api_key="wt_live_partner",
            surface="ui",
            component="worktual-chat",
            transport=transport,
        )
        listed = client.usage.logins(from_="2026-10-01T00:00:00.000Z")
        self.assertEqual(listed.organization_id, "1000")
        self.assertEqual(listed.logins[0].actor_id, "2")
        self.assertEqual(listed.logins[0].locale, "es")
        self.assertIn("/api/sdk/usage/logins", transport.calls[0]["url"])
        self.assertEqual(transport.calls[0]["headers"]["X-Worktual-Sdk-Surface"], "ui")
        self.assertEqual(transport.calls[0]["headers"]["X-Worktual-Sdk-Component"], "worktual-chat")

    def test_refusal_and_missing_customer_use_the_locale_sentence(self):
        transport = Recorder(
            json_of(
                {
                    "assistantText": "Payroll is outside Ticketing.",
                    "data": {"refusal": {"code": "unsupported_product", "message": "Payroll is outside Ticketing."}},
                }
            )
        )
        client = create_ticketing_client(base_url="http://127.0.0.1:3001", access_token="session.jwt", transport=transport)
        refused = client.ai.turn(message="Refund payroll", locale="es", session_token="session.jwt")
        self.assertEqual(refused.code, "unsupported_operation")
        self.assertEqual(refused.reply, "Esta solicitud no está admitida.")
        self.assertNotIn("Payroll", refused.reply)

        transport.handler = json_of(
            {"assistantText": "I could not find that person.", "data": {"ticket_draft": {"customer_not_found": True}}}
        )
        missing = client.ai.turn(message="Open a ticket for Ada", locale="de", session_token="session.jwt")
        self.assertEqual(missing.code, "customer_not_found")
        self.assertEqual(missing.reply, "Es wurde kein passender Kunde gefunden.")

    def test_missing_credentials_and_locale_do_not_call(self):
        transport = Recorder(json_of({}))
        client = create_ticketing_client(base_url="http://127.0.0.1:3001", transport=transport)
        with self.assertRaises(TicketingAuthError):
            client.auth.create_session(actor={"email": "jane@worktual.com"})
        with self.assertRaises(TicketingAuthError):
            client.ai.turn(message="Hola")
        with self.assertRaises(TicketingAuthError):
            client.ai.turn(message="Hola", session_token="jwt", locale="not a locale")
        with self.assertRaises(TicketingAuthError):
            create_ticketing_client(base_url="  ")
        self.assertEqual(transport.calls, [])

    def test_help_widget_create_uses_the_key_and_public_submit_does_not(self):
        transport = Recorder(
            json_of(
                {
                    "widget": {"id": "4", "publicId": "wgt_abc", "name": "Help"},
                    "embed": {"script": "<script data-widget-id=\"wgt_abc\"></script>", "iframe": "help.html?id=wgt_abc"},
                },
                status=201,
            )
        )
        client = create_ticketing_client(base_url="http://127.0.0.1:3001", api_key="wt_live_partner", transport=transport)
        created = client.widgets.create(name="Help", allowed_origins=["https://partner.example"])
        self.assertEqual(created.widget.public_id, "wgt_abc")
        self.assertIn("wgt_abc", created.embed.iframe)
        self.assertEqual(transport.calls[0]["headers"].get("X-Api-Key"), "wt_live_partner")

        transport.handler = json_of(
            {
                "ticketId": "9",
                "ticketNumber": "TKT-9",
                "status": "Open",
                "channel": "Web",
                "subject": "Cannot log in",
                "createdAt": "2026-10-06T00:00:00.000Z",
                "updatedAt": "2026-10-06T00:00:00.000Z",
            }
        )
        filed = client.widgets.submit_ticket("wgt_abc", {"subject": "Cannot log in", "email": "riya@clienta.com"})
        self.assertEqual(filed["ticketNumber"], "TKT-9")
        self.assertNotIn("X-Api-Key", transport.calls[1]["headers"])
        self.assertIn("/api/public/widgets/wgt_abc/tickets", transport.calls[1]["url"])


if __name__ == "__main__":
    unittest.main()
