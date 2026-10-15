/** Shared track-fn binding used by feature modules. */

/** @typedef {(name: string, properties?: Record<string, unknown>) => void} TrackFn */

/** @returns {{ bindTrack: (fn: TrackFn) => void, track: TrackFn }} */
export function createTracker() {
  /** @type {TrackFn} */
  let trackFn = () => {};

  return {
    bindTrack(fn) {
      trackFn = fn;
    },
    track(name, properties = {}) {
      trackFn(name, properties);
    },
  };
}
