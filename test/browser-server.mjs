// Test-only entry; production never exposes fixtures or test controls.
import { resolve } from 'node:path';
import { Runtime } from '../src/runtime.js';
import { Store } from '../src/store.js';
import { Controller } from '../src/controller.js';
import { WebServer } from '../src/http-server.js';
import { mockClient, fixtures } from './helpers.js';

const runtime = new Runtime(new Store(process.env.WEB_AGENT_TEST_DB || ':memory:'));
const controller = new Controller(runtime, { client: mockClient(), cwd: fixtures });
const server = new WebServer(runtime, { controller, cwd: fixtures, port: Number(process.env.WEB_AGENT_PORT || 0) });
await server.start(); await controller.connect();
process.stdout.write(JSON.stringify({ url: server.url, cwd: fixtures }) + '\n');
let epoch = 0;
const ticker = setInterval(async () => {
  epoch++;
  for (const task of runtime.tasks.values()) {
    if (task.status !== 'running') continue;
    try { await fetch(`${server.baseUrl}/api/ingest/${task.id}`, { method: 'POST', headers: { Authorization: `Bearer ${task.ingestKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'metrics', value: { epoch, loss: +(1.8 / (epoch / 10 + 1)).toFixed(3), f1: +(1 - 1 / (epoch / 10 + 2)).toFixed(3) } }) }); } catch {}
  }
}, 200);
async function stop() { clearInterval(ticker); await controller.close(); await server.close(); runtime.close(); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
process.stdin.resume(); process.stdin.on('data', chunk => { if (chunk.toString().trim() === 'stop') stop(); });
