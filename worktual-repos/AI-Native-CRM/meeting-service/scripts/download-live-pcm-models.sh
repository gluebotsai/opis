#!/usr/bin/env bash
# Fetch DTLN ONNX weights (breizhn/DTLN) for live PCM denoise on the VAD chain.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${ROOT}/models/dtln"
mkdir -p "$DEST"
BASE="https://github.com/breizhn/DTLN/raw/master/pretrained_model"
for name in model_1.onnx model_2.onnx; do
  if [[ -f "${DEST}/${name}" ]]; then
    echo "ok ${DEST}/${name}"
    continue
  fi
  echo "Downloading ${name}..."
  curl -fsSL "${BASE}/${name}" -o "${DEST}/${name}"
done
echo "DTLN models ready in ${DEST}"
