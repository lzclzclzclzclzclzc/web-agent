// demo.js — run the interaction engine WITHOUT any MCP wiring, so you can see it work now.
//   node demo/demo.js
// It starts the local page, opens your browser, and walks through render -> ask -> stream.
// The key thing to watch: ask() BLOCKS this script until you submit in the browser,
// then it resumes right here — the same mechanic that lets an MCP tool resume the
// agent mid-turn with no "type continue" round-trip.

import { spawn } from 'node:child_process';
import { InteractionServer } from '../src/engine.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function openBrowser(url) {
  if (process.env.WEB_AGENT_NO_OPEN) return;
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try { const child = spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true, windowsHide: true }); child.on('error', () => {}); child.unref(); } catch {}
}

const s = new InteractionServer();
const { url } = await s.start();
console.log('\n  web-agent demo running at:', url, '\n');
openBrowser(url);

// 1) render — push a welcome screen (returns immediately)
s.render({
  title: 'web-agent demo',
  subtitle: 'A local page the agent drives. Watch the terminal resume the instant you submit.',
  html: '<p style="margin:0;color:var(--muted)">Step 1 of 3 — this is a <b>render()</b> screen. No waiting here.</p>',
});
await sleep(1500);

// 2) ask — BLOCKS until you submit in the browser
console.log('  -> calling ask(): this script is now BLOCKED, waiting for your submit…');
const answer = await s.ask({
  title: 'Which v1 capability should we prioritise?',
  subtitle: 'Pick one (or type your own). The terminal will continue the moment you submit.',
  options: [
    { id: 'stream', label: '① Real-time monitor', description: 'live loss/F1/progress, no agent turns' },
    { id: 'elicit', label: '② Universal decision layer', description: 'reusable ask/render everywhere' },
    { id: 'both', label: '③ Both, phased', description: 'elicit first, then streaming' },
  ],
  freeText: { enabled: true, placeholder: 'or write your own take…' },
  submitLabel: 'Submit answer',
});
console.log('  <- ask() RESUMED. answer =', JSON.stringify(answer), '\n');

// 3) stream — set up a live panel and push data (agent-independent in real use)
s.render({
  title: 'Live training monitor (simulated)',
  subtitle: 'stream() pushes datapoints over SSE — the curves move without any agent turn.',
  charts: [{ channel: 'loss', label: 'train/loss' }, { channel: 'f1', label: 'val/F1' }],
});
console.log('  -> streaming 40 fake datapoints over ~8s… (watch the browser)');
let loss = 1.8, f1 = 0.30;
for (let i = 0; i < 40; i++) {
  loss = Math.max(0.05, loss * 0.94 + (Math.sin(i) * 0.01));
  f1 = Math.min(0.98, f1 + (0.98 - f1) * 0.08);
  s.stream('loss', Number(loss.toFixed(4)));
  s.stream('f1', Number(f1.toFixed(4)));
  await sleep(200);
}

s.render({ title: 'Demo complete ✓', subtitle: 'render + ask + stream all exercised.',
  html: '<p style="margin:0;color:var(--ok)">You can close this tab. Press Ctrl+C in the terminal to stop the server.</p>' });
console.log('\n  demo complete. Server still up so you can look around — Ctrl+C to exit.\n');
