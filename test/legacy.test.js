import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixtures, until } from './helpers.js';

test('real MCP stdio adapter preserves all seven tool names and null/custom answers', async t => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('src/mcp.js')], cwd: fixtures, env: { ...process.env, WEB_AGENT_NO_OPEN: '1' }, stderr: 'pipe' });
  const client = new Client({ name: 'web-agent-test', version: '1.0' });
  await client.connect(transport); t.after(() => client.close());
  const names = (await client.listTools()).tools.map(t => t.name).sort();
  assert.deepEqual(names, ['ask', 'converse', 'open_panel', 'render', 'route', 'say', 'stream']);
  const opened = await client.callTool({ name: 'open_panel', arguments: {} });
  const url = new URL(opened.content[0].text.match(/http:\/\/[^\s]+/)[0]);
  const token = new URLSearchParams(url.hash.slice(1)).get('token'), base = url.origin;
  const request = (path, body) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  await client.callTool({ name: 'render', arguments: { title: 'MCP custom', docPath: resolve(fixtures, 'choices.html') } });
  const answer = client.callTool({ name: 'ask', arguments: { title: 'MCP choice' } });
  const input = await until(async () => (await (await request('/api/state')).json()).tasks[0].inputs.find(i => i.status === 'pending'));
  await client.callTool({ name: 'render', arguments: { title: 'monitor', charts: [{ channel: 'loss' }] } });
  await client.callTool({ name: 'stream', arguments: { channel: 'loss', value: .25 } });
  await request(`/api/inputs/${input.id}/submit`, { eventId: 'mcp-null', artifactId: input.artifactId, version: input.version, value: null });
  const result = await answer; assert.equal(result.isError, undefined); assert.match(result.content[0].text, /null/);
  const route = await client.callTool({ name: 'route', arguments: { path: '/report', html: '<h1>report</h1>' } }); assert(!route.isError);
  await client.callTool({ name: 'say', arguments: { text: 'MCP say' } });
  const chat = client.callTool({ name: 'converse', arguments: { message: 'Reply?' } });
  const chatInput = await until(async () => (await (await request('/api/state')).json()).tasks[0].inputs.find(i => i.status === 'pending'));
  await request(`/api/inputs/${chatInput.id}/submit`, { eventId: 'mcp-chat', artifactId: chatInput.artifactId, version: chatInput.version, value: { text: 'yes' } });
  assert.match((await chat).content[0].text, /yes/);
});

test('standalone demo reaches ask, resumes and streams its complete walkthrough', { timeout: 20000 }, async t => {
  const child = spawn(process.execPath, ['demo/demo.js'], { cwd: resolve('.'), env: { ...process.env, WEB_AGENT_NO_OPEN: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill()); let output = ''; child.stdout.setEncoding('utf8'); child.stdout.on('data', data => { output += data; });
  const url = new URL(await until(() => output.match(/http:\/\/[^\s]+/)?.[0]));
  const headers = { Authorization: `Bearer ${new URLSearchParams(url.hash.slice(1)).get('token')}`, 'Content-Type': 'application/json' };
  const input = await until(async () => (await (await fetch(url.origin + '/api/state', { headers })).json()).tasks[0].inputs.find(i => i.status === 'pending'));
  await fetch(`${url.origin}/api/inputs/${input.id}/submit`, { method: 'POST', headers, body: JSON.stringify({ eventId: 'demo', artifactId: input.artifactId, version: input.version, value: { selected: ['both'], text: '' } }) });
  await until(() => output.includes('demo complete.'), 13000);
  const task = (await (await fetch(url.origin + '/api/state', { headers })).json()).tasks[0];
  assert.equal(task.channels.loss.length, 40); assert.equal(task.channels.f1.length, 40); assert(task.artifacts.some(a => a.title.includes('Demo complete')));
});
