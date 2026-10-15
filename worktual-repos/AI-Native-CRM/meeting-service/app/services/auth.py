from __future__ import annotations

from fastapi import Header, HTTPException, WebSocket, status
from jwt import InvalidTokenError, decode

from app.config import settings
from app.schemas import TokenPrincipal


def decode_token(token: str) -> TokenPrincipal:
    try:
        payload = decode(
            token,
            settings.crm_service_jwt_secret,
            algorithms=["HS256"],
            options={"require": ["organization_id"]},
        )
    except InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token") from exc
    org = str(payload.get("organization_id") or "").strip()
    if not org:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="organization_id missing")
    scopes = payload.get("scopes") or payload.get("scope") or []
    if isinstance(scopes, str):
        scopes = scopes.split()
    return TokenPrincipal(
        organization_id=org,
        sub=str(payload.get("sub") or "crm"),
        scopes=list(scopes),
        email=(str(payload.get("email") or "").strip().lower() or None),
        iss=(str(payload.get("iss") or "").strip() or None),
        google_sub=(str(payload.get("google_sub") or "").strip() or None),
    )


def require_meetings_write(principal: TokenPrincipal) -> None:
    if "meetings:write" not in principal.scopes and "meetings:*" not in principal.scopes:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="missing meetings:write")


def bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")
    return authorization.split(" ", 1)[1].strip()


def get_principal(authorization: str | None = Header(None)) -> TokenPrincipal:
    return decode_token(bearer_token(authorization))


async def ws_principal(websocket: WebSocket, token: str | None = None) -> TokenPrincipal:
    raw = token or websocket.query_params.get("token")
    auth = websocket.headers.get("authorization")
    if not raw and auth:
        if auth.lower().startswith("bearer "):
            raw = auth.split(" ", 1)[1].strip()
    if not raw:
        await websocket.close(code=4401)
        raise HTTPException(status_code=401, detail="missing token")
    try:
        return decode_token(raw)
    except HTTPException:
        await websocket.close(code=4401)
        raise
