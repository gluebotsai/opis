const params = new URLSearchParams(window.location.search);
const SITE_KEY = (params.get("key") || "").trim();

function fallbackRandomUuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function ensureRandomUuid() {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") return;
  const randomUUID = fallbackRandomUuid;
  if (cryptoObj) {
    try {
      Object.defineProperty(cryptoObj, "randomUUID", {
        value: randomUUID,
        configurable: true,
        writable: true,
      });
      return;
    } catch {
      /* read-only crypto */
    }
  }
  Object.defineProperty(globalThis, "crypto", {
    value: { ...(cryptoObj ?? {}), randomUUID },
    configurable: true,
    writable: true,
  });
}

ensureRandomUuid();

function defaultApiBase() {
  if (window.location.protocol === "https:") {
    return `${window.location.origin}/api`;
  }
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:3001/api`;
}

const API_BASE = (params.get("api") || defaultApiBase()).replace(/\/$/, "");
const VISITOR_KEY = "worktual_website_visitor";

const form = document.getElementById("form");
const btn = document.getElementById("btn");
const statusEl = document.getElementById("status");
const setupEl = document.getElementById("setup");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? ` ${kind}` : "");
}

function isTunnelHost() {
  const h = location.hostname.toLowerCase();
  return (
    h.endsWith(".ngrok-free.app") ||
    h.endsWith(".ngrok-free.dev") ||
    h.endsWith(".ngrok.io") ||
    h.endsWith(".ngrok.app") ||
    h.endsWith(".trycloudflare.com") ||
    h.endsWith(".loca.lt")
  );
}

function isPrivateLanHost() {
  const h = location.hostname;
  if (h === "localhost" || h === "127.0.0.1") return false;
  if (isTunnelHost()) return false;
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h.endsWith(".local");
}

function canRegisterPush() {
  return (
    window.isSecureContext &&
    "Notification" in window &&
    "serviceWorker" in navigator
  );
}

/** LAN IP URLs — push fails on other PCs unless they use the ngrok share link. */
function mustUseShareLink() {
  if (isTunnelHost()) return false;
  if (!isPrivateLanHost()) return false;
  if (location.protocol === "http:") return true;
  return !canRegisterPush();
}

function visitorId() {
  ensureRandomUuid();
  const uuid = () =>
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : fallbackRandomUuid();
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = uuid();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return uuid();
  }
}

function friendlyError(raw) {
  const msg = String(raw || "");
  const lower = msg.toLowerCase();
  if (
    lower.includes("not configured for this origin") ||
    lower.includes("unknown or invalid site key") ||
    lower.includes("pass ?key=")
  ) {
    return "This page is not linked to Campaign yet. Save VAPID keys in Configuration → Web push.";
  }
  if (lower.includes("vapid")) {
    return "Save VAPID keys in Configuration → Web push, then try again.";
  }
  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return "Cannot reach Campaign API. The host must run npm run dev:backend on the dev machine.";
  }
  if (lower.includes("ssl certificate") || lower.includes("certificate error")) {
    return "This LAN link does not work on other PCs. Ask the host for the ngrok share link (npm run dev:webpush:share).";
  }
  return msg;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function publicQuery() {
  const q = new URLSearchParams();
  if (SITE_KEY) q.set("key", SITE_KEY);
  q.set("origin", window.location.origin);
  return q;
}

async function loadConfig() {
  const q = publicQuery();
  const res = await fetch(`${API_BASE}/public/web-push/config?${q}`, {
    headers: { Accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.message || `Config failed (${res.status})`);
  }
  if (!body.vapid_public_key) {
    throw new Error("VAPID public key missing. Save Web push in Configuration.");
  }
  return body;
}

async function recordVisit() {
  const q = publicQuery();
  await fetch(`${API_BASE}/public/web-push/visit?${q}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      visitor_id: visitorId(),
      path: `${location.pathname}${location.search}`,
    }),
  });
}

function showLanBlockedBanner() {
  setupEl.hidden = false;
  setupEl.className = "banner";
  setupEl.innerHTML = `<strong>This link does not work for browser notifications on other computers.</strong><br>
    You opened <code>${location.origin}</code>. Ask the host to run
    <code>npm run dev:webpush:share</code> and send you the
    <strong>https://….ngrok-free.dev</strong> link instead.`;
  btn.disabled = true;
  setStatus("Use the ngrok share link from the host — not this LAN address.", "err");
}

function showHostShareBanner(shareUrl) {
  setupEl.hidden = false;
  setupEl.className = "banner banner-ok";
  setupEl.innerHTML = `<strong>Share with testers</strong> (works on any PC, no setup):<br>
    <a id="share-link" href="${shareUrl}">${shareUrl}</a>
    <button type="button" id="copy-share" class="copy-btn">Copy link</button>`;
  document.getElementById("copy-share")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setStatus("Share link copied.", "ok");
    } catch {
      setStatus("Copy the link above manually.", "err");
    }
  });
}

async function loadHostShareBanner() {
  if (location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;
  try {
    const res = await fetch("/share-url.json", { cache: "no-store" });
    const body = await res.json();
    if (body.share_url) showHostShareBanner(body.share_url);
  } catch {
    /* tunnel not running */
  }
}

async function probeSetup() {
  if (mustUseShareLink()) {
    showLanBlockedBanner();
    return;
  }
  try {
    await loadConfig();
    if (isTunnelHost()) {
      setupEl.hidden = true;
      setupEl.textContent = "";
    } else if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
      await loadHostShareBanner();
    } else {
      setupEl.hidden = true;
      setupEl.textContent = "";
    }
    await recordVisit();
  } catch (err) {
    setupEl.hidden = false;
    setupEl.className = "banner";
    setupEl.textContent = friendlyError(
      err instanceof Error ? err.message : String(err),
    );
  }
}

void probeSetup();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (mustUseShareLink()) {
    showLanBlockedBanner();
    return;
  }
  const data = new FormData(form);
  const email = String(data.get("email") || "").trim();
  const phone = String(data.get("phone") || "").trim();
  if (!email && !phone) {
    setStatus("Enter an email or a phone number.", "err");
    return;
  }
  if (!canRegisterPush()) {
    setStatus(
      isPrivateLanHost()
        ? "This LAN link cannot register push on this device. Use the host’s ngrok share link."
        : "This browser does not support web push on this page.",
      "err",
    );
    return;
  }

  btn.disabled = true;
  setStatus("Checking setup…");
  try {
    const config = await loadConfig();
    setStatus("Requesting permission…");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error("Notifications were not allowed.");
    }
    const reg = await navigator.serviceWorker.register("./sw.js");
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.vapid_public_key),
    });
    const json = sub.toJSON();
    const q = publicQuery();
    const res = await fetch(`${API_BASE}/public/web-push/subscribe?${q}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: json,
        visitor_id: visitorId(),
        path: `${location.pathname}${location.search}`,
        email: email || undefined,
        phone: phone || undefined,
        platform: "browser",
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.message || `Subscribe failed (${res.status})`);
    }
    setStatus(
      body.audience
        ? "You’re subscribed. Web push is also saved on the matching Audience contact."
        : "You’re subscribed. Saved as a website contact. No matching Audience contact yet.",
      "ok",
    );
  } catch (err) {
    setStatus(friendlyError(err instanceof Error ? err.message : String(err)), "err");
  } finally {
    btn.disabled = mustUseShareLink();
  }
});
