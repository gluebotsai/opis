#!/usr/bin/env bash
# Inject Worktual live-PCM forwarder into a running vexa-lite container.
# Stock vexaai/vexa-lite:v012 has no VEXA_LIVE_PCM_* path, so Meet audio never
# reaches meeting-service / CRM live-caption.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINER="${VEXA_CONTAINER:-vexa-lite}"
BOT_DIR="/app/core/meetings/services/bot"
WS_BASE="${VEXA_LIVE_PCM_WS_BASE:-ws://meeting-service:8030}"
BOT_KEY="${VEXA_LIVE_PCM_BOT_KEY:-${CRM_BOT_API_KEY:-}}"
if [[ -z "$BOT_KEY" && -f "$ROOT/.env" ]]; then
  BOT_KEY="$(grep -E '^CRM_BOT_API_KEY=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//' || true)"
fi
if [[ -z "$BOT_KEY" && -f "$ROOT/../.env" ]]; then
  BOT_KEY="$(grep -E '^CRM_BOT_API_KEY=' "$ROOT/../.env" | head -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//' || true)"
fi
if [[ -z "$BOT_KEY" && -f "$ROOT/../deploy/.env" ]]; then
  BOT_KEY="$(grep -E '^CRM_BOT_API_KEY=' "$ROOT/../deploy/.env" | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//' || true)"
fi
BOT_KEY="${BOT_KEY:-local-meeting-bot-key}"
SRC="$ROOT/patches/vexa-live-pcm-forward.ts"
if [[ ! -f "$SRC" ]]; then
  SRC="$ROOT/../vendor/vexa/core/meetings/services/bot/src/live-pcm-forward.ts"
fi

if [[ ! -f "$SRC" ]]; then
  echo "missing live-pcm forwarder — expected $ROOT/patches/vexa-live-pcm-forward.ts" >&2
  exit 1
fi
echo "using live-pcm source: $SRC"
if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "container $CONTAINER is not running" >&2
  exit 1
fi

docker cp "$SRC" "$CONTAINER:$BOT_DIR/src/live-pcm-forward.ts"

docker exec -i "$CONTAINER" python3 - <<'PY'
import re
from pathlib import Path

src = Path("/app/core/meetings/services/bot/src/pipeline.ts")
text = src.read_text()
if "live-pcm-forward" not in text:
    needle = "import type { Pipeline, TranscriptSink } from './ports.js';\n"
    insert = (
        needle
        + "import {\n"
        + "  buildLivePcmJoinUrl,\n"
        + "  createLivePcmForwarder,\n"
        + "  type LivePcmForwarder,\n"
        + "} from './live-pcm-forward.js';\n"
    )
    if needle not in text:
        raise SystemExit("pipeline.ts import anchor not found")
    text = text.replace(needle, insert, 1)

fn = '''/** Capture-only lane: PCM → meeting-service CCaaS transcoder (no in-bot Whisper).
 * Routes by the real per-participant CHANNEL Meet gives the bot, not by the
 * glow-highlight name alone (that flickers frame-to-frame even for one
 * continuous speaker). forwarder.setSpeaker/sendPcm carry the channel index
 * with every frame so meeting-service demuxes by real audio track. */
function createLivePcmCapturePipeline(
  inv: Invocation,
  forwarder: LivePcmForwarder,
): BotPipeline {
  return {
    async start() {
      await forwarder.connect();
    },
    async stop() {
      await forwarder.close();
    },
    feedAudio(channel, glowName, pcm, _tsMs) {
      forwarder.setSpeaker(channel, glowName?.trim() || '');
      forwarder.sendPcm(channel, pcm);
    },
    feedMixedAudio(_pcm, _tsMs) {
      // Platform has no per-track separation — everything is one channel (0).
      forwarder.sendPcm(0, _pcm);
    },
    recordHint() { /* capture-only */ },
  };
}

'''
mark = "export function createBotPipeline("
# Idempotent UPDATE, not just insert-if-missing: a container patched by an
# earlier version of this script already has SOME createLivePcmCapturePipeline
# body — replace it wholesale (not just skip) so re-running this script after
# editing `fn` above actually takes effect on an already-patched container.
existing_fn_re = re.compile(
    r"function createLivePcmCapturePipeline\(.*?\n\}\n\n(?=" + re.escape(mark) + r")",
    re.S,
)
if existing_fn_re.search(text):
    text = existing_fn_re.sub(fn, text, count=1)
else:
    if mark not in text:
        raise SystemExit("createBotPipeline not found")
    text = text.replace(mark, fn + mark, 1)

old = """): BotPipeline {
  const transcribe = opts.transcribe ?? createTranscribe(inv);
"""
new = """): BotPipeline {
  if (!opts.forceInBotStt) {
    const url = buildLivePcmJoinUrl(inv);
    console.log('[bot] live-pcm: capture → meeting-service (in-bot STT disabled)');
    return createLivePcmCapturePipeline(inv, createLivePcmForwarder(url));
  }
  const transcribe = opts.transcribe ?? createTranscribe(inv);
"""
if "buildLivePcmJoinUrl(inv)" not in text:
    if old not in text:
        raise SystemExit("createBotPipeline body anchor not found")
    text = text.replace(old, new, 1)

opt = "    onObservation?: (source: string, obs: Record<string, unknown>, tMs?: number) => void;\n  } = {},"
opt_new = (
    "    onObservation?: (source: string, obs: Record<string, unknown>, tMs?: number) => void;\n"
    "    /** Vexa upstream unit tests only — production always uses live PCM → meeting-service. */\n"
    "    forceInBotStt?: boolean;\n"
    "  } = {},"
)
if "forceInBotStt?" not in text:
    if opt not in text:
        raise SystemExit("opts type anchor not found")
    text = text.replace(opt, opt_new, 1)

src.write_text(text)
print("patched src/pipeline.ts")
PY

docker exec -i "$CONTAINER" python3 - <<'PY'
import re
from pathlib import Path
js = Path("/app/core/meetings/services/bot/dist/pipeline.js")
text = js.read_text()
if "live-pcm-forward" not in text:
    needle = "import { isMixedLanePlatform, isPerTrackLanePlatform } from './config.js';\n"
    insert = (
        needle
        + "import { buildLivePcmJoinUrl, createLivePcmForwarder } from './live-pcm-forward.js';\n"
    )
    if needle not in text:
        raise SystemExit("dist pipeline.js import anchor not found")
    text = text.replace(needle, insert, 1)

fn = '''function createLivePcmCapturePipeline(inv, forwarder) {
    return {
        async start() { await forwarder.connect(); },
        async stop() { await forwarder.close(); },
        feedAudio(channel, glowName, pcm, _tsMs) {
            forwarder.setSpeaker(channel, (glowName && glowName.trim()) || '');
            forwarder.sendPcm(channel, pcm);
        },
        feedMixedAudio(_pcm, _tsMs) {
            forwarder.sendPcm(0, _pcm);
        },
        recordHint() { },
    };
}
'''
mark = "export function createBotPipeline(inv, sink, opts = {}) {"
# Idempotent UPDATE (see src/pipeline.ts patch above for why insert-if-missing
# alone is not enough once a container has already been patched once).
existing_fn_re = re.compile(
    r"function createLivePcmCapturePipeline\(.*?\n\}\n(?=" + re.escape(mark) + r")",
    re.S,
)
if existing_fn_re.search(text):
    text = existing_fn_re.sub(fn, text, count=1)
else:
    if mark not in text:
        raise SystemExit("dist createBotPipeline not found")
    text = text.replace(mark, fn + mark, 1)

old = """export function createBotPipeline(inv, sink, opts = {}) {
    const transcribe = opts.transcribe ?? createTranscribe(inv);
"""
new = """export function createBotPipeline(inv, sink, opts = {}) {
    if (!opts.forceInBotStt) {
        const url = buildLivePcmJoinUrl(inv);
        console.log('[bot] live-pcm: capture → meeting-service (in-bot STT disabled)');
        return createLivePcmCapturePipeline(inv, createLivePcmForwarder(url));
    }
    const transcribe = opts.transcribe ?? createTranscribe(inv);
"""
if "buildLivePcmJoinUrl(inv)" not in text:
    if old not in text:
        raise SystemExit("dist createBotPipeline body not found")
    text = text.replace(old, new, 1)
js.write_text(text)
print("patched dist/pipeline.js")
PY

# Compile the forwarder (tsc) and keep a JS fallback if tsc is slow/fails.
docker exec "$CONTAINER" sh -c "cd $BOT_DIR && ./node_modules/.bin/tsc --pretty false src/live-pcm-forward.ts --outDir dist --module nodenext --moduleResolution nodenext --target es2022 --esModuleInterop --skipLibCheck" \
  || docker exec "$CONTAINER" sh -c "cd $BOT_DIR && ./node_modules/.bin/tsc -p tsconfig.json --pretty false"

LAUNCH=/usr/local/bin/vexa-bot-launch
docker exec -i -e WS_BASE="$WS_BASE" -e BOT_KEY="$BOT_KEY" "$CONTAINER" python3 - <<'PY'
import os
from pathlib import Path
p = Path("/usr/local/bin/vexa-bot-launch")
text = p.read_text()
ws = os.environ["WS_BASE"]
key = os.environ["BOT_KEY"]
# Assign the key literally. A stale container env (the local placeholder
# local-meeting-bot-key) would otherwise win over ${VEXA_LIVE_PCM_BOT_KEY:-...}
# and meeting-service would reject the live audio socket.
if any(ch in key for ch in '"\'\n$`\\'):
    raise SystemExit("BOT_KEY has shell metacharacters")
block = (
    f'export VEXA_LIVE_PCM_WS_BASE="${{VEXA_LIVE_PCM_WS_BASE:-{ws}}}"\n'
    f'export VEXA_LIVE_PCM_BOT_KEY="{key}"\n'
)
import re
block_re = re.compile(
    r'export VEXA_LIVE_PCM_WS_BASE="(?:\$\{VEXA_LIVE_PCM_WS_BASE:-[^"]*\}|[^"]*)"\n'
    r'export VEXA_LIVE_PCM_BOT_KEY="(?:\$\{VEXA_LIVE_PCM_BOT_KEY:-[^"]*\}|[^"]*)"\n'
)
if block_re.search(text):
    text = block_re.sub(block, text, count=1)
    p.write_text(text)
    print("updated vexa-bot-launch live-pcm defaults")
elif "VEXA_LIVE_PCM_WS_BASE" not in text:
    if "set -u\n" not in text:
        raise SystemExit("vexa-bot-launch set -u not found")
    text = text.replace("set -u\n", "set -u\n" + block, 1)
    p.write_text(text)
    print("patched vexa-bot-launch")
else:
    print("vexa-bot-launch has live-pcm env but unexpected format — edit manually")
PY

# Google Meet's own <audio> elements are often silent in headless Chrome.
# The WebRTC hook (already used for Zoom/Teams) mirrors remote tracks into
# playable elements that gmeet-capture can hear. Must be installed before
# the Meet page creates RTCPeerConnection, so the bot has to rejoin.
docker exec -i "$CONTAINER" python3 - <<'PY'
from pathlib import Path
p = Path("/app/core/meetings/services/bot/dist/capture-bridge.js")
text = p.read_text()
# tsc keeps the source indent (4 spaces). An older patch looked for 8 and
# aborted, so Google Meet never installed the WebRTC audio hook.
olds = [
    "if (isMixedLanePlatform(inv.platform)) {\n        await context.addInitScript(",
    "if (isMixedLanePlatform(inv.platform)) {\n    await context.addInitScript(",
]
matched = next((old for old in olds if old in text), "")
if not matched:
    if "inv.platform === 'google_meet'" in text and "installRemoteAudioHook" in text:
        print("gmeet remote audio hook already enabled")
    else:
        raise SystemExit("gmeet audio hook anchor not found")
else:
    updated = matched.replace(
        "if (isMixedLanePlatform(inv.platform))",
        "if (isMixedLanePlatform(inv.platform) || inv.platform === 'google_meet')",
        1,
    )
    p.write_text(text.replace(matched, updated, 1))
    print("enabled gmeet remote audio hook")
PY

# gmeet-capture ignores paused <audio>. Chrome often rejects play() on the
# hidden elements the WebRTC hook creates, so those live tracks never reach
# Whisper. Keep them even when the element itself is paused.
docker exec -i "$CONTAINER" python3 - <<'PY'
import re
from pathlib import Path
p = Path("/app/browser-utils.global.js")
text = p.read_text()
if 'vexaInjected === "true" || !el.paused' in text:
    print("gmeet capture already keeps injected tracks")
else:
    # esbuild may name the second copy findMediaElements2 and may keep tsc's
    # line break after `=>`. Match either form.
    pat = re.compile(
        r"function findMediaElements\d*\(\) \{.*?!\s*el\.paused &&",
        re.S,
    )
    match = pat.search(text)
    if not match:
        raise SystemExit("gmeet capture filter anchor not found")
    updated = match.group(0).replace(
        "!el.paused &&",
        '(el.dataset.vexaInjected === "true" || !el.paused) &&',
        1,
    )
    p.write_text(text[: match.start()] + updated + text[match.end() :])
    print("gmeet capture keeps injected tracks")
PY

docker exec "$CONTAINER" sh -c "test -f $BOT_DIR/dist/live-pcm-forward.js && grep -q buildLivePcmJoinUrl $BOT_DIR/dist/pipeline.js && grep -q VEXA_LIVE_PCM_WS_BASE /usr/local/bin/vexa-bot-launch"
echo "live-pcm patch applied on $CONTAINER (ws=$WS_BASE)"
echo "Admit the notetaker again in Meet so a new bot process picks this up."
