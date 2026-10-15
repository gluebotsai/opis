/**
 * CCaaS-style live PCM forward — bot capture → meeting-service live-pcm WebSocket.
 * Worktual Assist: in-bot Whisper is not used; STT runs only in meeting-service.
 * Shipped in CRM (not upstream Vexa) — patch-vexa-live-pcm.sh copies into vexa-lite.
 *
 * Channel-routed, not name-routed: Google Meet delivers each active speaker on its
 * own audio CHANNEL (real per-participant track separation from the bot's capture
 * layer — see vendor/vexa's gmeet-pipeline). The glow-highlight NAME for a channel
 * can flicker frame-to-frame (brief pauses, overlap) even for one continuous speaker.
 * Forwarding only a mutable "current speaker" string collapsed everyone onto one
 * timeline and let a name flicker fragment/relabel a single utterance mid-sentence.
 * Every PCM frame now carries its channel index inline (2-byte header) so
 * meeting-service can demux audio by real track, not by a flickering label — the
 * name is carried separately, only when it actually changes for that channel.
 */
import type { Invocation } from './config.js';

export function buildLivePcmJoinUrl(inv: Invocation, env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.VEXA_LIVE_PCM_WS_BASE || '').trim().replace(/\/$/, '');
  if (!base) {
    throw new Error(
      'VEXA_LIVE_PCM_WS_BASE is required (e.g. ws://meeting-service:8030); in-bot STT is disabled',
    );
  }
  const platform = inv.platform;
  const native = (inv.nativeMeetingId || '').trim();
  if (!native) {
    throw new Error('invocation.v1 nativeMeetingId is required for live-pcm join URL');
  }
  const key = (env.VEXA_LIVE_PCM_BOT_KEY || env.CRM_BOT_API_KEY || '').trim();
  if (!key) {
    console.error(
      '[bot] live-pcm: VEXA_LIVE_PCM_BOT_KEY is empty; meeting-service will reject the socket',
    );
  }
  const q = key ? `?bot_key=${encodeURIComponent(key)}` : '';
  return `${base}/v1/live-pcm/join/${encodeURIComponent(platform)}/${encodeURIComponent(native)}${q}`;
}

/** Binary frame = 2-byte big-endian channel index + raw PCM16LE payload. Channel and
 *  audio travel atomically in one frame so meeting-service never has to guess which
 *  channel a frame belongs to, even when multiple channels interleave on the wire
 *  (two participants speaking at once). */
function float32ToChannelFrame(channel: number, samples: Float32Array): Buffer {
  const out = Buffer.alloc(2 + samples.length * 2);
  out.writeUInt16BE(channel & 0xffff, 0);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    out.writeInt16LE(Math.round(s * 32767), 2 + i * 2);
  }
  return out;
}

export interface LivePcmForwarder {
  connect(): Promise<void>;
  /** No-op if `name` is blank or unchanged for this channel (avoids control-message
   *  spam on every frame; meeting-service holds the previous label through brief
   *  glow gaps rather than reset on a blank/unknown update). */
  setSpeaker(channel: number, name: string): void;
  sendPcm(channel: number, samples: Float32Array): void;
  close(): Promise<void>;
}

export function createLivePcmForwarder(url: string): LivePcmForwarder {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ws: any = null;
  let open = false;
  const queue: Buffer[] = [];
  /** Last name sent per channel — only emit a control message on real change. */
  const speakerByChannel = new Map<number, string>();

  const flush = (): void => {
    if (!ws || !open) return;
    while (queue.length) {
      const buf = queue.shift();
      if (buf) ws.send(buf);
    }
  };

  const sendControl = (channel: number, name: string): void => {
    if (!ws || !open) return;
    try {
      ws.send(JSON.stringify({ channel, speaker: name }));
    } catch {
      /* closed */
    }
  };

  return {
    async connect(): Promise<void> {
      const WS = globalThis.WebSocket;
      if (!WS) {
        throw new Error('live-pcm: WebSocket unavailable in this runtime');
      }
      ws = new WS(url);
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (err?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(t);
          if (err) reject(err);
          else resolve();
        };
        const t = setTimeout(() => finish(new Error('live-pcm connect timeout')), 8000);
        ws.onopen = () => {
          /* wait for the server ready frame before treating the socket as up */
        };
        ws.onerror = () => {
          console.error('[bot] live-pcm: connect failed');
          finish(new Error('live-pcm connect failed'));
        };
        ws.onclose = (ev: { code?: number; reason?: string }) => {
          if (settled) return;
          const code = ev && ev.code != null ? ev.code : 0;
          const reason = (ev && ev.reason) || '';
          console.error(`[bot] live-pcm: closed before ready code=${code} reason=${reason}`);
          finish(new Error(`live-pcm closed ${code} ${reason}`.trim()));
        };
        ws.onmessage = (ev: { data: unknown }) => {
          try {
            const raw = typeof ev.data === 'string' ? ev.data : '';
            if (!raw.startsWith('{')) return;
            const msg = JSON.parse(raw) as { type?: string };
            if (msg.type === 'ready') {
              open = true;
              ws.send(JSON.stringify({ source: 'vexa-bot' }));
              flush();
              finish();
            }
          } catch {
            /* ignore */
          }
        };
      });
      console.log(`[bot] live-pcm: connected ${url.replace(/bot_key=[^&]+/, 'bot_key=***')}`);
    },
    setSpeaker(channel: number, name: string): void {
      const next = (name || '').trim();
      if (!next) return; // blank/unknown glow — hold the previous label for this channel
      const prev = speakerByChannel.get(channel);
      if (next === prev) return;
      speakerByChannel.set(channel, next);
      sendControl(channel, next);
    },
    sendPcm(channel: number, samples: Float32Array): void {
      if (!samples.length) return;
      if (!speakerByChannel.has(channel)) {
        // First audio on this channel with no resolved name yet — announce the
        // fallback label once so meeting-service has something to route/log by.
        speakerByChannel.set(channel, 'Speaker');
        sendControl(channel, 'Speaker');
      }
      const buf = float32ToChannelFrame(channel, samples);
      if (ws && open) {
        try {
          ws.send(buf);
        } catch {
          queue.push(buf);
        }
      } else {
        queue.push(buf);
      }
    },
    async close(): Promise<void> {
      open = false;
      if (ws) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        ws = null;
      }
    },
  };
}
