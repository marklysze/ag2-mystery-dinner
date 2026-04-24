# Mystery Dinner — Graphic Assets Spec

Complete inventory of art/icons the game needs, grouped by priority. Sizes, formats, and counts are listed against every asset so this doc can be handed to a designer or image-generation pipeline directly.

Companion docs:
- `architecture.md` — system architecture
- `mystery_dinner_rules.md` — game rules + Detective agent spec
- `mystery_dinner_game.svg` — UI mockup

---

## Tier 1 — Must-have (for a playable demo)

### 1.1 Suspect portraits (×6 per case)

The face of each interrogation. Shown in the lineup rail, the interrogation header, and the reveal screen.

| Asset | Size | Format | Notes |
|---|---|---|---|
| Portrait (primary) | **512 × 512** | PNG or WEBP, transparent or solid bg | Interrogation header, reveal screen |
| Portrait (thumb) | **96 × 96** | same source, downscaled | Lineup rail |
| Avatar icon | **48 × 48** | same | Chat bubbles, commentary attributions |

- **Count:** 6 portraits used per case, but cases are procedurally generated → maintain a pool of **~12–16 portraits**. The Setup agent picks 6 per run.
- **Occupation mix:** librarian, chef, heir, doctor, gardener, driver, maid, accountant, artist, pilot, scientist, journalist.
- **Style guide:** painterly noir / moody lighting, chest-up framing, neutral expressions. Reference: Clue reboot, Disco Elysium character cards.
- **Aspect:** 1:1 square.

### 1.2 Location / case banner

Establishing shot at the top of the game screen.

| Asset | Size | Format |
|---|---|---|
| Banner (wide) | **1920 × 540** | PNG / WEBP / JPEG |
| Banner (mobile) | **900 × 540** | same |

- **Count:** **3–5 locations** (Estate, Yacht, Penthouse, Ski Chalet, Country Manor).
- **Style:** gothic mansion, dimly-lit dining room, fog-wreathed exterior. Each archetype gets one.
- Each archetype needs both wide + mobile variants.

### 1.3 Suspect status icons

Small glyphs on suspect cards indicating their interrogation state.

| Icon | Size | Format | Meaning |
|---|---|---|---|
| ✓ cleared | 24 × 24 | SVG | Alibi holds |
| ⚠ under pressure | 24 × 24 | SVG | Contradiction detected |
| ✗ caught lying | 24 × 24 | SVG | Verified lie on record |
| ? unquestioned | 24 × 24 | SVG | Not yet interviewed |
| ⏸ fatigued | 24 × 24 | SVG | Stamina exhausted |
| 🎯 current | 24 × 24 | SVG | Currently being interrogated |

**SVG only** — crisp at any scale, CSS-recolorable. 6 icons total.

### 1.4 Data-source icons

For dossier badges ("this suspect has GPS, phone, smart-home…").

| Source | Icon subject | Size | Format |
|---|---|---|---|
| GPS history | map pin | 32 × 32 | SVG |
| Phone log | telephone receiver | 32 × 32 | SVG |
| Smart-home | house | 32 × 32 | SVG |
| Health / watch | heart + pulse line | 32 × 32 | SVG |
| Bank / card | credit card | 32 × 32 | SVG |
| CCTV | camera | 32 × 32 | SVG |
| Email / text | envelope | 32 × 32 | SVG |
| Keycard | card / swipe | 32 × 32 | SVG |

**8 icons total.** All available from **Lucide** (https://lucide.dev) under MIT at zero cost — no custom commission needed.

### 1.5 UI primitives

Branding + chrome.

| Asset | Size | Format | Notes |
|---|---|---|---|
| Favicon | 32 × 32 + 16 × 16 | ICO (multi-size) | Magnifying glass over fingerprint |
| Logo (wordmark) | 512 × 128 | SVG | "🕵️ Mystery Dinner" |
| Logo (mark only) | 128 × 128 | SVG | Square — for loader / app icon |
| Loading spinner | 64 × 64 | SVG (animated) | |
| "Evidence forced" banner bg | 1200 × 48 | CSS gradient | No asset — use CSS |

### 1.6 Commentator avatar

If commentary feed shows the speaker.

| Asset | Size | Format |
|---|---|---|
| Commentator avatar | 96 × 96 | PNG or SVG |

Suggested style: stylized vintage microphone silhouette, or a period-accurate radio-announcer figure.

---

## Tier 2 — High value, low cost (polish)

### 2.1 Evidence visualization

Charts (GPS tracks, heart-rate curves) are rendered on the fly from real data — no static assets. But you do need backdrops:

| Asset | Size | Format | Notes |
|---|---|---|---|
| Map background tile | 800 × 600 | PNG | Street map of estate neighborhood for GPS overlays. Grayscale, stylized. |
| Floor plan of estate | 1200 × 900 | SVG | Top-down rooms (study, library, kitchen, dining, bedrooms). Stylized. Also used in the reveal. |

### 2.2 Card frames / backgrounds

Subtle textures instead of flat fills.

| Asset | Size | Format | Notes |
|---|---|---|---|
| Parchment texture | 512 × 512 tileable | PNG/JPEG | Notebook panel bg |
| Dark wood / fabric | 512 × 512 tileable | PNG/JPEG | Main app bg |
| Chalkboard texture | 512 × 512 tileable | PNG/JPEG | Contradictions panel bg |

All **optional** — CSS gradients cover ~80% of this style.

### 2.3 Reveal screen stills

Dramatic final beats.

| Asset | Size | Count |
|---|---|---|
| "Killer caught" hero | 1600 × 900 | 1 per case archetype — 3–5 total |
| "Killer escaped" hero | 1600 × 900 | 1 per archetype |

Same art direction as case banners. Can be reused location art with relighting if budget-tight.

---

## Tier 3 — Nice to have

### 3.1 Animated moments

Short (1–2 s) Lottie/SVG animations for dramatic beats.

| Moment | Format | Max size | Notes |
|---|---|---|---|
| Tool fires (evidence forced) | Lottie JSON | < 50 KB | Pulse / lens-flare behind suspect portrait |
| Contradiction found | Lottie JSON | < 50 KB | Two lines crossing, clash icon |
| Verdict — correct | Lottie JSON | < 50 KB | Check-mark burst |
| Verdict — wrong | Lottie JSON | < 50 KB | Cross + shatter |

Source: **LottieFiles** community library has free assets that fit.

### 3.2 Sound pack (not graphic but worth naming here)

For an audio-enabled build later:

| Cue | Length | Format |
|---|---|---|
| Typewriter / keystroke (streaming text) | 1–2 s | WAV |
| Code-exec "whoosh" | 1 s | WAV |
| Gavel / door-slam (accusation) | 2 s | WAV |
| Ambient estate drone (loop) | 30 s | WAV |

---

## What to skip entirely

- **Individual tool-call icons** — text/emoji badges are cheaper and clearer
- **Per-suspect name plates** — render with CSS typography
- **Background videos** — perf cost outweighs vibe gain
- **Complex cursors** — stick with system defaults

---

## MVP total asset count

Tier 1 only:

| Asset | Count |
|---|---|
| Portraits (512 × 512) | 14 (pool of 14, 6 used per case) |
| Location banners (1920 × 540 + 900 × 540) | 3 archetypes × 2 variants = 6 |
| Logo | 1 (SVG) |
| Favicon | 1 (ICO multi-size) |
| Commentator avatar | 1 |
| Data-source icons | 8 (Lucide — free) |
| Status icons | 6 (Lucide — free) |

**Actual custom commission work:**
1. **14 suspect portraits** — image-gen batch or illustrator
2. **3–5 location banners** — same pipeline
3. **1 logo** — designer or image-gen

Everything else is either free (Lucide SVGs) or CSS.

---

## Recommended pipeline

1. Generate portraits + locations with an image model; produce ~30, cull to the final set
2. Pull all functional SVG icons from Lucide (MIT-licensed, direct SVG download)
3. CSS gradients + type for remaining chrome
4. Add Lottie animations last, only after the core loop feels right

---

## File / folder convention

Propose placing assets under `mystery_dinner/static/assets/`:

```
static/assets/
├── portraits/
│   ├── librarian_01.png         # 512×512 primary
│   ├── librarian_01@thumb.png   # 96×96 auto-generated
│   ├── chef_01.png
│   └── ... (14 total)
├── locations/
│   ├── estate_wide.jpg          # 1920×540
│   ├── estate_mobile.jpg        # 900×540
│   ├── yacht_wide.jpg
│   └── ... (3–5 archetypes × 2)
├── icons/
│   ├── status/                  # 6 SVGs (24×24)
│   └── data-source/             # 8 SVGs (32×32)
├── brand/
│   ├── logo.svg
│   ├── logo-mark.svg
│   ├── favicon.ico
│   └── commentator.png          # 96×96
├── textures/                    # optional Tier 2
│   ├── parchment.jpg
│   └── ...
└── lottie/                      # optional Tier 3
    ├── evidence_forced.json
    └── ...
```

---

## Naming conventions

- All lowercase, underscores, no spaces
- Size suffixes only when a file has multiple rendered sizes: `portrait@thumb.png`, `portrait@avatar.png`
- Archetype prefix on location files: `estate_*`, `yacht_*`, etc.
- Style-family suffix if you have multiple art treatments: `librarian_01_noir.png`

---

## Size budget (for web delivery)

| Asset class | Per-file target | Total (MVP) |
|---|---|---|
| Portrait (512×512, WEBP) | < 80 KB | 14 × 80 KB ≈ 1.1 MB |
| Portrait thumb (96×96, WEBP) | < 8 KB | 14 × 8 KB ≈ 112 KB |
| Location banner wide (1920×540, WEBP) | < 250 KB | 5 × 250 KB ≈ 1.25 MB |
| Location banner mobile (900×540, WEBP) | < 120 KB | 5 × 120 KB ≈ 600 KB |
| All SVG icons | < 2 KB each | 14 × 2 KB = 28 KB |
| Logo + brand | < 30 KB combined | 30 KB |
| Lottie (if used) | < 50 KB each | 4 × 50 KB = 200 KB |

**Rough MVP total: under 4 MB of static assets**, well within comfortable first-load budget. Serve WEBP with JPEG fallback; preload only the current case's banner + the 6 portraits in play.
