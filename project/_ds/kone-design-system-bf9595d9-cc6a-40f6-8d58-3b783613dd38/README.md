# KONE Design System

> A design system for **KONE Corporation** — the Finnish people-flow company that makes elevators, escalators, and automatic doors. This kit captures the **2023 brand refresh** so you can prototype KONE-branded apps, sites, and decks at high fidelity.

---

## Sources

- **Reference brand book** (gated): https://brandbook.kone.com/
- **Public KONE materials referenced**: kone.com, KONE Annual Reports, brand-fetch listings, Wikipedia/Wikimedia Commons logo files.
- **Powerpoint template requested**: `Kone PowerPoint template Default June 2023.potx` — the file was referenced but **not actually attached to the project**. Visual specs were therefore reconstructed from the public 2023 KONE visual identity (color, wordmark proportions, "flow of life" tone). When you re-attach the .potx I'll lift exact theme XML colors, fonts, and master slides from it.

> If you have access to the brand book, please attach a PDF export — the sections most useful to extend this system are: extended color tints, illustration style, photography rules, iconography set, and proprietary KONE Information font files.

---

## Company at a glance

KONE Corporation (founded 1910, HQ Espoo, Finland) is one of the world's leading elevator, escalator, and automatic-door manufacturers. The brand promise is **"Flow of life"** — people, goods, and information moving smoothly through buildings and cities. The 2023 rebrand (with Manyone) emphasised hybrid + digital touchpoints, kept the iconic four-block KONE wordmark, and refreshed the blue to a brighter, more digital `#1450F5`.

**Voice/positioning anchors**
- Safe, smooth, sustainable people flow
- Engineering precision meets human-centered design
- Nordic clarity — calm, confident, never flashy

---

## Content fundamentals

KONE writes for a global B2B audience: building owners, architects, facility managers, plus end-riders. Tone is **calm, expert, and grounded in human benefit** — never jargony, never hype.

- **Voice:** professional, plain-spoken, quietly optimistic. Engineers explaining things to a smart non-engineer.
- **Person:** "we" for KONE, "you" for the customer. Avoid "I". Talk about people and buildings, not "users" or "assets".
- **Sentence length:** short to medium. Lead with the benefit; back it up with one fact. Cut adjectives.
- **Casing:** **Sentence case** for headlines, buttons, and nav. The wordmark itself is set in capitals (KONE) and never re-cased. Product names are Title Case ("KONE 24/7 Connected Services", "KONE DX Class").
- **Numbers & units:** SI units, comma thousands separator in EN-US, space thousands in EU locales. "60+ countries", "1.5 million units in service".
- **Punctuation:** Oxford comma. No exclamation marks in marketing copy. Em-dashes for asides.
- **Emoji:** **never** in product UI or marketing. Acceptable in casual internal comms only.
- **Vibe:** Nordic, considered, trustworthy. Headlines often pair a human verb with an infrastructure noun: *"Move people. Move cities forward."*

**Examples (synthesized from KONE marketing patterns)**
- ✅ "Smooth, safe rides — for the life of your building."
- ✅ "Plan smarter people flow with KONE DX Class elevators."
- ✅ "24/7 Connected Services. Fewer surprises, more uptime."
- ❌ "🚀 Revolutionizing vertical transportation!" — too hype, emoji, jargon.
- ❌ "I think you'll love this." — wrong person.

**Headline templates**
- *"[Verb] [people-flow noun]."* — "Move cities forward."
- *"[Number] + [proof point]"* — "1.5 million elevators connected."
- *"[Benefit], for [audience]."* — "Predictable maintenance, for owners who plan ahead."

---

## Visual foundations

### Color
- **Primary:** `#1450F5` KONE Blue — used for the wordmark blocks, primary CTAs, links, key accents. Used boldly and confidently as a flat fill, not as a gradient base.
- **Neutrals:** a warm-cool grey ladder from near-black `#1F2024` to off-white `#F7F8FA`. Body text is dark ink on white; inverted surfaces use KONE Blue OR near-black, never mid-grey.
- **Semantics:** desaturated success/warning/danger that don't out-shout the brand blue.
- **Backgrounds:** mostly white; secondary surfaces use `--bg-soft` (#F7F8FA). Full-bleed blue panels reserved for hero moments and section breaks. **Avoid bluish-purple gradients.** When gradients are used, they're subtle blue-on-blue (`#1450F5 → #0E3DC4`) or photographic.

### Type
- **Brand face:** **KONE Information** by Underware (2012, proprietary). It's a clear, slightly humanist sans with open apertures and grounded weight, designed for elevator displays and brochures.
- **Currently in use:** **Inter** (uploaded brand font, served from `fonts/Inter-Regular.ttf` + `fonts/Inter-SemiBold.ttf`). **⚠️ Flag for the user:** Inter is a stand-in for the proprietary KONE Information typeface; if you have the KONE Information `.woff2` files, drop them in `fonts/` and update the `@font-face` blocks in `colors_and_type.css`. Also: only Regular and SemiBold are uploaded — `font-weight: 700` will synthesize bold from SemiBold; upload `Inter-Bold.ttf` to render true 700.
- Display weights are **bold** (700) with negative tracking. Body is regular (400) at 16px. Captions are medium (500) at 12px with slight uppercase tracking when used as eyebrows.

### Spacing
- 4px base. Most rhythm is `8 / 16 / 24 / 32 / 48 / 64`.
- Generous whitespace — KONE layouts breathe. Nothing should feel crammed.
- Section vertical padding: 96–128px on desktop, 48–64px on mobile.

### Borders, radii, shadows
- **Default radius is 0** — sharp corners echo the four blocks of the wordmark. This is one of the most defining traits.
- Buttons and inputs use a small radius (`--radius-sm` 4px) at most. Pills are reserved for status chips, not primary CTAs.
- Borders are 1px hairlines in `--border` / `--border-strong`. Cards prefer **a border + soft shadow** over heavy shadow.
- Shadows are restrained: `shadow-1` for resting cards, `shadow-2` for elevated/hover, `shadow-3` for floating menus. **Inner shadows are not used.**

### Imagery
- **Photography:** real buildings, real people. Bright, neutral white-balance — never over-saturated. Architectural lines emphasized; elevators and escalators shown in context with people moving through them. **Cool, clean, slightly Nordic** light. No grainy filter, no Instagram tints.
- **Illustration:** schematic and architectural — line drawings of building cross-sections, isometric building cutaways, simple flat infographics. **Never** cartoony characters, hand-drawn doodles, or 3D blob illustrations.
- **Patterns:** the four-block motif of the logo is occasionally used as a decorative grid. Otherwise the brand avoids busy textures.

### Animation & interaction
- **Easing:** standard easing (`cubic-bezier(0.2, 0.8, 0.2, 1)`) for most UI; sharp ease for entry/exit of overlays. **No bouncy springs.**
- **Durations:** 150ms (micro), 240ms (default), 400ms (hero/page).
- **Hover states:** slight darkening (`--kone-blue-700`) for primary buttons; underline-on-hover for links; subtle shadow lift for cards. **No scale transforms on hover** for primary interactions.
- **Press states:** color-only — slightly darker, no shrink. Brief 100ms transition.
- **Focus:** 3px blue focus ring with a tinted offset (`--shadow-focus`). Always visible — accessibility-first.
- **Loading:** thin progress bars or linear shimmer in `--kone-blue-200`. No spinners with character.

### Layout rules
- 12-col grid, 24px gutter, max content width 1280px.
- **Asymmetric, ample whitespace** in marketing layouts; strict grid in app UI.
- Use **full-bleed blue or imagery panels** to break sections. Don't put blue cards on blue backgrounds.
- Sticky elements: headers and side-nav are flat backgrounds with a hairline bottom border on scroll. No floating glass/blur navs.

### Use of transparency & blur
- Overlays for modals: black at 40% opacity, no blur on the underlay.
- Blur is reserved for media (image protection gradients to ensure legible captions). Avoid frosted-glass UI surfaces.

### Cards
- White background, 1px `--border`, `--shadow-1` at rest, `--shadow-2` on hover, **no rounding** by default (or `--radius-sm` for product cards). Internal padding 24–32px.

### Don'ts
- No gradient meshes.
- No glassmorphism.
- No emoji in UI.
- No purple-blue or rainbow gradients.
- No left-color-bar-with-rounded-corners "alert card" trope.
- No invented icon glyphs — copy real assets in.

---

## Iconography

KONE doesn't ship a public icon font. Marketing pages use a mix of simple line icons and architectural pictograms (elevator silhouettes, building cutaways).

**Approach in this kit:**
- **Substitute:** [Lucide](https://lucide.dev) icons via CDN — line, 1.5px stroke, rounded caps. They match KONE's restrained, geometric feel best of the available open icon sets. Imported in UI kit / slide files via:
  ```html
  <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>
  ```
- **⚠️ Flag for the user:** when you have access to KONE's official icon SVGs from the brand bank, drop them in `assets/icons/` and update components to reference them instead of Lucide.
- **No emoji.** No unicode glyph icons. No hand-drawn SVGs.
- **Brand pictograms** (elevator car, escalator, building) — these need real assets from the brand bank. For this kit, components leave icon slots empty or reuse Lucide's `building`, `arrow-up`, `arrow-down`.

---

## Index

```
KONE Design System/
├── README.md                 ← you are here
├── SKILL.md                  ← cross-compatible skill manifest
├── colors_and_type.css       ← all design tokens + element styles
├── assets/
│   ├── kone-logo-primary.png   ← official wordmark, blue blocks (light backgrounds)
│   └── kone-logo-secondary.png ← official wordmark, white knockout (blue/dark backgrounds)
├── preview/                  ← Design System tab cards
├── slides/                   ← KONE deck templates
│   ├── index.html            ← deck shell
│   ├── deck-stage.js
│   └── *.html                ← individual slide types
└── ui_kits/
    └── kone-com/             ← marketing site UI kit
        ├── README.md
        ├── index.html
        └── *.jsx
```

---

## Caveats

- **Source files not received.** The `.potx` PowerPoint template was referenced but not actually attached. Brand book is gated. All visual decisions have been triangulated from public KONE materials and the published 2023 refresh.
- **KONE Information font is proprietary** — substituted with **Manrope**. Drop the real `.woff2` files in `fonts/` to swap.
- **Logo SVG is a faithful reconstruction** of the 4-block wordmark, not the official file. Replace with the brand-bank original when available.
- **Brand-specific iconography** (elevator pictograms, etc.) is not in this kit. Lucide stands in for general UI icons.
