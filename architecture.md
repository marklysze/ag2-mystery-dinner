# Mystery Dinner — Architecture

This document describes how **Mystery Dinner** is built on top of the AG2 beta stack (`autogen/beta/`). It maps every game concept to the concrete beta component that implements it.

Companion docs:
- `mystery_dinner_rules.md` — game rules and Detective agent spec
- `mystery_dinner_game.svg` — UI mockup

---

## 1. System Overview

```
   ┌────────────── Browser (AG-UI front-end) ──────────────┐
   │  HTML/CSS/JS · subscribes to one AG-UI stream per     │
   │  agent · renders detective chat, suspect panels,      │
   │  notebook, commentary feed, game clock                │
   └───────────────┬───────────────────────────────────────┘
                   │  WebSocket / SSE (AG-UI protocol)
                   ▼
   ┌──────────── ASGI app (autogen.beta.ag_ui.asgi) ───────┐
   │  Routes one endpoint per agent → AGUIStream.dispatch  │
   └────────┬────────────────────┬──────────────┬──────────┘
            │                    │              │
            ▼                    ▼              ▼
   ┌──────────────┐      ┌──────────────┐  ┌──────────────┐
   │  Detective   │      │  Commentator │  │  GameMaster  │
   │  Actor       │      │  Actor       │  │  (observer)  │
   │  + knowledge │      │  + knowledge │  │              │
   └──┬─────┬─────┘      └──────────────┘  └──────────────┘
      │     │ subagent delegation (run_task / as_tool)
      │     ▼
      │   ┌─────────────────────────────────────────────┐
      │   │  6 × Suspect Actor                          │
      │   │  each with its own knowledge store (dossier)│
      │   │  each has CodeExecutionTool for forced truth│
      │   └─────────────────────────────────────────────┘
      │
      └── tool: ask_suspect  → subagent_tool(suspect_actor)

   ┌────────── Shared state (one session) ──────────┐
   │  case_memory (Variable)  · game_clock (Watch)  │
   │  verified_facts logs · KnowledgeStore per actor│
   └─────────────────────────────────────────────────┘
```

Every oval is a process-local Python object. Everything that crosses the browser boundary travels as AG-UI events over the single ASGI app.

---

## 2. The Agents

Four agent roles. All are `autogen.beta.Actor` instances. They differ only in their tools, prompt, and knowledge store.

### 2.1 Detective Actor

The investigator. Full tool suite; orchestrates the game.

```python
from autogen.beta import Actor, KnowledgeConfig, TaskConfig, MemoryKnowledgeStore
from autogen.beta.config import VertexAIConfig

detective = Actor(
    name="detective",
    config=VertexAIConfig(model="gemini-3.1-flash-lite-preview", streaming=True),
    prompt=DETECTIVE_PROMPT,

    # Gathering, analysis, and judgment tools (see §4)
    tools=[
        ask_suspect, list_suspects, review_suspect,
        list_verified_facts, build_timeline, find_contradictions,
        check_alibi, locate_at_time, cross_reference,
        score_hypothesis, rank_suspects, accuse,
    ],

    # Persistent case memory — structured state, not free-text
    knowledge=KnowledgeConfig(
        store=MemoryKnowledgeStore(),     # swap for Sqlite/Redis for persistence
        bootstrap=case_memory_bootstrap,  # seeds an empty CaseMemory object
    ),

    # Suspects are reachable as subagents for delegation
    tasks=TaskConfig(
        config=VertexAIConfig(model="gemini-3.1-flash-lite-preview"),
        max_depth=2,
    ),

    # Live game observers (see §5)
    observers=[
        TokenMonitor(...),
        ClockObserver(...),
        AccusationLockObserver(...),
    ],
)
```

**Context bindings** (via `context.dependencies` / `context.variables`):

| Key | Shape | Owner |
|---|---|---|
| `case_memory` | `CaseMemory` dataclass | Detective (read/write) |
| `suspect:{name}` | `Actor` handle for each Suspect | injected at game start |
| `game_start_ts` | `float` | GameMaster |
| `accusation_state` | `"open" \| "withdrawn" \| "final"` | set by `accuse` tool |

### 2.2 Suspect Actors (× 6)

Each suspect is an independently-configured `Actor` with:
- A **private prompt** containing public alibi + private truth + the compliance rule
- `CodeExecutionTool` — fires only when a question meets the forced-truth test (the prompt decides)
- A **private knowledge store** seeded with their dossier (GPS, phone log, smart-home events…)

```python
from autogen.beta.tools.builtin.code_execution import CodeExecutionTool

def build_suspect(profile: SuspectProfile) -> Actor:
    return Actor(
        name=profile.name,
        config=VertexAIConfig(model="gemini-3.1-flash-lite-preview"),
        prompt=render_suspect_prompt(profile),   # alibi + truth + compliance rule
        tools=[CodeExecutionTool()],
        knowledge=KnowledgeConfig(
            store=MemoryKnowledgeStore(),
            bootstrap=dossier_bootstrap(profile.dossier),   # GPS/phone/etc. data
        ),
    )

suspects = {p.name: build_suspect(p) for p in generate_lineup()}
```

**Why a per-suspect knowledge store?** It is the dossier — the "physical evidence" the suspect can query. The compliance rule in their prompt says: *"When a question meets all three gates, run a `CodeExecutionTool` query against your dossier and report the exact result."* The store is what they query.

### 2.3 Commentator Actor

Delivers live color commentary on the investigation — like a sports announcer.

```python
commentator = Actor(
    name="commentator",
    config=VertexAIConfig(model="gemini-3.1-flash-lite-preview", streaming=True),
    prompt=COMMENTATOR_PROMPT,
    tools=[
        list_verified_facts,       # read-only view of the case
        rank_suspects,             # read-only
        peek_last_interrogation,   # read-only
    ],
    observers=[
        CommentaryTriggerObserver(...),   # fires on key moments
    ],
)
```

The Commentator **does not interrogate** — it is a read-only narrator. Its observer (below) watches for dramatic events on the Detective's stream and asks the Commentator to produce a one-liner.

### 2.4 GameMaster (not an `Actor`)

The GameMaster is a session orchestrator — a plain class, not an LLM. It owns:
- Session lifecycle (start, end, accusation terminal)
- The game clock `Watch`
- The AG-UI streams registry
- Ground truth (who the killer is)
- The `accuse` tool's pass/fail evaluation

It has no prompt and no LLM calls. Its job is wiring.

---

## 3. Knowledge, Context, and Memory

### 3.1 The Detective's case_memory

A `CaseMemory` dataclass lives in the Detective's `context.variables["case_memory"]`. Its sub-structures are defined in `mystery_dinner_rules.md §6.2`. Tools mutate it; the LLM reads *summaries* of it via tool calls, never directly.

Persisted via the Detective's `KnowledgeStore` at key `case/memory`. On each turn the `bootstrap` hydrates it; on each tool-invocation it is re-written. Swapping `MemoryKnowledgeStore` for `SqliteKnowledgeStore` gives you save-game.

### 3.2 Suspect dossiers

Each suspect's `KnowledgeStore` holds their private data keyed by source:

```
dossier/gps         → [(timestamp, lat, lng), ...]
dossier/phone_log   → [(timestamp, contact, duration), ...]
dossier/smart_home  → [(timestamp, device, action), ...]
profile/alibi       → "Home all evening, reading."
profile/private     → "Left at 21:35 for victim's apartment..."
profile/innocent_lie→ "Hiding my affair with the chef."
```

The `CodeExecutionTool` sandbox is seeded with these as Python variables at turn start — the suspect agent writes queries like `[(t, a) for t, _, a in smart_home if 19 <= hr(t) <= 23]` and the result streams back.

### 3.3 Why KnowledgeStore over plain dict

The beta `KnowledgeStore` gives us three things for free:
- **`ChangeSubscription`** — the front-end can watch for dossier / memory changes to push UI updates
- **`compact` / `aggregate` strategies** — keep the Detective's working set small without losing verified facts (e.g., compact interrogation_log, preserve verified_facts verbatim)
- **Pluggable backend** — `Memory` for dev, `Sqlite` for save-games, `Redis` for multi-process

---

## 4. Tools

### 4.1 Detective's tools (by group)

**Gathering**

| Tool | Implementation |
|---|---|
| `ask_suspect(name, question)` | Delegates to the named Suspect via subagent pattern (§6). Records turn in `case_memory.interrogation_log` and any `ToolResultEvent` as a `VerifiedFact`. |
| `list_suspects()` | Read from `context.dependencies` keys matching `suspect:*`. |
| `review_suspect(name)` | Filters `interrogation_log` by suspect. |

**Analysis** — all are pure-Python over `case_memory`:

| Tool | Reads | Returns |
|---|---|---|
| `list_verified_facts(suspect=None)` | `verified_facts` | filtered list |
| `build_timeline(window=None)` | `verified_facts` | `{suspect: [TimelineEvent]}` |
| `find_contradictions()` | `verified_facts`, `interrogation_log` | list of `Contradiction` |
| `check_alibi(suspect)` | `verified_facts`, `suspect_profiles[suspect].alibi` | `AlibiReport` |
| `locate_at_time(t)` | `verified_facts` (GPS/smart-home/camera) | `{suspect: Location \| "unknown"}` |
| `cross_reference(claim, source)` | `verified_facts` | list bearing on claim |

**Judgment**

| Tool | Behavior |
|---|---|
| `score_hypothesis(killer)` | Runs `has_alibi_for` on every other suspect; returns structured score (see rules §6.3). |
| `rank_suspects()` | Calls `score_hypothesis` for each. |
| `accuse(suspect, reasoning)` | **Terminal.** Calls `GameMaster.finalize(suspect, reasoning)`. Emits a `TaskCompleted` or `TaskFailed` event on the stream. |

### 4.2 Suspect's tools

Just `CodeExecutionTool()`. The prompt governs *when* it fires. The sandbox has the dossier pre-loaded.

### 4.3 Commentator's tools

Read-only slices of `case_memory`: `list_verified_facts`, `rank_suspects`, `peek_last_interrogation`. These share implementations with the Detective's analysis tools but are mounted with read-only context.

### 4.4 Optional: Skills and toolkits

For richer cases, wrap common patterns as `Toolkit`:
- `TimelineToolkit` — bundles `build_timeline`, `locate_at_time`, `cross_reference`
- `ForensicsToolkit` — regex/haversine/duration helpers the Detective may want

---

## 5. Subagent Delegation

The Detective reaches a Suspect through `ask_suspect`, which is the subagent entrypoint.

```python
from autogen.beta.annotations import Context
from autogen.beta.tools.subagents import run_task, persistent_stream

@tool
async def ask_suspect(name: str, question: str, context: Context) -> str:
    """Ask a suspect a question. Dispatches to their Actor via run_task."""
    suspect: Actor = context.dependencies[f"suspect:{name}"]

    # persistent_stream() keeps per-suspect history across calls
    # so "are you sure about your earlier answer?" works
    result = await run_task(
        suspect,
        objective=question,
        stream_factory=persistent_stream(),
        context=context,
    )

    # Record in Detective's case_memory
    memory: CaseMemory = context.variables["case_memory"]
    turn = InterrogationTurn(
        suspect=name, question=question, answer=result.body,
        timestamp=now(), tool_calls=result.tool_calls,
    )
    memory.interrogation_log.append(turn)

    # Auto-log any forced-truth queries as VerifiedFact
    for ev in result.events:
        if is_tool_result(ev):
            memory.verified_facts.append(fact_from_event(ev, suspect=name))

    return result.body
```

**Why subagents vs. plain `Actor.ask`:**
- `run_task` gives depth/limits via `TaskConfig(max_depth=2)` — suspects can't recursively spawn more agents
- `persistent_stream()` keeps the suspect's *own* conversation state across interrogations (so they remember what they told you 3 rounds ago — crucial for cross-examination)
- Isolated context copy — child variables don't leak back

**Agent.as_tool() alternative:** for auto-generated tool schemas we could use `suspect.as_tool(description="...")` and let the Detective call `task_{suspect_name}(objective=...)` directly. `ask_suspect` is a thin wrapper that adds the record-keeping.

---

## 6. Streams & AG-UI Front-end

### 6.1 Per-agent streams

The beta `ag_ui` module wraps an `Actor` into an AG-UI-compatible stream:

```python
from autogen.beta.ag_ui.asgi import AGUIStream

detective_stream   = AGUIStream(detective)
commentator_stream = AGUIStream(commentator)
suspect_streams    = {name: AGUIStream(a) for name, a in suspects.items()}
```

Each `AGUIStream` exposes an ASGI `HTTPEndpoint`:

```python
from starlette.applications import Starlette
from starlette.routing import Route

routes = [
    Route("/agent/detective",   detective_stream.build_asgi()),
    Route("/agent/commentator", commentator_stream.build_asgi()),
    *[Route(f"/agent/suspect/{n}", s.build_asgi()) for n, s in suspect_streams.items()],
]
app = Starlette(routes=routes)
```

The front-end opens one AG-UI channel per visible agent and pipes events into the correct panel.

### 6.2 What the front-end subscribes to

- **Detective panel** → `/agent/detective` — streams the Detective's thinking, tool calls, and returned text
- **Suspect panels** (×6) → `/agent/suspect/{name}` — streams each interrogation turn live, including `CodeExecutionTool` fires that light up the "EVIDENCE FORCED" banner
- **Commentary feed** → `/agent/commentator` — streams short color commentary between investigations
- **Case notebook** → subscribes to `case_memory` via `KnowledgeStore.ChangeSubscription` — re-renders verified facts + contradictions on change

### 6.3 HTML scaffold (game screen)

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Mystery Dinner</title>
  <link rel="stylesheet" href="/static/mystery_dinner.css" />
</head>
<body class="game">
  <header class="topbar">
    <h1>🕵️ Mystery Dinner — <span id="case-name">The Blackwood Estate</span></h1>
    <div class="clock" id="game-clock">⏱ 12:34 remaining</div>
    <div class="accusation-state" id="accuse-state">1 accusation left</div>
  </header>

  <main class="grid">
    <!-- Suspect lineup (left rail) -->
    <aside class="lineup" id="suspect-list">
      <!-- One <button class="suspect" data-name="..."> per suspect -->
    </aside>

    <!-- Detective chat (center) -->
    <section class="detective" id="detective-panel">
      <div class="stream" id="detective-stream"></div>
      <form class="composer" id="composer">
        <input type="text" name="q" placeholder="Direct the detective…" />
        <button>→</button>
      </form>
    </section>

    <!-- Notebook (right rail) -->
    <aside class="notebook" id="notebook">
      <section id="verified-facts"><h3>Verified facts</h3><ul></ul></section>
      <section id="contradictions"><h3>Contradictions</h3><ul></ul></section>
      <section id="leads"><h3>Leads</h3><ul></ul></section>
    </aside>

    <!-- Suspect interrogation stream (modal / full-width when suspect is focused) -->
    <section class="suspect-view" id="suspect-view" hidden>
      <header id="suspect-header"></header>
      <div class="stream" id="suspect-stream"></div>
    </section>

    <!-- Commentary feed (bottom) -->
    <footer class="commentary" id="commentary-feed">
      <h4>📻 Commentary</h4>
      <ol id="commentary-list"></ol>
    </footer>
  </main>

  <script type="module" src="/static/mystery_dinner.js"></script>
</body>
</html>
```

### 6.4 Front-end wiring (vanilla JS sketch)

```js
// /static/mystery_dinner.js
import { openAGUIStream } from "/static/agui-client.js";

const D = openAGUIStream("/agent/detective");
D.on("text.delta",       e => append("#detective-stream", e.delta));
D.on("tool.call.start",  e => renderToolStart(e));
D.on("tool.call.end",    e => renderToolEnd(e));
D.on("task.completed",   e => renderVerdict(e));

const C = openAGUIStream("/agent/commentator");
C.on("text.delta", e => appendCommentary(e.delta));

const suspects = {};
for (const name of LINEUP) {
  const S = openAGUIStream(`/agent/suspect/${name}`);
  S.on("text.delta",      e => appendSuspectStream(name, e.delta));
  S.on("tool.call.start", e => showEvidenceBanner(name));
  S.on("tool.result",     e => renderForcedTruth(name, e));
  suspects[name] = S;
}

// Notebook updates via KnowledgeStore change subscription (exposed through its own SSE route)
const N = new EventSource("/knowledge/detective/case_memory/changes");
N.addEventListener("verified_fact", e => addFact(JSON.parse(e.data)));
N.addEventListener("contradiction", e => addContradiction(JSON.parse(e.data)));
```

---

## 7. Observers

`autogen.beta.observer.BaseObserver` drives two game-critical behaviors: live commentary triggers and game-state alerts. Each observer is armed by a `Watch` (`EventWatch`, `CadenceWatch`, `IntervalWatch`, `DelayWatch`, combinators).

### 7.1 CommentaryTriggerObserver

Fires when the Detective does something narratively interesting, then asks the Commentator to produce a one-liner.

```python
from autogen.beta import BaseObserver, EventWatch, AnyOf, ObserverAlert, Severity

class CommentaryTriggerObserver(BaseObserver):
    """Generate live commentary on dramatic moments."""

    def __init__(self, commentator: Actor):
        super().__init__(
            name="commentary_trigger",
            watch=AnyOf(
                EventWatch(ToolResultEvent, predicate=is_forced_truth),
                EventWatch(ToolResultEvent, predicate=is_contradiction_found),
                EventWatch(TaskCompleted),                 # accusation resolves
            ),
        )
        self._commentator = commentator

    async def process(self, events, ctx):
        last = summarize(events)
        # Commentator produces one line and streams it on its own AG-UI channel
        await self._commentator.ask(
            f"React in one vivid sentence, as a live sports-style announcer: {last}"
        )
        return ObserverAlert(
            source=self.name,
            severity=Severity.INFO,
            message=f"Commentary generated: {last}",
        )
```

The `Watch` subsystem means the observer doesn't poll — it's event-driven, with the trigger predicate deciding whether the event is interesting.

### 7.2 ClockObserver (game time limit)

Uses `IntervalWatch` to tick every minute and fires a `HaltEvent` when time runs out.

```python
from autogen.beta import IntervalWatch, HaltEvent

class ClockObserver(BaseObserver):
    def __init__(self, duration_seconds: int):
        super().__init__(
            name="game_clock",
            watch=IntervalWatch(every_seconds=60),
        )
        self._deadline = time.time() + duration_seconds

    async def process(self, events, ctx):
        remaining = self._deadline - time.time()
        if remaining <= 0:
            # Force the Detective to either accuse or forfeit
            return ObserverAlert(
                source="clock",
                severity=Severity.ERROR,
                message="Morning has come. Accuse now or the killer escapes.",
                halt=True,          # becomes a HaltEvent if honored
            )
        # Soft warnings at 5 / 2 / 1 minutes left
        if remaining in WARNING_THRESHOLDS:
            return ObserverAlert(source="clock", severity=Severity.WARNING,
                                 message=f"⏳ {int(remaining/60)} minutes remaining.")
        return None
```

### 7.3 AccusationLockObserver

Watches for the `TaskCompleted` event emitted by `accuse()` and locks further interrogation.

### 7.4 Built-ins worth wiring

- `TokenMonitor` — budget guard; logs when a suspect interrogation uses too much context
- `LoopDetector` — kills the Detective if it asks the same suspect the same question three times in a row (common LLM failure mode)

---

## 8. Watches

The `Watch` primitive is how we model *time* and *sequencing* without a central scheduler:

| Watch | Used for |
|---|---|
| `EventWatch` | "fire when a specific event appears" (e.g., a tool result) |
| `IntervalWatch(every_seconds=60)` | game clock tick |
| `CadenceWatch` | commentary rate limit — "at most one quip per 20 seconds" |
| `DelayWatch` | post-accusation reveal pacing |
| `AllOf` / `AnyOf` / `Sequence` | compose predicates (see CommentaryTriggerObserver) |
| `CronWatch` | scheduled checks — unused in single-session play but handy for leaderboard/async modes |

**Commentary rate limit example:**

```python
watch = AllOf(
    AnyOf(
        EventWatch(ToolResultEvent, predicate=is_forced_truth),
        EventWatch(ToolResultEvent, predicate=is_contradiction_found),
    ),
    CadenceWatch(min_interval_seconds=20),   # throttle
)
```

---

## 9. Game Flow

### 9.1 Session start

1. Player opens the page.
2. Front-end requests `POST /game/new` → the GameMaster:
   - Runs the **Setup agent** (an `Actor` used once, see §10) to generate victim, lineup, dossiers, killer identity, cross-suspect consistency.
   - Builds 6 `Suspect` Actors with their knowledge stores seeded.
   - Builds the `Detective` Actor with `case_memory` bootstrapped.
   - Builds the `Commentator` Actor.
   - Wires `context.dependencies` for the Detective: `{"suspect:Eleanor": eleanor_actor, ...}`.
   - Registers each Actor's AG-UI endpoint on the ASGI app.
   - Arms `ClockObserver`, `CommentaryTriggerObserver`, `AccusationLockObserver`.
3. Returns session IDs and endpoint URLs to the front-end.

### 9.2 Interrogation loop

Per turn:

1. Player either types a free-form command to the Detective *or* presses "Autonomous" to let the Detective drive.
2. Detective calls `rank_suspects()` → `score_hypothesis(top_candidate)` → identifies an unresolved gap.
3. Detective calls `ask_suspect(name, question)`.
4. `ask_suspect` uses `run_task(suspect, objective=question, stream_factory=persistent_stream())`.
5. Suspect Actor streams its answer on `/agent/suspect/{name}`:
   - **Vague question** → text only, no tool call
   - **Invoked question** → `CodeExecutionTool.call` event → sandbox runs query against dossier → `tool.result` event with real data
6. `ask_suspect` writes back to `case_memory`: an `InterrogationTurn` always; a `VerifiedFact` if the tool fired.
7. `CommentaryTriggerObserver` sees the forced-truth event → triggers Commentator → one sentence streams to commentary feed.
8. If `find_contradictions()` now returns a new conflict, notebook UI updates.
9. Loop.

### 9.3 Accusation & end

1. Detective calls `accuse(name, reasoning)`.
2. `accuse` calls `GameMaster.finalize(name, reasoning)`:
   - Checks ground truth (name == killer?)
   - Checks `reasoning` cites ≥ N `VerifiedFact` IDs from `case_memory`
   - Emits `TaskCompleted` (win) or `TaskFailed` (wrong / insufficient)
3. `AccusationLockObserver` emits a `HaltEvent` to stop the Detective loop.
4. Front-end shows the reveal screen — per-suspect full dossier, the killer's private truth, and the evidence chain that closed the case.

### 9.4 One-withdrawal rule

If `accuse` is called with insufficient evidence *and* `case_memory.accusation_state == "open"`, it flips the state to `"withdrawn"` instead of ending the game. The Detective gets a ghost warning in its reply and can continue. A second insufficient accusation ends the game as a loss.

---

## 10. Procedural Generation (Setup agent)

A one-shot `Actor` used only at `/game/new`:

```python
setup = Actor(
    name="setup",
    config=VertexAIConfig(model="gemini-3.1-flash-lite-preview"),
    prompt=SETUP_PROMPT,
    response_schema=CaseDefinition,   # pydantic schema: victim, suspects, killer, dossiers
)

async def new_case() -> CaseDefinition:
    reply = await setup.ask("Generate a dinner-party murder mystery.")
    return await reply.content()
```

The `response_schema` contract forces the model to emit a validated `CaseDefinition` — the GameMaster then seeds each Suspect's knowledge store from it. Cross-suspect consistency is handled by a post-generation validator: if A's GPS claims B was with her, B's GPS must corroborate (within tolerance) unless the validator explicitly marks the claim as a lie.

---

## 11. Directory Layout

```
mystery_dinner/
├── architecture.md              ← this file
├── mystery_dinner_rules.md
├── mystery_dinner_game.svg
├── app.py                       # ASGI app: all AG-UI endpoints
├── game_master.py               # session orchestration, ground truth, accuse() eval
├── agents/
│   ├── detective.py             # Detective Actor + prompt
│   ├── suspect.py               # build_suspect(), suspect prompt renderer
│   ├── commentator.py           # Commentator Actor + prompt
│   └── setup.py                 # Setup Actor + CaseDefinition schema
├── tools/
│   ├── gathering.py             # ask_suspect, list_suspects, review_suspect
│   ├── analysis.py              # build_timeline, find_contradictions, ...
│   └── judgment.py              # score_hypothesis, rank_suspects, accuse
├── memory/
│   ├── case_memory.py           # CaseMemory, InterrogationTurn, VerifiedFact, ...
│   └── bootstrap.py             # KnowledgeStore bootstraps
├── observers/
│   ├── commentary_trigger.py
│   ├── clock.py
│   └── accusation_lock.py
└── static/
    ├── index.html               # game screen (see §6.3)
    ├── mystery_dinner.css
    ├── mystery_dinner.js
    └── agui-client.js           # AG-UI SSE/WebSocket client
```

---

## 12. Mapping: Game Concept → Beta Component

| Game concept | AG2 beta component |
|---|---|
| Detective / Suspects / Commentator | `autogen.beta.Actor` (+ `KnowledgeConfig`, `TaskConfig`) |
| Case memory (verified facts, timeline, contradictions) | `KnowledgeStore` (`MemoryKnowledgeStore` / `SqliteKnowledgeStore`) + `Context.variables` |
| Suspect dossiers (GPS, phone, smart-home) | per-suspect `KnowledgeStore` with `bootstrap=` |
| Forced truth | `CodeExecutionTool` — invoked from Suspect prompt compliance rule |
| Detective → Suspect dispatch | `run_task` + `persistent_stream` from `tools.subagents` |
| Live commentary | `Commentator` Actor + `CommentaryTriggerObserver` (`BaseObserver`) |
| Dramatic moment detection | `EventWatch` + `AnyOf` + `CadenceWatch` rate limit |
| Game time limit | `ClockObserver` with `IntervalWatch` + `HaltEvent` |
| Accusation lock | `AccusationLockObserver` + `HaltEvent` |
| Front-end streaming | `autogen.beta.ag_ui.AGUIStream` + ASGI mount |
| Notebook reactive updates | `KnowledgeStore.ChangeSubscription` → SSE |
| Procedural case generation | Setup `Actor` with `response_schema=CaseDefinition` |
| Budget / safety guards | built-in `TokenMonitor`, `LoopDetector` observers |
| Free-text input from player | front-end POST → Detective's `ask` with player's text as part of the prompt |

Every row is a one-to-one mapping. There is no custom harness code needed beyond the glue — the beta stack *is* the game engine.
