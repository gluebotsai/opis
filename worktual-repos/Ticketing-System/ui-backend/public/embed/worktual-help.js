/**
 * Worktual Help widget — drop on any site:
 * <script src="https://YOUR_HOST/embed/worktual-help.js" data-widget-id="wgt_…" async></script>
 */
(function () {
  var script =
    document.currentScript ||
    (function () {
      var list = document.getElementsByTagName("script");
      return list[list.length - 1];
    })();
  if (!script) return;

  var widgetId = script.getAttribute("data-widget-id") || "";
  if (!widgetId) {
    console.warn("[Worktual Help] Missing data-widget-id");
    return;
  }

  var src = script.src || "";
  var base = src.replace(/\/embed\/worktual-help\.js.*$/i, "") || "";
  var apiBase = base;

  var btnLabel = "Help";
  var open = false;
  var root = null;
  var panel = null;
  var statusEl = null;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "style" && typeof attrs[k] === "object") {
          Object.assign(node.style, attrs[k]);
        } else if (k === "text") {
          node.textContent = attrs[k];
        } else if (k.slice(0, 2) === "on") {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else {
          node.setAttribute(k, attrs[k]);
        }
      });
    }
    (children || []).forEach(function (c) {
      if (c) node.appendChild(c);
    });
    return node;
  }

  function setStatus(msg, ok) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.style.color = ok ? "#047857" : "#b45309";
  }

  function toggle() {
    open = !open;
    if (panel) panel.style.display = open ? "flex" : "none";
  }

  function buildUi() {
    root = el("div", {
      id: "worktual-help-root",
      style: {
        position: "fixed",
        right: "20px",
        bottom: "20px",
        zIndex: "2147483000",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
      },
    });

    var button = el(
      "button",
      {
        type: "button",
        text: btnLabel,
        style: {
          border: "none",
          borderRadius: "999px",
          padding: "12px 18px",
          background: "#111827",
          color: "#fff",
          fontWeight: "600",
          fontSize: "14px",
          cursor: "pointer",
          boxShadow: "0 8px 24px rgba(0,0,0,.18)",
        },
        onClick: toggle,
      },
      []
    );

    panel = el("div", {
      style: {
        display: "none",
        flexDirection: "column",
        gap: "8px",
        width: "320px",
        maxWidth: "calc(100vw - 40px)",
        marginBottom: "12px",
        padding: "16px",
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "16px",
        boxShadow: "0 16px 40px rgba(0,0,0,.16)",
      },
    });

    var title = el("div", {
      text: "Contact support",
      style: { fontWeight: "700", fontSize: "15px", color: "#111827" },
    });

    function field(label, name, type, required) {
      var wrap = el("label", {
        style: { display: "block", fontSize: "11px", color: "#6b7280" },
      });
      wrap.appendChild(document.createTextNode(label));
      var input = el("input", {
        name: name,
        type: type || "text",
        required: required ? "required" : undefined,
        style: {
          display: "block",
          width: "100%",
          marginTop: "4px",
          boxSizing: "border-box",
          border: "1px solid #e5e7eb",
          borderRadius: "8px",
          padding: "8px 10px",
          fontSize: "13px",
        },
      });
      wrap.appendChild(input);
      return wrap;
    }

    var nameF = field("Your name", "name", "text", true);
    var emailF = field("Email", "email", "email", true);
    var subjectF = field("Subject", "subject", "text", true);

    var descWrap = el("label", {
      style: { display: "block", fontSize: "11px", color: "#6b7280" },
    });
    descWrap.appendChild(document.createTextNode("How can we help?"));
    var desc = el("textarea", {
      name: "description",
      rows: "4",
      required: "required",
      style: {
        display: "block",
        width: "100%",
        marginTop: "4px",
        boxSizing: "border-box",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "8px 10px",
        fontSize: "13px",
        resize: "vertical",
      },
    });
    descWrap.appendChild(desc);

    statusEl = el("div", {
      style: { fontSize: "12px", minHeight: "16px" },
    });

    var submit = el("button", {
      type: "button",
      text: "Send",
      style: {
        border: "none",
        borderRadius: "10px",
        padding: "10px 14px",
        background: "#111827",
        color: "#fff",
        fontWeight: "600",
        fontSize: "13px",
        cursor: "pointer",
      },
      onClick: function () {
        var name = nameF.querySelector("input").value.trim();
        var email = emailF.querySelector("input").value.trim();
        var subject = subjectF.querySelector("input").value.trim();
        var description = desc.value.trim();
        if (!name || !email || !subject || !description) {
          setStatus("Please fill in all fields.", false);
          return;
        }
        submit.disabled = true;
        submit.textContent = "Sending…";
        setStatus("", true);
        fetch(apiBase + "/api/public/widgets/" + encodeURIComponent(widgetId) + "/tickets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requester: { name: name, email: email },
            subject: subject,
            description: description,
            metadata: {
              sourcePage: location.href,
              userAgent: navigator.userAgent,
            },
          }),
        })
          .then(function (res) {
            return res.json().then(function (body) {
              return { ok: res.ok, status: res.status, body: body };
            });
          })
          .then(function (r) {
            if (!r.ok) {
              setStatus((r.body && r.body.error) || "Could not send. Try again.", false);
              return;
            }
            setStatus(
              "Thanks — ticket " + (r.body.ticketNumber || "") + " created.",
              true
            );
            nameF.querySelector("input").value = "";
            emailF.querySelector("input").value = "";
            subjectF.querySelector("input").value = "";
            desc.value = "";
          })
          .catch(function () {
            setStatus("Network error. Try again.", false);
          })
          .finally(function () {
            submit.disabled = false;
            submit.textContent = "Send";
          });
      },
    });

    panel.appendChild(title);
    panel.appendChild(nameF);
    panel.appendChild(emailF);
    panel.appendChild(subjectF);
    panel.appendChild(descWrap);
    panel.appendChild(statusEl);
    panel.appendChild(submit);

    root.appendChild(panel);
    root.appendChild(button);
    document.body.appendChild(root);
  }

  fetch(apiBase + "/api/public/widgets/" + encodeURIComponent(widgetId))
    .then(function (res) {
      return res.json().then(function (body) {
        return { ok: res.ok, body: body };
      });
    })
    .then(function (r) {
      if (r.ok && r.body && r.body.buttonLabel) {
        btnLabel = r.body.buttonLabel;
      }
      if (document.body) buildUi();
      else document.addEventListener("DOMContentLoaded", buildUi);
    })
    .catch(function () {
      if (document.body) buildUi();
      else document.addEventListener("DOMContentLoaded", buildUi);
    });
})();
