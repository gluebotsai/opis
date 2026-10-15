/* Worktual Campaign Web Push SDK
 * Customer site: set window.WorktualWebPush then load this script from Campaign API.
 * Optional identity (attaches to Contacts): cfg.email / cfg.userEmail, cfg.phone / cfg.userPhone.
 * Service worker must be same-origin: copy /sdk/worktual-web-push-sw.js to
 * https://your-site/worktual-web-push-sw.js
 */
(function () {
  "use strict";

  var cfg = window.WorktualWebPush || {};
  window.WorktualWebPush = cfg;

  function scriptOrigin() {
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || "";
      if (src.indexOf("web-push.js") !== -1) {
        try {
          return new URL(src).origin;
        } catch (e) {
          /* ignore */
        }
      }
    }
    return "";
  }

  var apiOrigin = String(cfg.apiOrigin || cfg.apiBase || scriptOrigin()).replace(
    /\/api\/?$/,
    "",
  );
  var apiBase = apiOrigin.replace(/\/$/, "") + "/api";

  function uuid() {
    if (crypto && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (ch) {
      var r = (Math.random() * 16) | 0;
      var v = ch === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function visitorId() {
    var key = "worktual_web_push_visitor";
    try {
      var id = localStorage.getItem(key);
      if (!id) {
        id = uuid();
        localStorage.setItem(key, id);
      }
      return id;
    } catch (e) {
      return uuid();
    }
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(base64);
    var output = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
    return output;
  }

  function bufferToBase64Url(buf) {
    var bytes = new Uint8Array(buf);
    var str = "";
    for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function registerWorker() {
    var swUrl = cfg.serviceWorkerUrl || "/worktual-web-push-sw.js";
    try {
      return await navigator.serviceWorker.register(swUrl, {
        scope: cfg.scope || "/",
      });
    } catch (err) {
      var hint =
        "Host this file at " +
        swUrl +
        " on your site:\nimportScripts(" +
        JSON.stringify(apiBase.replace(/\/$/, "") + "/sdk/web-push-sw.js") +
        ");";
      console.error("[Worktual Web Push]", hint);
      throw err;
    }
  }

  async function subscribe() {
    if (!window.isSecureContext) {
      throw new Error("Web Push requires HTTPS.");
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      throw new Error("This browser does not support Web Push.");
    }
    var key = String(cfg.applicationServerKey || cfg.vapidPublicKey || "").trim();
    var orgId = String(cfg.organizationId || cfg.organization_id || "").trim();
    var channelId = String(
      cfg.channelId || cfg.channel_config_id || cfg.channelConfigId || "",
    ).trim();
    if (!orgId) throw new Error("WorktualWebPush.organizationId is required.");
    if (!key) {
      var cfgRes = await fetch(
        apiBase +
          "/v1/push/config?organization_id=" +
          encodeURIComponent(orgId) +
          (channelId ? "&channel_config_id=" + encodeURIComponent(channelId) : ""),
      );
      var cfgJson = await cfgRes.json();
      var cfgData = (cfgJson && cfgJson.data) || cfgJson || {};
      key = String(
        cfgData.vapid_public_key ||
          cfgData.applicationServerKey ||
          cfgJson.vapid_public_key ||
          cfgJson.applicationServerKey ||
          "",
      );
    }
    if (!key) throw new Error("Missing VAPID public key.");

    var permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error("Notification permission was not granted.");
    }

    var registration = await registerWorker();
    await navigator.serviceWorker.ready;
    var sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
    var json = sub.toJSON();
    var keys = json.keys || {};
    var body = {
      organization_id: orgId,
      channel_config_id: channelId || undefined,
      endpoint: json.endpoint || sub.endpoint,
      keys: {
        p256dh: keys.p256dh || bufferToBase64Url(sub.getKey("p256dh")),
        auth: keys.auth || bufferToBase64Url(sub.getKey("auth")),
      },
      visitor_id: visitorId(),
      path: location.pathname,
    };
    var email = String(cfg.email || cfg.userEmail || "").trim();
    var phone = String(cfg.phone || cfg.userPhone || cfg.mobile || "").trim();
    if (email) body.email = email;
    if (phone) body.phone = phone;
    var res = await fetch(apiBase + "/v1/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    var out = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      throw new Error(out.message || "Subscribe failed (" + res.status + ")");
    }
    cfg.lastSubscription = out;
    return out;
  }

  cfg.subscribe = subscribe;
  cfg.ready = Promise.resolve();

  if (cfg.autoSubscribe !== false) {
    var run = function () {
      subscribe().catch(function (err) {
        console.warn("[Worktual Web Push]", err && err.message ? err.message : err);
      });
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run);
    } else {
      run();
    }
  }
})();
