import { config, state } from '../core/state.js';
import { ERROR_STACK_MAX_LEN } from '../core/constants.js';
import { createTracker } from '../tracking/tracker.js';

const { bindTrack, track: errorsTrackFn } = createTracker();
export { bindTrack };

export function setupErrorTracking() {
  if (!config?.trackErrors || state.modules.errors) return;
  state.modules.errors = true;

  window.addEventListener('error', (e) => {
    errorsTrackFn('error', {
      type: 'javascript',
      message: e.message,
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      stack: e.error?.stack?.slice(0, ERROR_STACK_MAX_LEN),
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    errorsTrackFn('error', {
      type: 'unhandledrejection',
      message: reason?.message || String(reason),
      stack: reason?.stack?.slice(0, ERROR_STACK_MAX_LEN),
    });
  });

  patchFetch();
  patchXhr();
  monitorResourceErrors();
}

function patchFetch() {
  if (!window.fetch) return;
  const orig = window.fetch.bind(window);
  window.fetch = async (...args) => {
    try {
      const res = await orig(...args);
      if (!res.ok) {
        errorsTrackFn('error', {
          type: 'fetch',
          url: String(args[0]),
          status: res.status,
          statusText: res.statusText,
        });
      }
      return res;
    } catch (err) {
      errorsTrackFn('error', {
        type: 'fetch',
        url: String(args[0]),
        message: err?.message || 'Network error',
      });
      throw err;
    }
  };
}

function patchXhr() {
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._waUrl = url;
    this._waMethod = method;
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('error', () => {
      errorsTrackFn('error', { type: 'xhr', url: this._waUrl, method: this._waMethod, message: 'Network error' });
    });
    this.addEventListener('load', () => {
      if (this.status >= 400) {
        errorsTrackFn('error', { type: 'xhr', url: this._waUrl, method: this._waMethod, status: this.status });
      }
    });
    return origSend.apply(this, args);
  };
}

function monitorResourceErrors() {
  window.addEventListener('error', (e) => {
    const target = e.target;
    if (target && (target.tagName === 'IMG' || target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
      errorsTrackFn('error', {
        type: 'resource',
        tagName: target.tagName,
        src: target.src || target.href,
      });
    }
  }, true);
}
