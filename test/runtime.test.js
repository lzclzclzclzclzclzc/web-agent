import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from '../src/runtime.js';
import { Store } from '../src/store.js';
import { projectFile } from '../src/files.js';
import { fixtures } from './helpers.js';

test('multiple canvases and independent JSON channels retain pending structured input', async () => {
  const r = new Runtime(), task = r.createTask(fixtures, 'test');
  const a = r.present(task.id, { path: 'choices.html', title: 'A' }), b = r.present(task.id, { path: 'metrics.html', title: 'B' });
  const answer = r.requestInput(task.id, { artifactId: a.id, version: a.version, schema: { type: 'object', properties: { node: { type: 'string' } }, required: ['node'] } });
  const request = r.publicTask(task).inputs[0];
  for (let epoch = 0; epoch < 310; epoch++) r.stream(task.id, 'metrics', { epoch, loss: 1 / (epoch + 1) });
  assert.equal(r.publicTask(task).artifacts.length, 2); assert.equal(r.publicTask(task).channels.metrics.length, 300);
  assert.equal(r.publicTask(task).inputs[0].status, 'pending'); assert(b.id !== a.id);
  assert.throws(() => r.submit(request.id, { eventId: 'bad', artifactId: a.id, version: a.version, value: {} }), /格式/);
  const body = { eventId: 'answer-1', artifactId: a.id, version: a.version, value: { node: 'api' } };
  assert.deepEqual(r.submit(request.id, body), r.submit(request.id, body)); assert.deepEqual(await answer, { node: 'api' });
  assert.throws(() => r.submit(request.id, { ...body, value: { node: 'db' } }), /事件 ID/);
  assert.throws(() => r.submit(request.id, { ...body, eventId: 'different' }), /失效/); r.close();
});

test('versions expire old input, preserve only declared state and close cancels waiters', async () => {
  const r = new Runtime(), t = r.createTask(fixtures, 'test'), a = r.present(t.id, { path: 'choices.html' });
  r.saveState(t.id, a.id, 1, { selected: 'B', scratch: 'discard' });
  const waiting = r.requestInput(t.id, { artifactId: a.id, version: 1 });
  const rejected = assert.rejects(waiting, /更新/);
  const v2 = r.present(t.id, { path: 'choices.html' }, a.id, ['selected']); await rejected;
  assert.equal(v2.version, 2); assert.deepEqual(r.artifact(t.id, a.id).state, { selected: 'B' });
  assert.throws(() => r.saveState(t.id, a.id, 1, {}), /更新/);
  const next = r.requestInput(t.id, { artifactId: a.id, version: 2 }); const closed = assert.rejects(next, /关闭/);
  r.closeArtifact(t.id, a.id); await closed;
  assert.throws(() => r.requestInput(t.id, { artifactId: a.id, version: 2 }), /关闭/); r.close();
});

test('restart persists interfaces, drafts, receipts and data but expires pending operations', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'web-agent-store-')), 'state.sqlite');
  let r = new Runtime(new Store(path)); const t = r.createTask(fixtures, 'persist'), a = r.present(t.id, { path: 'choices.html' });
  r.mutate(t.id, t => { t.threadId = 'thread-1'; t.status = 'running'; t.draft = 'draft'; t.requests.push({ id: 'approval', status: 'pending' }); });
  r.saveState(t.id, a.id, 1, { feedback: 'keep me' }); r.stream(t.id, 'loss', .2);
  const answer = r.requestInput(t.id, { artifactId: a.id, version: 1 });
  const body = { eventId: 'persist-answer', artifactId: a.id, version: 1, value: null };
  r.submit(answer.requestId, body); await answer;
  const pending = r.requestInput(t.id, { artifactId: a.id, version: 1 }); pending.catch(() => {});
  const oldId = pending.requestId, acceptedId = answer.requestId; r.close();
  r = new Runtime(new Store(path)); const restored = r.publicTask(r.task(t.id));
  assert.equal(restored.status, 'interrupted'); assert.equal(restored.draft, 'draft'); assert.equal(restored.threadId, 'thread-1');
  assert.equal(restored.activeArtifactId, a.id);
  assert.deepEqual(restored.artifacts[0].state, { feedback: 'keep me' }); assert.deepEqual(restored.channels.loss, [.2]);
  assert.equal(restored.requests[0].status, 'expired'); assert(!restored.inputs.some(i => i.status === 'pending'));
  assert.throws(() => r.submit(oldId, { ...body, eventId: 'old' }), /失效/);
  assert.deepEqual(r.submit(acceptedId, body), { ok: true, requestId: acceptedId }); r.close();
});

test('real paths cannot escape a project and assets are bounded registered images', () => {
  assert.throws(() => projectFile(fixtures, '../../package.json'), /超出/);
  const r = new Runtime(), t = r.createTask(fixtures, 'files');
  assert.throws(() => r.present(t.id, { path: 'choices.html', assets: { evil: '../../package.json' } }), /图片/);
  const path = mkdtempSync(join(tmpdir(), 'web-agent-files-')); writeFileSync(join(path, 'big.html'), 'x'.repeat(2 * 1024 * 1024 + 1));
  assert.throws(() => projectFile(path, 'big.html'), /小于/); r.close();
});

test('only one live process can own a persistent database', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'web-agent-lock-')), 'state.sqlite');
  const first = new Store(path);
  assert.throws(() => new Store(path), /占用/); first.close();
  const second = new Store(path); second.close();
});
