# ag2-mystery-dinner

A multi-agent murder-mystery dinner game built on [AG2](https://github.com/ag2ai/ag2)'s `autogen.beta` framework. A detective agent interrogates suspect agents while a commentator narrates, all streamed to an AG-UI front end.

## Status

> **Heads up:** this repo pins `autogen @ git+https://github.com/ag2ai/ag2.git@main`, but currently depends on `autogen.beta.Actor` which has **not yet landed on `main`** (tracked in PR3 / `pr3/actor-merge`). It will crash on import until that PR is merged. Once PR3 is in `main`, `pip install -r requirements.txt` will Just Work.

## Install

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
python -m app.server
# Starlette app serves on http://127.0.0.1:8000
```

Vertex AI auth is required — set up Application Default Credentials (`gcloud auth application-default login`) or point `GOOGLE_APPLICATION_CREDENTIALS` at a service-account JSON.

## Layout

```
app/
  server.py            # Starlette ASGI entrypoint, static + AG-UI routes
  game_master.py       # Orchestrates turns, win/loss state
  commentary.py        # Commentator agent + narration engine
  clock.py             # Game clock
  memory.py            # CASE_MEMORY — interrogation facts, verified clues
  agents/              # Detective, suspect, commentator agent builders
  cases/               # Scenario definitions (Blackwood Estate)
  static/              # Front-end assets served by Starlette
architecture.md        # System diagram and component notes
assets.md              # Asset inventory
mystery_dinner_rules.md # Game rules
Images/                # Suspect/location art
slice*.png             # Design slice screenshots
```
