# web-agent

A universal **agent ↔ human rich-interaction layer** for Claude Code. An MCP server
that spins up a local web page and gives the agent three primitives:

| Tool | What it does | Blocks? |
|------|--------------|---------|
| `render` | push a screen (declarative fields and/or trusted freehand HTML) | no |
| `ask` | push a screen and **wait until the user submits in the browser**, then return their answer | **yes** |
| `stream` | append a live datapoint to a chart channel (real-time monitoring) | no |
| `open_panel` | start the page and return its URL | no |

The point of `ask` blocking: because an MCP tool call suspends the model mid-turn until
it returns, the agent **resumes the instant you submit in the browser** — no "type
`continue` in the terminal" round-trip. See `docs/superpowers/specs/` for the full design.

## Try it now (no MCP wiring needed)

```bash
npm install
npm run demo
```

This opens a local page and walks through `render → ask → stream`. Watch the terminal:
it blocks on `ask()` and resumes the moment you click **Submit** in the browser.

## Wire it into Claude Code as an MCP server

Add to your Claude Code MCP config (e.g. `.claude/settings.json` under `mcpServers`,
or via `claude mcp add`). Use an absolute path to `src/mcp.js`:

```json
{
  "mcpServers": {
    "web-agent": {
      "command": "node",
      "args": ["C:/Users/I779318/Desktop/CSS/web-agent/src/mcp.js"],
      "env": {}
    }
  }
}
```

Then, in a session, the agent can call `open_panel`, `render`, `ask`, `stream`.
Recommended: allowlist these tools so a blocking `ask` never stalls on a permission
prompt, and raise the client tool-call timeout for long human think-time (the server
sends progress keep-alives, but clients still enforce a hard maximum).

### Environment variables

- `WEB_AGENT_HOST` — bind host (default `127.0.0.1`).
- `WEB_AGENT_PORT` — fixed port (default: random free port).
- `WEB_AGENT_NO_OPEN` — set to skip auto-opening the browser.

## Agent-web contract (enforced regardless of who authors the markup)

- localhost-only binding; no external network calls from the page.
- answers return through a declared shape (`{selected, selectedLabels, text}`), not scraped DOM.
- no secrets/credentials in emitted markup.
- the page is a projection; the server is the single source of truth.

## Layout

```
src/engine.js   local HTTP + SSE + long-poll; render/ask/stream API (zero deps)
src/frame.js    the served page (inline CSS + client JS)
src/mcp.js      MCP stdio server exposing the tools (official SDK)
demo/demo.js    standalone walkthrough (no MCP needed)
docs/…/specs/   design document
```

## Status

v1 vertical slice: declarative `ask`, freehand `render`, live `stream`, and an
external `/ingest` endpoint so a training script can push metrics without the agent.
Not yet: pluggable MCP-Apps rendering surface, the `UI-author` subagent path, and the
`on` event primitive — see the spec's component list.
