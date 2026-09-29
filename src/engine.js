// MCP and demo share the same versioned runtime and sandbox as Codex.
import { randomBytes } from 'node:crypto';
import { Runtime } from './runtime.js';
import { Store } from './store.js';
import { WebServer } from './http-server.js';
import { projectDirectory, projectFile } from './files.js';

const escape = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function documentFor(view) {
  if (view.doc) return view.doc;
  const charts = (view.charts || []).map(c => `<section class="chart" data-channel="${escape(c.channel)}"><h3>${escape(c.label || c.channel)}</h3><strong>—</strong><svg viewBox="0 0 600 130" preserveAspectRatio="none"></svg></section>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  :root{--muted:#7c8979;--ok:#3c7652;--accent:#426b4a}*{box-sizing:border-box}body{margin:0;padding:40px;font:15px/1.8 'Segoe UI','Microsoft YaHei',sans-serif;color:#293c2d;background:#fbfcf8}h1{font-size:26px;font-weight:500}p{white-space:pre-wrap}small{color:var(--muted)}.chart{border:1px solid #dfe5d9;padding:20px;margin-top:20px;border-radius:8px}.chart h3{font-size:13px;margin:0}.chart svg{width:100%;height:130px;margin-top:16px}.chart strong{font-size:22px}a{color:var(--accent)}
  </style></head><body><h1>${escape(view.title || '')}</h1><small>${escape(view.subtitle || '')}</small>${view.message ? `<p>${escape(view.message)}</p>` : ''}${view.html || ''}${charts}<script>
  webagent.onStream(({channel,history})=>{for(const panel of document.querySelectorAll('[data-channel]')){if(panel.dataset.channel!==channel)continue;const values=history.filter(x=>typeof x==='number');if(!values.length)continue;panel.querySelector('strong').textContent=values.at(-1);const lo=Math.min(...values),hi=Math.max(...values),points=values.map((v,i)=>[i*600/Math.max(1,values.length-1),120-(v-lo)*110/(hi-lo||1)].join(',')).join(' ');panel.querySelector('svg').innerHTML='<polyline fill="none" stroke="#527c50" stroke-width="2" points="'+points+'"/>';}});
  </script></body></html>`;
}

export class InteractionServer {
  constructor({ host = '127.0.0.1', port = 0, cwd = process.cwd(), store = new Store() } = {}) {
    this.cwd = projectDirectory(cwd); this.runtime = new Runtime(store);
    this.web = new WebServer(this.runtime, { host, port, cwd: this.cwd });
    this.task = this.runtime.createTask(this.cwd, 'MCP / Demo 交互', 'legacy'); this.current = null;
  }
  async start() { const result = await this.web.start(); this.url = result.url; this.baseUrl = result.baseUrl; return result; }
  get ingest() { return { url: `${this.baseUrl}/api/ingest/${this.task.id}`, token: this.task.ingestKey }; }
  readFile(path, encoding) { const content = projectFile(this.cwd, path, 10 * 1024 * 1024); return encoding ? content.toString(encoding) : content; }
  render(view = {}) {
    this.current = this.runtime.present(this.task.id, { html: documentFor(view), title: view.title || '交互界面' }); return this.current;
  }
  ask(spec) {
    if (spec.doc || !this.current) this.render(spec);
    const hasControls = spec.options?.length || spec.controls?.length || spec.actions?.length || spec.freeText?.enabled;
    return this.runtime.requestInput(this.task.id, { artifactId: this.current.id, version: this.current.version, prompt: spec.title || '请确认', spec: hasControls ? { ...spec, doc: undefined } : undefined });
  }
  say(text) { return this.render({ title: 'Agent', message: text }); }
  converse(message) { return this.ask({ title: message || '请回复', freeText: { enabled: true }, submitLabel: '发送回复' }); }
  stream(channel, value) { this.runtime.stream(this.task.id, channel, value); }
  route(path, { contentType = 'text/html; charset=utf-8', body }) {
    path = path.startsWith('/') ? path : `/${path}`;
    if (!/^\/[\w./-]+$/.test(path) || /(^|\/)\.\.?($|\/)/.test(path) || /^\/(api|assets|src|events|submit|ingest|favicon\.ico)(\/|$)/.test(path)) throw new Error('保留或无效 URL 路径');
    const token = randomBytes(24).toString('hex'); this.web.routes.set(path, { contentType, body, token });
    return { path, url: `${this.baseUrl}${path}?key=${token}` };
  }
  waiting(message = '等待 agent…') { return this.render({ title: message }); }
  cancelPending(reason = '请求已取消', requestId) {
    if (requestId) {
      const request = this.runtime.store.get('input', requestId);
      if (request?.status === 'pending') this.runtime.expireInputs(this.task.id, reason, request.artifactId);
    } else this.runtime.expireInputs(this.task.id, reason);
    this.runtime.change(this.task.id, 'input.cancelled');
  }
  async close() { await this.web.close(); this.runtime.close(); }
}
