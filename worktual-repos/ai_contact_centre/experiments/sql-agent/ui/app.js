const ALLOWED_TAGS = new Set(["P", "UL", "OL", "LI", "STRONG", "EM", "BR", "B"]);

const state = {
  period: "7d",
  tab: "logs",
  setup: null,
  busy: false,
  history: [],
};

const thread = document.getElementById("thread");
const chips = document.getElementById("chips");
const form = document.getElementById("ask-form");
const input = document.getElementById("question");
const askBtn = document.getElementById("ask-btn");
const periodCaption = document.getElementById("period-caption");
const runMeta = document.getElementById("run-meta");
const inspectLogs = document.getElementById("inspect-logs");
const inspectPlan = document.getElementById("inspect-plan");
const inspectWarehouse = document.getElementById("inspect-warehouse");
const inspectTools = document.getElementById("inspect-tools");

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sanitizeHtml(html) {
  const parsed = new DOMParser().parseFromString(`<div>${html || ""}</div>`, "text/html");
  const root = parsed.body.firstElementChild;
  if (!root) return "";
  const walk = (node) => {
    [...node.children].forEach((child) => {
      if (!ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(...child.childNodes);
        return;
      }
      [...child.attributes].forEach((attr) => child.removeAttribute(attr.name));
      walk(child);
    });
  };
  walk(root);
  return root.innerHTML;
}

function pretty(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tab === tab);
  });
  inspectLogs.classList.toggle("is-hidden", tab !== "logs");
  inspectPlan.classList.toggle("is-hidden", tab !== "plan");
  inspectWarehouse.classList.toggle("is-hidden", tab !== "warehouse");
  inspectTools.classList.toggle("is-hidden", tab !== "tools");
}

function periodLabel() {
  const item = state.setup?.periods?.[state.period];
  if (!item) return "Trusted period is set here, not by the model.";
  return `${item.label}: ${item.start.slice(0, 10)} to ${item.end.slice(0, 10)}`;
}

function appendBubble(kind, html) {
  const empty = thread.querySelector(".empty");
  if (empty) empty.remove();
  const el = document.createElement("div");
  el.className = `bubble ${kind}`;
  el.innerHTML = html;
  thread.appendChild(el);
  thread.scrollTop = thread.scrollHeight;
  return el;
}

function resetInspector() {
  inspectLogs.innerHTML = "";
  inspectPlan.textContent = "";
  inspectWarehouse.innerHTML = "";
  inspectTools.textContent = "";
}

function addLog(event) {
  const row = document.createElement("div");
  row.className = "log-row";
  row.innerHTML = `
    <span class="log-time">${escapeHtml(event.at)}</span>
    <span class="log-agent">${escapeHtml(event.agent)}</span>
    <span class="log-state ${escapeHtml(event.state)}">${escapeHtml(event.state)}</span>
    <span>${escapeHtml(event.detail || event.tool || "")}</span>
  `;
  inspectLogs.appendChild(row);
  inspectLogs.scrollTop = inspectLogs.scrollHeight;
}

function renderWarehouse(payload) {
  const warehouse = payload.warehouse || {};
  const preview = warehouse.preview || [];
  const keys = preview[0] ? Object.keys(preview[0]) : [];
  const rows = preview
    .map(
      (row) =>
        `<tr>${keys.map((key) => `<td>${escapeHtml(row[key])}</td>`).join("")}</tr>`,
    )
    .join("");
  inspectWarehouse.innerHTML = `
    <div class="kpi">
      <div><span>Headline</span><strong>${escapeHtml(warehouse.headline || "—")}</strong></div>
      <div><span>Rows</span><strong>${escapeHtml(warehouse.total_matched_rows ?? preview.length)}</strong></div>
      <div><span>Trust</span><strong>${escapeHtml(payload.plan?.trust || "—")}</strong></div>
      <div><span>Elapsed</span><strong>${escapeHtml(payload.elapsed_ms)}ms</strong></div>
    </div>
    ${
      keys.length
        ? `<div class="table-wrap"><table class="data-table"><thead><tr>${keys
            .map((key) => `<th>${escapeHtml(key)}</th>`)
            .join("")}</tr></thead><tbody>${rows}</tbody></table></div>`
        : `<p class="panel-sub">${escapeHtml(warehouse.error || "No matching rows in this period.")}</p>`
    }
    <pre class="json-block">${escapeHtml(pretty(warehouse))}</pre>
  `;
}

function renderResult(payload) {
  inspectPlan.textContent = pretty(payload.plan);
  inspectTools.textContent = pretty({
    routed_to: payload.routed_to,
    supervisor_rounds: payload.supervisor_rounds,
    specialist_rounds: payload.specialist_rounds,
    tool_trace: payload.tool_trace,
  });
  renderWarehouse(payload);
  runMeta.textContent = `${payload.model} · org ${payload.context.organization_id} · ${payload.context.period_label} · ${payload.elapsed_ms}ms`;
}

async function readSse(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split;
    while ((split = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      let eventName = "message";
      const dataLines = [];
      frame.split("\n").forEach((line) => {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      });
      if (!dataLines.length) continue;
      onEvent(eventName, JSON.parse(dataLines.join("\n")));
    }
  }
}

async function ask(question) {
  if (state.busy) return;
  const text = question.trim();
  if (!text) return;
  state.busy = true;
  askBtn.disabled = true;
  input.value = "";
  resetInspector();
  const history = state.history.slice();
  appendBubble("out", escapeHtml(text));
  const pending = appendBubble("system", "sql_supervisor is reading the question…");
  setTab("logs");
  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: text, period: state.period, history }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: "Request failed." }));
      throw new Error(err.error || "Request failed.");
    }
    let result = null;
    await readSse(response, (event, data) => {
      if (event === "log") {
        addLog(data);
        pending.textContent = `${data.agent}: ${data.detail || data.state}`;
      }
      if (event === "result") result = data;
      if (event === "error") throw new Error(data.error || "The SQL agent failed.");
    });
    pending.remove();
    if (!result) throw new Error("No result from the SQL agent.");
    state.history.push({ role: "user", content: text });
    state.history.push({ role: "assistant", content: result.reply_text || "" });
    if (state.history.length > 16) {
      state.history = state.history.slice(-16);
    }
    appendBubble("in answer-html", sanitizeHtml(result.reply_html));
    renderResult(result);
    if (result.context?.period_label) {
      periodCaption.textContent = `Trusted window: ${result.context.period_label}`;
    }
  } catch (error) {
    pending.remove();
    appendBubble("error", escapeHtml(error.message || "The SQL agent failed."));
    runMeta.textContent = error.message;
  } finally {
    state.busy = false;
    askBtn.disabled = false;
    input.focus();
  }
}

async function loadSetup() {
  const setup = await fetch("/api/setup").then((res) => res.json());
  state.setup = setup;
  $("setup-model").textContent = setup.model;
  $("setup-org").textContent = setup.organization_id;
  $("setup-warehouse").textContent = setup.warehouse;
  $("setup-live").textContent = setup.live ? "on" : "off";
  periodCaption.textContent = periodLabel();
  thread.innerHTML = `<p class="empty">Ask a question to run sql_supervisor → sql_developer. Logs, plan SQL, and warehouse preview appear on the right.</p>`;
  state.history = [];
  chips.innerHTML = "";
    (setup.samples || []).forEach((sample) => {
      const question = typeof sample === "string" ? sample : sample.question;
      const period = typeof sample === "string" ? state.period : sample.period;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.textContent = question;
      btn.addEventListener("click", () => {
        input.value = question;
        if (period) {
          state.period = period;
          document.querySelectorAll("[data-period]").forEach((el) => {
            el.classList.toggle("is-active", el.dataset.period === period);
          });
          periodCaption.textContent = periodLabel();
        }
        input.focus();
      });
      chips.appendChild(btn);
    });
}

document.querySelectorAll("[data-period]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.period = btn.dataset.period;
    document.querySelectorAll("[data-period]").forEach((el) => {
      el.classList.toggle("is-active", el === btn);
    });
    periodCaption.textContent = periodLabel();
  });
});

document.querySelectorAll("[data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => setTab(btn.dataset.tab));
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  ask(input.value);
});

$("ping-btn").addEventListener("click", async () => {
  $("ping-status").textContent = "Pinging…";
  try {
    const result = await fetch("/api/ping").then((res) => res.json());
    $("ping-status").textContent = result.ok
      ? `ok · ${result.model} · ${result.elapsed_ms}ms`
      : `failed · ${result.reply || "no pong"}`;
  } catch (error) {
    $("ping-status").textContent = error.message;
  }
});

loadSetup().catch((error) => {
  thread.innerHTML = `<div class="bubble error">${escapeHtml(error.message)}</div>`;
});
