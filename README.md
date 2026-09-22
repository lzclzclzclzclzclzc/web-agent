# web-agent

A universal **agent ↔ human rich-interaction layer** for Claude Code. An MCP server that
spins up a local web page and gives the agent primitives to show UI, collect input, and
stream live data — for when a text-only reply isn't enough.

| Tool | What it does | Blocks? |
|------|--------------|---------|
| `open_panel` | start the page, return its URL | no |
| `render` | push a screen: declarative content, live-metrics panel, or trusted freehand HTML (inline or via `htmlPath`) | no |
| `ask` | push a screen (options / controls / actions / free-text) and **wait until the user clicks Submit**, then return their answer | **yes** |
| `stream` | append a live datapoint to a chart channel | no |

**The core trick:** an MCP tool call suspends the model mid-turn until it returns, so `ask`
**resumes the agent the instant the user clicks Submit in the browser** — no "type
`continue` in the terminal" round-trip.

**Interaction model:** one persistent **Submit** button pinned bottom-right. The user
interacts freely (select, drag sliders, type, use freehand controls) and clicks Submit to
send the whole interaction state back. Declared `actions` are buttons that submit
immediately (e.g. Approve / Reject). The Submit button is enabled only while the agent is
actually waiting on an `ask`.

## Try it now (no MCP wiring needed)

```bash
npm install
npm run demo      # opens a local page; walks through render -> ask -> stream
```

Watch the terminal: it blocks on `ask()` and resumes the moment you click Submit.

## Already wired into Claude Code

Registered at **user scope** (available in all projects):

```bash
claude mcp add web-agent --scope user -- node C:/Users/I779318/Desktop/CSS/web-agent/src/mcp.js
```

The `ui-author` subagent and the `web-agent` skill are installed under `~/.claude/`.
**Restart Claude Code** (or start a new session) to pick up the MCP tools; then the agent
can call `open_panel`, `render`, `ask`, `stream`.

Recommended: allowlist these tools so a blocking `ask` never stalls on a permission
prompt, and raise the client tool-call timeout for long human think-time (the server sends
progress keep-alives, but clients enforce a hard maximum).

Equivalent manual config (`~/.claude.json` / project `.mcp.json`):

```json
{ "mcpServers": { "web-agent": { "command": "node",
    "args": ["C:/Users/I779318/Desktop/CSS/web-agent/src/mcp.js"] } } }
```

## Building screens — declarative first

1. **Declarative (default):** `ask` with `options` (A/B/C), `controls`
   (slider/number/checkbox/text/select → collected into `answer.fields`), `actions`
   (immediate-submit buttons → `answer.action`), and/or `freeText`. No HTML to author.
   The **`on` primitive** (interactive controls + action buttons) lives here — e.g. drag a
   slider to tune a threshold, or click Approve/Reject.
2. **Freehand HTML (escape hatch):** for bespoke mockups / diagrams / generative UI,
   delegate authoring to the **`ui-author` subagent** (it writes a contract-compliant HTML
   file and returns the path), then `render({ htmlPath })`. Keeps verbose markup out of the
   main agent's context.

The answer shape returned by `ask`:

```json
{ "action": "approve|null", "selected": ["id"], "selectedLabels": ["…"],
  "text": "free text", "fields": { "conf": 0.5, "model": "yolov8s" } }
```

## Live monitoring without spending turns

`render({ charts:[{channel:'loss'},{channel:'f1'}] })`, then have the **producing process**
POST `{channel,value}` to `<url>/ingest` (or call `stream`). Curves update over SSE with no
agent turn per tick.

## Agent-web contract (enforced regardless of who authors the markup)

- localhost-only binding; no external network calls from the page.
- answers return through a declared shape, not scraped DOM.
- no secrets/credentials in emitted markup.
- the page is a projection; the server is the single source of truth.

## Environment variables

- `WEB_AGENT_HOST` — bind host (default `127.0.0.1`).
- `WEB_AGENT_PORT` — fixed port (default: random free port).
- `WEB_AGENT_NO_OPEN` — set to skip auto-opening the browser.
- `WEB_AGENT_MCP_APPS` — set to expose the panel as an MCP Apps `ui://` resource for
  GUI hosts (experimental; see below).

## Rendering surfaces

- **Self-hosted web page (default, tested):** the MCP server runs its own local HTTP+SSE
  page and opens the browser. This is what Claude Code (a terminal host) uses.
- **MCP Apps `ui://` resource (experimental, `WEB_AGENT_MCP_APPS=1`):** for GUI hosts
  (claude.ai desktop, VS Code) that render inline sandboxed iframes. A terminal CLI cannot
  render iframes, so this path is scaffolding, not exercised in Claude Code CLI.

## Layout

```
src/engine.js    local HTTP + SSE + long-poll; render/ask/stream API (zero deps)
src/frame.js     the served page (inline CSS + client JS; options/controls/actions/charts)
src/mcp.js       MCP stdio server exposing the tools (official SDK)
src/mcp-apps.js  optional/experimental MCP Apps ui:// resource (flag-gated)
demo/demo.js     standalone walkthrough (no MCP needed)
agents/ui-author.md         subagent that authors freehand HTML fragments -> file path
skills/web-agent/SKILL.md   playbook for when/how the agent uses the tools
docs/…/specs/               design document
```
