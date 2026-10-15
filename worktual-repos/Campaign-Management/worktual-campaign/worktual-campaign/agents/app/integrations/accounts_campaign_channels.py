"""My Accounts campaign-channels client (App Push + Web Push).

Customers configure FCM/APNs/VAPID in Setup → Channel Setup. Campaign reads
list + credentials APIs and must not copy secrets into
``campaign.push_channel_settings``.

Auth (one of): Bearer PRODUCT_MCP_CONNECTORS_TOKEN, x-product-mcp-token, or
x-internal-service-key.

This module is the mapping source of truth; the Campaign TS send worker uses a
thin HTTP adapter with the same field names.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.config import get_settings

SETUP_APP_PUSH_PATH = "/customer/setup/communication/app-push/new"
SETUP_WEB_PUSH_PATH = "/customer/setup/communication/web-push/new"

INACTIVE = "channel_inactive"
NOT_CONFIGURED = "not_configured"
NEEDS_REAUTH = "needs_reauth"


class AccountsChannelError(Exception):
    def __init__(
        self,
        message: str,
        *,
        status_code: int = 400,
        code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code or ""


def accounts_configured(base_url: str | None = None) -> bool:
    settings = get_settings()
    url = (base_url if base_url is not None else settings.accounts_api_base_url) or ""
    return bool(url.strip())


def campaign_status_from_accounts_channel(
    channel: dict[str, Any] | None,
    *,
    kind: str,
) -> str:
    """Map a list-API channel object to Campaign UI status."""
    if not channel:
        return "not_started"
    st = str(channel.get("status") or "").strip().lower()
    if st == "inactive":
        return "blocked"
    if st == "pending":
        return "in_progress"
    if st != "active":
        return "not_started"

    if kind == "web_push":
        vapid = bool(channel.get("vapidConfigured") or channel.get("vapidPublicKey"))
        return "ready" if vapid else "in_progress"

    platform = str(channel.get("platform") or "both").strip().lower()
    fcm = bool(channel.get("fcmConfigured"))
    apns = bool(channel.get("apnsConfigured"))
    if platform == "android":
        return "ready" if fcm else "in_progress"
    if platform == "ios":
        return "ready" if apns else "in_progress"
    if fcm and apns:
        return "ready"
    return "in_progress"


def sendable_accounts_status(status: str) -> bool:
    return str(status or "").strip().lower() == "ready"


def map_app_push_credentials(credentials: dict[str, Any]) -> dict[str, str]:
    """Map Accounts credentials JSON to the in-memory send settings shape."""
    sa = credentials.get("fcmServiceAccount")
    sa_obj = sa if isinstance(sa, dict) else {}
    platform = str(credentials.get("platform") or "both").strip().lower()
    if platform == "android":
        provider = "fcm"
    elif platform == "ios":
        provider = "apns"
    else:
        provider = "both"
    private_key = str(sa_obj.get("private_key") or "").replace("\\n", "\n").strip()
    return {
        "app_display_name": str(credentials.get("name") or "").strip(),
        "provider": provider,
        "fcm_project_id": str(
            sa_obj.get("project_id") or credentials.get("fcmProjectId") or ""
        ).strip(),
        "fcm_client_email": str(sa_obj.get("client_email") or "").strip(),
        "fcm_private_key": private_key,
        "fcm_server_key": "",
        "apns_key_id": str(credentials.get("apnsKeyId") or "").strip(),
        "apns_team_id": str(credentials.get("apnsTeamId") or "").strip(),
        "apns_bundle_id": str(
            credentials.get("apnsBundleId") or credentials.get("iosBundleId") or ""
        ).strip(),
        "apns_key_p8": str(credentials.get("apnsKey") or "").strip(),
        "apns_environment": str(
            credentials.get("apnsEnvironment") or "production"
        ).strip().lower(),
        "default_icon_url": str(credentials.get("defaultIconUrl") or "").strip(),
        "default_click_url": str(credentials.get("defaultClickUrl") or "").strip(),
    }


def map_web_push_credentials(credentials: dict[str, Any]) -> dict[str, str]:
    return {
        "vapid_subject": str(
            credentials.get("vapidSubject") or credentials.get("vapid_subject") or ""
        ).strip(),
        "vapid_public_key": str(
            credentials.get("vapidPublicKey") or credentials.get("vapid_public_key") or ""
        ).strip(),
        "vapid_private_key": str(
            credentials.get("vapidPrivateKey") or credentials.get("vapid_private_key") or ""
        ).strip(),
        "default_icon_url": str(
            credentials.get("defaultIconUrl") or credentials.get("default_icon_url") or ""
        ).strip(),
        "default_click_url": str(
            credentials.get("defaultClickUrl") or credentials.get("default_click_url") or ""
        ).strip(),
        "app_display_name": str(credentials.get("name") or "").strip(),
    }


def app_push_checklist(channel: dict[str, Any]) -> dict[str, bool]:
    platform = str(channel.get("platform") or "both").strip().lower()
    fcm = bool(channel.get("fcmConfigured"))
    apns = bool(channel.get("apnsConfigured"))
    return {
        "app_display_name": bool(str(channel.get("name") or "").strip()),
        "provider_set": True,
        "fcm_configured": fcm,
        "fcm_http_v1": fcm,
        "fcm_ready": True if platform == "ios" else fcm,
        "apns_configured": apns,
        "apns_ready": True if platform == "android" else apns,
    }


def web_push_checklist(channel: dict[str, Any]) -> dict[str, bool]:
    return {
        "vapid_subject": bool(str(channel.get("vapidSubject") or "").strip()),
        "vapid_public_key": bool(str(channel.get("vapidPublicKey") or "").strip()),
        "vapid_private_key": bool(channel.get("vapidConfigured")),
        "site_origin": False,
    }


def user_message_for_accounts_error(code: str, kind: str) -> str:
    label = "App Push" if kind == "app_push" else "Web Push"
    if code == NOT_CONFIGURED:
        return (
            f"{label} is not set up yet. Complete it in My Accounts → Setup → Channel Setup."
        )
    if code == INACTIVE:
        return (
            f"{label} is inactive. Activate it in My Accounts → Setup → Channel Setup."
        )
    if code == NEEDS_REAUTH:
        return (
            f"{label} keys could not be decrypted. Re-upload credentials in "
            "My Accounts → Setup → Channel Setup."
        )
    return f"{label} credentials are not available from My Accounts."


def _auth_headers() -> dict[str, str]:
    settings = get_settings()
    token = (settings.product_mcp_connectors_token or "").strip()
    internal = (settings.internal_service_key or "").strip()
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
        headers["x-product-mcp-token"] = token
    elif internal:
        headers["x-internal-service-key"] = internal
    else:
        raise AccountsChannelError(
            "My Accounts service token is not configured "
            "(PRODUCT_MCP_CONNECTORS_TOKEN or INTERNAL_SERVICE_KEY).",
            status_code=500,
            code="accounts_not_configured",
        )
    return headers


def _base_url() -> str:
    url = (get_settings().accounts_api_base_url or "").strip().rstrip("/")
    if not url:
        raise AccountsChannelError(
            "ACCOUNTS_API_BASE_URL is not set.",
            status_code=500,
            code="accounts_not_configured",
        )
    return url


def _parse_error_body(payload: Any, status: int) -> tuple[str, str]:
    if isinstance(payload, dict):
        code = str(payload.get("code") or "").strip()
        msg = str(payload.get("error") or payload.get("message") or "").strip()
        if msg or code:
            return code, msg
    return "", f"My Accounts error ({status})"


async def _get_json(path: str, organization_id: str) -> Any:
    url = f"{_base_url()}{path}"
    params = {"organization_id": str(organization_id).strip()}
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.get(url, params=params, headers=_auth_headers())
    payload: Any = None
    try:
        payload = res.json() if res.content else None
    except Exception:
        payload = None
    if res.status_code >= 400:
        code, msg = _parse_error_body(payload, res.status_code)
        raise AccountsChannelError(
            msg or f"My Accounts error ({res.status_code})",
            status_code=res.status_code,
            code=code or None,
        )
    return payload


async def list_push_channel(organization_id: str, kind: str) -> dict[str, Any] | None:
    """Return the first list item, or None when not configured."""
    path = (
        f"/api/v1/internal/campaign-channels/"
        f"{'app-push' if kind == 'app_push' else 'web-push'}"
    )
    try:
        payload = await _get_json(path, organization_id)
    except AccountsChannelError as exc:
        if exc.status_code == 404 or exc.code == NOT_CONFIGURED:
            return None
        raise
    channels = payload.get("channels") if isinstance(payload, dict) else None
    if not isinstance(channels, list) or not channels:
        return None
    first = channels[0]
    return first if isinstance(first, dict) else None


async def get_push_credentials(organization_id: str, kind: str) -> dict[str, str]:
    path = (
        f"/api/v1/internal/campaign-channels/"
        f"{'app-push' if kind == 'app_push' else 'web-push'}/credentials"
    )
    try:
        payload = await _get_json(path, organization_id)
    except AccountsChannelError as exc:
        label_kind = "app_push" if kind == "app_push" else "web_push"
        if exc.code in {NOT_CONFIGURED, INACTIVE, NEEDS_REAUTH} or exc.status_code in {
            404,
            409,
        }:
            code = exc.code or (
                INACTIVE if exc.status_code == 409 else NOT_CONFIGURED
            )
            raise AccountsChannelError(
                user_message_for_accounts_error(code, label_kind),
                status_code=exc.status_code,
                code=code,
            ) from exc
        raise
    creds = payload.get("credentials") if isinstance(payload, dict) else None
    if not isinstance(creds, dict) and isinstance(payload, dict):
        if kind == "web_push" and (
            "vapidPrivateKey" in payload
            or "vapid_private_key" in payload
            or "vapidPublicKey" in payload
            or "vapid_public_key" in payload
        ):
            creds = payload
        elif kind != "web_push" and (
            "fcmServiceAccount" in payload or "fcmProjectId" in payload
        ):
            creds = payload
    if not isinstance(creds, dict):
        raise AccountsChannelError(
            user_message_for_accounts_error(NOT_CONFIGURED, kind),
            status_code=404,
            code=NOT_CONFIGURED,
        )
    if kind == "web_push":
        return map_web_push_credentials(creds)
    return map_app_push_credentials(creds)


def read_id(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def normalize_web_push_snippet_subscribe(body: dict[str, Any]) -> dict[str, str]:
    """Normalize My Accounts snippet / Campaign SDK subscribe body."""
    nested = body.get("subscription") if isinstance(body.get("subscription"), dict) else {}
    keys = body.get("keys") if isinstance(body.get("keys"), dict) else {}
    if not keys and isinstance(nested, dict) and isinstance(nested.get("keys"), dict):
        keys = nested["keys"]
    endpoint = read_id(body.get("endpoint") or nested.get("endpoint"))
    return {
        "organization_id": read_id(
            body.get("organization_id") or body.get("organizationId")
        ),
        "channel_config_id": read_id(
            body.get("channel_config_id")
            or body.get("channelConfigId")
            or body.get("channelId")
            or body.get("channel_id")
        ),
        "endpoint": endpoint,
        "p256dh": read_id(keys.get("p256dh") or body.get("p256dh")),
        "auth": read_id(keys.get("auth") or body.get("auth")),
    }


def compliance_denied(body: Any) -> bool:
    if not isinstance(body, dict):
        return False
    act = str(body.get("act") or body.get("action") or "").strip().lower()
    if act in {"deny", "block", "forbid", "reject"}:
        return True
    if body.get("allowed") is False:
        return True
    instruction = str(body.get("instruction") or "").strip().lower()
    if instruction in {"deny", "block"}:
        return True
    return False


async def evaluate_campaign_compliance(
    organization_id: str,
    *,
    channel: str,
    country: str = "GB",
    note: str = "Scheduled push campaign to opted-in audience.",
) -> dict[str, Any]:
    """POST compliance evaluate. Returns body; raises if denied or HTTP error."""
    url = f"{_base_url()}/api/v1/internal/compliance/evaluate"
    payload = {
        "organization_id": str(organization_id).strip(),
        "product": "campaign",
        "country": (country or "GB").strip() or "GB",
        "channel": channel,
        "action": "send_campaign",
        "note": note,
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.post(url, json=payload, headers=_auth_headers())
    body: Any = None
    try:
        body = res.json() if res.content else None
    except Exception:
        body = None
    if res.status_code == 404:
        return {"skipped": True, "reason": "compliance_endpoint_missing"}
    if res.status_code >= 400:
        code, msg = _parse_error_body(body, res.status_code)
        raise AccountsChannelError(
            msg or f"Compliance evaluate failed ({res.status_code})",
            status_code=res.status_code,
            code=code or "compliance_error",
        )
    if isinstance(body, dict) and compliance_denied(body):
        raise AccountsChannelError(
            str(
                body.get("instruction")
                or body.get("error")
                or "Compliance denied this send."
            ),
            status_code=403,
            code="compliance_denied",
        )
    return body if isinstance(body, dict) else {"ok": True}
