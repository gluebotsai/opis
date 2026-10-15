import { useEffect, useRef } from 'react';
import { liveStreamUrl } from '../utils/ecommerceLive';

/**
 * Subscribe to website-scoped SSE live tracking events.
 * @param {{ enabled?: boolean, onSnapshot?: Function, onTracking?: Function }} options
 */
export default function useLiveTrackingStream({ enabled = true, onSnapshot, onTracking } = {}) {
  const snapshotRef = useRef(onSnapshot);
  const trackingRef = useRef(onTracking);
  snapshotRef.current = onSnapshot;
  trackingRef.current = onTracking;

  useEffect(() => {
    if (!enabled) return undefined;
    const url = liveStreamUrl();
    if (!url) return undefined;

    const source = new EventSource(url);
    const onSnap = (ev) => {
      try {
        snapshotRef.current?.(JSON.parse(ev.data));
      } catch {
        /* ignore */
      }
    };
    const onTrack = (ev) => {
      try {
        trackingRef.current?.(JSON.parse(ev.data));
      } catch {
        /* ignore */
      }
    };
    source.addEventListener('snapshot', onSnap);
    source.addEventListener('tracking', onTrack);
    source.onerror = () => {
      /* EventSource reconnects automatically */
    };
    return () => {
      source.removeEventListener('snapshot', onSnap);
      source.removeEventListener('tracking', onTrack);
      source.close();
    };
  }, [enabled]);
}
