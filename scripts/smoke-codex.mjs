// A real, billable Codex smoke test. Uses existing login/config; no auto approval.
import { mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { Runtime } from '../src/runtime.js';
import { Controller } from '../src/controller.js';
import { WebServer } from '../src/http-server.js';

const cwd = resolve('.web-agent-data/smoke-project'); mkdirSync(cwd, { recursive: true });
copyFileSync(resolve('test/fixtures/choices.html'), resolve(cwd, 'choices.html'));
const runtime = new Runtime(), controller = new Controller(runtime, { cwd }), server = new WebServer(runtime, { controller, cwd, port: 0 });
controller.client.on('diagnostic', value => { if (process.env.WEB_AGENT_SMOKE_DEBUG) process.stderr.write(value); });
controller.client.on('request', r => console.log('server request:', r.method, r.params?.namespace || '', r.params?.tool || ''));
controller.client.on('notification', r => { if (r.method === 'error') console.error('Codex error:', r.params?.error?.message || r.params?.message); if (r.method === 'turn/completed') console.log('turn completed:', r.params?.turn?.status, r.params?.turn?.error?.message || ''); });
controller.on('diagnostic', s => console.error(s));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 180000) { const started = Date.now(); while (!fn()) { if (Date.now() - started > timeout) throw new Error('smoke timeout'); await sleep(200); } return fn(); }
try {
  await server.start(); await controller.connect(); console.log('initialize: OK', controller.client.info?.userAgent);
  const created = await controller.start({ cwd, eventId: randomUUID(), text: '这是 Web Agent 协议验收。不要运行命令或读写文件。直接调用 web_agent.present 发布项目已有的 choices.html，title 为“真实 Codex 测试”。然后调用 web_agent.request_input 等待用户选择，schema 为 object，selected 是 A 或 B。收到后只回复 ACCEPTED 和 selected 字段，然后结束。必须实际调用这两个工具，不要仅描述。' });
  const task = runtime.task(created.taskId); console.log('thread/start, turn/start: OK');
  const request = await until(() => runtime.publicTask(task).inputs.find(r => r.status === 'pending'));
  const reply = await fetch(`${server.baseUrl}/api/inputs/${request.id}/submit`, { method: 'POST', headers: { Authorization: `Bearer ${server.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: randomUUID(), artifactId: request.artifactId, version: request.version, value: { selected: 'B' } }) });
  assert.equal(reply.status, 200, await reply.text()); console.log('present → request_input → HTTP submit: OK');
  await until(() => task.status === 'idle' || task.status === 'error'); assert.equal(task.status, 'idle');
  assert(task.items.some(i => i.type === 'agentMessage' && /ACCEPTED[\s\S]*B/i.test(i.text || ''))); console.log('agent continuation: OK');
  await controller.history(task.id); console.log('history: OK');
  await controller.close(); await controller.message(task.id, { eventId: randomUUID(), text: '再调用一次 web_agent.request_input，使用刚才保留的界面 ID 和版本，等待新的选择。不要运行其他命令。' });
  await until(() => runtime.publicTask(task).inputs.find(r => r.status === 'pending'));
  console.log('process restart → thread/resume → restored dynamic tools: OK');
  await controller.stop(task.id); assert(!runtime.publicTask(task).inputs.some(r => r.status === 'pending')); console.log('turn/interrupt → stale inputs expired: OK');
} catch (error) { console.error('REAL SMOKE FAILED:', error.message); for (const task of runtime.tasks.values()) console.error('Task diagnostic:', JSON.stringify({ status: task.status, items: task.items.slice(-5).map(i => ({ type: i.type, text: (i.text || '').slice(0, 2000) })) })); process.exitCode = 1; }
finally { await controller.close(); await server.close(); runtime.close(); }
