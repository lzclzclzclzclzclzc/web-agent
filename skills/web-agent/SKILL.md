---
name: web-agent
description: >-
  Use whenever a text-only reply is weaker than letting the user SEE or DO something in a
  browser — presenting choices/mockups to pick from, confirming a diagram/design, collecting
  structured input (sliders/forms), a custom interaction (drag/canvas/annotation), or live
  metrics that update in real time. You do NOT build the UI yourself: delegate the whole
  interaction to the `web-ui` subagent and use the answer it returns. Prefer this over ASCII
  art, long option lists, pasting big tables, or asking the user to eyeball raw numbers.
---

# web-agent — rich browser interaction (delegated to the `web-ui` subagent)

There is a local web panel (the `web-agent` MCP server) that shows UI, collects input, and
streams live data. **You do not drive it directly.** All UI work is delegated to the
**`web-ui` subagent**, so the verbose markup and interaction plumbing never enter your
context — you send a brief and receive a structured answer.

## When to reach for it (the general test — not a fixed list)

Decide **per interaction**, using one question:

> **Would the user understand, judge, or act on this better by seeing/doing it than by
> reading it?**

If yes → delegate a rich interaction (below). If the answer is fundamentally words (a
factual reply, a one-line conceptual choice) → just handle it in the conversation. Reach for
the panel when the content is **visual** (layouts, mockups, diagrams, comparisons),
**spatial** (graphs, flows), **manipulable** (sliders/forms/drag), or **live** (values
changing over time). These are categories, not an allowlist — invent new uses freely.

## How to use it — dispatch the `web-ui` subagent

Spawn the **`web-ui`** subagent (via the Agent/Task tool) with a brief containing:

- **Goal** — what the user is deciding/providing (e.g. "pick one of 3 homepage layouts").
- **What to show** — options, the data/mockup/diagram, or the interaction to design.
- **Answer shape** — exactly what you need back (e.g. "return the chosen layout id and any
  note").

The subagent builds the UI (declarative, freehand, or a fully custom interactive document),
the panel opens in the user's browser automatically, it waits for the user to submit, and it
returns **only the structured answer**. You then act on that answer. Do not call the panel's
render/ask/stream tools yourself — that is the subagent's job, and doing it yourself would
pull UI markup into your context.

Example briefs:

- "Show these 3 mockups (paths …) and ask the user to pick one; return the id + any note."
- "Collect detection params: confidence 0–1, IoU 0–1, model {yolov8s,yolov8m}; return the values."
- "Let the user drag-rank these 6 items; return the ordered list of ids."
- "Confirm this architecture diagram (I'll pass the description); return approve/revise + notes."

## Live monitoring

For training/long-task metrics, brief `web-ui` to set up a live panel (charts); the
**producing process** POSTs `{channel,value}` to the panel's `/ingest` endpoint (the
subagent will tell you the URL), so curves update with no agent turn. Delegate another
`web-ui` interaction only when a decision is needed.

## Operational notes

- The `web-agent` tools are allowlisted so the subagent's blocking `ask` never stalls on a
  permission prompt. Keep them allowlisted.
- Raise the client tool-call timeout for long human think-time (the server sends progress
  keep-alives, but clients enforce a hard maximum).
- For a genuinely multi-screen, back-and-forth dialogue where later screens depend on earlier
  ones, dispatch `web-ui` once per step and carry the thread yourself between steps.
