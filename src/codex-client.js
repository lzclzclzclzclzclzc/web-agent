import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export function codexBinary() {
  if (process.env.WEB_AGENT_CODEX_BIN) return process.env.WEB_AGENT_CODEX_BIN;
  if (process.platform === 'win32') {
    for (const directory of (process.env.PATH || '').split(delimiter)) {
      const exe = join(directory.replace(/^"|"$/g, ''), 'codex.exe');
      if (existsSync(exe)) return exe;
    }
  }
  return 'codex';
}

export class CodexClient extends EventEmitter {
  constructor({ bin = codexBinary(), args = ['app-server', '--listen', 'stdio://'], cwd = process.cwd(), timeout = 60000 } = {}) {
    super(); Object.assign(this, { bin, args, cwd, timeout }); this.pending = new Map(); this.nextId = 1; this.process = null;
  }
  async start() {
    if (this.ready) return this.info;
    if (this.starting) return this.starting;
    this.starting = this.launch().finally(() => { this.starting = null; }); return this.starting;
  }
  async launch() {
    if (/\.(cmd|bat)$/i.test(this.bin)) throw new Error('WEB_AGENT_CODEX_BIN 请指向 Codex 原生可执行文件（codex.exe），不支持批处理包装器');
    const child = spawn(this.bin, this.args, { cwd: this.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.process = child; this.buffer = ''; this.ready = false;
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (this.process !== child) return;
      this.buffer += chunk;
      if (this.buffer.length > 32 * 1024 * 1024) return this.fail(child, new Error('Codex 协议消息超出限制'));
      let end;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end).trim(); this.buffer = this.buffer.slice(end + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { this.fail(child, new Error('Codex 输出了无效 JSON 协议消息')); return; }
        if (message.method) this.emit(message.id === undefined ? 'notification' : 'request', message);
        else if (message.id !== undefined) {
          const pending = this.pending.get(message.id);
          if (!pending) continue;
          clearTimeout(pending.timer); this.pending.delete(message.id);
          if (message.error) pending.reject(Object.assign(new Error(message.error.message), { code: message.error.code, data: message.error.data }));
          else pending.resolve(message.result);
        }
      }
    });
    child.stderr.on('data', chunk => this.emit('diagnostic', chunk));
    child.stdin.on('error', error => this.fail(child, error));
    child.on('error', error => this.fail(child, new Error(`无法启动 Codex (${this.bin}): ${error.message}`)));
    child.on('exit', (code, signal) => this.fail(child, new Error(`Codex 进程已退出 (${signal || code})`)));
    try {
      this.info = await this.request('initialize', { clientInfo: { name: 'web_agent', title: 'Web Agent', version: '0.2.0' }, capabilities: { experimentalApi: true } });
      this.write({ method: 'initialized' }); this.ready = true; this.emit('ready', this.info); return this.info;
    } catch (error) { this.fail(child, error); throw error; }
  }
  fail(child, error) {
    if (this.process !== child) return;
    this.ready = false; this.process = null; child.kill();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.emit('disconnect', error);
  }
  write(message) {
    if (!this.process?.stdin.writable) throw new Error('Codex 未连接');
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }
  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error(`Codex 请求超时：${method}；连接已关闭，结果可能已执行，请检查任务状态后再继续`);
        if (this.process) this.fail(this.process, error); else { this.pending.delete(id); reject(error); }
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); }
      catch (error) { this.pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  respond(id, result) { this.write({ id, result }); }
  reject(id, message) { this.write({ id, error: { code: -32601, message } }); }
  async close() {
    const child = this.process;
    if (!child) return;
    this.fail(child, new Error('Codex 连接已关闭'));
    await new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); setTimeout(resolve, 3000).unref(); });
  }
}
