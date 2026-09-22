// mcp-apps.js — OPTIONAL, EXPERIMENTAL rendering-surface adapter.
//
// This is the pluggable "GUI-host" rendering surface from the design doc. MCP Apps
// (spec 2026-01-26, repo modelcontextprotocol/ext-apps) let a server expose a `ui://`
// HTML resource that a GUI host (claude.ai desktop, VS Code, …) renders inline in a
// sandboxed iframe with a bidirectional JSON-RPC bridge.
//
// IMPORTANT / honest scoping:
//   * The primary, fully-tested surface is the self-hosted local web page (engine.js).
//     A TERMINAL host like Claude Code CLI cannot render iframes, so it always uses that.
//   * This adapter is therefore OFF by default and gated behind WEB_AGENT_MCP_APPS=1.
//     It registers the panel as a `ui://` resource so a GUI host *could* fetch it; the
//     host-side iframe<->tool JSON-RPC bridge is host-specific and is NOT exercised in
//     the CLI target, so treat this path as scaffolding to build on, not a verified path.
//   * It is written to be strictly additive: if anything here fails, it is caught and the
//     core tools (render/ask/stream over the self-hosted page) keep working.

const RESOURCE_URI = 'ui://web-agent/panel';

export function maybeRegisterMcpApps(server, { framePageFactory } = {}) {
  if (!process.env.WEB_AGENT_MCP_APPS) return { enabled: false };
  try {
    server.registerResource(
      'web-agent-panel',
      RESOURCE_URI,
      {
        title: 'web-agent panel',
        description: 'Interactive panel (render/ask/stream) for MCP Apps-capable GUI hosts.',
        mimeType: 'text/html;profile=mcp-app',
      },
      async () => {
        const html = framePageFactory ? await framePageFactory() : '<!doctype html><p>web-agent</p>';
        return { contents: [{ uri: RESOURCE_URI, mimeType: 'text/html;profile=mcp-app', text: html }] };
      },
    );
    console.error('[web-agent] MCP Apps resource registered:', RESOURCE_URI,
      '(experimental; GUI hosts only — link it from a tool via _meta.ui.resourceUri).');
    return { enabled: true, resourceUri: RESOURCE_URI };
  } catch (e) {
    console.error('[web-agent] MCP Apps registration skipped:', e.message);
    return { enabled: false, error: e.message };
  }
}
