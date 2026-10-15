#!/usr/bin/env python3
"""
WhatsApp template helpers via social-service:
  1) submit template for Meta approval
  2) check approval status
  3) send approved template
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# Default ngrok gateway base (override with SOCIAL_BASE_URL, e.g. http://localhost:3004)
BASE_URL = os.environ.get(
    "SOCIAL_BASE_URL",
    "https://uninvited-skinless-eel.ngrok-free.dev",
).rstrip("/")
SERVICE_KEY = "dev-internal-key"
CHANNEL_CONFIG_ID = "454094b7-4a9a-43b0-b4cd-59663a8f1a06"


def headers() -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "x-internal-service-key": SERVICE_KEY,
        "ngrok-skip-browser-warning": "true",
    }


def request_json(
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
) -> tuple[int, Any]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = Request(f"{BASE_URL}{path}", data=data, headers=headers(), method=method)
    try:
        with urlopen(req, timeout=90) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, (json.loads(raw) if raw else {})
    except HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(err) if err else {"error": err}
        except json.JSONDecodeError:
            parsed = {"error": err}
        return e.code, parsed
    except URLError as e:
        raise SystemExit(f"Request failed: {e}") from e


def submit_payload(name: str, language: str, category: str) -> dict[str, Any]:
    # Keep BODY static (no {{n}} vars) unless you also send Meta example values.
    return {
        "channelConfigId": CHANNEL_CONFIG_ID,
        "name": name,
        "language": language,
        "category": category,
        "components": [
            {
                "type": "BODY",
                "text": "Thanks for contacting Worktual. How can we help you today?",
            }
        ],
    }


def submit_template(
    name: str = "worktual_help_test",
    language: str = "en",
    category: str = "UTILITY",
) -> tuple[int, Any, dict[str, Any]]:
    payload = submit_payload(name, language, category)
    status, body = request_json(
        "POST",
        "/internal/v1/whatsapp/templates/submit-approval",
        payload,
    )
    return status, body, payload


def approval_status(
    template_name: str | None = None,
    template_id: str | None = None,
    language: str | None = None,
) -> tuple[int, Any, str]:
    params: dict[str, str] = {"channelConfigId": CHANNEL_CONFIG_ID}
    if template_name:
        params["templateName"] = template_name
    if template_id:
        params["templateId"] = template_id
    if language:
        params["language"] = language
    if "templateName" not in params and "templateId" not in params:
        raise SystemExit("Provide --name or --id")
    query = urlencode(params)
    path = f"/internal/v1/whatsapp/templates/approval-status?{query}"
    status, body = request_json("GET", path)
    return status, body, path


def send_template(
    to: str,
    template_name: str,
    language_code: str = "en",
    body_params: list[str] | None = None,
) -> tuple[int, Any, dict[str, Any]]:
    payload: dict[str, Any] = {
        "channelConfigId": CHANNEL_CONFIG_ID,
        "to": to,
        "templateName": template_name,
        "languageCode": language_code,
    }
    if body_params:
        payload["components"] = [
            {
                "type": "body",
                "parameters": [{"type": "text", "text": p} for p in body_params],
            }
        ]
    status, body = request_json("POST", "/internal/v1/whatsapp/templates", payload)
    return status, body, payload


def main() -> None:
    parser = argparse.ArgumentParser(description="WhatsApp template API helper")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_submit = sub.add_parser("submit", help="Submit template for Meta approval")
    p_submit.add_argument("--name", default="worktual_api_test")
    p_submit.add_argument("--language", default="en")
    p_submit.add_argument(
        "--category",
        default="UTILITY",
        choices=["MARKETING", "UTILITY", "AUTHENTICATION"],
    )

    p_status = sub.add_parser("status", help="Check template approval status")
    p_status.add_argument("--name")
    p_status.add_argument("--id")
    p_status.add_argument("--language")

    p_send = sub.add_parser("send", help="Send approved template")
    p_send.add_argument("--to", required=True)
    p_send.add_argument("--name", required=True)
    p_send.add_argument("--language", default="en")
    p_send.add_argument("--body", nargs="*", default=["Tester", "API check"])

    args = parser.parse_args()

    if args.cmd == "submit":
        code, result, _ = submit_template(args.name, args.language, args.category)
    elif args.cmd == "status":
        code, result, _ = approval_status(args.name, args.id, args.language)
    else:
        code, result, _ = send_template(args.to, args.name, args.language, args.body)

    print(json.dumps({"httpStatus": code, "body": result}, indent=2))
    sys.exit(0 if 200 <= code < 300 else 1)


if __name__ == "__main__":
    main()
