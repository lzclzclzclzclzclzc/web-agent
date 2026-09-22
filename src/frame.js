// frame.js — the single-page frame served to the browser.
//
// The panel doubles as the whole conversation surface so the user never needs the terminal:
//   * a persistent TRANSCRIPT (agent messages via say(), user messages echoed on send)
//   * a persistent COMPOSER (textarea + Send) at the bottom — enabled whenever the agent is
//     waiting (converse()/ask()); disabled with "working…" otherwise
//   * a SCREEN area for the current interaction: declarative options/controls/actions,
//     a live-metrics panel, trusted freehand HTML, or a full CUSTOM document in a sandboxed
//     iframe (its own JS, talking back through the injected `webagent` bridge)
//
//   server -> browser : Server-Sent Events on GET /events   (say / screen / stream / resolved)
//   browser -> server : POST /submit (answers)  |  POST /ingest (external stream data)

export function framePage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>web-agent</title>
<style>
  :root {
    --bg:#0f1117; --panel:#161a26; --panel2:#1d2333; --line:#2a3142;
    --fg:#e6e8ee; --muted:#9aa3b8; --accent:#4f8cff; --ok:#5fd88a; --warn:#ffb057;
    --radius:12px;
  }
  * { box-sizing:border-box; }
  html,body { height:100%; }
  body { margin:0; background:var(--bg); color:var(--fg); display:flex; flex-direction:column;
    font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
  header { padding:14px 22px; border-bottom:1px solid var(--line);
    display:flex; align-items:center; gap:10px; background:var(--panel); flex:0 0 auto; }
  header .dot { width:9px; height:9px; border-radius:50%; background:var(--muted); }
  header .dot.live { background:var(--ok); box-shadow:0 0 8px var(--ok); }
  header b { font-weight:600; letter-spacing:.3px; }
  header .status { margin-left:auto; color:var(--muted); font-size:12px; }
  main { flex:1 1 auto; overflow-y:auto; }
  .wrap { max-width:900px; margin:0 auto; padding:24px 22px 8px; }

  /* transcript */
  #transcript { display:flex; flex-direction:column; gap:12px; margin-bottom:18px; }
  .bubble { max-width:82%; padding:12px 15px; border-radius:14px; white-space:pre-wrap; word-wrap:break-word; }
  .bubble.agent { align-self:flex-start; background:var(--panel); border:1px solid var(--line); border-bottom-left-radius:4px; }
  .bubble.user { align-self:flex-end; background:var(--accent); color:#fff; border-bottom-right-radius:4px; }
  .bubble code { background:rgba(255,255,255,.12); padding:1px 5px; border-radius:5px; font-size:.92em; }

  h2 { margin:0 0 4px; font-size:21px; }
  .subtitle { color:var(--muted); margin:0 0 18px; }
  .option { display:flex; gap:14px; align-items:flex-start; padding:15px 18px; border:1.5px solid var(--line);
    border-radius:var(--radius); background:var(--panel); cursor:pointer; margin-bottom:12px; transition:border-color .12s, background .12s; }
  .option:hover { border-color:var(--accent); }
  .option.selected { border-color:var(--accent); background:var(--panel2); }
  .option .letter { width:30px; height:30px; flex:0 0 30px; border-radius:8px; background:var(--panel2);
    color:var(--accent); font-weight:700; display:flex; align-items:center; justify-content:center; }
  .option.selected .letter { background:var(--accent); color:#fff; }
  .option h3 { margin:2px 0 3px; font-size:15px; }
  .option p { margin:0; color:var(--muted); font-size:13px; }
  .controls { display:grid; gap:14px; margin:8px 0 4px; }
  .control label { display:block; font-size:13px; color:var(--muted); margin-bottom:6px; }
  .control .row { display:flex; align-items:center; gap:12px; }
  .control input[type=range] { flex:1; accent-color:var(--accent); }
  .control .cval { min-width:52px; text-align:right; font-variant-numeric:tabular-nums; font-weight:600; }
  input[type=text], input[type=number], select, .freetext textarea { width:100%; padding:11px 13px;
    background:var(--panel); color:var(--fg); border:1.5px solid var(--line); border-radius:var(--radius); font:inherit; }
  .freetext textarea { min-height:80px; resize:vertical; }
  input:focus, select:focus, textarea:focus { outline:none; border-color:var(--accent); }
  .actions { display:flex; flex-wrap:wrap; gap:10px; margin:16px 0 4px; }
  .actions button { background:var(--panel2); color:var(--fg); border:1.5px solid var(--line); padding:10px 18px;
    font-size:14px; font-weight:600; border-radius:10px; cursor:pointer; }
  .actions button.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
  .actions button:hover { border-color:var(--accent); }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:18px; }
  iframe#customframe { width:100%; border:0; min-height:55vh; background:transparent; }
  .charts { display:grid; gap:16px; grid-template-columns:1fr; }
  @media(min-width:680px){ .charts.multi { grid-template-columns:1fr 1fr; } }
  .chart h4 { margin:0 0 2px; font-size:13px; color:var(--muted); font-weight:600; }
  .chart .val { font-size:22px; font-weight:700; }
  .chart svg { width:100%; height:120px; display:block; margin-top:6px; }
  .rawhtml :is(h1,h2,h3){ color:var(--fg); }

  /* composer */
  #bar { flex:0 0 auto; border-top:1px solid var(--line); background:var(--panel); }
  #barwrap { max-width:900px; margin:0 auto; padding:12px 22px; display:flex; gap:10px; align-items:flex-end; }
  #composer { flex:1; min-height:46px; max-height:180px; padding:12px 14px; background:var(--bg); color:var(--fg);
    border:1.5px solid var(--line); border-radius:12px; font:inherit; resize:none; }
  #composer:focus { outline:none; border-color:var(--accent); }
  #composer:disabled { opacity:.55; }
  #send { background:var(--accent); color:#fff; border:none; padding:0 24px; height:46px; font-size:15px;
    font-weight:700; border-radius:12px; cursor:pointer; }
  #send:disabled { background:var(--panel2); color:var(--muted); cursor:not-allowed; }
  #toast { position:fixed; left:50%; bottom:84px; transform:translateX(-50%); background:var(--panel2);
    border:1px solid var(--line); color:var(--fg); padding:10px 16px; border-radius:10px; font-size:13px;
    opacity:0; transition:opacity .2s; pointer-events:none; z-index:30; }
  #toast.show { opacity:1; }
</style>
</head>
<body>
<header>
  <span class="dot" id="conn"></span>
  <b>web-agent</b>
  <span class="status" id="status">connecting…</span>
</header>
<main><div class="wrap">
  <div id="transcript"></div>
  <div id="screen"></div>
</div></main>

<div id="bar"><div id="barwrap">
  <textarea id="composer" rows="1" placeholder="web-agent is working…" disabled></textarea>
  <button id="send" disabled>Send</button>
</div></div>
<div id="toast"></div>

<script>
const transcriptEl = document.getElementById('transcript');
const screenEl = document.getElementById('screen');
const statusEl = document.getElementById('status');
const connDot = document.getElementById('conn');
const composer = document.getElementById('composer');
const sendBtn = document.getElementById('send');
const toastEl = document.getElementById('toast');

let current = null;            // current screen object
let activeAskId = null;        // non-null while the agent awaits input
let selected = new Set();
let stageFrame = null;         // sandboxed iframe when in custom mode
const charts = new Map();
const streamHist = {};

function esc(s){ return String(s??'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function mdLite(s){ return esc(s).replace(/\`([^\`]+)\`/g,'<code>$1</code>').replace(/\\*\\*([^*]+)\\*\\*/g,'<b>$1</b>'); }
function toast(msg){ toastEl.textContent=msg; toastEl.classList.add('show');
  clearTimeout(toast._t); toast._t=setTimeout(()=>toastEl.classList.remove('show'),2200); }
function scrollDown(){ const m=document.querySelector('main'); m.scrollTop=m.scrollHeight; }

// ---- transcript --------------------------------------------------------
function addBubble(role, text){
  const b=document.createElement('div'); b.className='bubble '+(role==='user'?'user':'agent');
  b.innerHTML = mdLite(text); transcriptEl.appendChild(b); scrollDown();
}

// ---- the sandboxed custom-UI bridge (runs INSIDE the iframe) -----------
function bridgeFn(){
  var collector=null, streamCb=null;
  function send(m){ m.__wa=1; parent.postMessage(m,'*'); }
  window.webagent = {
    submit:function(v){ send({type:'submit', value: v===undefined?null:v}); },
    onCollect:function(fn){ collector=fn; },
    onStream:function(cb){ streamCb=cb; },
    ready:function(){ send({type:'ready'}); }
  };
  window.addEventListener('message', function(e){
    var m=e.data; if(!m||m.__wa!==1) return;
    if(m.type==='collect'){ var v=null; try{ v=collector?collector():null; }catch(_){} send({type:'submit', value:v}); }
    else if(m.type==='stream' && streamCb){ try{ streamCb(m.channel, m.value); }catch(_){} }
    else if(m.type==='streamInit' && streamCb){ (m.points||[]).forEach(function(p){ try{ streamCb(m.channel,p);}catch(_){}}); }
  });
  function postH(){ try{ send({type:'height', px: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)}); }catch(_){}}
  window.addEventListener('load', function(){ postH(); send({type:'ready'}); });
  try{ new ResizeObserver(postH).observe(document.documentElement); }catch(_){}
  setTimeout(postH, 300);
}
function buildDoc(content){
  var csp="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'unsafe-inline'; connect-src 'none'";
  var base=":root{--bg:#0f1117;--panel:#161a26;--panel2:#1d2333;--line:#2a3142;--fg:#e6e8ee;--muted:#9aa3b8;--accent:#4f8cff;--ok:#5fd88a;--warn:#ffb057}"+
    "*{box-sizing:border-box}body{margin:0;color:var(--fg);background:transparent;font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}";
  var bridge='('+bridgeFn.toString()+')();';
  return '<!doctype html><html><head><meta charset="utf-8">'+
    '<meta http-equiv="Content-Security-Policy" content="'+csp+'">'+
    '<style>'+base+'</style><script>'+bridge+'<\\/script></head><body>'+(content||'')+'</body></html>';
}

// ---- screen rendering (into #screen only; transcript persists) ---------
function renderScreen(s){
  current = s; selected = new Set(); stageFrame = null;
  screenEl.innerHTML = '';
  if (!s || s.kind === 'chat'){ setActive(s ? s.askId : null); return; }

  if (s.title){ const h=document.createElement('h2'); h.textContent=s.title; screenEl.appendChild(h); }
  if (s.subtitle){ const p=document.createElement('p'); p.className='subtitle'; p.textContent=s.subtitle; screenEl.appendChild(p); }

  if (s.doc){ renderCustom(s); setActive(s.kind === 'ask' ? s.askId : null); return; }

  if (s.html){ const d=document.createElement('div'); d.className='rawhtml card'; d.innerHTML=s.html; screenEl.appendChild(d); }
  if (s.charts && s.charts.length){ mountCharts(s.charts); }
  if (s.kind === 'ask'){ renderAsk(s); }
  setActive(s.kind === 'ask' ? s.askId : null);
  scrollDown();
}

function renderCustom(s){
  const f=document.createElement('iframe'); f.id='customframe'; f.setAttribute('sandbox','allow-scripts');
  f.srcdoc = buildDoc(s.doc || ''); screenEl.appendChild(f); stageFrame = f;
}

function renderAsk(s){
  const letters = 'ABCDEFGH';
  (s.options||[]).forEach((opt, i) => {
    const el = document.createElement('div'); el.className='option'; el.dataset.id = opt.id ?? String(i);
    el.innerHTML = '<div class="letter">'+(opt.letter||letters[i]||'•')+'</div>'+
      '<div><h3>'+esc(opt.label)+'</h3>'+(opt.description?'<p>'+esc(opt.description)+'</p>':'')+'</div>';
    el.onclick = () => toggle(el, s.multiSelect);
    screenEl.appendChild(el);
  });
  if (s.controls && s.controls.length) renderControls(s.controls);
  if (s.freeText && s.freeText.enabled){
    const wrap=document.createElement('div'); wrap.className='freetext';
    const ta=document.createElement('textarea'); ta.id='freetext-input';
    ta.placeholder = s.freeText.placeholder || 'Type here…'; wrap.appendChild(ta); screenEl.appendChild(wrap);
  }
  if (s.actions && s.actions.length) renderActions(s.actions);
}

function renderControls(controls){
  const box=document.createElement('div'); box.className='controls';
  controls.forEach(c => {
    const wrap=document.createElement('div'); wrap.className='control'; const id=c.id;
    const label=document.createElement('label'); label.textContent=c.label||id; label.setAttribute('for',id); wrap.appendChild(label);
    if (c.type==='slider' || c.type==='range'){
      const row=document.createElement('div'); row.className='row';
      const inp=document.createElement('input'); inp.type='range'; inp.id=id;
      inp.min=c.min??0; inp.max=c.max??100; inp.step=c.step??1; inp.value=c.value??inp.min;
      const val=document.createElement('span'); val.className='cval'; val.textContent=inp.value;
      inp.oninput=()=>{ val.textContent=inp.value; };
      row.appendChild(inp); row.appendChild(val); wrap.appendChild(row);
    } else if (c.type==='checkbox'){
      const inp=document.createElement('input'); inp.type='checkbox'; inp.id=id; inp.checked=!!c.value;
      label.prepend(inp); label.style.display='flex'; label.style.gap='8px';
    } else if (c.type==='select'){
      const sel=document.createElement('select'); sel.id=id;
      (c.options||[]).forEach(o=>{ const op=document.createElement('option');
        op.value = typeof o==='string'?o:o.value; op.textContent = typeof o==='string'?o:(o.label||o.value);
        if ((c.value)===op.value) op.selected=true; sel.appendChild(op); });
      wrap.appendChild(sel);
    } else if (c.type==='number'){
      const inp=document.createElement('input'); inp.type='number'; inp.id=id;
      if(c.min!=null)inp.min=c.min; if(c.max!=null)inp.max=c.max; if(c.step!=null)inp.step=c.step;
      inp.value=c.value??''; wrap.appendChild(inp);
    } else {
      const inp=document.createElement('input'); inp.type='text'; inp.id=id;
      inp.value=c.value??''; if(c.placeholder)inp.placeholder=c.placeholder; wrap.appendChild(inp);
    }
    box.appendChild(wrap);
  });
  screenEl.appendChild(box);
}

function renderActions(actions){
  const box=document.createElement('div'); box.className='actions';
  actions.forEach(a => {
    const b=document.createElement('button'); b.textContent=a.label||a.id;
    if (a.primary) b.className='primary';
    b.onclick=()=>submitNow(a.id);
    box.appendChild(b);
  });
  screenEl.appendChild(box);
}

function toggle(el, multi){
  const id = el.dataset.id;
  if (!multi){ document.querySelectorAll('.option').forEach(o=>o.classList.remove('selected')); selected.clear(); }
  if (el.classList.contains('selected')){ el.classList.remove('selected'); selected.delete(id); }
  else { el.classList.add('selected'); selected.add(id); }
}

// ---- composer / submit -------------------------------------------------
function setActive(askId){
  activeAskId = askId || null;
  const on = !!activeAskId;
  composer.disabled = !on; sendBtn.disabled = !on;
  const custom = on && current && current.doc;
  composer.placeholder = on
    ? (custom ? 'Interact in the panel, then Send…' : 'Type your message… (Enter to send, Shift+Enter for newline)')
    : 'web-agent is working…';
  sendBtn.textContent = (on && current && current.kind !== 'chat') ? 'Submit' : 'Send';
  if (on && !custom) setTimeout(()=>composer.focus(), 30);
}

function collectValue(action){
  const value = { action: action ?? null, selected:[...selected], selectedLabels:[], text: composer.value.trim(), fields:{} };
  value.selectedLabels = (current?.options||[])
    .filter(o => selected.has(String(o.id)) || selected.has(o.id)).map(o => o.label);
  screenEl.querySelectorAll('input, textarea, select').forEach(el => {
    const key = el.name || el.id; if (!key) return;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'radio'){ if (!el.checked) return; v = el.value; }
    else if (el.type === 'range' || el.type === 'number') v = el.value === '' ? null : Number(el.value);
    else v = el.value;
    value.fields[key] = v;
  });
  return value;
}

async function submitToServer(value){
  const askId = activeAskId;
  setActive(null); composer.value = '';
  try {
    const r = await fetch('/submit', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ askId, value }) });
    if (!r.ok){ toast('Could not submit (already answered?).'); }
  } catch(e){ toast('Network error while submitting.'); }
}

// send from the composer / Send button (chat or declarative)
function doSend(){
  if (!activeAskId) return;
  if (current && current.doc){ if (stageFrame) stageFrame.contentWindow.postMessage({ __wa:1, type:'collect' }, '*'); return; }
  const v = collectValue(null);
  if (current && current.kind === 'chat' && !v.text){ toast('Type a message first.'); return; }
  submitToServer(v);
}
// immediate submit from a declarative action button
function submitNow(action){ if (activeAskId) submitToServer(collectValue(action)); }

sendBtn.addEventListener('click', doSend);
composer.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); doSend(); }
});

// messages from the sandboxed custom iframe
window.addEventListener('message', (e) => {
  const m = e.data; if (!m || m.__wa !== 1) return;
  if (m.type === 'submit'){ if (activeAskId){ const v = m.value; if (v && typeof v==='object' && composer.value.trim() && v.text===undefined) v.text = composer.value.trim(); submitToServer(v); } }
  else if (m.type === 'height'){ if (stageFrame && m.px) stageFrame.style.height = Math.min(m.px + 8, 4000) + 'px'; }
  else if (m.type === 'ready'){ if (stageFrame) for (const ch in streamHist)
    stageFrame.contentWindow.postMessage({ __wa:1, type:'streamInit', channel:ch, points:streamHist[ch] }, '*'); }
});

// ---- live charts -------------------------------------------------------
function mountCharts(defs){
  const box=document.createElement('div'); box.className='charts'+(defs.length>1?' multi':''); charts.clear();
  defs.forEach(def => {
    const c=document.createElement('div'); c.className='chart card';
    c.innerHTML='<h4>'+esc(def.label||def.channel)+'</h4><div class="val" data-val>—</div>'+
      '<svg viewBox="0 0 300 120" preserveAspectRatio="none"><path data-path fill="none" stroke="var(--accent)" stroke-width="2"/></svg>';
    box.appendChild(c);
    charts.set(def.channel, { points:[], val:c.querySelector('[data-val]'), path:c.querySelector('[data-path]') });
  });
  screenEl.appendChild(box);
}
function pushPoint(channel, value){
  const ch = charts.get(channel); if (!ch) return;
  const num = Number(value); ch.points.push(num); if (ch.points.length > 300) ch.points.shift();
  ch.val.textContent = num.toFixed(4).replace(/\\.?0+$/,'');
  const pts=ch.points, n=pts.length;
  if (n < 2){ ch.path.setAttribute('d',''); return; }
  const min=Math.min(...pts), max=Math.max(...pts), span=(max-min)||1;
  ch.path.setAttribute('d', pts.map((v,i)=>{ const x=(i/(n-1))*300, y=120-((v-min)/span)*110-5;
    return (i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1); }).join(' '));
}
function forwardStream(channel, value){
  (streamHist[channel] = streamHist[channel] || []).push(value);
  if (streamHist[channel].length > 300) streamHist[channel].shift();
  pushPoint(channel, value);
  if (stageFrame) stageFrame.contentWindow.postMessage({ __wa:1, type:'stream', channel, value }, '*');
}

// ---- SSE wiring --------------------------------------------------------
function connect(){
  const es = new EventSource('/events');
  es.addEventListener('open', ()=>{ connDot.classList.add('live'); statusEl.textContent='connected'; });
  es.addEventListener('say', e => { const m=JSON.parse(e.data); addBubble(m.role, m.text); });
  es.addEventListener('screen', e => renderScreen(JSON.parse(e.data)));
  es.addEventListener('streamInit', e => { const {channel, points}=JSON.parse(e.data);
    streamHist[channel] = (points||[]).slice(); (points||[]).forEach(v=>pushPoint(channel,v));
    if (stageFrame) stageFrame.contentWindow.postMessage({ __wa:1, type:'streamInit', channel, points }, '*'); });
  es.addEventListener('stream', e => { const {channel, value}=JSON.parse(e.data); forwardStream(channel, value); });
  es.addEventListener('resolved', e => { const {message}=JSON.parse(e.data||'{}'); setActive(null); if(message) toast(message); });
  es.onerror = () => { connDot.classList.remove('live'); statusEl.textContent='reconnecting…'; };
}
connect();
</script>
</body>
</html>`;
}
