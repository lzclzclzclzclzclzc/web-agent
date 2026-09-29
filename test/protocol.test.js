import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup, mockClient, until, fixtures, sleep } from './helpers.js';

test('stdio handshake, correlated out-of-order calls, timeout and process failure', async () => {
  const client = mockClient(); await client.start();
  assert.equal(client.info.userAgent, 'mock-codex/0.155');
  assert.deepEqual(await Promise.all([client.request('test/echo', { a: 1 }), client.request('test/echo', { b: 2 })]), [{ a: 1 }, { b: 2 }]);
  client.timeout = 100; await assert.rejects(client.request('test/hang'), /超时/); client.timeout = 5000;
  await client.start();
  await assert.rejects(client.request('test/crash'), /退出/);
  await client.start(); assert(client.ready); await assert.rejects(client.request('test/malformed'), /无效 JSON/);
  await client.close(); assert.equal(client.pending.size, 0);
});

test('HTTP task → dynamic tools → structured answers → continuation, history and duplicate events', async t => {
  const app = await setup(); t.after(() => app.close());
  const { runtime: r, request, controller } = app;
  const body = { cwd: fixtures, text: 'rich interaction', eventId: randomUUID() };
  const [one, duplicate] = await Promise.all([request('/api/tasks', body), request('/api/tasks', body)]);
  assert.equal(one.status, 200); assert.equal(duplicate.status, 200);
  const { taskId } = await one.json(); assert.equal((await duplicate.json()).taskId, taskId); assert.equal(r.tasks.size, 1);
  const task = r.task(taskId); const input = await until(() => r.publicTask(task).inputs.find(i => i.status === 'pending'));
  assert.equal(r.publicTask(task).artifacts.length, 3);
  assert.equal((await request('/api/tasks', { ...body, eventId: randomUUID() })).status, 409);
  const steer = await request(`/api/tasks/${taskId}/message`, { text: 'prefer B', eventId: randomUUID() }); assert.equal((await steer.json()).steered, true);
  const submit = { eventId: randomUUID(), artifactId: input.artifactId, version: input.version, value: { selected: 'B', feedback: 'compact' } };
  assert.equal((await request(`/api/inputs/${input.id}/submit`, submit)).status, 200);
  assert.equal((await request(`/api/inputs/${input.id}/submit`, submit)).status, 200);
  const graph = await until(() => r.publicTask(task).inputs.find(i => i.status === 'pending' && i.id !== input.id));
  await request(`/api/inputs/${graph.id}/submit`, { eventId: randomUUID(), artifactId: graph.artifactId, version: graph.version, value: { node: 'api', comment: 'split services' } });
  await until(() => task.status === 'idle');
  assert(task.items.some(i => i.text?.includes('继续修改'))); assert.equal(r.artifact(task.id, input.artifactId).version, 2);
  assert.equal((await controller.history(taskId)).data.length, 1);
});

test('command approval uses original server id and host questions return structured answers', async t => {
  const app = await setup(); t.after(() => app.close()); const { runtime: r, controller } = app;
  const { taskId } = await controller.start({ cwd: fixtures, text: 'approvals', eventId: randomUUID() }); const task = r.task(taskId);
  const approval = await until(() => task.requests.find(r => r.status === 'pending'));
  assert.equal(controller.requests.get(approval.id).rawId.startsWith('server:'), true);
  await assert.rejects(controller.respond(approval.id, { eventId: randomUUID(), decision: 'acceptForSession' }), /未提供/);
  await controller.respond(approval.id, { eventId: randomUUID(), decision: 'accept' });
  const question = await until(() => task.requests.find(r => r.status === 'pending' && r.id !== approval.id));
  await controller.respond(question.id, { eventId: randomUUID(), answers: { direction: { answers: ['方案 B'] } } });
  await until(() => task.status === 'idle'); assert(task.items.some(i => i.text?.includes('accept') && i.text?.includes('方案 B')));
});

test('stop expires pending answers; a resumed process restores tools without replaying old RPC', async t => {
  const app = await setup(); t.after(() => app.close()); const { runtime: r, controller, client } = app;
  const { taskId } = await controller.start({ cwd: fixtures, text: 'wait', eventId: randomUUID() }); const task = r.task(taskId);
  const input = await until(() => r.publicTask(task).inputs.find(i => i.status === 'pending'));
  const stopping = controller.stop(taskId);
  assert.equal(r.store.get('input', input.id).status, 'expired');
  await stopping; assert.equal(task.status, 'interrupted');
  assert.throws(() => r.submit(input.id, { eventId: randomUUID(), artifactId: input.artifactId, version: input.version, value: null }), /失效/);
  await client.close(); await controller.message(taskId, { text: 'complete', eventId: randomUUID() }); await until(() => task.status === 'idle');
  assert(task.items.some(i => i.text?.includes('已完成')));
});

test('crash invalidates an outstanding approval and reconnection never sends its response', async t => {
  const app = await setup(); t.after(() => app.close()); const { runtime: r, controller, client } = app;
  const { taskId } = await controller.start({ cwd: fixtures, text: 'approvals', eventId: randomUUID() }); const task = r.task(taskId);
  const pending = await until(() => task.requests.find(q => q.status === 'pending'));
  await assert.rejects(client.request('test/crash')); await until(() => task.status === 'interrupted'); await controller.connect();
  await assert.rejects(controller.respond(pending.id, { eventId: randomUUID(), decision: 'accept' }), /失效/);
  assert.equal(task.requests[0].status, 'expired'); await sleep(20); assert(client.ready);
});

test('file, permission, MCP form approvals and server-resolved requests retain protocol semantics', async t => {
  const app = await setup(); t.after(() => app.close()); const { runtime: r, controller, client } = app;
  await controller.connect(); const task = r.createTask(fixtures, 'requests');
  r.mutate(task.id, t => { t.threadId = 'approval-test'; t.turnId = 'turn-test'; t.status = 'running'; });
  const replies = [], original = client.respond.bind(client); client.respond = (id, value) => { replies.push({ id, value }); original(id, value); };
  let serial = 0;
  async function request(method, extra = {}) {
    const id = ++serial;
    await controller.onRequest({ id, method, params: { threadId: task.threadId, turnId: task.turnId, itemId: 'item', ...extra } });
    return task.requests.at(-1);
  }
  const file = await request('item/fileChange/requestApproval', { grantRoot: fixtures });
  await controller.respond(file.id, { eventId: randomUUID(), decision: 'decline' }); assert.deepEqual(replies.at(-1), { id: 1, value: { decision: 'decline' } });
  const permissions = { fileSystem: { read: [fixtures] }, network: null };
  const permission = await request('item/permissions/requestApproval', { permissions });
  await controller.respond(permission.id, { eventId: randomUUID(), decision: 'accept' }); assert.deepEqual(replies.at(-1).value, { permissions, scope: 'turn' });
  const form = await request('mcpServer/elicitation/request', { mode: 'form', serverName: 'test', requestedSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } });
  await assert.rejects(controller.respond(form.id, { eventId: randomUUID(), decision: 'accept', content: {} }), /name/);
  await controller.respond(form.id, { eventId: randomUUID(), decision: 'accept', content: { name: 'test' } }); assert.deepEqual(replies.at(-1).value, { action: 'accept', content: { name: 'test' } });
  const device = await request('mcpServer/elicitation/request', { mode: 'openai/userVerification' });
  await assert.rejects(controller.respond(device.id, { eventId: randomUUID(), decision: 'accept' }), /原生客户端/);
  controller.onNotification({ method: 'serverRequest/resolved', params: { threadId: task.threadId, requestId: serial } });
  assert.equal(device.status, 'expired'); await assert.rejects(controller.respond(device.id, { eventId: randomUUID(), decision: 'decline' }), /失效/);
});
