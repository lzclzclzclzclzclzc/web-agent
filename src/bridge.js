import { legacyControls } from './legacy-controls.js';
// Executed inside an opaque-origin, scripts-only sandbox. No credentials enter it.
function bridge(config, legacyControls) {
  let state = config.state || {}, request = null, session = null, collect;
  const callbacks = { stream: [], state: [], request: [], session: [] }, awaiting = new Map();
  const send = (type, payload = {}) => parent.postMessage({ __webAgent: true, id: config.id, version: config.version, type, ...payload }, '*');
  const rpc = (type, payload) => new Promise((resolve, reject) => {
    const eventId = crypto.randomUUID();
    const timer = setTimeout(() => { awaiting.delete(eventId); reject(new Error('宿主未确认，请保留输入并重试')); }, 20000);
    awaiting.set(eventId, { resolve, reject, timer }); send(type, { eventId, ...payload });
  });
  const notify = (kind, value) => callbacks[kind].forEach(fn => { try { fn(value); } catch (error) { send('error', { error: String(error) }); } });
  Object.defineProperty(window, 'webagent', { value: {
    get state() { return state; },
    get session() { return session; },
    submit: value => rpc('submit', { value, requestId: request?.id }),
    sendMessage: text => rpc('message', { text }),
    navigate: id => rpc('navigate', { targetId: id }),
    stop: () => rpc('stop', {}),
    openControls: () => send('controls'),
    onSession: fn => { callbacks.session.push(fn); if (session) fn(session); },
    saveState: value => { state = value; return rpc('state', { value }); },
    onState: fn => { callbacks.state.push(fn); fn(state); },
    onRequest: fn => { callbacks.request.push(fn); fn(request); },
    onCollect: fn => { collect = fn; },
    // Preserve the original MCP (channel, value) callback as well as the new API.
    onStream: fn => { callbacks.stream.push(fn.length >= 2 ? data => {
      if (data.initial) for (const value of data.history) fn(data.channel, value);
      else fn(data.channel, data.value);
    } : fn); },
    ready: () => send('ready'),
    asset: name => config.assets[name] || '',
    report: summary => send('report', { summary: String(summary) }),
  }, writable: false });
  addEventListener('message', async event => {
    const m = event.data;
    if (event.source !== parent || !m?.__webAgentHost || m.id !== config.id || m.version !== config.version) return;
    if (m.type === 'ack') {
      const pending = awaiting.get(m.eventId); if (!pending) return;
      clearTimeout(pending.timer); awaiting.delete(m.eventId);
      m.error ? pending.reject(new Error(m.error)) : pending.resolve(m.result);
    }
    if (m.type === 'init') {
      request = m.request; notify('request', request);
      session = m.session; notify('session', session);
      for (const [channel, history] of Object.entries(m.channels || {})) notify('stream', { channel, value: history.at(-1), history, initial: true });
    }
    if (m.type === 'request') { request = m.request; notify('request', request); }
    if (m.type === 'session') { session = m.session; notify('session', session); }
    if (m.type === 'stream') notify('stream', { channel: m.channel, value: m.value, history: m.history });
    if (m.type === 'collect') {
      try { if (!collect) throw new Error('请在画布中直接提交，或为页面注册 webagent.onCollect'); await window.webagent.submit(await collect()); }
      catch (error) { send('error', { error: String(error) }); }
    }
  });
  addEventListener('keydown', event => {
    if (event.key === 'Escape' && event.isTrusted && !event.defaultPrevented) send('controls');
  });
  addEventListener('error', event => send('error', { error: event.message }));
  addEventListener('unhandledrejection', event => send('error', { error: String(event.reason) }));
  addEventListener('DOMContentLoaded', () => {
    callbacks.request.push(legacyControls());
    notify('request', request);
    // Also preserve ordinary form edits even if a generated page forgets saveState.
    for (const el of document.querySelectorAll('input[id],textarea[id],select[id]')) {
      if (el.type === 'password' || el.type === 'file') continue;
      if (Object.hasOwn(state.__form || {}, el.id)) {
        if (el.type === 'checkbox' || el.type === 'radio') el.checked = state.__form[el.id]; else el.value = state.__form[el.id];
      }
      el.addEventListener('input', () => {
        state = { ...state, __form: { ...state.__form, [el.id]: ['checkbox', 'radio'].includes(el.type) ? el.checked : el.value } };
        window.webagent.saveState(state).catch(error => send('error', { error: String(error) }));
      });
    }
    send('ready');
  });
}
const safeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
export function artifactDocument(artifact, version) {
  const config = { id: artifact.id, version: artifact.version, state: artifact.state, assets: version.assets };
  // Placed before all generated content, so its policies and bridge take effect first.
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; media-src data: blob:"><meta name="viewport" content="width=device-width,initial-scale=1"><script>(${bridge.toString()})(${safeJSON(config)},${legacyControls.toString()});</script>`;
  let html = version.html.replace(/web-agent-asset:([\w.-]+)/g, (_, name) => version.assets[name] || '');
  if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, match => match + head);
  html = html.replace(/<!doctype[^>]*>/i, '');
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}
