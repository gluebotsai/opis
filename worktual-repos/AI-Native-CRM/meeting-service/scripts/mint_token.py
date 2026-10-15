#!/usr/bin/env python3
"""Mint a CRM service JWT for local testing. Do not use production secrets here."""

from __future__ import annotations

import argparse
import time

import jwt

from app.config import settings


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--org", default="1003")
    p.add_argument("--sub", default="local-dev")
    args = p.parse_args()
    token = jwt.encode(
        {
            "organization_id": args.org,
            "sub": args.sub,
            "scopes": ["meetings:write"],
            "iat": int(time.time()),
        },
        settings.crm_service_jwt_secret,
        algorithm="HS256",
    )
    print(token)


if __name__ == "__main__":
    main()
