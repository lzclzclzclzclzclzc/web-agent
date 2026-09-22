---
name: web-agent
description: >-
  Use whenever a text-only reply is weaker than letting the user SEE or DO something in a
  browser — any time seeing beats describing, or interacting beats typing. Drives the
  `web-agent` MCP server (open_panel, render, ask, stream), which serves a local page the
  user interacts with, clicking one Submit button to hand results back. Not limited to any
  fixed set of use cases; decide per interaction. Prefer this over ASCII art, long option
  lists, pasting big tables, or asking the user to eyeball raw numbers.
---

# web-agent — rich browser interaction

A local web panel the agent drives through four MCP tools. The user interacts in the
browser and clicks one persistent **Submit** button (bottom-right); the agent resumes the
instant they submit — no "type continue" round-trip, because `ask` blocks the tool call.

## Tools

- **`open_panel`** → start the page, return its URL. Call once, tell the user to open it.
- **`render`** → push a screen; returns immediately (no waiting). Declarative content, a
  live-metrics panel (`charts:[{channel,label}]`), or trusted freehand HTML (`html` inline,
  or `htmlPath` to a file — see ui-author below).
- **`ask`** → push a screen and **block until the user submits**; returns their answer
  `{ action, selected, selectedLabels, text, fields }`. This is how you get input.
- **`stream`** → append a datapoint to a chart channel declared via `render`. Non-blocking.

## When to reach for it (the general test — not a fixed list)

Decide **per interaction**, not per session, using one question:

> **Would the user understand, judge, or act on this better by seeing/doing it than by
> reading it?**

If yes, use the panel. If the answer is fundamentally words (a factual reply, a short
conceptual choice you can pose in one line), stay in the terminal — don't route everything
through the browser. This mirrors the Visual Companion's decide-per-question rule.

Reach for the panel when the content is **visual** (layouts, mockups, diagrams, side-by-side
comparisons, look-and-feel), **spatial** (graphs, flows, relationships), **manipulable**
(sliders/knobs/forms the user tunes), or **live** (values that change over time and are
painful to read as a stream of numbers). These are *categories*, not an allowlist —
anything that fits the test qualifies. Examples (illustrative, not exhaustive): picking
among design directions, confirming an architecture drawing, tuning parameters before a
run, watching metrics evolve, triaging a list visually, arranging/ordering items. Invent
new uses freely.

## Interaction model

One persistent Submit button, pinned bottom-right. The user interacts freely (select, drag,
type, use freehand controls) and clicks Submit to send the whole interaction state back.
Declared `actions` are buttons that submit immediately (e.g. Approve / Reject). The Submit
button is enabled only while the agent is actually waiting on an `ask`.

## Building a screen — three tiers, cheapest first

1. **Declarative (default, cheap, safe):** `ask` with `options` (choices), `controls`
   (slider / number / checkbox / text / select — collected into `answer.fields`), `actions`
   (immediate-submit buttons → `answer.action`), and/or `freeText`. No HTML authoring. Use
   this for the large majority of interactions.
2. **Freehand fragment (static visuals):** for a bespoke thing the user must *see* but only
   needs to pick/confirm — mockups, diagrams, comparisons. **Delegate authoring to the
   `ui-author` subagent** (returns a file path), then `render({ htmlPath })` and pair with an
   `ask({ options|actions })`. Scripts do NOT run in a fragment; it's static + collected form
   fields.
3. **Custom interactive UI (maximum freedom):** when you want to *design your own
   interaction* — drag-and-drop, a canvas, a node graph, ranking, a drawing surface, linked
   sliders with a live preview, anything. Ship a full document via `ask({ doc })` (or
   `docPath` from the `ui-author` subagent). It runs in a **sandboxed iframe** with its own
   HTML/CSS/JS, and you define **both the interaction and the shape of the returned value**.

Rule of thumb: choice/value/form → tier 1. See-and-pick a custom visual → tier 2. Invent a
new interaction and return your own data structure → tier 3.

### The `webagent` bridge (tier 3)

Inside a custom document the panel injects `window.webagent` — the only channel out
(everything else is blocked by a sandbox + CSP: no external network, no parent access):

- `webagent.submit(value)` — resolve the `ask` with ANY JSON `value` your UI builds (from
  your own button or completion condition).
- `webagent.onCollect(fn)` — register a getter so the persistent Submit button returns your
  value. Provide this so the global Submit works even without a button of your own.
- `webagent.onStream((channel, value) => …)` — receive live datapoints for custom viz.

So `answer` can be *any shape you designed* (e.g. `{confidence, tags, boxes}`), not just the
declarative `{selected, text, fields}`.

## Design quality for freehand screens

When you (or ui-author) author freehand HTML, apply the **frontend-design** skill's
principles so it doesn't look like generic AI output:

- Commit to a clear, intentional aesthetic direction; refined-minimal and bold-maximal both
  work — what matters is intentionality, not intensity.
- Strong typographic hierarchy; a dominant color with sharp accents beats a timid even
  palette; use CSS variables; add depth/texture over flat fills; purposeful motion on
  high-impact moments (a staggered page-load reveal beats scattered micro-interactions).
- Match implementation complexity to the vision.
- **Contract tension to respect:** the panel is **localhost-only with no external network**,
  so you cannot pull web fonts/CDN assets. Get distinctiveness from layout, spacing, color,
  weight, inline SVG, and CSS — not downloaded fonts. Use only locally-available font
  families; never `<link>`/`@import` a remote font.

## Craft (from the Visual Companion playbook)

- **Scale fidelity to the question:** wireframe for a layout question, polish for a
  look-and-feel question. Don't over-build a rough decision.
- **State the question on the screen** ("Which layout reads more professional?"), not just
  "Pick one."
- **2–4 options per screen.** More than that is a menu, not a choice.
- **Iterate before advancing:** if the user's feedback changes the current screen, push a
  revised screen and re-ask; only move on once the current step is settled.
- **Use real-ish content** when it affects judgment; placeholder lorem hides design issues.
- **Return to the terminal when the browser isn't earning its place** — not every step of a
  task needs the panel.

## Live data without spending turns

`render` a panel with `charts`, then have the **producing process** (training script, long
job) POST `{channel,value}` to `<url>/ingest` (or call `stream`). Curves update over SSE
with no agent turn per tick. Only re-enter with `ask` when a decision is actually needed.

## Answer shape (`ask` returns)

```json
{ "action": "approve|null", "selected": ["id"], "selectedLabels": ["…"],
  "text": "free text", "fields": { "conf": 0.5, "model": "…" } }
```

## Operational notes

- Allowlist the web-agent tools so a blocking `ask` never stalls on a permission prompt.
- Raise the client tool-call timeout for long human think-time (the server sends progress
  keep-alives, but clients enforce a hard maximum).
- The panel is a projection; the server is the source of truth. It binds to localhost only.
