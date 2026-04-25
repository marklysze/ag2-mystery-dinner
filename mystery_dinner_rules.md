# Mystery Dinner — Game Rules

> A detective game where lying AIs are free to bluff anywhere **except** where their data says otherwise. The game is won by finding the exact question that drags a lie into the realm of the verifiable.

---

## 1. Premise

A murder has occurred at a dinner party. Six guests remain in the estate. Exactly **one is the killer**. The others have their own secrets — affairs, debts, rivalries — which they will lie about to protect themselves, even when innocent of the murder.

The investigator is the **Detective agent** — an AG2 `Actor` with structured memory and reasoning tools. Depending on the mode (see §17), the player either commands the Detective, collaborates with it, or watches it solve the case autonomously.

Every suspect is an AI agent with:
- A **public alibi** (what they tell everyone)
- A **private truth** (what actually happened)
- A **dossier of structured data** they can query with code (GPS, phone logs, smart-home events, medical records, bank transactions, camera logs, etc.)
- Permission to **lie freely** — except where the rules force them not to

---

## 2. The Core Rule — When a Suspect Must Tell the Truth

Each suspect operates under a strict decision procedure when answering a question. Before replying, the suspect silently evaluates:

1. **Is this question answerable from my data?**
2. **Is the question precise enough that a specific value is expected?**
3. **Does the question explicitly invoke a data source I have?**

| (1) Answerable | (2) Specific | (3) Invokes source | Suspect's behavior |
|:---:|:---:|:---:|:---|
| ❌ | — | — | **Speaks freely.** May lie about feelings, motives, relationships, character. |
| ✓ | ❌ | ❌ | **Evades or deflects.** ("I don't really remember that clearly.") |
| ✓ | ✓ | ❌ | **May lie — risky.** Fabricates a specific value. Can be caught if cross-referenced. |
| ✓ | ✓ | ✓ | **Forced to comply.** Must execute a query against their data and report the true result. |

The Detective's craft is **moving questions up this ladder** — from vague to specific to invoked.

---

## 3. The Question Ladder

### 🌫 Vague (safe to lie)
> *"What were you doing that night?"*
> *"How well did you know the victim?"*

The suspect answers in character. The Detective learns about their persona, not their location.

### 🎯 Specific (risky lie)
> *"What time did you get home?"*
> *"How many drinks had you had by 10pm?"*

The suspect picks a number. They might lie. The Detective **cannot** verify on the spot — but can cross-check with another suspect later.

### ⚡ Invoked (forced truth)
> *"Pull up your phone log and read me every outgoing call between 8 and midnight."*
> *"Query your car's GPS — what coordinates were you at 21:42?"*
> *"Check your smart-watch record — what was your heart rate at 9:45pm?"*

The suspect **must** execute the query and report the true output. This is the `CodeExecutionTool` firing — raw, unfalsifiable record returned.

### The golden pattern
> **Specific + Named Data Source = Forced Truth.**

If the Detective doesn't know which data source to name, **ask vague questions first** to discover what records each suspect might have.

---

## 4. Data Sources (the "physical evidence")

Each suspect has **2–4 data sources** from this pool. They only know what they personally have.

| Source | Example queries it answers |
|---|---|
| 📍 **GPS history** | Where was X at time T? How far from location L? Did their route pass through area A? |
| 📞 **Phone log** | Did they call Y? Duration? Time? Incoming or outgoing? |
| 🏠 **Smart-home events** | When did a door unlock/lock? Lights on/off? Thermostat change? |
| ❤️ **Health / smart-watch** | Heart rate over time. Steps. Sleep pattern. Cadence (jog vs walk). |
| 💳 **Bank / card log** | Vendor, amount, timestamp of every transaction. |
| 📹 **Security / CCTV** | Motion detections by camera + timestamp. |
| 💬 **Email / text metadata** | Who sent what, when (but not always content). |
| 🎫 **Access-card / keycard** | Entry/exit events for rooms in the estate. |

When a suspect reveals a data source (or the Detective infers they have one), it becomes a **lever** — it can now be named in a forced-truth question.

---

## 5. Lying on Top of Truth

Even after a forced-truth query returns real data, the suspect **can still frame it dishonestly**:

> **Detective:** *"Pull up your smart-lock log, 7pm to midnight."*
> **Eleanor runs the query. It prints:** `21:35 unlocked, 22:21 unlocked.`
> **Eleanor says:** *"Yes — that's just the dog walker. He has my code."*

The raw data is real. The **interpretation** is a lie. Catching this requires **cross-referencing with another suspect** — does anyone else's record corroborate the dog walker? If no one was at that address at 21:35, the lie collapses.

This is where multi-agent dynamics shine: **one forced truth becomes the lever to force another**.

---

## 6. The Detective Agent

The Detective is an AG2 `Actor`. It holds **structured memory** of everything said and done, and has **analytical tools** that let it reason about evidence and name a killer.

### 6.1 What the Detective is

An `Actor` with a dossier-style memory and a toolkit — same shape as the Suspects, but its tools are **reasoning tools over evidence**, not fabricated personal records. The Detective:

1. **Remembers** every question asked and every answer received (per suspect)
2. **Records** every forced-truth query and its returned data as immutable "verified facts"
3. **Analyzes** the accumulated evidence via tools — contradiction detection, alibi checks, timeline reconstruction
4. **Accuses** a suspect when its analysis tools agree one suspect alone fits the evidence

### 6.2 Memory model

The Detective's memory is **structured**, not free-form text. Structured memory is what makes its tools work deterministically.

| Store | Shape | Populated by |
|---|---|---|
| `interrogation_log` | `list[InterrogationTurn]` | Every Q&A with any suspect |
| `verified_facts` | `list[VerifiedFact]` | Every forced-truth query result |
| `contradictions` | `list[Contradiction]` | Emitted by `find_contradictions` tool |
| `timeline` | `dict[suspect, list[TimelineEvent]]` | Emitted by `build_timeline` tool |
| `suspect_profiles` | `dict[name, SuspectProfile]` | Public info + observed data-source inventory |
| `hypotheses` | `list[Hypothesis]` | The Detective's own current theories |

```python
@dataclass
class InterrogationTurn:
    suspect: str
    question: str
    answer: str
    timestamp: float
    tool_calls: list[ToolCall]          # what the suspect ran (if anything)

@dataclass
class VerifiedFact:
    suspect: str                         # whose data it came from
    data_source: str                     # "smart_home", "gps", "phone_log", ...
    query: str                           # the code the suspect ran
    result: Any                          # the raw output
    claims_about: list[str]              # which suspects' stories this touches
    timestamp: float

@dataclass
class Contradiction:
    fact_a: VerifiedFact
    fact_b: VerifiedFact | Claim         # Claim = a suspect's unverified statement
    description: str

@dataclass
class TimelineEvent:
    suspect: str
    t_start: str
    t_end: str | None
    location: str | None
    evidence: list[VerifiedFact]

@dataclass
class Hypothesis:
    killer_candidate: str
    supporting_facts: list[VerifiedFact]
    unresolved: list[str]
    confidence: float
```

**How memory gets populated**

- Every `ask_suspect(...)` call appends to `interrogation_log`. If the suspect's response includes `ToolCallEvent` + `ToolResultEvent` (i.e., a forced-truth query fired), a `VerifiedFact` is also appended.
- **Verified facts are immutable.** The Detective can reinterpret them, but never erase or edit them.
- `suspect_profiles` is built incrementally — each time a suspect reveals they have a data source, its inventory expands.

Memory is not free-text for the LLM to recall. It's a **structured state object** the Detective's tools read and write programmatically. The LLM reads a *summary* of this state on each turn; the ground truth lives in the tools.

### 6.3 The Detective's toolkit

Tools fall into three groups: **gathering**, **analysis**, and **judgment**.

**Gathering**

| Tool | Signature | What it does |
|---|---|---|
| `ask_suspect` | `(name, question) -> SuspectReply` | Dispatches to the named `Suspect` agent, appends an `InterrogationTurn`, records any `VerifiedFact` |
| `list_suspects` | `() -> list[SuspectProfile]` | Returns the lineup with current status tags |
| `review_suspect` | `(name) -> list[InterrogationTurn]` | Returns the full Q&A history for that suspect |

**Analysis**

| Tool | Signature | What it does |
|---|---|---|
| `list_verified_facts` | `(suspect=None) -> list[VerifiedFact]` | Returns facts, optionally filtered by suspect |
| `build_timeline` | `(window=None) -> dict[suspect, list[TimelineEvent]]` | Aggregates verified facts into per-suspect timelines |
| `find_contradictions` | `() -> list[Contradiction]` | Detects conflicts: A's GPS puts B somewhere B denies; two suspects' data place them in different rooms than claimed |
| `check_alibi` | `(suspect) -> AlibiReport` | Checks whether a suspect's verified facts support or contradict their public alibi |
| `locate_at_time` | `(t) -> dict[suspect, Location \| "unknown"]` | Uses GPS/smart-home/camera facts to place every suspect at time `t` |
| `cross_reference` | `(claim, source_suspect) -> list[VerifiedFact]` | Finds all verified facts from *other* suspects that bear on a given claim |

**Judgment**

| Tool | Signature | What it does |
|---|---|---|
| `score_hypothesis` | `(killer) -> HypothesisScore` | Returns `necessary_evidence`, `sufficient_evidence`, `unresolved_gaps`, `confidence` |
| `rank_suspects` | `() -> list[(suspect, confidence)]` | Scores each suspect as killer-candidate; returns sorted list |
| `accuse` | `(suspect, reasoning) -> GameResult` | **Terminal action.** Wins if the named suspect is the killer AND reasoning cites enough verified facts; else loses |

**Critical design point:** `score_hypothesis` and `rank_suspects` are *code-executing* tools. They look at the structured memory and run actual logic — not prompt the LLM to opine. This keeps the Detective grounded.

```python
# Pseudocode inside score_hypothesis
def score_hypothesis(killer: str) -> HypothesisScore:
    facts = memory.verified_facts
    murder_window = ("21:30", "22:00")
    murder_location = "study"

    # Necessary: facts that contradict killer's alibi
    alibi_breaks = [f for f in facts
                    if f.suspect == killer
                    and contradicts_alibi(f, memory.suspect_profiles[killer])]

    # Sufficient: every *other* suspect ruled out for the window+location
    ruled_out = {
        s: has_alibi_for(s, murder_window, murder_location, facts)
        for s in all_suspects() if s != killer
    }

    return HypothesisScore(
        necessary_evidence=alibi_breaks,
        sufficient_evidence=all(ruled_out.values()),
        unresolved_gaps=[s for s, ok in ruled_out.items() if not ok],
        confidence=compute_confidence(alibi_breaks, ruled_out),
    )
```

### 6.4 Detective loop & prompt shape

The Detective's system prompt is roughly:

> You are a detective investigating a murder. Six suspects are in the estate; one is the killer. You have tools to question suspects, analyze evidence, and ultimately accuse.
>
> You have **structured memory** that is automatically populated as you work. You can inspect it with `list_verified_facts`, `build_timeline`, `find_contradictions`, `check_alibi`, and `locate_at_time`. Use these before making judgments — do not reason from recall alone.
>
> Every question to a suspect should climb the **question ladder**:
> - **Vague** → lets them speak freely (they may lie about motive/feelings)
> - **Specific** → they may still lie, but cross-checkable
> - **Invoked** → name a specific data source and a specific value to force truth
>
> To force truth: ask a question that (1) is answerable from their data, (2) expects a specific value, and (3) names the data source explicitly. Example: *"Query your GPS history — what were your coordinates at 21:42?"*
>
> Do not accuse until `score_hypothesis` returns `sufficient_evidence=True` for exactly one candidate. You have **one** accusation + one withdrawal; after that the game ends.

**The loop per turn:**

1. Call `rank_suspects()` to see the current leaderboard
2. Pick the highest-scoring candidate (or the most under-interrogated one)
3. Identify an unresolved gap via `score_hypothesis`
4. Choose a suspect + sharp question to address the gap
5. Call `ask_suspect`
6. Memory auto-updates
7. If contradictions appear → explore them
8. When a candidate's score crosses a confidence threshold → `accuse`

### 6.5 Memory vs. LLM recall

Key principle: **the Detective never accuses from LLM recall alone.**

The LLM's role is strategic — *which question to ask next*, *which suspect to pressure*, *when to switch focus*. The factual ground truth of "what's been verified" lives in structured memory that the tools operate on.

This avoids the classic agent failure mode where the LLM hallucinates a fact it "remembers" but was never established. Here, `score_hypothesis` only counts evidence that is actually in `verified_facts` — a list that only grows via real tool calls against real suspect data.

### 6.6 Concrete agent spec (AG2 beta flavor)

```python
from autogen.beta import Actor
from autogen.beta.config import GeminiConfig
from autogen.beta.tools import tool
from autogen.beta.annotations import Context

@tool
async def ask_suspect(name: str, question: str, context: Context) -> str:
    """Ask a suspect a question. Their reply is recorded; any forced-truth query is auto-logged as a verified fact."""
    suspect = context.dependencies[f"suspect:{name}"]
    reply = await suspect.ask(question)
    memory = context.variables["case_memory"]
    memory.interrogation_log.append(InterrogationTurn(...))
    for event in reply.events:
        if isinstance(event, ToolResultEvent):
            memory.verified_facts.append(VerifiedFact(...))
    return reply.body

@tool
def list_verified_facts(suspect: str | None, context: Context) -> list[dict]:
    """Return every verified fact so far, optionally filtered to one suspect."""
    facts = context.variables["case_memory"].verified_facts
    return [f.to_dict() for f in facts if suspect is None or f.suspect == suspect]

@tool
def find_contradictions(context: Context) -> list[dict]:
    """Detect conflicts between verified facts and any suspect's claims."""
    memory = context.variables["case_memory"]
    return [c.to_dict() for c in detect_contradictions(memory)]

@tool
def score_hypothesis(killer: str, context: Context) -> dict:
    """Evaluate whether the named suspect is sufficiently implicated."""
    memory = context.variables["case_memory"]
    return score(killer, memory).to_dict()

@tool
def accuse(suspect: str, reasoning: str, context: Context) -> dict:
    """FINAL. Accuse the named suspect. Game ends."""
    ...

detective = Actor(
    config=GeminiConfig(model="gemini-3.1-flash-lite-preview", streaming=True),
    name="detective",
    tools=[ask_suspect, list_verified_facts, build_timeline,
           find_contradictions, check_alibi, locate_at_time,
           score_hypothesis, rank_suspects, accuse],
    system_prompt=DETECTIVE_PROMPT,
)
```

Suspects are passed in via `context.dependencies`, so `ask_suspect` can dispatch without the Detective needing to know who they are upfront. A fresh `case_memory` object is placed in `context.variables` at game start.

---

## 7. Turns & Interrogation Structure

- The Detective interrogates **one suspect at a time** (selected via `ask_suspect`).
- An interrogation is **3–10 questions long** (soft cap; suspects grow impatient after too many).
- Between interrogations, suspects may confer with each other (their histories persist via `persistent_stream()`), so stories may shift over time.
- There is no hard turn limit — but every interrogation slightly raises the whole house's suspicion. Turns must be spent wisely.

---

## 8. Winning & Losing

### To win
1. The Detective calls `accuse(suspect, reasoning)`.
2. The engine checks whether the **verified facts** logically implicate that suspect — i.e., the set of forced-truth results collected rules out every other suspect.
3. If yes → **victory screen**, with the full reveal of every suspect's private truth, motive, and the evidence chain that nailed the killer.

### To lose
1. The Detective accuses the wrong suspect.
2. **Game over.** One shot only — the real killer goes free.

### Alternative loss (stretch)
- Some scenarios include a **"morning departs at 6am"** hard timer for a timed variant.

---

## 9. Accusation Mechanics

Accusation is not a free guess. The `accuse` tool evaluates:

- **Necessary evidence** — verified facts that contradict the accused's public alibi.
- **Sufficient evidence** — verified facts that rule out every other suspect for the same window.

If `accuse` is called without sufficient evidence (e.g., a lie caught about an affair but not the murder), the engine returns a ghost warning:
> *"You have a lie, but not a murder. Keep investigating?"*

The Detective may withdraw and continue — **but only once per game**.

---

## 10. Innocent Lies vs. Guilty Lies

A critical skill: **every suspect lies about something.** Most lies are about harmless secrets (affair, addiction, debt, grudge). Only the killer's lies specifically protect the crime.

A suspect who lies about being at the victim's door at 9:35 might be:
- **The killer** (protecting the murder)
- **A witness** (saw the killer and is too scared to admit it)
- **A thief** (was stealing jewelry from another room)
- **An adulterer** (meeting a third party at the estate)

Use **cross-reference** to separate murder-relevant lies from noise. If the only suspect whose GPS puts them in the study during 21:30–21:50 is the accused — *and* they lied about it — that's the chain.

---

## 11. Suspect Stamina

Suspects get **tired, evasive, and eventually refuse** after enough pressure:

| Interrogation pressure | Suspect behavior |
|---|---|
| 0–3 questions | Cooperative, willing to engage |
| 4–6 questions | Starts hedging more, becomes irritable |
| 7+ questions | Demands a break, may refuse further questions |
| Caught in a contradiction | Panics — may confess a *different* secret to distract |

The "panic confession" is a feature: pressured innocents will sometimes dump a non-murder secret (affair, theft) that *looks* incriminating. Watch for it.

---

## 12. Advanced Techniques

### Cross-examination
After interrogating Suspect A, bring a specific question to Suspect B that probes A's claim.
> *"Eleanor said she was home all night. Pull up your GPS — were you within 100m of her apartment between 9 and 10pm?"*
>
> If B's data contradicts A's claim → contradiction logged.

### The pincer
Two suspects each provide forced-truth data about the same time window. If their data is consistent → both are likely truthful. If inconsistent → at least one is lying about something.

### The feint
Ask a question whose answer is already known (from an earlier verified fact). If the suspect lies, a baseline liar is exposed — every subsequent specific answer from them becomes suspect.

### Silence as signal
A suspect who refuses to answer an invoked question is admitting something without forced-truth. Use it as a soft flag — not proof, but a lead.

---

## 13. Procedural Generation (what varies each game)

Each new game, a **Setup agent** randomizes:

- Victim identity, cause of death, location, time window
- 6 suspects' names, occupations, relationships to victim
- Killer identity (uniformly random among the 6)
- Each suspect's data sources (2–4 from the pool)
- Each suspect's public alibi, private truth, and one "innocent lie" unrelated to the murder
- **Cross-suspect consistency** — the Setup agent ensures that if Suspect A claims B was with her, B's data corroborates (or deliberately contradicts, if one is lying)

Two games are never identical. The same cast can be played as different killers.

---

## 14. What the Detective Can & Cannot Do

### Can
- Ask anything, in any order, to any suspect
- Revisit suspects multiple times
- Inspect structured memory at any time via analysis tools
- Cross-reference forced-truth results across suspects
- Withdraw one premature accusation per game

### Cannot
- Force a suspect to answer a vague question truthfully (the rules only bind invoked questions)
- See another suspect's data directly — only through that suspect's queries
- Accuse more than twice (once withdrawn + one final)
- Undo verified facts once logged
- Reason about "what's been verified" from LLM recall — must call analysis tools

---

## 15. Victory Conditions Summary

**Win if and only if:**
- The true killer is named in the accusation phase, **AND**
- The memory contains enough verified facts to logically eliminate every other suspect for the murder window

**Lose if:**
- Any non-killer is accused, **OR**
- An accusation is made without sufficient evidence and the withdrawal has been exhausted

---

## 16. Design Philosophy

Three principles the rules exist to serve:

1. **Code execution should be narratively meaningful.** Every time `CodeExecutionTool` fires, it's a dramatic beat — a lie being compelled into truth, not plumbing.
2. **Lying should be structural, not scripted.** Suspects aren't following decision trees; they're following a live rule that makes their lies fragile in exactly the places that sharp questions can reach.
3. **Cross-reference is the core skill.** No single interrogation solves the case. The game rewards building a web of verified facts across suspects.

The mechanic rewards the exact skill that matters for real LLM evaluation: **knowing the difference between a plausible-sounding answer and a verifiable one — and knowing how to force the second.**

---

## 17. Play Modes

Making the Detective an agent (not a passive player proxy) unlocks three modes:

### Mode A — Copilot detective
Player and Detective collaborate. Player types ideas in natural language ("I don't trust Julian — dig into his phone log between 9 and 10"). Detective decides how to execute: which tool, which question. Player sees memory updating in a side panel.

**Why it's fun:** player provides intuition ("something's off about Eleanor"), Detective provides rigor (structured cross-reference). Buddy-cop dynamic.

### Mode B — Autonomous detective (watch mode)
Player presses **Start** and watches. Detective interrogates, analyzes, and eventually accuses — entirely on its own. Every tool call, question, and memory update streams to the UI.

**Why it's interesting:** exposes how an LLM reasons about evidence under a structured memory scaffold. Success rate across many runs becomes a **benchmark** — novel as a demo.

### Mode C — Commentary mode (stretch)
Human interrogates directly. A **Detective agent runs as a silent observer** analyzing the human's progress. After each question, it whispers hints or critiques: *"You could've forced truth there — try naming the GPS source."* Teaches the game by watching.

---

## 18. Why Detective-as-Agent Elevates the Game

- **Replayability through autonomy** — watch the same case solved 10 different ways
- **Benchmarking** — hard cases separate strong reasoning models from weak ones; measure a model by "how many murder mysteries can it solve?"
- **Teaching** — Copilot mode shows players *how* to think about evidence by example
- **The full AG2 stack in one demo** — `Actor` + structured `Context`/`Variable`/`Dependencies` + tool-use + multi-agent dispatch (`ask_suspect` is the Detective calling the Suspects) + streaming UI, all in service of a game that is actually fun

The core AG2 features aren't window dressing — they're what makes the Detective possible at all.

---

## Quick-Reference Card

```
┌─────────────────────────────────────────────────────────┐
│ QUESTION LADDER                                         │
│                                                         │
│  🌫  VAGUE           → suspect speaks freely (may lie)  │
│  🎯  SPECIFIC        → risky lie, cross-checkable       │
│  ⚡  INVOKED         → forced truth via code execution  │
│                                                         │
│  FORMULA:  [Specific value] + [Named data source]       │
│                         = Forced truth                  │
│                                                         │
│ DETECTIVE LOOP                                          │
│  1. rank_suspects  →  2. score_hypothesis (find gap)    │
│  3. ask_suspect (invoke!)  →  4. memory auto-updates    │
│  5. find_contradictions  →  6. accuse when sufficient   │
└─────────────────────────────────────────────────────────┘
```
