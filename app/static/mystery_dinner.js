// Slice 3 client: 6-suspect lineup, detective driven by user directives.

const streamEl = document.getElementById("stream");
const form = document.getElementById("composer");
const input = document.getElementById("question");
const send = document.getElementById("send");
const caseInfoEl = document.getElementById("case-info");
const suspectsEl = document.getElementById("suspects");
const factsEl = document.getElementById("facts");
const turnsEl = document.getElementById("turns");
const commentaryListEl = document.getElementById("commentary-list");
const clockEl = document.getElementById("clock");
const topbarEl = document.getElementById("topbar");

const threadId = crypto.randomUUID();
const messages = [];

// ---------- Case + suspects bootstrap ----------
async function loadCase() {
  try {
    const c = await fetch("/case").then(r => r.json());
    caseInfoEl.innerHTML = `🎩 <b>${c.title}</b> · victim <b>${c.victim ?? "?"}</b> · murder ${c.murder_window[0]}–${c.murder_window[1]} · ${c.murder_location}`;
    if (c.banner) {
      topbarEl.style.setProperty("--banner-url", `url("${c.banner}")`);
    }
  } catch (e) { console.error(e); }
}

let suspectCards = {};

async function loadSuspects() {
  try {
    const list = await fetch("/suspects").then(r => r.json());
    suspectsEl.innerHTML = "";
    suspectCards = {};
    for (const s of list) {
      const li = document.createElement("li");
      li.className = "suspect-item";
      li.dataset.name = s.name;
      const avatar = s.image
        ? `<img class="portrait" src="/images/${s.image}" alt="${s.display_name}" onerror="this.outerHTML='<div class=&quot;emoji-fallback&quot;>${s.emoji || '🧑'}</div>'"/>`
        : `<div class="emoji-fallback">${s.emoji || '🧑'}</div>`;
      li.innerHTML = `
        <div class="top">
          ${avatar}
          <div>
            <div class="name">${s.display_name}</div>
            <div class="role">${s.occupation}</div>
          </div>
        </div>
        <div class="alibi">“${s.public_alibi}”</div>
        <div class="sources"></div>
        <div class="counters">
          <span class="counter">turns <b data-turns>0</b></span>
          <span class="counter">facts <b data-facts>0</b></span>
        </div>
      `;
      const src = li.querySelector(".sources");
      for (const ds of s.data_sources) {
        const b = document.createElement("span");
        b.className = "source-badge";
        b.textContent = ds;
        src.appendChild(b);
      }
      suspectsEl.appendChild(li);
      suspectCards[s.name] = li;
    }
  } catch (e) { console.error(e); }
}

// ---------- Detective runner ----------

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  send.disabled = true;

  appendTurn("user", text);
  messages.push({ id: crypto.randomUUID(), role: "user", content: text });

  try {
    await runTurn();
  } catch (err) {
    console.error(err);
    appendSystem(`Error: ${err.message}`);
  } finally {
    send.disabled = false;
    input.focus();
  }
});

async function runTurn() {
  const runId = crypto.randomUUID();
  const body = {
    threadId,
    runId,
    state: {},
    messages,
    tools: [],
    context: [],
    forwardedProps: {},
  };

  const response = await fetch("/agent/detective", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const t = await response.text();
    throw new Error(`HTTP ${response.status}: ${t.slice(0, 200)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const asst = { bubble: null, text: "", id: crypto.randomUUID() };
  const toolCalls = new Map();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const record = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      handleRecord(record, asst, toolCalls);
    }
  }

  if (asst.text) {
    messages.push({ id: asst.id, role: "assistant", content: asst.text });
  }
}

function handleRecord(record, asst, toolCalls) {
  const lines = record.split("\n");
  let eventType = null;
  let dataStr = "";
  for (const line of lines) {
    if (line.startsWith("event:")) eventType = line.slice(6).trim();
    else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
  }
  if (!dataStr) return;

  let payload;
  try { payload = JSON.parse(dataStr); } catch { return; }
  const type = payload.type || eventType;

  switch (type) {
    case "TEXT_MESSAGE_START":
      asst.bubble = appendTurn("assistant", "");
      asst.text = "";
      break;
    case "TEXT_MESSAGE_CONTENT":
    case "TEXT_MESSAGE_CHUNK": {
      const delta = payload.delta ?? payload.content ?? "";
      if (!asst.bubble) asst.bubble = appendTurn("assistant", "");
      asst.text += delta;
      asst.bubble.textContent = asst.text;
      scrollStream();
      break;
    }
    case "TEXT_MESSAGE_END": break;
    case "TOOL_CALL_START": {
      const id = payload.toolCallId;
      const name = payload.toolCallName || "tool";
      const card = appendToolCard(name);
      toolCalls.set(id, { card, name, args: "", result: "" });
      break;
    }
    case "TOOL_CALL_ARGS":
    case "TOOL_CALL_CHUNK": {
      const id = payload.toolCallId;
      const entry = toolCalls.get(id);
      if (!entry) break;
      const delta = payload.delta ?? payload.args ?? "";
      entry.args += delta;
      renderToolArgs(entry);
      scrollStream();
      break;
    }
    case "TOOL_CALL_RESULT": {
      const id = payload.toolCallId;
      const entry = toolCalls.get(id);
      if (!entry) break;
      const r = payload.content ?? payload.result ?? "";
      entry.result = String(r);
      renderToolResult(entry);
      scrollStream();
      if (entry.name === "accuse") renderVerdict(r);
      break;
    }
    case "RUN_ERROR":
      appendSystem(`Run error: ${payload.message ?? JSON.stringify(payload)}`);
      break;
  }
}

function appendTurn(role, text) {
  const el = document.createElement("div");
  el.className = `turn ${role}`;
  el.textContent = text;
  streamEl.appendChild(el);
  scrollStream();
  return el;
}

const TOOL_META = {
  list_suspects:        { icon: "👥", label: "Lineup query" },
  ask_suspect:          { icon: "🎙", label: "Interrogation" },
  list_verified_facts:  { icon: "📓", label: "Notebook check" },
  accuse:               { icon: "⚖", label: "Final accusation" },
  _default:             { icon: "▶",  label: "Tool call" },
};

function appendToolCard(name) {
  const meta = TOOL_META[name] || TOOL_META._default;
  const el = document.createElement("div");
  el.className = "tool-card";
  el.dataset.tool = name;
  el.innerHTML = `
    <div class="tool-card-header">
      <span class="tool-icon"></span>
      <span class="tool-name"></span>
      <span class="tool-tag"></span>
    </div>
    <div class="tool-card-args"></div>
    <div class="tool-card-result" hidden></div>
  `;
  el.querySelector(".tool-icon").textContent = meta.icon;
  el.querySelector(".tool-name").textContent = meta.label;
  el.querySelector(".tool-tag").textContent = name;
  streamEl.appendChild(el);
  scrollStream();
  return el;
}

function renderToolArgs(entry) {
  const el = entry.card.querySelector(".tool-card-args");
  let parsed = null;
  try { parsed = JSON.parse(entry.args || "{}"); } catch { /* args still streaming */ }

  if (!parsed) {
    el.innerHTML = `<div class="args-streaming">${escapeHtml(entry.args)}</div>`;
    return;
  }

  if (entry.name === "ask_suspect") {
    const who = titleCase(parsed.name || "?");
    el.innerHTML = `
      <div class="ask-target">${escapeHtml(who)}</div>
      ${parsed.question ? `<div class="ask-question">${escapeHtml(parsed.question)}</div>` : ""}`;
  } else if (entry.name === "list_verified_facts") {
    el.innerHTML = parsed.suspect
      ? `<div class="dim">filter: ${escapeHtml(parsed.suspect)}</div>`
      : `<div class="dim">all suspects</div>`;
  } else if (entry.name === "accuse") {
    const who = titleCase(parsed.suspect || "?");
    el.innerHTML = `
      <div class="ask-target">Accusing ${escapeHtml(who)}</div>
      ${parsed.reasoning ? `<div class="ask-question">${escapeHtml(parsed.reasoning)}</div>` : ""}`;
  } else if (entry.name === "list_suspects") {
    el.innerHTML = ""; // no args of interest
  } else {
    el.innerHTML = renderKeyValues(parsed);
  }
}

function renderToolResult(entry) {
  const el = entry.card.querySelector(".tool-card-result");
  el.hidden = false;
  let parsed = null;
  try { parsed = JSON.parse(entry.result); } catch { /* keep as string */ }

  if (entry.name === "ask_suspect") {
    el.innerHTML = `<div class="suspect-reply">— ${escapeHtml(entry.result)}</div>`;
    return;
  }

  if (entry.name === "list_suspects" && Array.isArray(parsed)) {
    el.innerHTML = parsed.map(s => `
      <div class="lineup-row">
        <span class="lineup-name">${escapeHtml(s.display_name || s.name || "?")}</span>
        <span class="lineup-role">${escapeHtml(s.occupation || "")}</span>
      </div>`).join("");
    return;
  }

  if (entry.name === "list_verified_facts" && Array.isArray(parsed)) {
    if (parsed.length === 0) {
      el.innerHTML = `<div class="dim">No facts on record.</div>`;
      return;
    }
    el.innerHTML = parsed.map(f => `
      <div class="fact-row">
        <div class="fact-row-head">
          <span class="fact-suspect">${escapeHtml(f.suspect || "?")}</span>
          <span class="fact-source">${escapeHtml(f.data_source || "")}</span>
        </div>
        <div class="fact-data">${formatFactResult(f.result)}</div>
      </div>`).join("");
    return;
  }

  if (entry.name === "accuse" && parsed) {
    const outcomeClass =
      parsed.outcome === "win" ? "win"
      : parsed.outcome === "insufficient_evidence" ? "warn"
      : "loss";
    el.innerHTML = `
      <div class="accuse-outcome ${outcomeClass}">${escapeHtml((parsed.outcome || "").replace(/_/g, " "))}</div>
      ${parsed.detail ? `<div class="accuse-detail">${escapeHtml(parsed.detail)}</div>` : ""}`;
    return;
  }

  el.textContent = `→ ${truncate(entry.result, 600)}`;
}

function renderKeyValues(obj) {
  const entries = Object.entries(obj || {});
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `
    <div class="kv">
      <span class="k">${escapeHtml(k)}</span>
      <span class="v">${escapeHtml(typeof v === "string" ? v : JSON.stringify(v))}</span>
    </div>`).join("");
}

function formatFactResult(raw) {
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* fall through */ }

  if (Array.isArray(parsed) && parsed.length && Array.isArray(parsed[0])) {
    return parsed.map(row => `
      <div class="data-row">${
        row.map(v => `<span class="cell">${escapeHtml(formatCell(v))}</span>`)
           .join('<span class="sep">·</span>')
      }</div>`).join("");
  }
  if (Array.isArray(parsed)) {
    return `<div class="data-row">${
      parsed.map(v => `<span class="cell">${escapeHtml(formatCell(v))}</span>`)
            .join('<span class="sep">·</span>')
    }</div>`;
  }
  if (parsed && typeof parsed === "object") {
    return renderKeyValues(parsed);
  }
  return `<div class="data-row"><span class="cell">${escapeHtml(String(parsed ?? raw))}</span></div>`;
}

function formatCell(v) {
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : v.toFixed(4);
  }
  return String(v);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function titleCase(s) {
  return String(s).replace(/\b\w/g, c => c.toUpperCase());
}

function appendSystem(text) {
  const el = document.createElement("div");
  el.className = "turn assistant";
  el.style.color = "var(--evidence)";
  el.textContent = text;
  streamEl.appendChild(el);
  scrollStream();
}

function renderVerdict(raw) {
  try {
    const data = JSON.parse(raw);
    const el = document.createElement("div");
    const kind =
      data.outcome === "win" ? "win"
      : data.outcome === "insufficient_evidence" ? "warn"
      : "loss";
    el.className = `verdict ${kind}`;
    el.innerHTML = `
      <h4>${data.outcome.replace("_", " ")}</h4>
      <div>${data.detail ?? ""}</div>
    `;
    streamEl.appendChild(el);
    scrollStream();
    if (data.game_over) send.disabled = true;
  } catch (e) {
    console.warn("verdict parse failed", e);
  }
}

function scrollStream() { streamEl.scrollTop = streamEl.scrollHeight; }
function truncate(s, n) { return s.length <= n ? s : s.slice(0, n) + "…"; }

// ---------- Notebook SSE ----------

const state = { turns: [], facts: [] };

function startNotebookStream() {
  const es = new EventSource("/notebook/stream");
  es.addEventListener("snapshot", (e) => {
    const snap = JSON.parse(e.data);
    state.turns = snap.turns || [];
    state.facts = snap.facts || [];
    renderNotebook();
  });
  es.addEventListener("turn", (e) => {
    state.turns.push(JSON.parse(e.data));
    renderNotebook();
  });
  es.addEventListener("fact", (e) => {
    state.facts.push(JSON.parse(e.data));
    renderNotebook();
  });
}

function renderNotebook() {
  // Per-suspect counters
  const counts = {};
  for (const t of state.turns) counts[t.suspect] = counts[t.suspect] || { turns: 0, facts: 0 };
  for (const f of state.facts) counts[f.suspect] = counts[f.suspect] || { turns: 0, facts: 0 };
  for (const t of state.turns) counts[t.suspect].turns++;
  for (const f of state.facts) counts[f.suspect].facts++;

  for (const [name, card] of Object.entries(suspectCards)) {
    const c = counts[name] || { turns: 0, facts: 0 };
    card.querySelector("[data-turns]").textContent = c.turns;
    card.querySelector("[data-facts]").textContent = c.facts;
    card.classList.toggle("has-turns", c.turns > 0);
    card.classList.toggle("has-facts", c.facts > 0);
  }

  // Facts list
  if (state.facts.length === 0) {
    factsEl.innerHTML = '<li class="muted">Nothing verified yet.</li>';
  } else {
    factsEl.innerHTML = "";
    for (const f of state.facts) {
      const li = document.createElement("li");
      li.className = "fact-item";
      li.innerHTML = `
        <div class="fact-label">✓ ${escapeHtml(f.label || "")}</div>
        <div class="fact-result">${formatFactResult(f.result)}</div>`;
      factsEl.appendChild(li);
    }
  }

  // Turns list (newest first)
  if (state.turns.length === 0) {
    turnsEl.innerHTML = '<li class="muted">No turns yet.</li>';
  } else {
    turnsEl.innerHTML = "";
    for (const t of [...state.turns].reverse().slice(0, 20)) {
      const li = document.createElement("li");
      li.className = "turn-item";
      const who = document.createElement("div");
      who.className = "who";
      who.textContent = `→ ${t.suspect}`;
      li.appendChild(who);
      const q = document.createElement("div");
      q.className = "q";
      q.textContent = truncate(t.question, 120);
      li.appendChild(q);
      const a = document.createElement("div");
      a.className = "a";
      a.textContent = truncate(t.answer, 180);
      li.appendChild(a);
      turnsEl.appendChild(li);
    }
  }
}

function fmtClock(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `⏱ ${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function startClockStream() {
  const es = new EventSource("/clock/stream");
  es.addEventListener("tick", (e) => {
    const { remaining, expired } = JSON.parse(e.data);
    clockEl.textContent = fmtClock(remaining);
    clockEl.classList.toggle("warn", remaining <= 120 && remaining > 60);
    clockEl.classList.toggle("danger", remaining <= 60 || expired);
    if (expired) {
      clockEl.textContent = "⏱ TIME UP";
    }
  });
}

function startCommentaryStream() {
  const es = new EventSource("/commentary/stream");
  let firstItem = true;
  es.addEventListener("commentary", (e) => {
    const line = JSON.parse(e.data);
    if (firstItem) {
      commentaryListEl.innerHTML = "";
      firstItem = false;
    }
    const li = document.createElement("li");
    li.className = "commentary-item";
    li.textContent = line.text;
    commentaryListEl.prepend(li);
  });
}

loadCase();
loadSuspects().then(() => {
  startNotebookStream();
  startCommentaryStream();
  startClockStream();
});
