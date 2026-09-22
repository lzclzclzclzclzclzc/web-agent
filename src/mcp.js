#!/usr/bin/env node
// mcp.js — MCP stdio server exposing the rich-interaction primitives as tools.
//
// Tools:
//   open_panel  -> ensure the local web page is up; returns its URL (tell the user to open it)
//   render      -> push a screen (declarative fields and/or trusted freehand HTML); returns immediately
//   ask         -> push a screen and BLOCK until the user submits in the browser; returns their answer
//   stream      -> push a live datapoint into a chart channel declared via render(); does not block
//
// IMPORTANT: stdio transport uses stdout for JSON-RPC. Never write to stdout.
// All human-facing logs go to stderr.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { InteractionServer } from './engine.js';
import { maybeRegisterMcpApps } from './mcp-apps.js';

const log = (...a) => console.error('[web-agent]', ...a);

// ---- lazily-started singleton engine ----------------------------------
let engine = null;
let opened = false;

async function ensureEngine() {
  if (!engine) {
    engine = new InteractionServer({
      host: process.env.WEB_AGENT_HOST || '127.0.0.1',
      port: process.env.WEB_AGENT_PORT ? Number(process.env.WEB_AGENT_PORT) : 0,
    });
    const { url } = await engine.start();
    log('web page serving at', url);
  }
  return engine;
}

function openBrowser(url) {
  if (opened || process.env.WEB_AGENT_NO_OPEN) return;
  opened = true;
  try {
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin' ? ['open', [url]]
      : ['xdg-open', [url]];
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
  } catch (e) { log('could not auto-open browser:', e.message); }
}

const urlLine = () => `Open the panel in your browser: ${engine.url}`;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf',
};

// Wrap a body fragment in a themed full page; pass full documents through untouched.
function themedPage(title, body) {
  if (/^\s*<(!doctype|html)/i.test(body)) return body;
  const css = ":root{--bg:#0f1117;--panel:#161a26;--panel2:#1d2333;--line:#2a3142;--fg:#e6e8ee;--muted:#9aa3b8;--accent:#4f8cff}"
    + "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:32px}"
    + "a{color:var(--accent)}.wrap{max-width:1000px;margin:0 auto}h1{font-size:22px}";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>${title || 'web-agent'}</title><style>${css}</style></head><body><div class="wrap">${body}</div></body></html>`;
}

// ---- MCP server + tools ------------------------------------------------
const server = new McpServer({ name: 'web-agent', version: '0.1.0' });

server.registerTool('open_panel', {
  title: 'Open the interaction panel',
  description: 'Start (if needed) the local web panel and return its URL. Call this first, then tell the user to open the URL.',
  inputSchema: {},
}, async () => {
  await ensureEngine();
  openBrowser(engine.url);
  return { content: [{ type: 'text', text: urlLine() }] };
});

const chartsSchema = z.array(z.object({
  channel: z.string().describe('id used later in stream(channel,...)'),
  label: z.string().optional(),
})).optional();

server.registerTool('render', {
  title: 'Render a screen',
  description: 'Push a screen to the panel and return immediately (does NOT wait). Content can be: declarative (title/subtitle + charts), trusted freehand HTML (`html` inline or `htmlPath`), or a full CUSTOM interactive document (`doc` inline or `docPath`) that runs in a sandboxed iframe with its own JS. For large/bespoke UI, delegate authoring to the `ui-author` subagent and pass htmlPath/docPath so the markup never enters your context.',
  inputSchema: {
    title: z.string().optional(),
    subtitle: z.string().optional(),
    html: z.string().optional().describe('freehand HTML body (static; injected, scripts do NOT run)'),
    htmlPath: z.string().optional().describe('path to an HTML fragment file to render'),
    doc: z.string().optional().describe('full custom interactive document body (runs in a sandboxed iframe; use the injected `webagent` bridge, see docs). For live custom viz, call webagent.onStream(cb).'),
    docPath: z.string().optional().describe('path to a custom document file to render in the sandboxed iframe'),
    charts: chartsSchema,
  },
}, async (args) => {
  await ensureEngine();
  openBrowser(engine.url);
  const view = { ...args };
  try {
    if (args.htmlPath) { view.html = readFileSync(args.htmlPath, 'utf8'); delete view.htmlPath; }
    if (args.docPath) { view.doc = readFileSync(args.docPath, 'utf8'); delete view.docPath; }
  } catch (e) { return { isError: true, content: [{ type: 'text', text: `Could not read path: ${e.message}` }] }; }
  engine.render(view);
  return { content: [{ type: 'text', text: `Rendered "${args.title || '(untitled)'}". ${urlLine()}` }] };
});

server.registerTool('ask', {
  title: 'Ask the user (blocking)',
  description: 'Push a screen with options, form controls, action buttons and/or a free-text box, then BLOCK until the user submits in the browser. Returns their answer. Because this call blocks, you resume in the SAME turn the moment they submit — no terminal input needed. `controls` are declarative widgets (slider/number/checkbox/text/select) collected into answer.fields (the `on` primitive — e.g. drag a slider to tune a param). `actions` are buttons that submit immediately with answer.action set (e.g. Approve/Reject). Prefer declarative options/controls over freehand HTML.',
  inputSchema: {
    title: z.string(),
    subtitle: z.string().optional(),
    options: z.array(z.object({
      id: z.string().optional().describe('stable id returned in the answer; defaults to index'),
      label: z.string(),
      description: z.string().optional(),
    })).optional(),
    multiSelect: z.boolean().optional(),
    controls: z.array(z.object({
      id: z.string().describe('key under which the value is returned in answer.fields'),
      type: z.enum(['slider', 'range', 'number', 'checkbox', 'text', 'select']),
      label: z.string().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      step: z.number().optional(),
      value: z.union([z.string(), z.number(), z.boolean()]).optional(),
      placeholder: z.string().optional(),
      options: z.array(z.union([z.string(), z.object({ value: z.string(), label: z.string().optional() })])).optional(),
    })).optional(),
    actions: z.array(z.object({
      id: z.string(),
      label: z.string().optional(),
      primary: z.boolean().optional(),
    })).optional(),
    freeText: z.object({
      enabled: z.boolean(),
      placeholder: z.string().optional(),
    }).optional(),
    doc: z.string().optional().describe('full CUSTOM interactive document body; runs in a sandboxed iframe with its own JS. Design any interaction you like and call webagent.submit(value) with ANY JSON to answer (and/or webagent.onCollect(fn) so the global Submit button collects your value). This is the maximum-freedom path.'),
    docPath: z.string().optional().describe('path to a custom document file (e.g. written by the ui-author subagent)'),
    submitLabel: z.string().optional(),
  },
}, async (args, extra) => {
  await ensureEngine();
  openBrowser(engine.url);

  // Normalize option ids to strings so the browser and answer agree.
  const spec = { ...args, options: (args.options || []).map((o, i) => ({ ...o, id: String(o.id ?? i) })) };
  if (args.docPath) {
    try { spec.doc = readFileSync(args.docPath, 'utf8'); delete spec.docPath; }
    catch (e) { return { isError: true, content: [{ type: 'text', text: `Could not read docPath: ${e.message}` }] }; }
  }
  const pending = engine.ask(spec);

  // Clean cancellation if the client aborts the tool call (e.g. timeout / user interrupt).
  if (extra?.signal) {
    if (extra.signal.aborted) engine.cancelPending('client aborted');
    else extra.signal.addEventListener('abort', () => engine.cancelPending('client aborted'), { once: true });
  }
  // Best-effort keep-alive so long human think-time doesn't trip client timeouts.
  const beat = setInterval(() => {
    try { extra?.sendNotification?.({ method: 'notifications/progress',
      params: { progressToken: extra?._meta?.progressToken ?? 'web-agent', progress: 0 } }); } catch {}
  }, 15000);

  try {
    const answer = await pending;
    const fieldKeys = answer.fields ? Object.keys(answer.fields).filter(k => k !== 'freetext-input') : [];
    const summary = [
      answer.action ? `action: ${answer.action}` : null,
      answer.selectedLabels?.length ? `selected: ${answer.selectedLabels.join(', ')}` : null,
      fieldKeys.length ? `fields: ${fieldKeys.map(k => `${k}=${answer.fields[k]}`).join(', ')}` : null,
      answer.text ? `text: ${answer.text}` : null,
    ].filter(Boolean).join(' | ') || '(empty submission)';
    return { content: [{ type: 'text', text: `User submitted — ${summary}\n\n${JSON.stringify(answer)}` }] };
  } finally {
    clearInterval(beat);
  }
});

server.registerTool('stream', {
  title: 'Push a live datapoint',
  description: 'Append a value to a chart channel that was declared via render({charts:[...]}). Does not block. For agent-independent live monitoring, an external process can instead POST {channel,value} to <url>/ingest.',
  inputSchema: {
    channel: z.string(),
    value: z.number(),
  },
}, async (args) => {
  await ensureEngine();
  engine.stream(args.channel, args.value);
  return { content: [{ type: 'text', text: `ok (${args.channel}=${args.value})` }] };
});

server.registerTool('route', {
  title: 'Publish a page/asset at a URL path',
  description: 'Serve content at a stable GET route (e.g. path "/image" for an architecture diagram, "/report" for a page). Build a small multi-page local site and link to these from the panel with render({html:"<a href=\'/image\' target=\'_blank\'>…</a>"}) as entry points. Source one of: `html` (a full page or fragment — fragments are themed), `htmlPath` (an html/text file), or `filePath` (any file incl. images/svg/pdf; content-type inferred). Published pages are normal pages (their own scripts run natively). Returns the full URL.',
  inputSchema: {
    path: z.string().describe('URL path, e.g. "/image" (reserved: /, /events, /submit, /ingest)'),
    html: z.string().optional().describe('inline HTML (full document or fragment; fragments get themed)'),
    htmlPath: z.string().optional().describe('path to an .html/.txt file'),
    filePath: z.string().optional().describe('path to any file to serve (png/jpg/svg/pdf/…); content-type inferred'),
    contentType: z.string().optional().describe('override the content-type'),
    title: z.string().optional().describe('page title when wrapping an HTML fragment'),
  },
}, async (args) => {
  await ensureEngine();
  openBrowser(engine.url);
  let contentType = args.contentType, body;
  try {
    if (args.filePath) {
      body = readFileSync(args.filePath);
      contentType = contentType || CONTENT_TYPES[extname(args.filePath).toLowerCase()] || 'application/octet-stream';
    } else if (args.htmlPath) {
      body = themedPage(args.title, readFileSync(args.htmlPath, 'utf8'));
      contentType = contentType || 'text/html; charset=utf-8';
    } else if (args.html != null) {
      body = themedPage(args.title, args.html);
      contentType = contentType || 'text/html; charset=utf-8';
    } else {
      return { isError: true, content: [{ type: 'text', text: 'Provide one of html / htmlPath / filePath.' }] };
    }
  } catch (e) { return { isError: true, content: [{ type: 'text', text: `Could not read source: ${e.message}` }] }; }
  let r;
  try { r = engine.route(args.path, { contentType, body }); }
  catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
  return { content: [{ type: 'text', text: `Published ${r.path} -> ${r.url}` }] };
});

server.registerTool('say', {
  title: 'Say something in the panel',
  description: 'Show an agent message as the current panel screen (markdown-lite: **bold**, `code`). Non-blocking; the next render/ask/converse replaces it. Use to tell the user something in the browser instead of the terminal.',
  inputSchema: { text: z.string() },
}, async (args) => {
  await ensureEngine();
  openBrowser(engine.url);
  engine.say(args.text);
  return { content: [{ type: 'text', text: 'ok' }] };
});

server.registerTool('converse', {
  title: 'Ask a free-form chat question (blocking)',
  description: 'Show a message with an inline text box, then BLOCK until the user sends a reply; returns { text }. This is the free-form conversation form — one of several interaction forms (use `ask` for choices/sliders/custom UI). Nothing accumulates: the screen is replaced on your next call.',
  inputSchema: { message: z.string().optional().describe('agent message shown above the input (omit to just show a box)') },
}, async (args, extra) => {
  await ensureEngine();
  openBrowser(engine.url);
  const pending = engine.converse(args.message);
  if (extra?.signal) {
    if (extra.signal.aborted) engine.cancelPending('client aborted');
    else extra.signal.addEventListener('abort', () => engine.cancelPending('client aborted'), { once: true });
  }
  const beat = setInterval(() => {
    try { extra?.sendNotification?.({ method: 'notifications/progress',
      params: { progressToken: extra?._meta?.progressToken ?? 'web-agent', progress: 0 } }); } catch {}
  }, 15000);
  try {
    const answer = await pending;
    return { content: [{ type: 'text', text: `User: ${answer?.text ?? ''}\n\n${JSON.stringify(answer)}` }] };
  } finally { clearInterval(beat); }
});

// ---- boot --------------------------------------------------------------
// Optional: expose the panel as an MCP Apps ui:// resource for GUI hosts (experimental,
// off by default; Claude Code CLI cannot render iframes so it uses the self-hosted page).
maybeRegisterMcpApps(server, { framePageFactory: () => import('./frame.js').then(m => m.framePage()) });

const transport = new StdioServerTransport();
await server.connect(transport);
log('MCP server ready on stdio.');

const shutdown = async () => { try { await engine?.close(); } catch {} process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
