const UA = typeof navigator !== 'undefined' ? navigator.userAgent : '';

function parseBrowser(ua) {
  if (/Edg\//.test(ua)) return { name: 'Edge', version: ua.match(/Edg\/([\d.]+)/)?.[1] || '' };
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return { name: 'Chrome', version: ua.match(/Chrome\/([\d.]+)/)?.[1] || '' };
  if (/Firefox\//.test(ua)) return { name: 'Firefox', version: ua.match(/Firefox\/([\d.]+)/)?.[1] || '' };
  if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return { name: 'Safari', version: ua.match(/Version\/([\d.]+)/)?.[1] || '' };
  return { name: 'Other', version: '' };
}

function parseOS(ua) {
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Other';
}

function parseDevice(ua) {
  if (/Mobile|Android|iPhone/.test(ua)) return 'mobile';
  if (/iPad|Tablet/.test(ua)) return 'tablet';
  return 'desktop';
}

export function getDeviceContext() {
  const browser = parseBrowser(UA);
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  return {
    browser: browser.name,
    browserVersion: browser.version,
    engine: /WebKit/.test(UA) ? 'WebKit' : 'Other',
    os: parseOS(UA),
    device: parseDevice(UA),
    language: navigator.language || '',
    languages: navigator.languages ? [...navigator.languages] : [],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    screen: {
      width: screen.width,
      height: screen.height,
      colorDepth: screen.colorDepth,
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    dpr: window.devicePixelRatio || 1,
    touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    cpu: navigator.hardwareConcurrency || null,
    memory: navigator.deviceMemory || null,
    connection: conn
      ? { effectiveType: conn.effectiveType, downlink: conn.downlink, rtt: conn.rtt }
      : null,
    userAgent: UA,
  };
}
