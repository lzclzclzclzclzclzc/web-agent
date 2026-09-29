// Optional real approval protocol test. It declines the harmless echo request.
// Only this disposable thread uses an explicit policy; production inherits config.
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { Runtime } from '../src/runtime.js';
import { Controller } from '../src/controller.js';
import { WebServer } from '../src/http-server.js';

const cwd = resolve('.web-agent-data/smoke-project'); mkdirSync(cwd, { recursive: true });
const runtime = new Runtime(), controller = new Controller(runtime, { cwd }), server = new WebServer(runtime, { controller, port: 0 });
async function until(fn) { const start = Date.now(); while (!fn()) { if (Date.now() - start > 180000) throw new Error('真实审批请求未在期限内出现'); await new Promise(r => setTimeout(r, 200)); } return fn(); }
try {
  await server.start(); await controller.connect();
  const task = runtime.createTask(cwd, '一次性审批协议测试');
  const response = await controller.client.request('thread/start', {
    cwd, ephemeral: true, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only',
    developerInstructions: 'This is a disposable UI approval transport test. Execute no file writes, network requests, or additional commands. For the requested harmless echo, explicitly request escalation so that the client can decline it. If denied, stop immediately without retrying or using another tool.',
  });
  task.threadId = response.thread.id; controller.loaded.add(task.id); runtime.save(task);
  await controller.startTurn(task, '请调用 exec_command 执行 echo web-agent-approval-smoke，sandbox_permissions 必须为 require_escalated，justification 为“验证 Web Agent 命令审批流程”。这是审批协议测试；如果拒绝就结束，不要绕过拒绝或改用其他方式。', randomUUID());
  const approval = await until(() => task.requests.find(r => r.method === 'item/commandExecution/requestApproval' && r.status === 'pending'));
  console.log('real command approval received; original request ID preserved; decisions:', JSON.stringify(approval.params.availableDecisions));
  const decision = !approval.params.availableDecisions || approval.params.availableDecisions.includes('decline') ? 'decline' : 'cancel';
  const result = await fetch(`${server.baseUrl}/api/requests/${approval.id}/respond`, { method: 'POST', headers: { Authorization: `Bearer ${server.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: randomUUID(), decision }) });
  assert.equal(result.status, 200, await result.text());
  await until(() => ['idle', 'error', 'interrupted'].includes(task.status)); assert.notEqual(task.status, 'error');
  console.log(`HTTP ${decision} → App Server response → turn finished: OK`);
} catch (error) { console.error(error.message); for (const t of runtime.tasks.values()) console.error(t.status, t.items.filter(i => i.type === 'agentMessage' || i.type === 'error').map(i => i.text)); process.exitCode = 1; }
finally { await controller.close(); await server.close(); runtime.close(); }
