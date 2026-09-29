import { EventEmitter } from 'node:events';
import { randomUUID, randomBytes } from 'node:crypto';
import Ajv from 'ajv';
import { Store } from './store.js';
import { projectFile, readAssets } from './files.js';

const ajv = new Ajv({ strict: false, allErrors: true });
const now = () => new Date().toISOString();
const jsonSize = value => Buffer.byteLength(JSON.stringify(value));
export function check(condition, message, status = 409) {
  if (!condition) throw Object.assign(new Error(message), { status });
}

export class Runtime extends EventEmitter {
  constructor(store = new Store()) {
    super(); this.store = store; this.waiters = new Map();
    this.tasks = new Map(store.all('task').map(t => [t.id, t]));
    for (const task of this.tasks.values()) {
      if (!task.activeArtifactId) task.activeArtifactId = store.all('artifact').filter(a => a.taskId === task.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).at(-1)?.id;
      if (['running', 'starting', 'stopping'].includes(task.status)) task.status = 'interrupted';
      task.turnId = null;
      for (const request of task.requests) if (request.status === 'pending') request.status = 'expired';
      this.save(task);
    }
    for (const request of store.all('input')) if (request.status === 'pending') {
      request.status = 'expired'; request.reason = '服务已重启，请继续任务后重新确认'; store.put('input', request.id, request);
    }
  }
  task(id) { const t = this.tasks.get(id); check(t, '任务不存在', 404); return t; }
  save(task) { task.updatedAt = now(); this.store.put('task', task.id, task); }
  createTask(cwd, title, mode = 'codex') {
    const task = { id: randomUUID(), threadId: null, cwd, title: String(title || '新任务').slice(0, 80), mode,
      status: 'idle', turnId: null, draft: '', items: [], requests: [], createdAt: now(), updatedAt: now(), ingestKey: randomBytes(32).toString('hex') };
    this.tasks.set(task.id, task); this.save(task); this.change(task.id, 'task.created'); return task;
  }
  publicTask(task) {
    const { ingestKey, ...safe } = task;
    return { ...safe, artifacts: this.store.all('artifact').filter(a => a.taskId === task.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      inputs: this.store.all('input').filter(r => r.taskId === task.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      channels: Object.fromEntries(this.store.all('channel').filter(c => c.taskId === task.id).map(c => [c.channel, c.values])) };
  }
  snapshot() { return [...this.tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(t => this.publicTask(t)); }
  change(taskId, kind, detail = {}) {
    const event = { kind, taskId, ...detail, at: now() };
    event.seq = this.store.event(taskId, event);
    this.emit('change', kind === 'data' ? event : { ...event, task: this.publicTask(this.task(taskId)) });
  }
  mutate(id, fn, kind = 'task.updated') { const task = this.task(id); fn(task); this.save(task); this.change(id, kind); return task; }
  artifact(taskId, id, version) {
    const a = this.store.get('artifact', id);
    check(a && a.taskId === taskId, '界面不存在', 404);
    if (version !== undefined) check(a.version === version, '界面已更新，请重新查看后提交');
    return a;
  }
  present(taskId, { path, title, assets, html, activate = true }, existingId, preserveState = []) {
    const task = this.task(taskId);
    const previous = existingId ? this.artifact(taskId, existingId) : null;
    const source = html ?? projectFile(task.cwd, path).toString('utf8');
    check(typeof source === 'string' && source.length <= 2 * 1024 * 1024, 'HTML 太大', 400);
    const resources = assets === undefined && previous ? this.store.get('version', `${previous.id}:${previous.version}`).assets : readAssets(task.cwd, assets);
    const state = Object.fromEntries(preserveState.filter(k => typeof k === 'string' && Object.hasOwn(previous?.state || {}, k)).map(k => [k, previous.state[k]]));
    const artifact = { id: existingId || randomUUID(), taskId, version: (previous?.version || 0) + 1,
      order: previous?.order ?? this.store.all('artifact').filter(a => a.taskId === taskId).length,
      title: title || previous?.title || '交互界面', status: 'open', state, loaded: false, errors: [], updatedAt: now() };
    if (previous) this.expireInputs(taskId, '界面已更新', existingId);
    this.store.transaction(() => {
      this.store.put('version', `${artifact.id}:${artifact.version}`, { html: source, assets: resources });
      this.store.put('artifact', artifact.id, artifact);
      if (activate || !task.activeArtifactId) { task.activeArtifactId = artifact.id; this.save(task); }
    });
    this.change(taskId, 'artifact.presented'); return { id: artifact.id, version: artifact.version, title: artifact.title };
  }
  navigate(taskId, id) {
    const a = this.artifact(taskId, id); check(a.status === 'open', '界面已关闭');
    this.mutate(taskId, task => { task.activeArtifactId = id; }, 'artifact.activated');
    return { id: a.id, version: a.version, title: a.title };
  }
  saveState(taskId, id, version, state) {
    const a = this.artifact(taskId, id, version);
    check(a.status === 'open', '界面已关闭');
    check(state !== null && typeof state === 'object' && !Array.isArray(state) && jsonSize(state) <= 65536, '状态必须是小于 64 KB 的 JSON 对象', 400);
    a.state = state; this.store.put('artifact', id, a); // No iframe reload or full snapshot for every keystroke.
  }
  report(taskId, id, version, { loaded, error, summary }) {
    const a = this.artifact(taskId, id, version);
    if (loaded) a.loaded = true;
    if (error) a.errors = [...a.errors, String(error).slice(0, 2000)].slice(-20);
    if (summary !== undefined) a.summary = String(summary).slice(0, 2000);
    this.store.put('artifact', id, a);
  }
  requestInput(taskId, { artifactId, version, prompt = '请在界面中完成操作', schema, spec }) {
    const a = this.artifact(taskId, artifactId, version); check(a.status === 'open', '界面已关闭');
    check(!this.store.all('input').some(r => r.artifactId === artifactId && r.status === 'pending'), '此界面已有待处理回答');
    if (schema) { check(jsonSize(schema) < 32768, '回答结构过大', 400); ajv.compile(schema); }
    const request = { id: randomUUID(), taskId, artifactId, version, prompt, schema, spec, status: 'pending', createdAt: now() };
    this.store.put('input', request.id, request);
    const promise = new Promise((resolve, reject) => this.waiters.set(request.id, { resolve, reject }));
    promise.requestId = request.id;
    this.change(taskId, 'input.requested'); return promise;
  }
  submit(id, { eventId, artifactId, version, value }) {
    check(typeof eventId === 'string' && eventId.length > 0 && eventId.length < 128, '需要唯一事件 ID', 400);
    check(value !== undefined && jsonSize(value) <= 65536, '回答必须是小于 64 KB 的 JSON', 400);
    const receiptKey = `answer:${eventId}`, fingerprint = JSON.stringify({ id, artifactId, version, value });
    const receipt = this.store.get('receipt', receiptKey);
    if (receipt) { check(receipt.fingerprint === fingerprint, '事件 ID 已被另一提交使用'); return receipt.result; }
    const request = this.store.get('input', id);
    check(request && request.status === 'pending' && this.waiters.has(id), '这次确认已经结束或失效');
    check(request.artifactId === artifactId && request.version === version, '回答与请求版本不匹配');
    const a = this.artifact(request.taskId, artifactId, version); check(a.status === 'open', '界面已关闭');
    if (request.schema) {
      const validate = ajv.compile(request.schema);
      check(validate(value), `回答格式不正确：${ajv.errorsText(validate.errors)}`, 400);
    }
    const result = { ok: true, requestId: id };
    request.status = 'answered'; request.answer = value; request.answeredAt = now();
    this.store.transaction(() => { this.store.put('input', id, request); this.store.put('receipt', receiptKey, { fingerprint, result }); });
    const waiter = this.waiters.get(id); this.waiters.delete(id);
    this.change(request.taskId, 'input.answered'); waiter.resolve(value); return result;
  }
  expireInputs(taskId, reason, artifactId) {
    for (const request of this.store.all('input')) {
      if (request.taskId !== taskId || request.status !== 'pending' || (artifactId && request.artifactId !== artifactId)) continue;
      request.status = 'expired'; request.reason = reason; this.store.put('input', request.id, request);
      this.waiters.get(request.id)?.reject(new Error(reason)); this.waiters.delete(request.id);
    }
  }
  closeArtifact(taskId, id) {
    const a = this.artifact(taskId, id); this.expireInputs(taskId, '界面已关闭', id); a.status = 'closed';
    this.store.put('artifact', id, a);
    const task = this.task(taskId);
    if (task.activeArtifactId === id) {
      task.activeArtifactId = this.publicTask(task).artifacts.filter(a => a.status === 'open').at(-1)?.id || id; this.save(task);
    }
    this.change(taskId, 'artifact.closed'); return { ok: true };
  }
  inspect(taskId, id) { const a = this.artifact(taskId, id); return { ...a, inputs: this.store.all('input').filter(r => r.artifactId === id).map(({ id, status, version }) => ({ id, status, version })) }; }
  stream(taskId, channel, value) {
    this.task(taskId); check(typeof channel === 'string' && /^[\w.:-]{1,100}$/.test(channel), '无效数据通道', 400);
    check(value !== undefined && jsonSize(value) <= 65536, '数据必须小于 64 KB', 400);
    const id = `${taskId}:${channel}`, current = this.store.get('channel', id);
    check(current || this.store.all('channel').filter(c => c.taskId === taskId).length < 100, '数据通道数量已达上限');
    const entry = { taskId, channel, values: [...(current?.values || []), value].slice(-300) };
    this.store.put('channel', id, entry); this.change(taskId, 'data', { channel, value });
  }
  expireTask(id, reason, status = 'interrupted') {
    this.expireInputs(id, reason);
    this.mutate(id, task => { task.status = status; task.turnId = null;
      for (const r of task.requests) if (r.status === 'pending') { r.status = 'expired'; r.reason = reason; }
    }, 'task.ended');
  }
  close() { for (const t of this.tasks.values()) this.expireInputs(t.id, '服务已关闭'); this.store.close(); }
}
