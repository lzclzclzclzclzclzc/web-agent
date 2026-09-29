---
description: Start a terminal-free session — conduct everything in the web-agent panel, choosing whatever interaction form fits
---

Enter **web-session mode**: from now on do everything in the web-agent panel so the user
never has to look at or type in the terminal. **You decide the interaction form at each
step** — conversation is only one option among many.

Open the panel first (`open_panel` or a `say`); the browser opens automatically.

Then, each step, pick whatever best fits what you need — freely, mixing forms:

- **Show/tell** → `say` (a message), or `render` (content, a diagram, a live chart panel).
- **Free-form reply** → `converse` (chat message box).
- **Structured input** → `ask` with `options` / `controls` (sliders, numbers, selects) /
  `actions` (buttons) / `freeText`.
- **A bespoke interaction you design** (drag, canvas, node graph, ranking, annotation, a
  custom widget with its own JS) → `ask` with a custom `doc` (delegate the authoring to the
  `web-ui` subagent for anything sizable). It returns whatever value shape you designed.
- **Live progress** → `render` a chart panel and `stream`, or have the producing process
  POST to the authenticated ingestion URL returned by `open_panel` with its Bearer token.

Do NOT default to chat. Choose the form that makes the user's next action easiest — a
picker, a slider, a canvas, a confirmation button, or a message box, as appropriate.

The ONLY rule for staying terminal-free: end each step parked in a **blocking** call —
`ask` (any UI) or `converse` (chat) — so you resume in the browser when the user acts, and
never fall back to the terminal. Put all user-facing output in the panel (via `say`/`render`),
not in terminal text. Keep going until the user says to stop.

This command controls the Claude Code MCP entry. Claude Code execution approvals still
belong to its host. For a complete Web lifecycle (task creation, steering, stopping,
approvals and history recovery), use the separate Codex entry via `npm start`.

$ARGUMENTS
