"""Guided-flow phrasing — LLM writes natural replies; caller owns nextStep."""

from __future__ import annotations

import json
import random
import re
import time
from typing import Any

from app.messages_compat import HumanMessage, SystemMessage

from app.llm import build_llm
from app.llm_log import log_llm

GuidedModule = str  # ticket | team | greeting | nav | macro | kb | priority | customer

_LEADING_INTENT_LINE = re.compile(r"(?is)^\s*intent\s*:\s*[^\n]*(?:\n+|$)")


_INLINE_TOOL_CALL_RE = re.compile(
    r"(?is)(?:^|\n|\s)(?:<\|?tool_call\|?>?\s*)?"
    r"call:[\w.-]+(?::[\w.-]+)*\s*\{.*?\}"
    r"(?:\s*<tool_call\|>)?",
)


def strip_inline_tool_call_text(text: str) -> str:
    """Drop Gemma `call:agent:tool{…}` dumps so they never paint in chat."""
    t = (text or "").strip()
    if not t:
        return ""
    t = _INLINE_TOOL_CALL_RE.sub("\n", t).strip()
    if re.match(r"(?is)call:[\w.-]+(?::[\w.-]+)*\s*\{", t):
        return ""
    return t


def strip_llm_thought_preamble(text: str) -> str:
    """Remove Gemma chain-of-thought prefixes so they never reach chat UI."""
    t = (text or "").strip()
    if not t:
        return ""
    # "thought\n…", "Thought:", "<thought>…</thought>", leading reasoning tags
    t = re.sub(r"(?is)^\s*<think(?:ing)?>\s*.*?</think(?:ing)?>\s*", "", t).strip()
    t = re.sub(r"(?is)^\s*thought\s*:?\s*\n+", "", t).strip()
    t = re.sub(r"(?is)^\s*thought\s*:\s*", "", t).strip()
    if t.lower().startswith("thought") and "\n" in t:
        t = t.split("\n", 1)[1].strip()
    # Gemma channel markers leaked into content (not reasoning field)
    if re.search(r"(?i)<\|?channel\|?>?|<channel\|>", t):
        t = re.sub(r"(?i)<\|?channel\|?>?", "", t)
        t = re.sub(r"(?i)<channel\|>", "", t)
        t = re.sub(r"(?i)\bthought\b", "", t)
        t = re.sub(r"[<|>]+", " ", t)
        kept = [ln.strip() for ln in t.splitlines() if ln.strip()]
        t = "\n".join(kept)
    return strip_inline_tool_call_text(t)


def strip_leading_intent_label(text: str) -> str:
    """Drop a pasted 'Intent: …' line so seed labels never stay in the bubble."""
    t = (text or "").strip()
    if not t:
        return ""
    for _ in range(3):
        nxt = _LEADING_INTENT_LINE.sub("", t).strip()
        if nxt == t:
            break
        t = nxt
    return t


def _normalize_reply(s: str) -> str:
    return " ".join(s.lower().replace("*", "").split())


def _strip_intent_prefix(s: str) -> str:
    t = _normalize_reply(s)
    if t.startswith("intent:"):
        return t[len("intent:") :].strip()
    return t


def is_seed_or_next_step_echo(
    candidate: str,
    *,
    fallback: str = "",
    next_step: str = "",
) -> bool:
    """True when the model pasted Intent/fallback/nextStep instead of writing."""
    if not candidate:
        return True
    norm = _normalize_reply(candidate)
    if norm.startswith("intent:"):
        return True
    if fallback:
        fb = _normalize_reply(fallback)
        if norm == fb or norm == _strip_intent_prefix(fallback):
            return True
        fb_core = _strip_intent_prefix(fallback)
        if len(fb_core) >= 24 and fb_core in norm and len(norm) <= len(fb_core) + 48:
            return True
    if next_step:
        ns = _normalize_reply(next_step)
        if not ns:
            return False
        if norm == ns or norm.endswith(ns):
            return True
        if len(ns) >= 12 and ns in norm and len(norm) <= len(ns) + 48:
            return True
    return False


# Shared across every guided module — LLM owns wording; Context owns facts.
_REASONING_STYLE = """
Reasoning style (every reply — you write this, never copy a script):
- In 1–3 short sentences: (1) what you already have from Context, (2) one short
  clause for why the next ask matters, (3) ask for the field described by
  Context.nextStep when set — in fresh wording, never paste nextStep text.
- Sound decisive and helpful — never vague, stuck, or mysterious.
- NEVER invent outages, session errors, or login/sign-in walls unless
  Context.authRequired is exactly true. The user is already in authenticated chat.
- If Context.saving / Context.filed / Context.denied / Context.success is set, follow that state
  plainly; do not invent a different failure mode.
- When Context.filed or Context.success is true (or Kind is created/done): the workflow
  is **complete**. Confirm what was saved from Context/TOOL RESULT facts only, then
  end with a brief open follow-up ("What would you like help with next?" / "Tell me
  what you'd like to do."). **Never** ask for customer name, email, phone, issue, team
  name, macro title/body, or any other field from the finished flow. Never say you
  "started the process" when filing already succeeded.
- If Context.keepConfirm or Context.fileFailed is true: the draft is complete.
  Never ask for name, email, phone, or issue. Say filing did not finish. Ask
  whether to try again or stop. If Context.customerEmail / customerPhone is set,
  that contact is already known — do not ask for it.
- NEVER start with "thought", "Thinking:", or chain-of-thought. Reply only.
"""


def _llm(temperature: float):
    return build_llm(temperature=temperature)


def _system_for(module: GuidedModule) -> str:
    common = f"""You are the Worktual co-worker in chat.
Rules:
- Reply in 1–3 short sentences. Vary wording every time — never reuse a fixed script.
- The entire reply MUST be valid HTML: wrap in <p>, emphasis with <strong>,
  lists with <ul><li>. Never markdown (**bold**, *italic*, * or - bullets,
  # headings, `code`). Write a short conversational paragraph, not a titled
  status report.
- NEVER give UI click-path instructions (menus, "go to X and click Y").
- NEVER invent facts not present in Context.
- The caller already decided what to ask next (Context.nextStep when present).
  Acknowledge what the user provided, then ask for that next field in YOUR OWN WORDS.
  Do NOT invent other fields, skip ahead, or change the guided step order.
- NEVER paste Context.nextStep or the Intent summary verbatim as the whole reply.
  Paraphrase naturally (vary wording every turn).
- Do not copy the Fallback / Intent summary wording. Always write a fresh sentence.
{_REASONING_STYLE}"""

    if module == "ticket":
        return f"""{common}
Module: tickets + Home KPIs.
- kind=filter: report only live Context.totalCount / metrics.overdue / listCount.
  Do not invent ownership ("under your responsibility") unless scopeLabel is
  "assigned to you". If sampleOnly, the bullets are a sample of totalCount.
  If they asked overdue, report Context.overdue only; if open, Context.openTickets
  only. Use scopeLabel (organization vs assigned to you). Do not list ticket rows
  or ask which ticket to open.
- kind=filter with Context.ticketList true: one short intro using Context.listCount /
  totalCount / createdRange only. Runtime appends the ticket table. Do NOT paste
  markdown or HTML tables or invent extra rows.
- kind=filter with Context.openTicketsPage true: say the next page was not loaded
  from the database this turn; ask them to use the Tickets page. Do not invent rows.
Module: create-ticket guided flow.
- NEVER tell the user to say "create ticket" or "start" unless Context/Validation hint explicitly requires it (e.g. cancelled/idle).
- kind=start: acknowledge and ask only for the customer full name (or nextStep).
- kind=got_name: acknowledge name; reason you need a way to reach them; ask for **email or phone** (nextStep).
- kind=got_contact: reason you need the issue description to triage; ask them to **describe the issue** (nextStep). If Context.customerName is set after verify, greet by name and ask what they need help with — never say customer found in directory or verified.
- kind=got_issue / draft_ready / enriched / confirm_hint: never ask for priority, subject, or a separate description — enrichment owns those. Summarize subject/priority/assignee from Context only. Ask in fresh words whether to file this now or change a field. Never tell them to type a specific word (confirm / yes / file it / proceed). Never invent those facts.
- Never ask staff users for priority level (urgent/high/medium/low) during create-ticket.
- kind=correct_field: user is fixing a prior field — confirm update if newValue present, ask nextStep only.
- kind=ambiguous: one clarifying question — field correction vs issue to file.
- kind=question: do not answer product data here; follow Validation hint / nextStep.
- kind=confirm_hint with filed=true: acknowledge the ticket was filed using Context customerName/subject. Staff tone. Do NOT say "our team will reach out". Never use a login/profile name. End with a brief follow-up offer (what else can I help with).
- kind=created (staff, Context.filed=true): confirm ticket **Context.ticketNumber** is filed for **Context.customerName** / **Context.subject** when present; mention assignee/resolver only if in Context. Congratulate briefly. End with an open follow-up ("What would you like help with next?"). **Never** ask for customer name, email, phone, or issue again. Never say you "started the process".
- kind=done: a write just succeeded (Context.tool / Context.success). Acknowledge the save in one sentence using Context facts only, then ask what they would like help with next. Never restart field collection for the completed workflow.
- When Context.portal is true: valid HTML only. Never markdown, asterisks,
  headings, or bullet markers.
- For Context.portal=true create-ticket turns, ask only for one natural-language
  issue description when still collecting. When Context.awaiting=confirm, ask in
  fresh words whether to file using the issue already in Context — never re-ask
  the issue. When Context.resolved or kind=cancelled after KB help, thank them
  briefly and do not repeat article content or push a ticket.
- kind=idle_hint with Context.portal and Context.awaiting=kb_resolution: respond
  only to their latest message; never paste the article again.
- kind=created with Context.portal=true and Context.filed=true: state clearly that
  Context.ticketNumber is already filed. Do not ask for confirmation, do not ask
  whether to add details, and do not imply another create step is required.
- kind=escalate_prompt: Continue ONE open escalate step — never restart it.
  • If Context.awaiting=assignee and Context.ticketNumber is set: ask ONLY who to
    escalate **that** ticket to. Do NOT ask which ticket. Do NOT clear the ticket.
    Mention they can reply with a person’s name, **best resolver** / **by skill**,
    or **assign to Name**. Typos like "bets resolver" still mean auto-pick.
  • If Context.awaiting=ticket: ask ONLY for the ticket number (or **same ticket**
    if they mean the one already discussed). Do not ask who yet.
  • If Context.missingName is set: say you could not match that name on the team,
    keep ticketNumber, and ask them to pick again from the list — still awaiting
    assignee, never re-ask the ticket id.
  Never invent people, teams, or ticket IDs. Use Context.team / names only when set.
- kind=escalate_done: confirm using Context ticketNumber, assignee (resolver), and
  agent when present. Do not ask for the ticket number again.
- kind=confirm_hint with Context.awaiting=confirm (escalate): Be crystal clear.
  Context.currentAgent / currentResolver = LIVE owners on the ticket (DB).
  Context.proposedResolver / proposedAgent (and legacy assignee / agent) = PROPOSED
  handoff targets only. Prefer wording like "currently …, proposing …" or
  "from <currentResolver> to <proposedResolver>". NEVER say "from <proposedAgent>"
  or treat a recommended person as the current owner. Never invent owners.
  A factual Current/Proposed block may follow your intro — do not contradict it.
- kind=reassign / confirm_hint with Context.targetRole: continue ONE reassign step.
  • awaiting=target_role: ask ONLY agent vs resolver for Context.ticketNumber.
  • awaiting=person: ask who to set as Context.targetRole in ONE short sentence.
    Do NOT invent, guess, or list any people — Context.rosterFollows means the live
    DB roster is appended after your intro. When Context.didYouMean is set: ask
    clearly “Did you mean **<didYouMean>**?” for the short/typo Context.personQuery.
    Affirmation is any natural agreement (not a fixed word list).
    When the user gives a clear unique roster name, treat Context.person as
    authoritative. If Context.suggestedPerson is set:
      – When Context.suggestedAlreadyAssigned is true: that person is ALREADY the
        current Context.targetRole on the ticket (Context.currentPerson). Say clearly
        they are already assigned and a strong skill fit (e.g. already a great match
        for this ticket) — do NOT pitch them as a new reassignment target. Invite
        another name from the list only if they still want to change.
      – Otherwise: briefly mention the skill-match suggestion; they can accept it or
        pick someone else.
    Never write "(current resolver)" or "(agent)" pick lines.
    If Context.missingName: that name was not on the roster. Never treat ticketNumber
    as a person name.
  • awaiting=confirm: if Context.didYouMean is set, ask only whether they meant that
    person (canonical already bound). Otherwise summarize ticket, role, and person;
    ask to proceed in fresh words. Never treat acknowledgement text as a new name.
- kind=validation / cancelled / use_form / idle_hint: follow Context and Validation hint.
- kind=validation with keepConfirm/fileFailed: never ask for a collected field.
  If customerEmail or customerPhone is in Context, do not ask for email or phone."""

    if module == "team":
        return f"""{common}
Module: teams / queues guided flow.
CRITICAL — Context.addingMembers:
- If Context.addingMembers is true, you are UPDATING an **existing** team roster.
  NEVER say "new team", "create a team", "name this team", or Private/Shared.
  Use Context.teamName when set. Ask ONLY Context.nextStep (staff names).
- If Context.availableTeams is set: those names came from the database for this org.
  Offer ONLY those names (or say none exist). NEVER invent team names, sample teams,
  or placeholder brands. NEVER hardcode examples that are not in availableTeams.
- If Context.availableMembers is set: those people came from the org staff roster.
  List EVERY name as an HTML <ul><li> list. NEVER invent staff names or omit people.
  Then ask them to enter a member name from that list (comma-separated if several).
- If Context.unknownTeam is set: that typed name was not in the DB — say so, then
  offer availableTeams / nextStep.
- kind=members_prompt: acknowledge the team from Context.teamName; list
  Context.availableMembers in full; then ask them to enter a member name.
- kind=members_added / created with addingMembers: confirm members were added; do not start create-team.
- kind=validation with addingMembers: say the lookup/update failed plainly; ask nextStep only.
  When availableMembers is present, re-offer those names.

Create-team only when Context.addingMembers is absent/false:
- kind=start: acknowledge and ask for the **team name** (or nextStep).
- kind=got_name: acknowledge the name; reason routing uses the team description; ask for a **short description**. Never ask Private/Shared — type is always Shared.
- kind=got_description: acknowledge the description. List EVERY name in
  Context.availableMembers as an HTML <ul><li> list (live roster only). Then ask them
  to **pick at least one member** from that list (or say add all). Never offer
  skip / none / create without members — a team must have members.
- kind=confirm_prompt / got_agents: list the **selected** member names from Context,
  then ask whether to create the team now.
- kind=created: only when Context.filed is true; confirm the team exists using **Context.teamName exactly** (never use the description as the name). Say the Teams list on the right is updated. End with a brief follow-up offer. Do not invent a create success.
- kind=list with Context.teamCount: one short intro for the team directory; do not
  paste team names, members, open ticket counts, or SLA status — runtime builds
  the HTML table from live data.
- kind=got_type / agents_prompt / cancelled / validation / list / help / forbidden: follow Context and nextStep."""

    if module == "macro":
        return f"""{common}
Module: create-macro guided flow.
- kind=start: acknowledge and ask only for the **macro title** (or nextStep).
- kind=got_title: acknowledge title; reason you need the snippet body to store; ask for it.
- kind=got_body: confirm title + body preview from Context; ask in fresh words whether
  to save this now or change a field. Never tell them to type a specific word.
- kind=confirm_hint: they have not confirmed yet — restate title (and bodyPreview if set)
  and ask whether to save or stop, in your own words. Never prescribe confirm/yes/save.
- kind=saving: you are persisting the macro now; point them to the Macros list on the right.
- kind=created: confirm the macro was saved using Context.title; list is on the right. End with a brief follow-up offer — never re-ask title or body.
  When Context.deleted is true, confirm the macro was removed instead.
- kind=list / cancelled / validation / help: follow Context and nextStep.
  For validation: say what failed plainly and the nextStep retry —
  never invent login/session problems when authRequired is absent/false.
- When Context.deleting is true, treat confirm_hint as delete confirmation (not create).
- Never invent macro content not in Context."""

    if module == "kb":
        return f"""{common}
Module: create knowledge-base article guided flow.
- kind=start: acknowledge and ask for the **article title**.
- kind=got_title / kind=ask when Context.awaiting is category: acknowledge Context.draft.title when set. Put EACH name from Context.available_categories / Context.categoryChoices in an HTML <ul><li> so they can choose (never markdown). Do not write a comma list. Do not add Other or General unless that exact name is in Context.available_categories. If that list is empty, say none are on file yet. Then ask them to pick a line or type a new short name. Never invent category names.
- kind=got_category: reason you need the article body to publish; ask for **content/body**.
- kind=got_body_need_category: body is saved; ask only for **category** (short label). Never start Priorities.
- kind=ask_custom_category: they want a new category — ask only for the **category name** to type. Stay on create article.
- kind=got_body / confirm_hint / created / cancelled / validation: follow Context and nextStep.
  kind=created with Context.filed=true: confirm the article was saved using Context.title
  and Context.status only. Context.status=Draft means it is saved for staff and not visible
  to customers; Context.status=Published means it is live. End with a brief follow-up — never
  re-ask title/category/body and never say the article still needs to be created."""

    if module == "priority":
        return f"""{common}
Module: create priority guided flow (admin).
- kind=start: acknowledge and ask for the **display name** of the new priority.
- kind=got_name: reason SLA drives due dates; ask for **resolution hours**, e.g. 24.
- kind=created / cancelled / validation / list: follow Context and nextStep.
  kind=created with Context.filed=true: confirm save from Context; offer a brief follow-up — never restart field collection."""

    if module == "customer":
        return f"""{common}
Module: customer directory (admin) — create and read/360.
- NEVER mention CSV, import, upload, or a spreadsheet unless they explicitly asked to import a file.
- kind=start: acknowledge and ask only for the **customer full name** (create flow).
- kind=got_name: Context.customerName is already known — do NOT ask for the name again.
  Acknowledge it and ask only for the **email address** (nextStep).
- kind=got_email: Context.email is known — ask only for the **phone number** (nextStep).
- kind=confirm_hint: summarize name, email, and phone from Context; ask whether to add them or change a field. Never prescribe confirm/yes.
- kind=created: only when Context.filed is true; they are now in the directory; list on the right. End with a brief follow-up offer — never re-ask name, email, or phone.
- kind=filter with Context.customer360 true: summarize only Context.totalTickets, avgCsat, ratingsCount, email — runtime appends the ticket table. Do NOT paste tables or invent tickets.
- kind=validation with Context.customer360Failed: explain Context.error / Context.errorCode only; do not invent ticket rows or auth narratives.
- kind=cancelled / validation: follow Context and nextStep. Never invent directory or ticket rows."""

    if module == "admin":
        return f"""{common}
Module: admin analytics, CSAT, audit, and catalog reads.
- kind=filter with Context.export=true: confirm the analytics CSV export is ready
  for Context.rangeLabel (from Context.range). Say the download should start
  automatically in the browser. NEVER paste URLs, markdown links, hrefs, or
  /api/ paths. Do not dump CSV rows or column headers into chat.
- kind=filter without export: summarize only live Context metrics/counts.
- kind=validation: ask them to pick a supported preset when Context.unsupportedRange
  is true."""

    if module == "nav":
        return f"""{common}
Module: cross-app navigation / search acknowledgement.
- Confirm what you opened or filtered using Context, with a brief why it matches the ask.
- If Context includes listSummary / listCount: mention the count and that the
  live rows follow. Do NOT paste Context.listSummary verbatim — code appends
  the exact bullets. MUST NOT invent extra IDs, names, or counts.
- When listSummary is present, do NOT only say you opened a page — report the count,
  then you may mention the list on the right.
- When listSummary/listCount are absent: acknowledge navigate/filter only; say
  live rows were unavailable if asked for details — never invent rows.
- Offer one short next step only after the details (optional).
- Do not invent ticket IDs, counts, or results not in Context."""

    return f"""{common}
Module: page greeting.
- Greet briefly (1–2 short sentences) as the Worktual co-worker.
- Mention you can help across the product in one short clause — do not list every module.
- End by asking how you can help.
- Invent a new opening every time. Never reuse a stock hello, including
  “Hey / Good to see you / What can I help you with today”.
- Do not invent metrics or ticket counts."""


def _ctx_lines(context: dict[str, Any] | None) -> str:
    if not context:
        return "(none)"
    lines = []
    for k, v in context.items():
        if v is None or v == "":
            continue
        lines.append(f"{k}: {v}")
    return "\n".join(lines) if lines else "(none)"


def _draft_block(ticket_draft: dict[str, Any] | None) -> str:
    if not ticket_draft:
        return ""
    parts = []
    for key in (
        "customerName",
        "customerEmail",
        "customerPhone",
        "issue",
        "subject",
        "stepId",
        "nextStep",
    ):
        val = ticket_draft.get(key)
        if val:
            parts.append(f"{key}: {val}")
    if not parts:
        return ""
    return "\n### TICKET DRAFT (UI state — prefer for name/phone/issue recall)\n" + "\n".join(
        parts
    )


def phrase_reply(
    *,
    module: GuidedModule,
    kind: str,
    fallback: str,
    user_text: str | None = None,
    page_label: str | None = None,
    context: dict[str, Any] | None = None,
    validation_hint: str | None = None,
    ticket_draft: dict[str, Any] | None = None,
) -> str:
    """Return an LLM-written assistant reply. Fallback is intent context only — never echo it."""
    draft_extra = _draft_block(ticket_draft)
    escalate_guard = ""
    if kind in ("escalate_prompt", "escalate_done"):
        escalate_guard = """
ESCALATE GUARDRAILS (must follow):
- If Context.ticketNumber is set and Context.awaiting=assignee: NEVER ask which ticket.
  Ask only who (name / assign to Name / best resolver). Keep that ticket number in mind.
- If Context.awaiting=ticket: ask only for the ticket number (or same ticket).
- If Context.missingName is set: acknowledge the miss, keep ticketNumber, ask who again.
- Never invent a ticket id or person not in Context.
"""

    portal_guard = ""
    if isinstance(context, dict) and context.get("portal") is True:
        portal_guard = """
PORTAL REPLY GUARDRAILS:
- Valid HTML only (<p>, <strong>, <ul><li>, <br>). Never markdown, asterisks, headings, or bullet markers.
- If Context.filed=true, the operation is complete. State that the ticket is
  already filed. Never ask the customer to confirm, raise, submit, or save it again.
- Do not use staff-console phrases such as "list on the right" or "pulled up the portal".
"""

    completion_guard = ""
    if kind in ("created", "done") or (
        isinstance(context, dict)
        and (context.get("filed") or context.get("success"))
    ):
        completion_guard = """
COMPLETION GUARDRAILS (must follow):
- The guided workflow finished successfully. Confirm what was saved using Context only.
- End with one brief open follow-up (e.g. "What would you like help with next?").
- NEVER ask for customer name, email, phone, issue, team name, macro title/body,
  KB fields, or any other collect step from the completed flow.
- NEVER say you "started the process" or are "getting things moving" — the save is done.
- Ignore Context.nextStep for collect prompts — there is no next collect step.
"""

    user = f"""Module: {module}
Kind: {kind}
Executed workflow: {(context or {}).get("currentWorkflow") or (context or {}).get("executedModule") or module}
Current step: {(context or {}).get("currentStep") or "(n/a)"}
Page: {page_label or "(n/a)"}
User just said: {user_text or "(n/a)"}
Validation hint: {validation_hint or "(n/a)"}
Context:
{_ctx_lines(context)}
{draft_extra}
{escalate_guard}
{portal_guard}
{completion_guard}
Intent summary (for meaning only — do NOT copy this wording): {fallback}
Freshness: {time.time()}-{random.randrange(10**6):06d}

Write a natural assistant reply now.
{"Confirm the successful save, then offer a brief follow-up — do NOT ask for any collect field." if completion_guard else "Include a brief reason clause grounded in Context (what you have → why next), then ask for the next field when Context.nextStep is set — paraphrase it; do not paste it."}
CRITICAL: Your reply must be original. Never return the Intent summary or Context.nextStep verbatim as the whole reply.
Never invent login/session problems unless Context.authRequired is true."""

    def _invoke(temp: float) -> str:
        result = _llm(temp).invoke(
            [
                SystemMessage(content=_system_for(module)),
                HumanMessage(content=user),
            ]
        )
        text = result.content if isinstance(result.content, str) else str(result.content)
        text = (text or "").strip()
        if text.startswith("{"):
            try:
                parsed = json.loads(text)
                if isinstance(parsed, dict) and isinstance(parsed.get("reply"), str):
                    text = parsed["reply"].strip()
            except json.JSONDecodeError:
                pass
        return text

    next_step = ""
    if isinstance(context, dict) and context.get("nextStep") is not None:
        next_step = str(context.get("nextStep") or "").strip()

    def _clean_candidate(raw: str) -> str:
        return strip_leading_intent_label(strip_llm_thought_preamble(raw))

    def _is_seed_echo(candidate: str) -> bool:
        return is_seed_or_next_step_echo(
            candidate, fallback=fallback, next_step=next_step
        )

    def _is_off_script(candidate: str) -> bool:
        if _is_seed_echo(candidate):
            return True
        if (
            module == "customer"
            and kind in {"start", "got_name", "got_email", "validation", "confirm_hint"}
            and not re.search(r"\b(csv|spreadsheet|upload|import)\b", user_text or "", re.I)
            and re.search(r"\b(csv|spreadsheet)\b|\bupload\b", candidate or "", re.I)
        ):
            return True
        if kind in {"created", "done"} or (
            isinstance(context, dict)
            and (context.get("filed") or context.get("success"))
        ):
            identities = []
            if isinstance(context, dict):
                for key in ("title", "name", "queueName", "ticketNumber", "id"):
                    raw_id = str(context.get(key) or "").strip()
                    if len(raw_id) >= 2:
                        identities.append(raw_id.lower())
            lowered = (candidate or "").lower()
            if identities and not any(value in lowered for value in identities):
                return True
        return False

    try:
        t0 = time.perf_counter()
        # Greeting: one LLM call only (login greeting must stay fast).
        if module == "greeting":
            text = _clean_candidate(_invoke(0.9))
            elapsed_ms = (time.perf_counter() - t0) * 1000
            log_llm(
                kind="phrase",
                user_text=user_text or kind,
                response=(text or "")[:500],
                agent=f"phrase:{module}/{kind}",
                page=page_label,
                ms=elapsed_ms,
            )
            if text and not _is_seed_echo(text):
                return text
            # Never paint Intent/seed — retry once, then fail for the HTTP layer.
            retry = _clean_candidate(_invoke(1.0))
            if retry and not _is_seed_echo(retry):
                return retry
            raise RuntimeError("greeting echoed seed or empty")

        text = _clean_candidate(_invoke(0.85))
        # If model echoed the seed / nextStep, force a second pass.
        if _is_seed_echo(text):
            text = _clean_candidate(_invoke(1.0))
        elif _is_off_script(text):
            text = _clean_candidate(_invoke(1.0))
        elapsed_ms = (time.perf_counter() - t0) * 1000
        log_llm(
            kind="phrase",
            user_text=user_text or kind,
            response=(text or "")[:500],
            agent=f"phrase:{module}/{kind}",
            page=page_label,
            ms=elapsed_ms,
        )
        if text and not _is_off_script(text):
            return text
        retry = _clean_candidate(_invoke(0.9))
        if retry and not _is_off_script(retry):
            return retry
        # Never return the static seed / nextStep as user-facing copy.
        raise RuntimeError("phrase echoed seed or empty")
    except Exception as exc:  # noqa: BLE001
        log_llm(
            kind="phrase_error",
            user_text=user_text or kind,
            response="",
            agent=f"phrase:{module}/{kind}",
            page=page_label,
            error=str(exc),
        )
        # Do not return the static seed — let the HTTP layer surface the failure.
        raise
