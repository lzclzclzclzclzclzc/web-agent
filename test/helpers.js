import { resolve } from 'node:path';
import { Runtime } from '../src/runtime.js';
import { Controller } from '../src/controller.js';
import { CodexClient } from '../src/codex-client.js';
import { WebServer } from '../src/http-server.js';

export const fixtures = resolve('test/fixtures');
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function until(fn, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await fn(); if (result) return result; await sleep(20); }
  throw new Error('condition timeout');
}
export function mockClient(options = {}) { return new CodexClient({ bin: process.execPath, args: [resolve('test/fixtures/mock-app-server.mjs')], cwd: fixtures, timeout: 5000, ...options }); }
export async function setup(options = {}) {
  const runtime = options.runtime || new Runtime(), client = mockClient();
  const controller = new Controller(runtime, { client, cwd: fixtures });
  const server = new WebServer(runtime, { controller, cwd: fixtures, port: 0 }); await server.start();
  const request = (path, body, headers = {}) => fetch(server.baseUrl + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${server.token}`, 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { runtime, controller, client, server, request, async close() { await controller.close(); await server.close(); runtime.close(); } };
}
