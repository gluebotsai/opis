import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatReplayTime, getReplayStats, replayKindLabel } from '../utils/replayStats';

const RRWEB_SCRIPT_LOCAL = '/vendor/rrweb/rrweb.min.js';
const RRWEB_SCRIPT_CDN =
  'https://nlp-storage.worktual.co.uk/wsnlp/Web_Tracking/JavaScript_sdk/vendor/rrweb/rrweb.min.js';

function rrwebScriptUrl() {
  return RRWEB_SCRIPT_LOCAL;
}

let rrwebLoadPromise = null;

function injectRrwebScript(src, resolve, reject) {
  const onReady = () => {
    if (window.rrweb?.Replayer) resolve(window.rrweb);
    else reject(new Error('rrweb.Replayer not found after script load'));
  };

  const existing = document.querySelector(`script[data-wt-rrweb="${src}"]`);
  if (existing) {
    if (window.rrweb?.Replayer) {
      onReady();
      return;
    }
    if (existing.readyState === 'complete' || existing.readyState === 'loaded') {
      onReady();
      return;
    }
    existing.addEventListener('load', onReady, { once: true });
    existing.addEventListener('error', () => reject(new Error(`Failed to load rrweb: ${src}`)), { once: true });
    return;
  }

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = src.includes('/vendor/')
    ? '/vendor/rrweb/style.css'
    : src.replace(/rrweb\.(min\.)?js.*$/, 'style.css');
  document.head.appendChild(link);

  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  script.dataset.wtRrweb = src;
  script.onload = onReady;
  script.onerror = () => reject(new Error(`Failed to load rrweb: ${src}`));
  document.head.appendChild(script);
}

function loadRrwebScript() {
  if (typeof window !== 'undefined' && window.rrweb?.Replayer) {
    return Promise.resolve(window.rrweb);
  }
  if (!rrwebLoadPromise) {
    rrwebLoadPromise = new Promise((resolve, reject) => {
      const local = rrwebScriptUrl();
      injectRrwebScript(
        local,
        resolve,
        () => {
          injectRrwebScript(
            RRWEB_SCRIPT_CDN,
            resolve,
            () => reject(new Error(`Failed to load rrweb (${local} and CDN)`)),
          );
        },
      );
    });
  }
  return rrwebLoadPromise;
}

const PORTRAIT_MAX_STAGE_HEIGHT_VH = 0.8;
const PORTRAIT_MAX_STAGE_HEIGHT_PX = 900;
const LANDSCAPE_MAX_STAGE_HEIGHT_VH = 0.72;
const STAGE_BOTTOM_PADDING_PX = 28;
const STAGE_MIN_HEIGHT_PX = 280;

function getMaxStageHeight(viewportEl, isPortraitRecording) {
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
  if (isPortraitRecording) {
    return Math.min(vh * PORTRAIT_MAX_STAGE_HEIGHT_VH, PORTRAIT_MAX_STAGE_HEIGHT_PX);
  }
  let maxH = vh * LANDSCAPE_MAX_STAGE_HEIGHT_VH;
  if (viewportEl && typeof window !== 'undefined') {
    const top = viewportEl.getBoundingClientRect().top;
    maxH = Math.min(maxH, vh - top - STAGE_BOTTOM_PADDING_PX);
  }
  return Math.max(STAGE_MIN_HEIGHT_PX, maxH);
}

/**
 * Recorded browser viewport for scaling.
 * Portrait: meta only (scrollWidth on mobile often inflates width).
 * Landscape: meta + content width if meta under-reports — avoids horizontal clip.
 */
function measureReplayViewport(replayer, fallbackWidth, fallbackHeight, isPortraitRecording) {
  let width = fallbackWidth;
  let height = fallbackHeight;

  const meta = replayer.getMetaData?.();
  if (meta?.width) width = meta.width;
  if (meta?.height) height = meta.height;

  if (!isPortraitRecording) {
    try {
      const doc = replayer.iframe?.contentDocument;
      const root = doc?.documentElement;
      if (root) {
        width = Math.max(
          width,
          root.scrollWidth || 0,
          root.clientWidth || 0,
          doc.body?.scrollWidth || 0,
          doc.body?.clientWidth || 0,
        );
      }
    } catch {
      // iframe not ready — meta/fallback is enough
    }
  }

  return {
    width: Math.max(width, 1),
    height: Math.max(height, 1),
  };
}

function applyReplayerDomSizes(replayer, width, height, scale) {
  const wrapper = replayer.wrapper;
  const iframe = replayer.iframe;

  iframe.style.display = 'block';
  iframe.style.border = 'none';
  iframe.style.width = `${width}px`;
  iframe.style.height = `${height}px`;
  iframe.setAttribute('scrolling', 'no');

  wrapper.style.width = `${width}px`;
  wrapper.style.height = `${height}px`;
  wrapper.style.transform = `scale(${scale})`;
  wrapper.style.transformOrigin = 'top left';
  wrapper.style.overflow = 'visible';
  wrapper.style.margin = '0';
}

function fitReplayerToContainer(
  replayer,
  viewportEl,
  stageEl,
  mountEl,
  { fallbackWidth, fallbackHeight, isPortraitRecording },
) {
  if (!replayer?.wrapper || !viewportEl || !mountEl) return 1;

  const containerWidth = viewportEl.clientWidth || fallbackWidth;
  const { width, height } = measureReplayViewport(
    replayer,
    fallbackWidth,
    fallbackHeight,
    isPortraitRecording,
  );

  const maxStageH = getMaxStageHeight(viewportEl, isPortraitRecording);
  const scale = Math.min(containerWidth / width, maxStageH / height);
  const scaledWidth = Math.ceil(width * scale);
  const scaledHeight = Math.ceil(height * scale);

  if (stageEl) {
    stageEl.style.width = `${scaledWidth}px`;
    stageEl.style.height = `${scaledHeight}px`;
    stageEl.style.margin = '0 auto';
    stageEl.style.maxWidth = '100%';
  }

  mountEl.style.width = `${scaledWidth}px`;
  mountEl.style.height = `${scaledHeight}px`;
  mountEl.style.margin = '0 auto';
  mountEl.style.overflow = 'hidden';
  viewportEl.style.height = `${scaledHeight + (isPortraitRecording ? 32 : 16)}px`;
  viewportEl.style.minHeight = `${Math.min(scaledHeight, maxStageH)}px`;

  applyReplayerDomSizes(replayer, width, height, scale);
  return scale;
}

const REPLAY_SPEED_OPTIONS = [
  { value: 0.5, label: '0.5×' },
  { value: 1, label: '1×' },
  { value: 2, label: '2×' },
  { value: 4, label: '4×' },
];

function ReplaySpeedSelect({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocPointer = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = REPLAY_SPEED_OPTIONS.find((o) => o.value === value) ?? REPLAY_SPEED_OPTIONS[1];

  return (
    <div className={`replay-speed-control${open ? ' replay-speed-control--open' : ''}`} ref={rootRef}>
      <span className="replay-speed-label">Speed</span>
      <div className="replay-speed-dropdown">
        <button
          type="button"
          className="replay-speed-trigger"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label="Playback speed"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="replay-speed-value">{current.label}</span>
          <span className="replay-speed-chevron" aria-hidden />
        </button>
        <ul
          className="replay-speed-menu"
          role="listbox"
          aria-label="Playback speed options"
          aria-hidden={!open}
        >
          {REPLAY_SPEED_OPTIONS.map((opt) => (
            <li key={opt.value} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={opt.value === value}
                className={`replay-speed-option${opt.value === value ? ' replay-speed-option--active' : ''}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function SessionReplayPlayer({ events, note }) {
  const mountRef = useRef(null);
  const stageRef = useRef(null);
  const viewportRef = useRef(null);
  const replayerRef = useRef(null);
  const rafRef = useRef(null);
  const [error, setError] = useState(null);
  const [playerBooting, setPlayerBooting] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [totalMs, setTotalMs] = useState(0);
  const [speed, setSpeed] = useState(1);
  const stats = useMemo(() => getReplayStats(events), [events]);
  const isVideo = stats.isPlayableVideo;

  const syncTime = useCallback(() => {
    const replayer = replayerRef.current;
    if (!replayer) return;
    setCurrentMs(Math.max(0, replayer.getCurrentTime()));
    const meta = replayer.getMetaData();
    if (meta?.totalTime > 0) setTotalMs(meta.totalTime);
  }, []);

  const togglePlay = useCallback(() => {
    const replayer = replayerRef.current;
    if (!replayer) return;
    if (playing) {
      replayer.pause();
      setPlaying(false);
    } else {
      replayer.play(currentMs);
      setPlaying(true);
    }
  }, [playing, currentMs]);

  const onScrub = useCallback((value) => {
    const replayer = replayerRef.current;
    if (!replayer) return;
    const next = Number(value);
    setCurrentMs(next);
    replayer.pause(next);
    setPlaying(false);
  }, []);

  const onSpeedChange = useCallback((value) => {
    const next = Number(value);
    setSpeed(next);
    const replayer = replayerRef.current;
    if (replayer) replayer.setConfig({ speed: next });
  }, []);

  useEffect(() => {
    if (!mountRef.current || !viewportRef.current || !events?.length || stats.isStaticOnly) return undefined;

    let cancelled = false;
    setError(null);
    setPlayerBooting(true);
    setPlaying(false);
    setCurrentMs(0);

    loadRrwebScript()
      .then((rrweb) => {
        if (cancelled || !mountRef.current || !viewportRef.current) return;
        setPlayerBooting(false);

        mountRef.current.innerHTML = '';
        const replayer = new rrweb.Replayer(events, {
          root: mountRef.current,
          skipInactive: isVideo && stats.durationMs > 5000,
          showWarning: false,
          speed: 1,
          UNSAFE_replayCanvas: true,
          loadFont: false,
          mouseTail: isVideo,
        });
        replayerRef.current = replayer;

        const applyFit = () => {
          if (cancelled) return;
          fitReplayerToContainer(
            replayer,
            viewportRef.current,
            stageRef.current,
            mountRef.current,
            {
              fallbackWidth: stats.viewportWidth,
              fallbackHeight: stats.viewportHeight,
              isPortraitRecording: stats.isPortraitRecording,
            },
          );
        };

        replayer.on('fullsnapshot-rebuilded', applyFit);
        replayer.on('resize', applyFit);
        replayer.on('finish', () => {
          setPlaying(false);
          syncTime();
        });

        const meta = replayer.getMetaData();
        if (meta?.totalTime > 0) setTotalMs(meta.totalTime);
        else setTotalMs(stats.durationMs);

        applyFit();

        const ro = typeof ResizeObserver !== 'undefined'
          ? new ResizeObserver(applyFit)
          : null;
        ro?.observe(viewportRef.current);
        const shell = viewportRef.current.closest('.replay-player-shell');
        if (shell) ro?.observe(shell);
        window.addEventListener('resize', applyFit);
        window.addEventListener('scroll', applyFit, { passive: true });

        return () => {
          window.removeEventListener('resize', applyFit);
          window.removeEventListener('scroll', applyFit);
          ro?.disconnect();
        };
      })
      .catch((err) => {
        if (!cancelled) {
          setPlayerBooting(false);
          setError(err instanceof Error ? err.message : 'Failed to load replay player');
        }
      });

    return () => {
      cancelled = true;
      setPlayerBooting(false);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      replayerRef.current?.destroy?.();
      replayerRef.current = null;
      if (mountRef.current) mountRef.current.innerHTML = '';
    };
  }, [
    events,
    stats.durationMs,
    stats.isStaticOnly,
    stats.viewportWidth,
    stats.viewportHeight,
    stats.isPortraitRecording,
    isVideo,
    syncTime,
  ]);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return undefined;
    }
    const tick = () => {
      syncTime();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, syncTime]);

  if (!events?.length) {
    return (
      <div className="replay-empty">
        <p>No replay recording for this session.</p>
      </div>
    );
  }

  if (stats.isStaticOnly) {
    return (
      <div className="replay-empty">
        <p><strong>{replayKindLabel(stats.recordingKind)}</strong></p>
        <p className="replay-empty-hint">
          rrweb stores a DOM screenshot plus interaction events — not a video file. This session has
          {' '}<strong>no interaction events</strong>, so playback can only show a frozen image.
        </p>
        {note && <p className="replay-empty-hint">{note}</p>}
      </div>
    );
  }

  if (error) {
    return (
      <div className="replay-error">
        <p>{error}</p>
        <p className="replay-empty-hint">
          Ensure <code>/vendor/rrweb/rrweb.min.js</code> is served (run <code>python scripts/build_sdk.py</code>).
        </p>
      </div>
    );
  }

  const sliderMax = Math.max(totalMs, stats.durationMs, 1);
  const kindLabel = replayKindLabel(stats.recordingKind);

  return (
    <div className="replay-player-shell">
      {playerBooting && (
        <div className="replay-empty replay-player-booting" role="status">
          <p>Initializing replay player…</p>
          <p className="replay-empty-hint">
            Loading rrweb from <code>/vendor/rrweb/rrweb.min.js</code>. If this stays more than a few seconds, check Network for a 404 on that file.
          </p>
        </div>
      )}

      <div className={`replay-verdict ${isVideo ? 'replay-verdict-ok' : 'replay-verdict-warn'}`} hidden={playerBooting}>
        <strong>{kindLabel}</strong>
        {' · '}
        {stats.motionEvents} motion event(s), {formatReplayTime(stats.activeDurationMs)} active
        {stats.durationMs > stats.activeDurationMs + 5000 && (
          <> · timeline span {formatReplayTime(stats.durationMs)} (mostly idle)</>
        )}
        {!isVideo && (
          <p className="replay-empty-hint" style={{ margin: '0.5rem 0 0' }}>
            Low motion session — playback may skip long idle gaps or look mostly static. Use Play and the timeline to scrub.
          </p>
        )}
      </div>

      {note && !playerBooting && <p className="replay-empty-hint replay-player-note">{note}</p>}

      {!playerBooting && stats.isPortraitRecording && (
        <p className="replay-recording-badge" aria-label="Recording device size">
          Mobile recording · {Math.round(stats.viewportWidth)}×{Math.round(stats.viewportHeight)}
        </p>
      )}

      <div className="replay-toolbar" aria-label="Replay controls" hidden={playerBooting}>
        <button type="button" className="replay-btn replay-btn-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          className="replay-scrubber"
          min={0}
          max={sliderMax}
          step={100}
          value={Math.min(currentMs, sliderMax)}
          onChange={(e) => onScrub(e.target.value)}
          aria-label="Scrub replay timeline"
        />
        <span className="replay-time">
          {formatReplayTime(currentMs)} / {formatReplayTime(sliderMax)}
        </span>
        <ReplaySpeedSelect value={speed} onChange={onSpeedChange} disabled={playerBooting} />
      </div>

      <div
        className={`replay-viewport${stats.isPortraitRecording ? ' replay-viewport--portrait' : ''}`}
        ref={viewportRef}
        style={playerBooting ? { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' } : undefined}
        aria-hidden={playerBooting}
      >
        <div
          className={`replay-stage${stats.isPortraitRecording ? ' replay-stage--portrait' : ''}`}
          ref={stageRef}
        >
          <div className="replay-mount" ref={mountRef} />
        </div>
      </div>
    </div>
  );
}
