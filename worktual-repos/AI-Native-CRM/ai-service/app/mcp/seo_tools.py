"""SEO MCP tool handlers — read crm.seo_* cache (first project only)."""

from __future__ import annotations

import json
import uuid
from typing import Any
from urllib.parse import urlparse

from app.mcp import db
from app.mcp.context import get_ctx
from app.crm_client import CrmClient

# Query-path analysis snapshots only (projects is ingest/list, not analysis).
ALLOWED_SNAPSHOT_TOOLS = frozenset(
    {
        "keyword_research",
        "organic_research",
        "competitors_research",
        "position_tracking",
        "audience_research",
        "site_audit",
        "backlinks_research",
        "traffic_overview",
        "paid_search_research",
        "domain_overview",
    }
)


def _str(v: Any) -> str:
    return str(v or "").strip()


def _ok(text: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "ok": True,
        "kind": "executed",
        "assistantText": text,
        "data": data or {},
    }


def _fail(error: str) -> dict[str, Any]:
    return {"ok": False, "kind": "error", "error": error}


def _normalize_domain(raw: str) -> str | None:
    text = _str(raw).lower()
    if not text:
        return None
    if "://" in text:
        host = urlparse(text).hostname
        return host.lstrip("www.") if host else None
    text = text.replace("www.", "", 1) if text.startswith("www.") else text
    return text.split("/")[0].split("?")[0] or None


async def _first_project(org: str) -> dict[str, Any] | None:
    row = await db.fetchrow(
        """
        SELECT id, external_project_id, domain, market, synced_at
        FROM seo_projects
        WHERE organization_id = $1::bigint
        ORDER BY created_at ASC, id ASC
        LIMIT 1
        """,
        int(org),
    )
    if not row:
        return None
    return {
        "id": row["id"],
        "projectId": row["external_project_id"],
        "domain": row["domain"],
        "market": row["market"] or "in",
        "syncedAt": row["synced_at"].isoformat() if row["synced_at"] else None,
    }


async def handle_seo_tool(name: str, args: dict[str, Any]) -> dict[str, Any] | None:
    if not name.startswith("seo_"):
        return None
    org = _str(get_ctx().organization_id)
    if not org:
        return _fail("Organization context required for SEO tools.")

    if name == "seo_list_projects":
        first = await _first_project(org)
        if not first:
            return _ok(
                "No connected Semrush project is cached yet. SEO chat can only use the first project after the weekly sync — do not ask the user for another website.",
                {"projects": []},
            )
        domain = first.get("domain") or first["projectId"]
        return _ok(
            f"Using the connected Semrush project only: {domain}.",
            {"projects": [first], "defaultProjectId": first["projectId"]},
        )

    if name == "seo_get_snapshots":
        first = await _first_project(org)
        if not first:
            return _fail(
                "No connected Semrush project is cached yet. Wait for the weekly sync — do not look up another website."
            )
        project_id = first["projectId"]
        tool_name = _str(args.get("toolName")) or None
        rows = await db.fetch(
            """
            SELECT tool_name, payload, error, fetched_at
            FROM seo_tool_snapshots
            WHERE organization_id = $1::bigint
              AND external_project_id = $2
              AND ($3::text IS NULL OR tool_name = $3)
            ORDER BY tool_name
            """,
            int(org),
            project_id,
            tool_name,
        )
        snapshots = [
            {
                "toolName": r["tool_name"],
                "payload": _json_val(r["payload"]),
                "error": r["error"],
                "fetchedAt": r["fetched_at"].isoformat() if r["fetched_at"] else None,
            }
            for r in rows
            if str(r["tool_name"] or "").lower() in ALLOWED_SNAPSHOT_TOOLS
            and (not tool_name or str(r["tool_name"] or "").lower() == tool_name.lower())
        ]
        errors = [s for s in snapshots if s.get("error")]
        return _ok(
            f"Loaded {len(snapshots)} tool snapshot(s)"
            + (f" ({len(errors)} with errors)." if errors else "."),
            {
                "projectId": project_id,
                "domain": first.get("domain"),
                "snapshots": snapshots,
            },
        )

    if name == "seo_report_progress":
        stage = _str(args.get("stage")) or "domain_analysis"
        label = _str(args.get("label")) or stage.replace("_", " ").title()
        detail = _str(args.get("detail"))
        get_ctx().note_refresh(
            modules=["marketing"],
            reason="seo_progress",
            seo_progress={"stage": stage, "label": label, "detail": detail or None},
        )
        return _ok(
            "Progress noted. Continue with the matching Digital Marketing tool "
            "(seo_research_keywords, seo_save_generated_content, or seo_repurpose_social).",
            {"stage": stage, "label": label},
        )

    if name == "seo_list_generated_content":
        content_type = _str(args.get("contentType")) or None
        search = _str(args.get("search")) or None
        limit = args.get("limit")
        lim = int(limit) if isinstance(limit, int) and limit > 0 else 20
        lim = min(lim, 100)
        rows = await db.fetch(
            """
            SELECT id, content_type, title, slug, seo_score, project_id, updated_at
            FROM seo_generated_content
            WHERE organization_id = $1::bigint
              AND ($2::text IS NULL OR content_type = $2)
              AND (
                $3::text IS NULL
                OR title ILIKE '%' || $3 || '%'
                OR coalesce(slug, '') ILIKE '%' || $3 || '%'
              )
            ORDER BY updated_at DESC
            LIMIT $4
            """,
            int(org),
            content_type,
            search,
            lim,
        )
        items = [
            {
                "id": r["id"],
                "contentType": r["content_type"],
                "title": r["title"],
                "slug": r["slug"],
                "seoScore": r["seo_score"],
                "projectId": r["project_id"],
                "updatedAt": r["updated_at"].isoformat() if r["updated_at"] else None,
            }
            for r in rows
        ]
        return _ok(f"{len(items)} saved content item(s).", {"items": items})

    if name == "seo_get_generated_content":
        cid = _str(args.get("id"))
        if not cid:
            return _fail("id is required")
        row = await db.fetchrow(
            """
            SELECT * FROM seo_generated_content
            WHERE organization_id = $1::bigint AND id = $2
            LIMIT 1
            """,
            int(org),
            cid,
        )
        if not row:
            return _fail("Content not found")
        item = {
            "id": row["id"],
            "contentType": row["content_type"],
            "title": row["title"],
            "slug": row["slug"],
            "seoScore": row["seo_score"],
            "projectId": row["project_id"],
            "body": _json_val(row["body"]),
            "updatedAt": row["updated_at"].isoformat() if row["updated_at"] else None,
        }
        get_ctx().note_refresh(
            modules=["marketing"],
            reason="seo_content",
            seo_content=item,
        )
        return _ok("Loaded content package.", {"item": item})

    if name == "seo_save_generated_content":
        content_type = _str(args.get("contentType"))
        title = _str(args.get("title"))
        raw_body = args.get("body")
        if isinstance(raw_body, str):
            raw_body = _json_val(raw_body)
        body = raw_body if isinstance(raw_body, dict) else {}
        if not content_type or not title:
            return _fail("contentType and title are required")
        blog = body.get("blog") if isinstance(body.get("blog"), dict) else {}
        markdown = _str(blog.get("markdown") or body.get("markdown"))
        if content_type in {"package", "blog", "landing"} and len(markdown) < 200:
            return _fail(
                "body.blog.markdown is required (at least 200 characters). "
                "Put the full article in that field and call this tool again."
            )
        cid = _str(args.get("id")) or f"seoc_{uuid.uuid4().hex[:16]}"
        user = _str(get_ctx().acting_user_id) or None
        user_id = int(user) if user and user.isdigit() else None
        score = args.get("seoScore")
        seo_score = int(score) if isinstance(score, int) else None
        first = await _first_project(org)
        bound_project = (first or {}).get("projectId") or None
        keyword_query_id = _str(args.get("keywordQueryId")) or None
        primary_keyword = _str(args.get("primaryKeyword")) or None
        campaign_id = _str(args.get("campaignId")) or None
        status = _str(args.get("status")) or "draft"
        if not keyword_query_id and cid:
            existing = await db.fetchrow(
                """
                SELECT keyword_query_id FROM seo_generated_content
                WHERE organization_id = $1::bigint AND id = $2
                LIMIT 1
                """,
                int(org),
                cid,
            )
            if existing and existing["keyword_query_id"]:
                keyword_query_id = str(existing["keyword_query_id"])
        if not keyword_query_id:
            return _fail(
                "keywordQueryId is required. Call seo_research_keywords first and "
                "save content from that cached query — never invent Semrush volumes."
            )
        await db.execute(
            """
            INSERT INTO seo_generated_content (
              id, organization_id, user_id, project_id, content_type, title, slug, seo_score, body,
              status, campaign_id, primary_keyword, keyword_query_id, created_at, updated_at
            ) VALUES (
              $1, $2::bigint, $3::bigint, $4, $5, $6, $7, $8, $9::jsonb,
              $10, $11, $12, $13, NOW(), NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              project_id = EXCLUDED.project_id,
              content_type = EXCLUDED.content_type,
              title = EXCLUDED.title,
              slug = EXCLUDED.slug,
              seo_score = EXCLUDED.seo_score,
              body = EXCLUDED.body,
              status = EXCLUDED.status,
              campaign_id = EXCLUDED.campaign_id,
              primary_keyword = EXCLUDED.primary_keyword,
              keyword_query_id = EXCLUDED.keyword_query_id,
              updated_at = NOW()
            """,
            cid,
            int(org),
            user_id,
            bound_project,
            content_type,
            title,
            _str(args.get("slug")) or None,
            seo_score,
            json.dumps(body),
            status,
            campaign_id,
            primary_keyword,
            keyword_query_id,
        )
        item = {
            "id": cid,
            "contentType": content_type,
            "title": title,
            "slug": _str(args.get("slug")) or None,
            "seoScore": seo_score,
            "projectId": bound_project,
            "body": body,
            "status": status,
            "campaignId": campaign_id,
            "primaryKeyword": primary_keyword,
            "keywordQueryId": keyword_query_id,
        }
        get_ctx().note_refresh(
            modules=["marketing"],
            reason="seo_content",
            seo_content=item,
            seo_progress={"stage": "done", "label": "Content ready"},
        )
        return _ok("Saved Digital Marketing content.", {"item": item})

    if name == "seo_request_ad_hoc_sync":
        first = await _first_project(org)
        if not first:
            return _fail(
                "No connected Semrush project is cached yet. Live website lookup is not allowed — wait for the weekly first-project sync."
            )
        allowed = _normalize_domain(_str(first.get("domain"))) or _str(
            first.get("projectId")
        )
        requested = _normalize_domain(_str(args.get("website")))
        if requested and allowed and requested != allowed:
            return _ok(
                f"SEO only uses the connected Semrush project ({allowed}). Other websites are not fetched. Continue from cache for {allowed}.",
                {
                    "refusedWebsite": requested,
                    "projects": [first],
                    "defaultProjectId": first["projectId"],
                    "domain": allowed,
                },
            )
        return _ok(
            f"Using cached Semrush data for {allowed} only. No live MCP fetch.",
            {
                "projects": [first],
                "defaultProjectId": first["projectId"],
                "domain": allowed,
            },
        )

    if name == "seo_research_keywords":
        seed = _str(args.get("seed") or args.get("topic") or args.get("keyword"))
        if not seed:
            return _fail("seed is required for keyword research.")
        location = _str(args.get("location")) or "us"
        language = _str(args.get("language")) or "en"
        filters = args.get("filters") if isinstance(args.get("filters"), dict) else {}
        try:
            crm = CrmClient(organization_id=org)
            data = await crm.research_seo_keywords(
                {
                    "organizationId": org,
                    "userId": _str(get_ctx().acting_user_id) or None,
                    "seed": seed,
                    "location": location,
                    "language": language,
                    "filters": filters,
                }
            )
        except Exception as exc:
            return _fail(f"Keyword research failed: {exc}")
        payload = data.get("data") if isinstance(data.get("data"), dict) else data
        ok = bool(payload.get("ok"))
        rows = payload.get("rows") if isinstance(payload.get("rows"), list) else []
        query = payload.get("query") if isinstance(payload.get("query"), dict) else {}
        error = _str(payload.get("error") or data.get("message"))
        get_ctx().note_refresh(
            modules=["marketing"],
            reason="seo_keywords",
            seo_keywords={
                "queryId": query.get("id"),
                "cacheHit": bool(payload.get("cacheHit")),
                "rows": rows,
                "error": error or None,
            },
            seo_progress={
                "stage": "keyword_research" if ok else "error",
                "label": "Keywords ready" if ok else "Keyword research failed",
                "detail": error or None,
            },
        )
        if not ok:
            return _fail(
                error
                or "Keyword research failed. The Keywords table is empty — do not invent extra volumes."
            )
        cache_hit = bool(payload.get("cacheHit"))
        qid = query.get("id")
        source = str(payload.get("source") or "").lower()
        has_semrush = source == "semrush" or any(
            isinstance(r, dict) and str(r.get("source") or "") == "semrush"
            for r in rows
        )
        llm = (not has_semrush) and (
            source == "llm"
            or any(
                isinstance(r, dict) and str(r.get("source") or "") == "llm_estimate"
                for r in rows
            )
        )
        top = next(
            (
                str(row.get("term") or row.get("keyword") or "").strip()
                for row in rows
                if isinstance(row, dict)
            ),
            "",
        )
        hint = f" Strongest row: {top}." if top else ""
        return _ok(
            f"Keyword research ready ({len(rows)} rows). Results are in the "
            f"Keyword Generation table.{hint} Speak conversationally; do not "
            "list volumes or data sources in chat.",
            {
                "queryId": qid,
                "cacheHit": cache_hit,
                "source": "llm" if llm else "semrush",
                "rows": rows,
            },
        )

    if name == "seo_repurpose_social":
        content_id = _str(args.get("contentId") or args.get("id"))
        if not content_id:
            return _fail("contentId is required.")
        user = _str(get_ctx().acting_user_id) or None
        user_id = int(user) if user and user.isdigit() else None
        posts_arg = args.get("posts")
        from app.services.seo_social_generate import generate_and_persist_social_posts

        result = await generate_and_persist_social_posts(
            organization_id=org,
            user_id=user_id,
            content_id=content_id,
            platform=_str(args.get("platform")) or None,
            linkedin_count=args.get("linkedinCount"),
            facebook_count=args.get("facebookCount"),
            instagram_count=args.get("instagramCount"),
            posts=posts_arg if isinstance(posts_arg, list) else None,
        )
        if not result.get("ok"):
            return _fail(
                str(result.get("error") or "Could not generate social posts.")
            )
        slim_items = result.get("items") if isinstance(result.get("items"), list) else []
        get_ctx().note_refresh(
            modules=["marketing"],
            reason="seo_social",
            seo_social={"contentId": content_id, "items": slim_items},
            seo_progress={"stage": "repurpose_formats", "label": "Social posts ready"},
        )
        return _ok(
            str(
                result.get("assistantText")
                or "Social posts are ready on the Social Media Post tab."
            ),
            {
                "items": slim_items,
                "counts": result.get("counts") or {},
                "images": result.get("images") or 0,
            },
        )

    if name == "seo_list_social_posts":
        content_id = _str(args.get("contentId")) or None
        platform = _str(args.get("platform")) or None
        rows = await db.fetch(
            """
            SELECT * FROM seo_social_posts
            WHERE organization_id = $1::bigint
              AND ($2::text IS NULL OR content_id = $2)
              AND ($3::text IS NULL OR platform = $3)
            ORDER BY updated_at DESC
            LIMIT 100
            """,
            int(org),
            content_id,
            platform,
        )
        items = [
            {
                "id": r["id"],
                "contentId": r["content_id"],
                "platform": r["platform"],
                "postType": r["post_type"],
                "copy": _json_val(r["copy"]),
                "status": r["status"],
                "scheduledAt": r["scheduled_at"].isoformat() if r["scheduled_at"] else None,
                "publishedAt": r["published_at"].isoformat() if r["published_at"] else None,
                "lastError": r["last_error"],
            }
            for r in rows
        ]
        return _ok(f"{len(items)} social post(s).", {"items": items})

    if name == "seo_schedule_post":
        post_id = _str(args.get("id") or args.get("postId"))
        when = _str(args.get("scheduledAt"))
        if not post_id or not when:
            return _fail("id and scheduledAt are required.")
        row = await db.fetchrow(
            """
            UPDATE seo_social_posts
            SET status = 'scheduled', scheduled_at = $3::timestamptz, updated_at = NOW()
            WHERE organization_id = $1::bigint AND id = $2
            RETURNING *
            """,
            int(org),
            post_id,
            when,
        )
        if not row:
            return _fail("Post not found")
        item = {
            "id": row["id"],
            "status": row["status"],
            "scheduledAt": row["scheduled_at"].isoformat() if row["scheduled_at"] else None,
        }
        get_ctx().note_refresh(
            modules=["marketing"],
            reason="seo_social",
            seo_social={"item": item},
        )
        return _ok("Scheduled. Publish runs when due if Accounts tokens exist.", {"item": item})

    if name == "seo_publish_post":
        post_id = _str(args.get("id") or args.get("postId"))
        if not post_id:
            return _fail("id is required.")
        try:
            crm = CrmClient(organization_id=org)
            data = await crm.publish_seo_social_post(org, post_id)
        except Exception as exc:
            return _fail(f"Publish failed: {exc}")
        payload = data.get("data") if isinstance(data.get("data"), dict) else data
        ok = bool(payload.get("ok"))
        post = payload.get("post") if isinstance(payload.get("post"), dict) else {}
        error = _str(payload.get("error"))
        get_ctx().note_refresh(
            modules=["marketing"],
            reason="seo_social",
            seo_social={"item": post, "error": error or None},
        )
        if not ok:
            return _fail(
                error
                or "Publish is unavailable until Accounts connects org LinkedIn/Facebook/Instagram."
            )
        return _ok("Published.", {"item": post})

    return _fail(f"Unknown SEO tool: {name}")


def _json_val(raw: Any) -> Any:
    if raw is None:
        return None
    if isinstance(raw, (dict, list)):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw
    return raw
