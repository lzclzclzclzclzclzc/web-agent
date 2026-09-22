#!/usr/bin/env node
// scripts/install.mjs — set up web-agent for Claude Code on this machine.
//
//   node scripts/install.mjs           install (copy skill/agent/command + register MCP)
//   node scripts/install.mjs --print   just print what it would do (no changes)
//   node scripts/install.mjs --uninstall
//
// Cross-platform (macOS / Linux / Windows). Requires `npm install` to have been run first.

import { existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLAUDE = join(homedir(), '.claude');
const MCP_ENTRY = join(ROOT, 'src', 'mcp.js');

const args = new Set(process.argv.slice(2));
const PRINT = args.has('--print');
const UNINSTALL = args.has('--uninstall');

const FILES = [
  { from: join(ROOT, 'agents', 'web-ui.md'),           to: join(CLAUDE, 'agents', 'web-ui.md') },
  { from: join(ROOT, 'commands', 'web.md'),            to: join(CLAUDE, 'commands', 'web.md') },
  { from: join(ROOT, 'skills', 'web-agent', 'SKILL.md'), to: join(CLAUDE, 'skills', 'web-agent', 'SKILL.md') },
];

function log(...a) { console.log('[web-agent]', ...a); }

function copyAll() {
  for (const { from, to } of FILES) {
    if (PRINT) { log('would copy', from, '->', to); continue; }
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    log('installed', to);
  }
}

function removeAll() {
  for (const { to } of FILES) {
    if (PRINT) { log('would remove', to); continue; }
    try { rmSync(to); log('removed', to); } catch { /* not present */ }
  }
}

function registerMcp() {
  const cmd = `claude mcp add web-agent --scope user -- node "${MCP_ENTRY}"`;
  if (PRINT) { log('would run:', cmd); return; }
  const r = spawnSync('claude', ['mcp', 'add', 'web-agent', '--scope', 'user', '--', 'node', MCP_ENTRY],
    { stdio: 'pipe', encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status === 0) { log('registered MCP server (user scope):', MCP_ENTRY); return; }
  log('could not run `claude mcp add` automatically. Register it manually:');
  console.log('\n  ' + cmd + '\n');
  log('…or add to your Claude Code MCP config (~/.claude.json or a project .mcp.json):');
  console.log(`\n  { "mcpServers": { "web-agent": { "command": "node", "args": ["${MCP_ENTRY}"] } } }\n`);
}

function unregisterMcp() {
  if (PRINT) { log('would run: claude mcp remove web-agent -s user'); return; }
  spawnSync('claude', ['mcp', 'remove', 'web-agent', '-s', 'user'],
    { stdio: 'ignore', shell: process.platform === 'win32' });
  log('removed MCP server registration (if it existed)');
}

if (!existsSync(join(ROOT, 'node_modules'))) {
  log('WARNING: node_modules missing — run `npm install` first so the MCP server can start.');
}

if (UNINSTALL) {
  removeAll();
  unregisterMcp();
  log('uninstalled. Restart Claude Code to drop the tools.');
} else {
  copyAll();
  registerMcp();
  console.log('');
  log('Next steps:');
  log('1. Restart Claude Code (or start a new session) to load the MCP tools + /web command.');
  log('2. (Recommended) allowlist the tools so a blocking ask never hits a permission prompt —');
  log('   add to ~/.claude/settings.json under permissions.allow:');
  console.log('     "mcp__web-agent__open_panel", "mcp__web-agent__say", "mcp__web-agent__converse",');
  console.log('     "mcp__web-agent__render", "mcp__web-agent__ask", "mcp__web-agent__stream", "mcp__web-agent__route"');
  log('3. In a session, run  /web  to start a browser-driven session, or just ask for something visual.');
}
