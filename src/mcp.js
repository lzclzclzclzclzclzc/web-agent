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
import { InteractionServer } from './engine.js';

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
  description: 'Push a screen to the panel and return immediately (does NOT wait). Use for showing content, mockups, or setting up a live-metrics panel (declare charts here, then push data with stream). `html` is trusted markup you author under the agent-web contract (localhost-only, no secrets, no external calls).',
  inputSchema: {
    title: z.string().optional(),
    subtitle: z.string().optional(),
    html: z.string().optional().describe('freehand HTML body (for bespoke mockups/diagrams)'),
    charts: chartsSchema,
  },
}, async (args) => {
  await ensureEngine();
  openBrowser(engine.url);
  engine.render(args);
  return { content: [{ type: 'text', text: `Rendered "${args.title || '(untitled)'}". ${urlLine()}` }] };
});

server.registerTool('ask', {
  title: 'Ask the user (blocking)',
  description: 'Push a screen with options and/or a free-text box, then BLOCK until the user submits in the browser. Returns their answer. Because this call blocks, you resume in the SAME turn the moment they submit — no terminal input needed. Prefer declarative options/freeText over freehand HTML.',
  inputSchema: {
    title: z.string(),
    subtitle: z.string().optional(),
    options: z.array(z.object({
      id: z.string().optional().describe('stable id returned in the answer; defaults to index'),
      label: z.string(),
      description: z.string().optional(),
    })).optional(),
    multiSelect: z.boolean().optional(),
    freeText: z.object({
      enabled: z.boolean(),
      placeholder: z.string().optional(),
    }).optional(),
    submitLabel: z.string().optional(),
  },
}, async (args, extra) => {
  await ensureEngine();
  openBrowser(engine.url);

  // Normalize option ids to strings so the browser and answer agree.
  const spec = { ...args, options: (args.options || []).map((o, i) => ({ ...o, id: String(o.id ?? i) })) };
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
    const summary = [
      answer.selectedLabels?.length ? `selected: ${answer.selectedLabels.join(', ')}` : null,
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

// ---- boot --------------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);
log('MCP server ready on stdio.');

const shutdown = async () => { try { await engine?.close(); } catch {} process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
