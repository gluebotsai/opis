import { config, state } from '../core/state.js';
import { createTracker } from './tracker.js';

const { bindTrack, track: heartbeatTrackFn } = createTracker();
export { bindTrack };

export function setupHeartbeat() {
  if (config?.trackHeartbeat === false || state.modules.heartbeat) return;
  state.modules.heartbeat = true;

  const intervalMs = config?.heartbeatIntervalMs ?? 30_000;
  setInterval(() => {
    if (!state.isActive || document.visibilityState === 'hidden') return;
    heartbeatTrackFn('heartbeat', {
      intervalMs,
      path: window.location.pathname + window.location.search,
    });
  }, intervalMs);
}
