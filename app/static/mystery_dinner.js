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
      const header = appendToolHeader(name);
      const code = appendCodeBlock(name);
      toolCalls.set(id, { header, code, name, args: "", result: "" });
      break;
    }
    case "TOOL_CALL_ARGS":
    case "TOOL_CALL_CHUNK": {
      const id = payload.toolCallId;
      const entry = toolCalls.get(id);
      if (!entry) break;
      const delta = payload.delta ?? payload.args ?? "";
      entry.args += delta;
      entry.code.querySelector(".args").textContent = entry.args;
      scrollStream();
      break;
    }
    case "TOOL_CALL_RESULT": {
      const id = payload.toolCallId;
      const entry = toolCalls.get(id);
      if (!entry) break;
      const r = payload.content ?? payload.result ?? "";
      entry.result = r;
      const el = entry.code.querySelector(".result");
      el.textContent = `→ ${truncate(String(r), 400)}`;
      el.style.display = "block";
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

function appendToolHeader(name) {
  const el = document.createElement("div");
  el.className = "tool-header";
  if (name === "ask_suspect") el.classList.add("evidence");
  if (name === "accuse") el.classList.add("accuse");
  el.textContent =
    name === "ask_suspect" ? `📎 ${name} — interrogating suspect`
    : name === "accuse" ? `⚖ ${name} — FINAL CALL`
    : `▶ ${name}`;
  streamEl.appendChild(el);
  scrollStream();
  return el;
}

function appendCodeBlock(name) {
  const el = document.createElement("div");
  el.className = "code-block";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = name;
  el.appendChild(label);
  const args = document.createElement("div");
  args.className = "args";
  el.appendChild(args);
  const result = document.createElement("div");
  result.className = "result";
  result.style.display = "none";
  el.appendChild(result);
  streamEl.appendChild(el);
  scrollStream();
  return el;
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
      const label = document.createElement("div");
      label.className = "fact-label";
      label.textContent = `✓ ${f.label}`;
      li.appendChild(label);
      const body = document.createElement("div");
      body.className = "fact-result";
      body.textContent = truncate(String(f.result), 240);
      li.appendChild(body);
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
