import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setup, fixtures, until } from './helpers.js';
import { WebServer } from '../src/http-server.js';
import { Runtime } from '../src/runtime.js';
import { InteractionServer } from '../src/engine.js';

test('loopback binding, session tokens, origins and write-only ingestion capabilities', async t => {
  assert.throws(() => new WebServer(new Runtime(), { host: '0.0.0.0' }), /回环/);
  const app = await setup(); t.after(() => app.close()); const { server, runtime: r, request } = app;
  assert.equal((await fetch(server.baseUrl + '/api/state')).status, 401);
  assert.equal((await request('/api/state', undefined, { Origin: 'https://evil.example' })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => { const req = http.get(server.baseUrl + '/api/state', { headers: { Host: 'evil.example', Authorization: `Bearer ${server.token}` } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); });
  assert.equal(hostStatus, 403);
  assert.equal((await request('/api/session', {})).status, 200);
  const login = await request('/api/session', {}), cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(server.baseUrl + '/api/state', { headers: { Cookie: cookie } })).status, 200);
  const task = r.createTask(fixtures, 'stream');
  assert.equal((await request(`/api/ingest/${task.id}`, { channel: 'loss', value: .2 })).status, 401);
  assert.equal((await request(`/api/ingest/${task.id}`, { channel: 'loss', value: { epoch: 1, loss: .2 } }, { Authorization: `Bearer ${task.ingestKey}` })).status, 200);
  assert.equal((await request('/api/state', undefined, { Authorization: `Bearer ${task.ingestKey}` })).status, 401);
  assert.equal((await request(`/api/ingest/${task.id}`, { channel: 'loss', value: .2 }, { Authorization: `Bearer ${task.ingestKey}`, Origin: 'null' })).status, 403);
  const state = await (await request('/api/state')).json(); assert(!JSON.stringify(state).includes(task.ingestKey));
});

test('one port owns one conversation even after completion; canvas navigation never calls the model', async t => {
  const app = await setup(); t.after(() => app.close()); const { runtime: r, request } = app;
  const body = { text: 'complete', eventId: 'first-port-task' };
  const started = await (await request('/api/tasks', body)).json(), task = r.task(started.taskId);
  await until(() => task.status === 'idle');
  assert.equal((await request('/api/tasks', { text: 'new', eventId: 'another' })).status, 409);
  assert.deepEqual(await (await request('/api/tasks', body)).json(), started);
  const a = r.present(task.id, { path: 'choices.html' }), b = r.present(task.id, { path: 'metrics.html', activate: false });
  assert.equal(task.activeArtifactId, a.id);
  const turnCount = task.items.length;
  assert.equal((await request(`/api/tasks/${task.id}/interact`, { action: 'navigate', artifactId: a.id, version: 1, id: b.id })).status, 200);
  assert.equal(task.activeArtifactId, b.id); assert.equal(task.items.length, turnCount);
  assert.equal((await request(`/api/tasks/${task.id}/interact`, { action: 'message', artifactId: a.id, version: 1, text: 'complete', eventId: 'hidden' })).status, 409);
  assert.equal((await request(`/api/tasks/${task.id}/interact`, { action: 'navigate', artifactId: b.id, version: 999, id: a.id })).status, 409);
  assert.equal((await request(`/api/tasks/${task.id}/interact`, { action: 'message', artifactId: b.id, version: 1, text: 'complete via canvas', eventId: 'canvas-message' })).status, 200);
  await until(() => task.status === 'idle');
  assert(task.items.some(i => i.id === 'canvas-message'));
  const other = r.createTask(fixtures, 'old history'), otherArtifact = r.present(other.id, { path: 'choices.html' });
  assert.equal((await (await request('/api/state')).json()).tasks.length, 1);
  assert.equal((await request(`/api/tasks/${other.id}/message`, { text: 'complete', eventId: 'cross-task' })).status, 404);
  assert.equal((await request(`/api/artifacts/${otherArtifact.id}/1`)).status, 404);
  assert.equal((await request(`/api/tasks/${task.id}/interact`, { action: 'navigate', artifactId: b.id, version: 1, id: otherArtifact.id })).status, 404);
  assert.equal((await request(`/api/ingest/${other.id}`, { channel: 'loss', value: 1 }, { Authorization: `Bearer ${other.ingestKey}` })).status, 404);
});

test('legacy render/ask/stream/route uses shared runtime and leaves prior canvas visible', async t => {
  const engine = new InteractionServer({ cwd: fixtures }); t.after(() => engine.close()); await engine.start();
  const view = engine.render({ title: 'original', doc: '<h1>keep me</h1>' });
  const answer = engine.ask({ title: 'choose', options: [{ id: 'a', label: 'A' }] });
  engine.render({ title: 'monitor', charts: [{ channel: 'loss' }] }); engine.stream('loss', .3);
  assert.equal(engine.runtime.publicTask(engine.task).artifacts.length, 2);
  const input = engine.runtime.store.get('input', answer.requestId); assert.equal(input.artifactId, view.id);
  engine.runtime.submit(input.id, { eventId: 'legacy', artifactId: view.id, version: 1, value: null }); assert.equal(await answer, null);
  const route = engine.route('/report', { body: '<script>document.body.textContent="sandboxed"</script>' });
  const response = await fetch(route.url); assert.equal(response.status, 200); assert.match(response.headers.get('content-security-policy'), /sandbox allow-scripts/);
  assert.throws(() => engine.route('/api/state', { body: '' }), /保留/);
});

test('a failed thread creation retains the first prompt and recovers within the bound conversation', async t => {
  const app = await setup(); t.after(() => app.close()); const rpc = app.client.request.bind(app.client);
  let fail = true;
  app.client.request = async (method, params) => {
    if (method === 'thread/start' && fail) { fail = false; throw new Error('temporary thread failure'); }
    return rpc(method, params);
  };
  const text = 'complete original prompt';
  assert.equal((await app.request('/api/tasks', { text, eventId: 'first-failed' })).status, 500);
  const task = app.server.snapshot().tasks[0]; assert.equal(task.draft, text); assert.equal(task.status, 'error');
  assert.equal((await app.request(`/api/tasks/${task.id}/message`, { text: task.draft, eventId: 'retry-thread' })).status, 200);
  await until(() => app.runtime.task(task.id).status === 'idle');
  assert.equal(app.runtime.tasks.size, 1); assert(app.runtime.task(task.id).threadId);
  assert(app.runtime.task(task.id).items.some(i => i.type === 'userMessage' && i.text === text));
});
