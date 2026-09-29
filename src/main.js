#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { Runtime } from './runtime.js';
import { Controller } from './controller.js';
import { WebServer } from './http-server.js';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const dataDirectory = resolve(process.env.WEB_AGENT_DATA_DIR || resolve(appRoot, '.web-agent-data'));
const port = Number(process.env.WEB_AGENT_PORT || 3210);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('WEB_AGENT_PORT 必须是 0–65535 的整数');
// Preserve the default port's existing data; other ports own independent sessions.
const sessionDirectory = port === 3210 ? dataDirectory : resolve(dataDirectory, 'ports', port ? String(port) : `temporary-${Date.now()}-${process.pid}`);
const runtime = new Runtime(new Store(resolve(sessionDirectory, 'web-agent.sqlite')));
const controller = new Controller(runtime);
const server = new WebServer(runtime, { controller, port, dev: process.argv.includes('--dev') });
let closing = false;
async function shutdown() {
  if (closing) return; closing = true;
  await controller.close(); await server.close(); runtime.close();
}
process.on('SIGINT', () => shutdown().then(() => process.exit(0)));
process.on('SIGTERM', () => shutdown().then(() => process.exit(0)));
try {
  const { url } = await server.start();
  console.log(`\nWeb Agent\n${url}\n\n本端口对应一个对话。数据目录：${sessionDirectory}\n按 Ctrl+C 停止服务。浏览器关闭不会停止任务。\n`);
  controller.connect().catch(error => console.error(`Codex 连接失败：${error.message}\n可在网页重试连接。`));
} catch (error) { console.error(error.message); await shutdown(); process.exitCode = 1; }
