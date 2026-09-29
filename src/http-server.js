import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactDocument } from './bridge.js';
import { check } from './runtime.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
export async function readJSON(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; check(size <= 1024 * 1024, '请求超出 1 MB', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('无效 JSON'), { status: 400 }); }
}
export class WebServer {
  constructor(runtime, { controller = null, port = 3210, host = '127.0.0.1', cwd = process.cwd(), dev = false } = {}) {
    check(['127.0.0.1', '::1', 'localhost'].includes(host), '服务仅允许监听本机回环地址', 400);
    Object.assign(this, { runtime, controller, port, host, cwd, dev }); this.token = randomBytes(32).toString('hex'); this.clients = new Set(); this.routes = new Map();
  }
  bind(taskId, eventId) {
    this.binding = { taskId, eventId }; this.runtime.store.put('session', 'binding', this.binding);
  }
  boundTask(id) { check(this.binding?.taskId === id, '此对话不属于当前端口', 404); return this.runtime.task(id); }
  snapshot() { return { tasks: this.binding ? [this.runtime.publicTask(this.boundTask(this.binding.taskId))] : [], codex: this.controller?.status() || null, cwd: this.cwd, mode: this.controller ? 'codex' : 'legacy' }; }
  async start() {
    this.binding = this.runtime.store.get('session', 'binding');
    if (!this.binding) {
      const previous = this.runtime.snapshot().find(t => t.mode === (this.controller ? 'codex' : 'legacy'));
      if (previous) this.bind(previous.id);
    }
    if (this.dev) {
      const { createServer } = await import('vite');
      this.vite = await createServer({ configFile: resolve(root, 'vite.config.ts'), server: { middlewareMode: true, hmr: false }, appType: 'spa' });
    }
    this.server = http.createServer((req, res) => this.handle(req, res).catch(error => {
      if (res.headersSent) return res.destroy();
      this.json(res, { error: error.message }, error.status || 500);
    }));
    this.server.requestTimeout = 120000;
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.port, this.host, resolve); });
    const address = this.server.address(); this.baseUrl = `http://${address.family === 'IPv6' ? `[${address.address}]` : address.address}:${address.port}`;
    this.cookieName = `web_agent_session_${address.port}`;
    this.url = `${this.baseUrl}/#token=${this.token}`;
    if (this.controller) this.controller.baseUrl = this.baseUrl;
    this.onChange = event => {
      if (!this.binding && event.kind === 'task.created') this.bind(event.taskId, this.startEventId);
      if (event.taskId === this.binding?.taskId) this.broadcast('change', event);
    };
    this.onStatus = () => this.broadcast('status', this.controller.status());
    this.runtime.on('change', this.onChange); this.controller?.on('status', this.onStatus);
    return { url: this.url, baseUrl: this.baseUrl };
  }
  json(res, value, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
  authenticated(req, url) {
    const bearer = req.headers.authorization?.replace(/^Bearer /, '');
    const cookie = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${this.cookieName}=`))?.slice(this.cookieName.length + 1);
    return equal(bearer, this.token) || equal(cookie, this.token);
  }
  broadcast(type, data) {
    const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.clients) {
      if (res.writableLength > 4 * 1024 * 1024) { res.destroy(); this.clients.delete(res); }
      else res.write(message);
    }
  }
  async handle(req, res) {
    const base = new URL(this.baseUrl);
    check(req.headers.host === base.host, '不允许此 Host', 403);
    check(!req.headers.origin || req.headers.origin === base.origin, '不允许跨来源访问', 403);
    check(!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']), '不允许跨站访问', 403);
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Frame-Options', 'DENY');
    const url = new URL(req.url, base), path = url.pathname, method = req.method;
    if (path === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (path === '/api/session' && method === 'POST') {
      check(equal(req.headers.authorization?.replace(/^Bearer /, ''), this.token), '请使用启动终端提供的完整链接打开应用', 401);
      res.setHeader('Set-Cookie', `${this.cookieName}=${this.token}; HttpOnly; SameSite=Strict; Path=/`); return this.json(res, { ok: true });
    }
    const ingest = path.match(/^\/api\/ingest\/([^/]+)$/);
    if (ingest && method === 'POST') {
      const task = this.boundTask(ingest[1]); check(equal(req.headers.authorization?.replace(/^Bearer /, ''), task.ingestKey), '数据写入令牌无效', 401);
      const body = await readJSON(req); this.runtime.stream(task.id, body.channel, body.value); return this.json(res, { ok: true });
    }
    if (path.startsWith('/api/')) check(this.authenticated(req, url), '会话已失效，请使用启动终端提供的链接重新打开', 401);
    if (this.routes.has(path)) check(this.authenticated(req, url) || equal(url.searchParams.get('key'), this.routes.get(path).token), '资源链接已失效', 401);
    if (path === '/api/state' && method === 'GET') return this.json(res, this.snapshot());
    if (path === '/api/events' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      this.clients.add(res); res.write(`event: snapshot\ndata: ${JSON.stringify(this.snapshot())}\n\n`);
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
      req.on('close', () => { clearInterval(heartbeat); this.clients.delete(res); }); return;
    }
    if (path === '/api/tasks' && method === 'POST') {
      this.requireCodex(); const body = await readJSON(req);
      check(!this.binding || (body.eventId && body.eventId === this.binding.eventId), '此端口已绑定一个对话，请在当前页面继续；新对话请使用另一个端口');
      check(!this.startEventId || this.startEventId === body.eventId, '对话正在创建，请稍后重试');
      this.startEventId = body.eventId;
      try { return this.json(res, await this.controller.start(body)); }
      finally { this.startEventId = undefined; }
    }
    const taskAction = path.match(/^\/api\/tasks\/([^/]+)\/(message|stop|draft|history|interact)$/);
    if (taskAction) {
      const [, id, action] = taskAction; this.boundTask(id);
      if (action === 'history' && method === 'GET') { this.requireCodex(); return this.json(res, await this.controller.history(id, url.searchParams.get('cursor'))); }
      if (method === 'POST') {
        if (action === 'interact') {
          const body = await readJSON(req), task = this.boundTask(id);
          check(Number.isInteger(body.version) && body.version > 0, '需要界面版本', 400);
          const source = this.runtime.artifact(id, body.artifactId, body.version);
          check(source.status === 'open' && task.activeArtifactId === source.id, '只有当前界面可以发起此操作');
          if (body.action === 'navigate') return this.json(res, this.runtime.navigate(id, body.id));
          this.requireCodex();
          if (body.action === 'message') return this.json(res, await this.controller.message(id, body));
          if (body.action === 'stop') return this.json(res, await this.controller.stop(id));
          check(false, '未知页面操作', 400);
        }
        if (action === 'draft') {
          const { value } = await readJSON(req); check(typeof value === 'string' && value.length <= 100000, '草稿过大', 400);
          const task = this.runtime.task(id); task.draft = value; this.runtime.save(task); return this.json(res, { ok: true });
        }
        this.requireCodex(); return this.json(res, action === 'stop' ? await this.controller.stop(id) : await this.controller.message(id, await readJSON(req)));
      }
    }
    const artifact = path.match(/^\/api\/artifacts\/([^/]+)\/(\d+)$/);
    if (artifact && method === 'GET') {
      const a = this.runtime.store.get('artifact', artifact[1]); check(a, '界面不存在', 404);
      this.boundTask(a.taskId);
      check(a.version === Number(artifact[2]), '界面版本已失效');
      const content = this.runtime.store.get('version', `${a.id}:${a.version}`);
      return this.json(res, { document: artifactDocument(a, content) });
    }
    const artifactAction = path.match(/^\/api\/artifacts\/([^/]+)\/(state|report)$/);
    if (artifactAction && method === 'POST') {
      const a = this.runtime.store.get('artifact', artifactAction[1]); check(a, '界面不存在', 404); const body = await readJSON(req);
      this.boundTask(a.taskId);
      if (artifactAction[2] === 'state') this.runtime.saveState(a.taskId, a.id, body.version, body.value);
      else this.runtime.report(a.taskId, a.id, body.version, body);
      return this.json(res, { ok: true });
    }
    const submit = path.match(/^\/api\/inputs\/([^/]+)\/submit$/);
    if (submit && method === 'POST') {
      const request = this.runtime.store.get('input', submit[1]); check(request, '请求不存在', 404); this.boundTask(request.taskId);
      return this.json(res, this.runtime.submit(submit[1], await readJSON(req)));
    }
    const approval = path.match(/^\/api\/requests\/([^/]+)\/respond$/);
    if (approval && method === 'POST') {
      this.requireCodex(); check(this.boundTask(this.binding?.taskId).requests.some(r => r.id === approval[1]), '请求不存在', 404);
      return this.json(res, await this.controller.respond(approval[1], await readJSON(req)));
    }
    if (method === 'POST' && path.startsWith('/api/login/')) {
      this.requireCodex();
      if (path === '/api/login/start') return this.json(res, await this.controller.loginStart());
      if (path === '/api/login/cancel') { await this.controller.loginCancel(); return this.json(res, { ok: true }); }
    }
    if (path === '/api/reconnect' && method === 'POST') { this.requireCodex(); await this.controller.connect(); return this.json(res, this.controller.status()); }
    if (this.routes.has(path) && method === 'GET') {
      const route = this.routes.get(path);
      res.setHeader('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; form-action 'none'");
      res.writeHead(200, { 'Content-Type': route.contentType }); return res.end(route.body);
    }
    if (path.startsWith('/api/')) return this.json(res, { error: '接口不存在' }, 404);
    if (method !== 'GET') return this.json(res, { error: '方法不支持' }, 405);
    if (this.vite) return this.vite.middlewares(req, res, () => { res.writeHead(404); res.end(); });
    const dist = resolve(root, 'dist'), file = resolve(dist, `.${decodeURIComponent(path)}`);
    check(file === dist || file.startsWith(dist + sep), '路径无效', 403);
    const target = existsSync(file) && statSync(file).isFile() ? file : resolve(dist, 'index.html');
    if (!existsSync(target)) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('请先运行 npm run build，再运行 npm start；开发时使用 npm run dev。'); }
    // srcdoc inherits this policy. Inline code is needed by the isolated canvas;
    // the shell never inserts generated HTML outside that sandbox.
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' about:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream' }); res.end(readFileSync(target));
  }
  requireCodex() { check(this.controller, '此入口由 MCP / demo 驱动，不启动 Codex', 400); }
  async close() {
    if (this.onChange) this.runtime.off('change', this.onChange);
    if (this.onStatus) this.controller?.off('status', this.onStatus);
    for (const res of this.clients) res.end(); this.clients.clear();
    await this.vite?.close();
    if (this.server) await new Promise(resolve => { this.server.close(resolve); this.server.closeAllConnections(); });
  }
}
