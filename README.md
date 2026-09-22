# web-agent

A universal **agent ↔ human rich-interaction layer** for [Claude Code](https://docs.claude.com/en/docs/claude-code).

Text is a narrow channel. When an agent needs you to *pick between designs, confirm an
architecture diagram, tune parameters, watch training metrics move, or use some interaction
it invents on the spot*, a chat line isn't enough. **web-agent** is an MCP server that spins
up a local web panel and gives the agent primitives to show UI, collect input, stream live
data, and publish pages — so the agent can choose the right interaction form for each moment,
and even run an entire session in the browser with no terminal.

> **The core trick:** an MCP tool call suspends the model mid-turn until it returns. So a
> blocking `ask`/`converse` **resumes the agent the instant you act in the browser** — no
> "type `continue` in the terminal" round-trip.

## Tools

| Tool | What it does | Blocks? |
|------|--------------|---------|
| `open_panel` | start the local page, return its URL (opens your browser) | no |
| `say` | show an agent message as the current screen | no |
| `converse` | show a message + inline text box, **wait for the user's reply** | **yes** |
| `render` | show a screen: content, live-metrics panel, freehand HTML, or a full custom interactive document (sandboxed iframe) | no |
| `ask` | show options / controls (sliders…) / action buttons / free-text / a custom document, **wait for submit** | **yes** |
| `stream` | push a live datapoint to a chart channel | no |
| `route` | publish a page/asset at a URL path (e.g. `/image` for a diagram) | no |

The panel shows **one screen at a time** (each step replaces the last — nothing accumulates),
with a single fixed **Submit** button that lights up only while the agent is waiting.
Conversation is just one screen kind, not the whole UI.

## Requirements

- [Claude Code](https://docs.claude.com/en/docs/claude-code) (`claude` CLI)
- Node.js ≥ 18

## Quick start (no Claude Code needed)

```bash
npm install
npm run demo      # opens a local page and walks through render → ask → stream
```

Watch the terminal: it blocks on `ask()` and resumes the moment you click Submit.

## Set it up for Claude Code

```bash
npm install        # install the MCP SDK
npm run setup      # register the MCP server + install the skill, subagent, and /web command
```

`npm run setup` (script: `scripts/install.mjs`) does three things:

1. **Registers the MCP server** at user scope (`claude mcp add web-agent --scope user -- node <repo>/src/mcp.js`). If the `claude` CLI isn't on PATH it prints the exact command / config to add manually.
2. **Installs the skill** `~/.claude/skills/web-agent/SKILL.md` — tells the agent when and how to use the panel.
3. **Installs the `web-ui` subagent** (`~/.claude/agents/web-ui.md`) and the **`/web` command** (`~/.claude/commands/web.md`).

Then:

- **Restart Claude Code** (or start a new session) so it loads the new MCP tools and command.
- **(Recommended) allowlist the tools** so a blocking `ask` never stalls on a permission
  prompt. Add to `~/.claude/settings.json` under `permissions.allow`:
  ```json
  "mcp__web-agent__open_panel", "mcp__web-agent__say", "mcp__web-agent__converse",
  "mcp__web-agent__render", "mcp__web-agent__ask", "mcp__web-agent__stream", "mcp__web-agent__route"
  ```

### Manual MCP registration (alternative)

Add to `~/.claude.json` (user scope) or a project `.mcp.json`, using an **absolute path**:

```json
{ "mcpServers": { "web-agent": { "command": "node", "args": ["/absolute/path/to/web-agent/src/mcp.js"] } } }
```

Verify with `claude mcp list` — `web-agent` should show `✓ Connected`.

To remove everything later: `npm run uninstall`.

## Using it

**`/web` — terminal-free entry.** Run `/web` in a session to move the whole conversation into
the panel: the agent talks via `say`, asks via `converse`/`ask`, and stays parked in the
browser so you never touch the terminal. It picks whatever interaction form fits each step.

**Ad-hoc.** You don't need `/web` — whenever a request is better served visually, the agent
will open the panel and use the right tool (the skill guides this). Heavy or bespoke UI is
delegated to the **`web-ui` subagent**, which builds it and returns just the result, keeping
the main agent's context clean.

## Interaction forms

The agent chooses per step — declarative is cheapest, custom is unlimited:

1. **Declarative** — `ask` with `options`, `controls` (slider/number/checkbox/text/select →
   `answer.fields`), `actions` (immediate-submit buttons → `answer.action`), `freeText`.
2. **Freehand fragment** — static bespoke HTML (mockups/diagrams) via `render({html|htmlPath})`;
   the user picks/confirms.
3. **Custom interactive document** — a full doc via `ask({doc|docPath})` that runs in a
   **sandboxed iframe** with its own HTML/CSS/JS. You design the interaction *and* the returned
   value shape. It talks back only through the injected `webagent` bridge:
   - `webagent.submit(value)` — resolve with ANY JSON you build
   - `webagent.onCollect(fn)` — let the fixed Submit button collect your value
   - `webagent.onStream((channel,value)=>…)` — receive live data for custom viz

The declarative answer shape: `{ action, selected, selectedLabels, text, fields }`. A custom
document returns whatever you designed.

## Multi-page routes

Publish content at stable URL paths and make the panel a hub:

```js
route({ path: '/image',      html: '<svg>…architecture…</svg>' })  // themed if a fragment
route({ path: '/report',     htmlPath: './report.html' })          // a full page (its scripts run)
route({ path: '/logo.png',   filePath: './logo.png' })             // any file; content-type inferred
render({ html: '<a href="/image" target="_blank">Open architecture diagram</a>' })  // entry point
```

Reserved paths: `/ /events /submit /ingest`.

## Live monitoring (no agent turns)

`render` a panel with `charts`, then have the **producing process** (training script, long
job) POST `{channel, value}` to `<url>/ingest` — or call `stream`. Curves update over SSE with
no agent turn per tick.

## Agent-web contract (security)

- **Localhost only.** The server binds to `127.0.0.1`; the page makes no external network calls.
- **Custom documents are sandboxed.** `sandbox="allow-scripts"` (no same-origin) + a CSP with
  `connect-src 'none'` — no external fetch, no CDN/remote fonts, no access to the parent page.
  The `webagent` bridge (postMessage) is the only channel out.
- **No secrets** in emitted markup.
- The server is the source of truth; the page is a projection.

## How it works

An LLM agent only runs when it has a *turn*, and a turn comes from a user message, a tool
result returning to a call it's parked on, or a scheduled wake — a browser click can't create
one by itself. web-agent uses the second path: `ask`/`converse` are MCP tools whose handlers
**block** (long-poll) until you act in the browser, then return — resuming the same turn. The
server sends periodic progress notifications so long human think-time doesn't trip client
timeouts. See `docs/superpowers/specs/` for the full design.

## Rendering surfaces

- **Self-hosted page (default, used by Claude Code CLI):** the MCP server runs its own local
  HTTP + SSE page and opens your browser.
- **MCP Apps `ui://` resource (experimental, `WEB_AGENT_MCP_APPS=1`):** for GUI hosts
  (claude.ai desktop, VS Code) that render inline sandboxed iframes. A terminal CLI can't
  render iframes, so this path is scaffolding, not exercised in Claude Code CLI.

## Environment variables

- `WEB_AGENT_HOST` — bind host (default `127.0.0.1`).
- `WEB_AGENT_PORT` — fixed port (default: random free port).
- `WEB_AGENT_NO_OPEN` — skip auto-opening the browser.
- `WEB_AGENT_MCP_APPS` — also expose the panel as an MCP Apps `ui://` resource (experimental).

## Project layout

```
src/engine.js    local HTTP + SSE + long-poll; say/converse/render/ask/stream/route (zero deps)
src/frame.js     the served page (inline CSS + client JS; screen model + custom-doc bridge)
src/mcp.js       MCP stdio server exposing the tools (official SDK)
src/mcp-apps.js  optional/experimental MCP Apps ui:// resource (flag-gated)
demo/demo.js     standalone walkthrough (no MCP needed)
scripts/install.mjs   installer: registers MCP + installs skill/subagent/command
agents/web-ui.md      subagent that builds UI and returns the answer
commands/web.md       /web slash command (terminal-free session)
skills/web-agent/SKILL.md   playbook: when/how the agent uses the panel
docs/superpowers/specs/     design document
```

## Caveats

- **One bootstrap action.** Terminal-free mode still needs the one `/web` command to start; if
  the agent's turn ever ends unexpectedly you restart from the terminal.
- **No external assets in the sandbox.** Custom documents can't load CDN scripts/fonts — inline
  what you need.
- **MCP Apps path is untested** in the terminal CLI (it can't render iframes).

## License

MIT — see [LICENSE](LICENSE).
