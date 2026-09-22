// engine.js — the local web interaction engine.
//
// Zero external dependencies (Node built-in http only).
//   server -> browser : Server-Sent Events on GET /events
//   browser -> server : POST /submit  (answers)  |  POST /ingest (external stream data)
//
// Public API (used by the MCP layer and by the standalone demo):
//   const s = new InteractionServer();
//   const { url } = await s.start();
//   s.render({ title, subtitle, html?, charts? });          // push a screen, returns immediately
//   const answer = await s.ask({ title, options?, freeText?, ... });  // BLOCKS until the browser submits
//   s.stream(channel, value);                                // push a live datapoint (does not block)
//   await s.close();
//
// The blocking `ask()` is the whole point: whoever awaits it (an MCP tool handler,
// hence the model, mid-turn) resumes the instant the user submits in the browser —
// no "type continue in the terminal" round-trip.

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { framePage } from './frame.js';

const MAX_HISTORY = 300;

export class InteractionServer {
  constructor(opts = {}) {
    this.host = opts.host || '127.0.0.1';
    this.port = opts.port ?? 0;              // 0 => random free port
    this.server = null;
    this.url = null;
    this.clients = new Set();                // active SSE responses
    this.screen = null;                      // current screen object (replaced each step)
    this.pending = null;                     // { id, resolve } for an in-flight ask()/converse()
    this.streams = new Map();                // channel -> [values] (bounded history)
    this._page = framePage();
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this._route(req, res));
      this.server.on('error', reject);
      this.server.listen(this.port, this.host, () => {
        const { port } = this.server.address();
        this.port = port;
        this.url = `http://${this.host === '0.0.0.0' ? 'localhost' : this.host}:${port}`;
        resolve({ url: this.url, port });
      });
    });
  }

  // ---- primitives -------------------------------------------------------

  render(view = {}) {
    this.screen = { kind: 'view', ...view };
    this._broadcast('screen', this.screen);
    return { ok: true, url: this.url };
  }

  ask(spec = {}) {
    // Reject any previous unanswered ask so we never leak a resolver.
    if (this.pending) { const p = this.pending; this.pending = null; p.reject?.(new Error('superseded by a new ask()')); }
    const id = randomUUID();
    this.screen = { kind: 'ask', askId: id, ...spec };
    this._broadcast('screen', this.screen);
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject };
    });
  }

  stream(channel, value) {
    let hist = this.streams.get(channel);
    if (!hist) { hist = []; this.streams.set(channel, hist); }
    hist.push(value);
    if (hist.length > MAX_HISTORY) hist.shift();
    this._broadcast('stream', { channel, value });
    return { ok: true };
  }

  // Show a message in the panel (as the current screen). Non-blocking.
  say(text) {
    this.screen = { kind: 'view', message: String(text ?? '') };
    this._broadcast('screen', this.screen);
    return { ok: true };
  }

  // Show a chat prompt with an inline input, then BLOCK until the user sends a message.
  // Returns { text }. One of several interaction forms the agent can choose — not mandatory.
  converse(prompt) {
    if (this.pending) { const p = this.pending; this.pending = null; p.reject?.(new Error('superseded by a new prompt')); }
    const id = randomUUID();
    this.screen = { kind: 'chat', askId: id, message: prompt ? String(prompt) : '' };
    this._broadcast('screen', this.screen);
    return new Promise((resolve, reject) => { this.pending = { id, resolve, reject }; });
  }

  waiting(message = 'Continuing…') {
    this.render({ title: '', subtitle: '', html: `<div style="color:var(--muted)">${message}</div>` });
  }

  // Release an in-flight ask() without an answer (client cancel / timeout).
  cancelPending(reason = 'cancelled') {
    if (!this.pending) return false;
    const p = this.pending; this.pending = null;
    this._broadcast('resolved', { message: 'Cancelled.' });
    p.reject?.(new Error(reason));
    return true;
  }

  async close() {
    for (const res of this.clients) { try { res.end(); } catch {} }
    this.clients.clear();
    if (this.pending) { this.pending.reject?.(new Error('server closing')); this.pending = null; }
    await new Promise(r => (this.server ? this.server.close(r) : r()));
  }

  // ---- HTTP routing -----------------------------------------------------

  _route(req, res) {
    const url = new URL(req.url, this.url || 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/') return this._servePage(res);
    if (req.method === 'GET' && url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (req.method === 'GET' && url.pathname === '/events') return this._serveEvents(req, res);
    if (req.method === 'POST' && url.pathname === '/submit') return this._handleSubmit(req, res);
    if (req.method === 'POST' && url.pathname === '/ingest') return this._handleIngest(req, res);
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
  }

  _servePage(res) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(this._page);
  }

  _serveEvents(req, res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    this.clients.add(res);
    // Bring the newcomer up to date: current screen + any stream history.
    if (this.screen) this._send(res, 'screen', this.screen);
    for (const [channel, points] of this.streams) this._send(res, 'streamInit', { channel, points });
    const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);
    req.on('close', () => { clearInterval(heartbeat); this.clients.delete(res); });
  }

  async _handleSubmit(req, res) {
    let body;
    try { body = await readJson(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const { askId, value } = body || {};
    if (!this.pending || this.pending.id !== askId) {
      return json(res, 409, { error: 'no matching pending ask (already answered or superseded)' });
    }
    const p = this.pending; this.pending = null;
    this._broadcast('resolved', {});
    p.resolve(value);
    json(res, 200, { ok: true });
  }

  // Allows an external process (e.g. a training script) to push stream data
  // without going through the agent:  POST /ingest {channel, value}
  async _handleIngest(req, res) {
    let body;
    try { body = await readJson(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const { channel, value } = body || {};
    if (!channel) return json(res, 400, { error: 'channel required' });
    this.stream(channel, value);
    json(res, 200, { ok: true });
  }

  // ---- SSE helpers ------------------------------------------------------

  _send(res, event, data) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
  }

  _broadcast(event, data) {
    for (const res of this.clients) this._send(res, event, data);
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}
