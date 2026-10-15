#!/usr/bin/env python3
"""Silent SQL load of org-1012 JSONL tickets.

Does not call HTTP / createTicketFromIntake / TSAA / mail / notifications.

  # preview matches only
  DATABASE_URL=... python scripts/load_org_1012_tickets.py

  # write
  DATABASE_URL=... python scripts/load_org_1012_tickets.py --apply

  python scripts/load_org_1012_tickets.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_DEFAULT_FILE = Path("/Users/apple/Downloads/org-1012-tickets-20k (2).jsonl")


def _load_dotenv() -> None:
    for path in (
        _ROOT / ".env",
        _ROOT / "ui-backend" / ".env",
        Path.cwd() / ".env",
    ):
        if not path.is_file():
            continue
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip().strip("'").strip('"')
            if key and key not in os.environ:
                os.environ[key] = val


def _connect():
    try:
        import psycopg
    except ImportError as exc:
        raise SystemExit(
            "psycopg is required (ai-agents venv: pip install 'psycopg[binary]')"
        ) from exc
    url = (os.environ.get("DATABASE_URL") or "").strip()
    if not url:
        raise SystemExit("DATABASE_URL must be set")
    return psycopg.connect(url, autocommit=False)


def _norm_email(raw: object) -> str:
    return str(raw or "").strip().lower()


def _text(raw: object) -> str:
    return str(raw or "").strip()


def _ts(raw: object):
    s = _text(raw)
    if not s:
        return None
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return s
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _int_or_none(raw: object):
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def seed_ai_summary(row: dict) -> str:
    name = _text(row.get("created_by")) or "The customer"
    channel = _text(row.get("channel")) or "a channel"
    subject = _text(row.get("subject"))
    desc = _text(row.get("description"))
    status = _text(row.get("status"))
    first = ""
    if desc:
        first = desc.split(".")[0].strip()
        if first and not first.endswith("."):
            first += "."
    if subject:
        lead = f"{name} opened this by {channel.lower()} about {subject}."
    else:
        lead = f"{name} opened this by {channel.lower()}."
    parts = [lead]
    if first and first.lower() not in lead.lower():
        parts.append(first)
    if status:
        parts.append(f"Current status is {status}.")
    return " ".join(parts)[:2000]


def _resolve_jsonl(path: Path | None) -> Path:
    chosen = path or _DEFAULT_FILE
    if not chosen.is_file():
        raise SystemExit(f"JSONL not found: {chosen}")
    return chosen


def read_jsonl(path: Path, limit: int | None) -> list[dict]:
    rows: list[dict] = []
    with path.open(encoding="utf-8") as fh:
        for i, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as err:
                print(f"skip bad json line {i}: {err}", file=sys.stderr)
                continue
            if not isinstance(obj, dict):
                continue
            rows.append(obj)
            if limit is not None and len(rows) >= limit:
                break
    return rows


def resolve_customers(cur, org_id: int, emails: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    chunk = 400
    for i in range(0, len(emails), chunk):
        batch = emails[i : i + chunk]
        cur.execute(
            """
            SELECT DISTINCT ON (lower(btrim(e.key_value)))
                   lower(btrim(e.key_value)) AS email,
                   e.cdp_id,
                   cp.id AS contact_id,
                   NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '') AS name,
                   ph.key_value AS phone
              FROM cdp.identity_keys e
              JOIN cdp.customer_profile p
                ON p.cdp_id = e.cdp_id
               AND p.organization_id = e.organization_id
              LEFT JOIN ticketing.contact_profile cp
                ON cp.organization_id = e.organization_id
               AND cp.cdp_id = e.cdp_id
               AND cp.status = 'Active'
              LEFT JOIN LATERAL (
                    SELECT ik.key_value
                      FROM cdp.identity_keys ik
                     WHERE ik.cdp_id = e.cdp_id
                       AND ik.organization_id = e.organization_id
                       AND ik.key_type = 'phone'
                     LIMIT 1
              ) ph ON TRUE
             WHERE e.organization_id = %s
               AND e.key_type = 'email'
               AND lower(btrim(e.key_value)) = ANY(%s)
             ORDER BY lower(btrim(e.key_value)), e.cdp_id
            """,
            (org_id, batch),
        )
        for row in cur.fetchall():
            out[str(row[0])] = {
                "email": str(row[0]),
                "cdp_id": str(row[1] or ""),
                "contact_id": int(row[2]) if row[2] is not None else None,
                "name": str(row[3] or "").strip(),
                "phone": str(row[4] or "").strip() or None,
            }
    return out


def missing_cdp_ids(customers: dict[str, dict]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for person in customers.values():
        cdp_id = str(person.get("cdp_id") or "").strip()
        if not cdp_id or person.get("contact_id") or cdp_id in seen:
            continue
        seen.add(cdp_id)
        out.append(cdp_id)
    return out


def ensure_contact_profiles(cur, org_id: int, cdp_ids: list[str]) -> int:
    if not cdp_ids:
        return 0
    created = 0
    chunk = 400
    for i in range(0, len(cdp_ids), chunk):
        batch = cdp_ids[i : i + chunk]
        cur.execute(
            """
            INSERT INTO ticketing.contact_profile (
              organization_id, cdp_id, status, total_tickets
            )
            SELECT %s, x.cdp_id, 'Active', 0
              FROM unnest(%s::text[]) AS x(cdp_id)
             WHERE btrim(x.cdp_id) <> ''
            ON CONFLICT (organization_id, cdp_id) DO NOTHING
            """,
            (org_id, batch),
        )
        created += cur.rowcount or 0
    return created


def load_staff(cur, org_id: int) -> dict[int, str]:
    names: dict[int, str] = {}
    cur.execute(
        """
        SELECT ag.id, ag.setup_user_id,
               NULLIF(btrim(concat_ws(' ', au.first_name, au.last_name)), '')
          FROM ticketing.agents ag
          LEFT JOIN accounts.setup_users au ON au.id = ag.setup_user_id
         WHERE ag.organization_id = %s
        """,
        (org_id,),
    )
    for ag_id, setup_id, name in cur.fetchall():
        label = str(name or "").strip()
        if ag_id is not None:
            names[int(ag_id)] = label
        if setup_id is not None:
            names.setdefault(int(setup_id), label)
    return names


def existing_ticket_numbers(cur, org_id: int, numbers: list[str]) -> set[str]:
    found: set[str] = set()
    chunk = 1000
    for i in range(0, len(numbers), chunk):
        batch = numbers[i : i + chunk]
        cur.execute(
            """
            SELECT ticket_number
              FROM ticketing.tickets
             WHERE organization_id = %s
               AND ticket_number = ANY(%s)
            """,
            (org_id, batch),
        )
        found.update(str(r[0]) for r in cur.fetchall())
    return found


def insert_ticket_batch(cur, org_id: int, batch: list[dict]) -> dict[str, int]:
    tuples = []
    for rec in batch:
        tuples.append(
            (
                org_id,
                rec["ticket_number"],
                rec["subject"][:255],
                rec["description"],
                rec["customer_id"],
                rec["customer_name"],
                rec["customer_email"],
                rec["customer_phone"],
                rec["channel"],
                rec["assignee_id"],
                rec["assignee_name"],
                rec["resolver_id"],
                rec["resolver_name"],
                rec["queue_id"],
                rec["queue_name"],
                rec["priority"],
                rec["status"],
                rec["due_at"],
                rec["first_response_at"],
                rec["resolved_at"],
                rec["csat_score"],
                rec["csat_rated_at"],
                rec["csat_comment"],
                rec["category"],
                rec["created_by_name"],
                rec["ai_summary"],
                rec["created_at"],
                rec["updated_at"],
            )
        )
    cur.executemany(
        """
        INSERT INTO ticketing.tickets (
          organization_id, ticket_number, subject, description,
          customer_id, customer_name, customer_email, customer_phone,
          channel, assignee_id, assignee_name, resolver_id, resolver_name,
          queue_id, queue_name, priority, status,
          attachments, due_at, first_response_at, resolved_at,
          csat_score, csat_rated_at, csat_comment, category,
          created_by_id, created_by_name, ai_summary, created_at, updated_at
        ) VALUES (
          %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
          '{}',%s,%s,%s,%s,%s,%s,%s,NULL,%s,%s,%s,%s
        )
        """,
        tuples,
    )
    numbers = [r["ticket_number"] for r in batch]
    cur.execute(
        """
        SELECT ticket_number, id
          FROM ticketing.tickets
         WHERE organization_id = %s
           AND ticket_number = ANY(%s)
        """,
        (org_id, numbers),
    )
    return {str(n): int(i) for n, i in cur.fetchall()}


def insert_refs(cur, org_id: int, refs: list[tuple[int, str, str]]) -> int:
    if not refs:
        return 0
    cur.executemany(
        """
        INSERT INTO ticketing.ticket_references (
          organization_id, ticket_id, ref_type, ref_id
        ) VALUES (%s,%s,%s,%s)
        ON CONFLICT (ticket_id, ref_type, ref_id) DO NOTHING
        """,
        [(org_id, tid, rtype, rid) for tid, rtype, rid in refs],
    )
    return len(refs)


def insert_audit(cur, org_id: int, events: list[tuple]) -> int:
    if not events:
        return 0
    cur.executemany(
        """
        INSERT INTO ticketing.audit_events (
          organization_id, actor_id, actor_name, action,
          ticket_id, ticket_number, meta, created_at
        ) VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s)
        """,
        events,
    )
    return len(events)


def recount_totals(cur, org_id: int) -> None:
    cur.execute(
        """
        UPDATE ticketing.contact_profile cp
           SET total_tickets = s.n,
               updated_at = NOW()
          FROM (
                SELECT customer_id, COUNT(*)::int AS n
                  FROM ticketing.tickets
                 WHERE organization_id = %s
                   AND customer_id IS NOT NULL
                 GROUP BY customer_id
          ) s
         WHERE cp.id = s.customer_id
           AND cp.organization_id = %s
        """,
        (org_id, org_id),
    )


def prepare_records(
    raw_rows: list[dict],
    customers: dict[str, dict],
    staff: dict[int, str],
    already: set[str],
) -> tuple[list[dict], list[str], dict[str, int]]:
    prepared: list[dict] = []
    skip_reasons: dict[str, int] = defaultdict(int)
    unmatched: list[str] = []
    seen_unmatched: set[str] = set()

    for row in raw_rows:
        number = _text(row.get("ticket_number"))
        email = _norm_email(row.get("customer_email"))
        if not number:
            skip_reasons["no_ticket_number"] += 1
            continue
        if number in already:
            skip_reasons["already_exists"] += 1
            continue
        if not email:
            skip_reasons["no_email"] += 1
            continue
        person = customers.get(email)
        if not person or not person.get("cdp_id"):
            skip_reasons["email_not_in_cdp"] += 1
            if email not in seen_unmatched:
                seen_unmatched.add(email)
                unmatched.append(email)
            continue
        if not person.get("contact_id"):
            skip_reasons["no_active_contact_profile"] += 1
            if email not in seen_unmatched:
                seen_unmatched.add(email)
                unmatched.append(email)
            continue
        subject = _text(row.get("subject")) or "Untitled"
        desc = _text(row.get("description")) or "No description provided."
        assignee_id = _int_or_none(row.get("assignee_id"))
        resolver_id = _int_or_none(row.get("resolver_id"))
        created_by = _text(row.get("created_by"))
        prepared.append(
            {
                "ticket_number": number,
                "subject": subject,
                "description": desc,
                "customer_id": person["contact_id"],
                "customer_name": person["name"] or created_by or email,
                "customer_email": email,
                "customer_phone": person["phone"],
                "channel": _text(row.get("channel")) or "Web",
                "assignee_id": assignee_id,
                "assignee_name": (
                    staff.get(assignee_id) if assignee_id is not None else None
                )
                or "Unassigned",
                "resolver_id": resolver_id,
                "resolver_name": (
                    staff.get(resolver_id) if resolver_id is not None else None
                )
                or None,
                "queue_id": _int_or_none(row.get("queue_id")),
                "queue_name": _text(row.get("queue_name")) or None,
                "priority": _text(row.get("priority")) or "medium",
                "status": _text(row.get("status")) or "Open",
                "due_at": _ts(row.get("due_at")),
                "first_response_at": _ts(row.get("first_response_at")),
                "resolved_at": _ts(row.get("resolved_at")),
                "csat_score": _int_or_none(row.get("csat_score")),
                "csat_rated_at": _ts(row.get("csat_rated_at")),
                "csat_comment": _text(row.get("csat_comment")) or None,
                "category": _text(row.get("category")) or None,
                "created_by_name": created_by or None,
                "ai_summary": seed_ai_summary(row),
                "created_at": _ts(row.get("created_at")) or datetime.now(timezone.utc),
                "updated_at": _ts(row.get("updated_at")) or datetime.now(timezone.utc),
                "order_id": _text(row.get("order_id")),
                "product_id": _text(row.get("product_id")),
                "cdp_id": person["cdp_id"],
            }
        )
    return prepared, unmatched, dict(skip_reasons)


def build_audit(org_id: int, rec: dict, ticket_id: int) -> list[tuple]:
    events: list[tuple] = []
    created = rec["created_at"]
    actor = rec["assignee_name"] if rec["assignee_name"] != "Unassigned" else rec["created_by_name"]
    events.append(
        (
            org_id,
            rec["assignee_id"],
            actor,
            "ticket.created",
            ticket_id,
            rec["ticket_number"],
            json.dumps({}),
            created,
        )
    )
    if rec["assignee_id"]:
        events.append(
            (
                org_id,
                rec["assignee_id"],
                rec["assignee_name"],
                "ticket.assigned",
                ticket_id,
                rec["ticket_number"],
                json.dumps({"to": rec["assignee_name"]}),
                created,
            )
        )
    if rec["resolver_id"]:
        events.append(
            (
                org_id,
                rec["resolver_id"],
                rec["resolver_name"],
                "ticket.resolver_set",
                ticket_id,
                rec["ticket_number"],
                json.dumps({"to": rec["resolver_name"]}),
                rec["resolved_at"] or created,
            )
        )
    status = rec["status"]
    if status and status.lower() not in {"open", "new"}:
        events.append(
            (
                org_id,
                rec["resolver_id"] or rec["assignee_id"],
                rec["resolver_name"] or rec["assignee_name"],
                "ticket.status_changed",
                ticket_id,
                rec["ticket_number"],
                json.dumps({"to": status}),
                rec["resolved_at"] or rec["updated_at"] or created,
            )
        )
    return events


def main() -> int:
    parser = argparse.ArgumentParser(description="Silent org-1012 JSONL ticket load")
    parser.add_argument("--file", type=Path, default=None)
    parser.add_argument("--org-id", type=int, default=1012)
    parser.add_argument("--apply", action="store_true", help="Write rows (default is dry-run)")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--batch-size", type=int, default=250)
    parser.add_argument("--skip-audit", action="store_true")
    args = parser.parse_args()

    _load_dotenv()
    path = _resolve_jsonl(args.file)
    raw = read_jsonl(path, args.limit)
    emails = sorted({_norm_email(r.get("customer_email")) for r in raw if _norm_email(r.get("customer_email"))})
    numbers = [_text(r.get("ticket_number")) for r in raw if _text(r.get("ticket_number"))]

    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM accounts.organizations WHERE id = %s",
                (args.org_id,),
            )
            if not cur.fetchone():
                raise SystemExit(f"organization {args.org_id} not found in accounts.organizations")
            customers = resolve_customers(cur, args.org_id, emails)
            to_link = missing_cdp_ids(customers)
            staff = load_staff(cur, args.org_id)
            already = existing_ticket_numbers(cur, args.org_id, numbers)

            matched_cdp = sum(1 for e in emails if customers.get(e, {}).get("cdp_id"))
            matched_contact = sum(1 for e in emails if customers.get(e, {}).get("contact_id"))
            print(f"file={path}")
            print(f"org_id={args.org_id}")
            print(f"jsonl_rows={len(raw)} unique_emails={len(emails)}")
            print(f"cdp_email_hits={matched_cdp} active_contact_hits={matched_contact}")
            print(f"spoke_links_needed={len(to_link)}")
            print(f"already_in_tickets={len(already)}")

            if not args.apply:
                print("dry-run only; pass --apply to write")
                conn.rollback()
                return 0

            linked = ensure_contact_profiles(cur, args.org_id, to_link)
            conn.commit()
            print(f"spoke_links_created={linked}")
            customers = resolve_customers(cur, args.org_id, emails)
            prepared, unmatched, skips = prepare_records(raw, customers, staff, already)
            print(f"ready_to_insert={len(prepared)}")
            print(f"skips={skips}")
            if unmatched:
                print(f"unmatched_emails={len(unmatched)} sample={unmatched[:15]}")
            if prepared:
                sample = prepared[0]
                print(
                    "sample "
                    f"{sample['ticket_number']} customer_id={sample['customer_id']} "
                    f"cdp_id={sample['cdp_id']}"
                )
                print(f"sample_ai_summary={sample['ai_summary']}")

            inserted = 0
            refs_n = 0
            audit_n = 0
            size = max(1, args.batch_size)
            for i in range(0, len(prepared), size):
                chunk = prepared[i : i + size]
                ids = insert_ticket_batch(cur, args.org_id, chunk)
                refs: list[tuple[int, str, str]] = []
                events: list[tuple] = []
                for rec in chunk:
                    tid = ids.get(rec["ticket_number"])
                    if not tid:
                        continue
                    inserted += 1
                    if rec["order_id"]:
                        refs.append((tid, "order", rec["order_id"]))
                    if rec["product_id"]:
                        refs.append((tid, "product", rec["product_id"]))
                    if not args.skip_audit:
                        events.extend(build_audit(args.org_id, rec, tid))
                refs_n += insert_refs(cur, args.org_id, refs)
                if not args.skip_audit:
                    audit_n += insert_audit(cur, args.org_id, events)
                conn.commit()
                print(f"committed {min(i + size, len(prepared))}/{len(prepared)}")

            recount_totals(cur, args.org_id)
            conn.commit()
            print(f"inserted_tickets={inserted} references={refs_n} audit_events={audit_n}")
            return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
