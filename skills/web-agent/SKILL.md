---
name: web-agent
description: >-
  Use whenever a text-only reply is weaker than letting the user SEE or DO something in a
  browser — presenting choices/mockups to pick from, confirming a diagram/design, collecting
  structured input (sliders/forms), a custom interaction (drag/canvas/annotation), or live
  metrics that update in real time, using the web-agent MCP tools in Claude Code. Prefer
  file-backed interfaces so large markup does not enter tool results. The Codex Web entry
  uses its own web_agent dynamic tools and does not require this MCP skill.
---

# web-agent — rich browser interaction for Claude Code

There is a local web panel (the `web-agent` MCP server) that shows UI, collects input, and
streams live data. The main agent can author and publish interfaces directly. For a large
interface, the optional `web-ui` subagent can author a file and return its path, or handle
one complete interaction when the MCP tools are available there. Delegation is optional.

## Runtime contract (v0.2)

- Run `npm run build` before using the MCP/demo entry. `open_panel` returns a local URL
  with a session token and a separate authenticated background ingestion capability.
- The entire viewport belongs to the agent. There is no host sidebar, header, tabs,
  composer or Submit button. Design all navigation and input in your document.
- `render` creates and shows a full-page interface. `ask` without `doc` associates its controls
  with the current interface; it does not erase an earlier render. Another render does
  not cancel an existing input request. Only one pending input per interface is allowed.
- HTML and local file paths are restricted to the MCP process working directory. Use
  self-contained HTML/CSS/JS; no CDN, network fetch or parent DOM access from a page.
- `webagent.submit(value)` is a Promise. Show success only after it resolves; on failure
  preserve inputs and allow retry. `webagent.saveState(object)` persists custom edits
  across browser refresh; `webagent.state` restores them. Provide your own submit button;
  `onRequest` reports whether a fresh input request exists. Declarative ask controls are
  appended inside your page, not in a persistent host strip.
- `webagent.onSession(fn)` exposes status and interface handles for agent-designed
  navigation; `webagent.navigate(id)` switches pages. Escape opens a temporary host menu.
  Codex pages additionally support `webagent.sendMessage(text)` to continue the same
  conversation from a user action; Claude Code uses blocking `ask`/`converse` instead.
- `webagent.onStream(({channel,value,history}) => ...)` receives arbitrary JSON. The
  previous `(channel,value)` callback is also supported.
- Browser refresh preserves a running MCP interaction. MCP sessions are process-local;
  restart/resume of historical Codex tasks belongs to the separate Codex Web entry.
- A page confirmation is structured user feedback, never an authorization to execute
  a command. Claude Code remains responsible for its execution permission prompts.

## When to reach for it (the general test — not a fixed list)

Decide **per interaction**, using one question:

> **Would the user understand, judge, or act on this better by seeing/doing it than by
> reading it?**

If yes → build a rich interaction, optionally delegating authoring. If the answer is fundamentally words (a
factual reply, a one-line conceptual choice) → just handle it in the conversation. Reach for
the panel when the content is **visual** (layouts, mockups, diagrams, comparisons),
**spatial** (graphs, flows), **manipulable** (sliders/forms/drag), or **live** (values
changing over time). These are categories, not an allowlist — invent new uses freely.

## Terminal-free mode (run everything in the panel — but you choose the form)

When the user wants **0 terminal interaction** (the `/web` command bootstraps this), do
everything in the panel. **You decide the interaction form at each step — conversation is
only one option, not the spine.** Mix freely:

- `say(text)` / `render(...)` — show or tell (message, content, diagram, live chart panel).
- `converse(message?)` — a free-form chat reply (blocks for the user's typed message).
- `ask(...)` — structured input: options, controls (sliders/numbers/selects), action
  buttons, free text, or a fully custom interactive `doc` you design (blocks for submit).

Do NOT default to chat. Pick the form that makes the user's next action easiest — a picker,
a slider, a canvas, a confirm button, or a message box. The ONLY rule for staying
terminal-free is: **end each step parked in a blocking call (`ask` or `converse`)** — which
one, and what UI it carries, is your choice — so the agent resumes in the browser when the
user acts and never falls back to the terminal. Delegate sizable custom UI to the `web-ui`
subagent.

Caveat: Claude Code may still require host-side permission confirmation. For the complete
Web task lifecycle, use the Codex entry (`npm start`).

## How to use it — dispatch the `web-ui` subagent

When delegating, give **`web-ui`** a brief containing:

- **Goal** — what the user is deciding/providing (e.g. "pick one of 3 homepage layouts").
- **What to show** — options, the data/mockup/diagram, or the interaction to design.
- **Answer shape** — exactly what you need back (e.g. "return the chosen layout id and any
  note").

The subagent builds the UI (declarative, freehand, or a fully custom interactive document),
the panel opens in the user's browser automatically, it waits for the user to submit, and it
returns **only the structured answer** or authored file path, as requested. You then act on
the answer or publish the file with `docPath`; the tool results do not repeat the markup.

Example briefs:

- "Show these 3 mockups (paths …) and ask the user to pick one; return the id + any note."
- "Collect detection params: confidence 0–1, IoU 0–1, model {yolov8s,yolov8m}; return the values."
- "Let the user drag-rank these 6 items; return the ordered list of ids."
- "Confirm this architecture diagram (I'll pass the description); return approve/revise + notes."

## Live monitoring

For training/long-task metrics, brief `web-ui` to set up a live panel (charts); the
**producing process** POSTs `{channel,value}` to the ingestion URL returned by `open_panel`,
with `Authorization: Bearer <ingestToken>`, so curves update with no agent turn. Keep the
token in the producing process, outside page HTML. Use another interaction when a decision
is needed. The old unauthenticated `/ingest` endpoint is no longer available.

## Multi-page routes

To publish content at a stable URL (a big diagram, a report, an image), the agent/`web-ui`
can `route({ path:'/image', html|htmlPath|filePath })`. Give the user the returned complete
resource URL. Published pages execute under a sandbox CSP; they do not share the host's
privileges. Reserved paths include `/`, `/api/`, `/assets/`, `/src/`, `/events`, `/submit`,
and `/ingest`. Do not assume a link inside a sandboxed custom document can open a popup.

## Operational notes

- The user's existing MCP permissions determine whether a tool call requires confirmation.
  Do not silently change the user's allowlist.
- Raise the client tool-call timeout for long human think-time (the server sends progress
  keep-alives, but clients enforce a hard maximum).
- For a genuinely multi-screen, back-and-forth dialogue where later screens depend on earlier
  ones, dispatch `web-ui` once per step and carry the thread yourself between steps.
