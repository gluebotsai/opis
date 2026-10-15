export function getPageContext() {
  const loc = window.location;
  return {
    url: loc.href,
    path: loc.pathname + loc.search,
    title: document.title || '',
    referrer: document.referrer || '',
    hash: loc.hash || '',
  };
}

export function isOutboundLink(href) {
  if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return false;
  }
  try {
    const url = new URL(href, window.location.origin);
    return url.hostname !== window.location.hostname;
  } catch {
    return false;
  }
}

export function isDownloadLink(href) {
  if (!href) return false;
  return /\.(pdf|zip|doc|docx|xls|xlsx|csv|ppt|pptx|mp3|mp4|avi|mov|dmg|exe|pkg)(\?|$)/i.test(href);
}
