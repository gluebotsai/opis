#!/usr/bin/env bash
set -euo pipefail
# OpenAI-compatible Whisper preflight. Vexa will call the same URL.
: "${TRANSCRIPTION_SERVICE_URL:=${WHISPER_BASE_URL:-http://localhost:8000}}"
: "${TRANSCRIPTION_SERVICE_TOKEN:=${WHISPER_API_TOKEN:-}}"
: "${TRANSCRIPTION_MODEL:=${WHISPER_MODEL:-whisper-1}}"
FILE="${1:-}"
if [ -z "$FILE" ]; then
  echo "usage: $0 sample.wav" >&2
  exit 2
fi
AUTH=()
if [ -n "$TRANSCRIPTION_SERVICE_TOKEN" ]; then
  AUTH=(-H "Authorization: Bearer $TRANSCRIPTION_SERVICE_TOKEN")
fi
curl -sS -D - "$TRANSCRIPTION_SERVICE_URL/v1/audio/transcriptions" \
  "${AUTH[@]}" \
  -F "file=@${FILE}" \
  -F "model=${TRANSCRIPTION_MODEL}"
