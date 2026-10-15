#!/usr/bin/env bash
# Shared deploy defaults — keep in sync with deploy-staging.yml / deploy-qa.yml env blocks.

: "${DEPLOY_ROOT:=/home/worktual/REBUILD/POC/worktual-accounts}"
: "${MAIL_API_PORT:=3002}"
: "${FRONTEND_PORT:=5173}"
: "${KEEP_RELEASES:=5}"
: "${SERVE_FRONTEND_ON_MAIL_API:=true}"
