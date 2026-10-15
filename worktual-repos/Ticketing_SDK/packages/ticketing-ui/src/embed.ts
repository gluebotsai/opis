/** Host-side iframe embed. The frame loads Ticketing; the host passes the session with postMessage. */

export const EMBED_AUTH_MESSAGE = "worktual:ticketing-auth";

export type WorktualFrame = {
  iframe: HTMLIFrameElement;
  setToken: (token: string) => void;
  unmount: () => void;
};

function originOf(appUrl: string): string {
  return new URL(appUrl).origin;
}

/** Staff or partner app URL with `embed=1`, ready for the auth postMessage. */
export function ticketingFrameUrl(appUrl: string, path = "/dashboard"): string {
  const origin = String(appUrl || "").trim().replace(/\/$/, "");
  const route = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${origin}${route}`);
  url.searchParams.set("embed", "1");
  return url.toString();
}

/** Public help-widget frame. The query carries `wgt_…`, never an API key. */
export function helpFrameUrl(appUrl: string, widgetId: string): string {
  const origin = String(appUrl || "").trim().replace(/\/$/, "");
  const url = new URL(`${origin}/embed/help.html`);
  url.searchParams.set("id", widgetId);
  return url.toString();
}

function mountFrame(options: {
  container: HTMLElement;
  src: string;
  title: string;
  token?: string;
  targetOrigin: string;
}): WorktualFrame {
  const iframe = document.createElement("iframe");
  iframe.title = options.title;
  iframe.src = options.src;
  iframe.style.border = "0";
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  let token = options.token || "";
  const send = () => {
    if (!token || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage({ type: EMBED_AUTH_MESSAGE, token }, options.targetOrigin);
  };
  iframe.addEventListener("load", send);
  options.container.replaceChildren(iframe);
  return {
    iframe,
    setToken(next: string) {
      token = next;
      send();
    },
    unmount() {
      iframe.remove();
    },
  };
}

/** Iframe the Ticketing app and pass the session token after it loads. */
export function mountWorktualFrame(options: {
  container: HTMLElement;
  appUrl: string;
  token: string;
  path?: string;
  title?: string;
}): WorktualFrame {
  return mountFrame({
    container: options.container,
    src: ticketingFrameUrl(options.appUrl, options.path),
    title: options.title || "Worktual",
    token: options.token,
    targetOrigin: originOf(options.appUrl),
  });
}

/** Iframe the public help form for a `wgt_…` id. */
export function mountHelpFrame(options: {
  container: HTMLElement;
  appUrl: string;
  widgetId: string;
  title?: string;
}): WorktualFrame {
  return mountFrame({
    container: options.container,
    src: helpFrameUrl(options.appUrl, options.widgetId),
    title: options.title || "Help",
    targetOrigin: originOf(options.appUrl),
  });
}
