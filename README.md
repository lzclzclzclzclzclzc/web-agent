# web-agent

A universal **agent ↔ human rich-interaction layer** for Claude Code. An MCP server that
spins up a local web page and gives the agent primitives to show UI, collect input, and
stream live data — for when a text-only reply isn't enough.

| Tool | What it does | Blocks? |
|------|--------------|---------|
| `open_panel` | start the page, return its URL | no |
| `say` | append an agent message to the panel transcript (talk to the user in the browser) | no |
| `converse` | say + **wait for the user's chat reply** in the panel | **yes** |
| `render` | push a screen: declarative content, live-metrics panel, trusted freehand HTML (`html`/`htmlPath`), or a full custom interactive document (`doc`/`docPath`) | no |
| `ask` | push a screen (options / controls / actions / free-text, or a custom document) and **wait until the user submits**, then return their answer | **yes** |
| `stream` | append a live datapoint to a chart channel | no |

**The core trick:** an MCP tool call suspends the model mid-turn until it returns, so `ask`
**resumes the agent the instant the user clicks Submit in the browser** — no "type
`continue` in the terminal" round-trip.

**Interaction model:** one persistent **Submit** button pinned bottom-right. The user
interacts freely (select, drag sliders, type, use freehand controls) and clicks Submit to
send the whole interaction state back. Declared `actions` are buttons that submit
immediately (e.g. Approve / Reject). The Submit button is enabled only while the agent is
actually waiting on an `ask`.

## Terminal-free mode

Run `/web` to move the **entire conversation into the panel** — the agent talks via `say`,
waits for your replies via `converse` (a persistent chat composer), and stays parked in the
browser so you never look at or type in the terminal. Rich steps (choices, sliders, custom
interactions) are delegated to the `web-ui` subagent and rendered in the same panel. The only
terminal action is the one `/web` command that bootstraps the session.

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

The `web-ui` subagent and the `web-agent` skill are installed under `~/.claude/`.
**Restart Claude Code** (or start a new session) to pick up the MCP tools. The main agent
does not drive the panel directly — it delegates each interaction to the `web-ui` subagent,
which builds the UI, waits for the user, and returns the answer.

Recommended: allowlist the web-agent tools so the subagent's blocking `ask` never stalls on
a permission prompt (add `mcp__web-agent__open_panel|render|ask|stream` to `permissions.allow`
in `~/.claude/settings.json`), and raise the client tool-call timeout for long human
think-time (the server sends progress keep-alives, but clients enforce a hard maximum).

Equivalent manual config (`~/.claude.json` / project `.mcp.json`):

```json
{ "mcpServers": { "web-agent": { "command": "node",
    "args": ["C:/Users/I779318/Desktop/CSS/web-agent/src/mcp.js"] } } }
```

## Building screens — the `web-ui` subagent's three tiers

The main agent delegates each interaction to the **`web-ui`** subagent with a brief (goal +
what to show + answer shape). The subagent picks the cheapest tier that fits and returns only
the structured answer:

1. **Declarative (default):** `ask` with `options` (A/B/C), `controls`
   (slider/number/checkbox/text/select → collected into `answer.fields`), `actions`
   (immediate-submit buttons → `answer.action`), and/or `freeText`. No HTML to author.
   The **`on` primitive** (interactive controls + action buttons) lives here — e.g. drag a
   slider to tune a threshold, or click Approve/Reject.
2. **Freehand fragment (static):** for bespoke mockups / diagrams / comparisons the user
   must *see* and pick, the subagent authors the HTML (to a file for anything sizable) and
   uses `render({ html | htmlPath })` + an `ask`. Scripts don't run; the panel collects form
   fields.
3. **Custom interactive UI (maximum freedom):** ship a full document via `ask({ doc })`
   (or `docPath`). It runs in a **sandboxed iframe** with its own HTML/CSS/JS — you design
   the interaction (drag, canvas, node graph, ranking, live-preview sliders…) **and the
   shape of the returned value**. The document talks to the agent only through the injected
   `webagent` bridge:

   - `webagent.submit(value)` — resolve the `ask` with ANY JSON you build.
   - `webagent.onCollect(fn)` — let the persistent Submit button collect your value.
   - `webagent.onStream((channel,value)=>…)` — receive live data for custom viz.

   A sandbox + CSP (no external network, no parent access) is the security boundary; the
   bridge is the only way data leaves the iframe.

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
agents/web-ui.md            subagent that owns a whole interaction (build UI -> ask -> return answer)
commands/web.md             /web slash command that bootstraps terminal-free mode
skills/web-agent/SKILL.md   playbook for when/how the agent uses the tools
docs/…/specs/               design document
```
