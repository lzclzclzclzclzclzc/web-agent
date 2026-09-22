// frame.js — the single-page frame served to the browser.
// Two rendering modes:
//   * DECLARATIVE — options / controls / actions / freeText / charts, rendered by the frame
//     and collected via a generic collector + the persistent Submit button.
//   * CUSTOM      — the agent ships a full interactive HTML document (its own HTML/CSS/JS,
//     any interaction it invents) which runs in a SANDBOXED IFRAME. It talks to the agent
//     only through the injected `webagent` bridge (postMessage), so it can define both the
//     interaction AND the shape of the returned value, while staying inside the contract
//     (sandbox + CSP: no external network, no access to the parent / cookies).
//
//   server -> browser : Server-Sent Events on GET /events
//   browser -> server : POST /submit  (answers)  |  POST /ingest (external stream data)

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
  body { margin:0; background:var(--bg); color:var(--fg);
    font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
  header { padding:14px 22px; border-bottom:1px solid var(--line);
    display:flex; align-items:center; gap:10px; background:var(--panel);
    position:sticky; top:0; z-index:5; }
  header .dot { width:9px; height:9px; border-radius:50%; background:var(--muted); }
  header .dot.live { background:var(--ok); box-shadow:0 0 8px var(--ok); }
  header b { font-weight:600; letter-spacing:.3px; }
  header .status { margin-left:auto; color:var(--muted); font-size:12px; }
  main { max-width:900px; margin:0 auto; padding:28px 22px 120px; }
  h2 { margin:0 0 4px; font-size:23px; }
  .subtitle { color:var(--muted); margin:0 0 22px; }
  .option { display:flex; gap:14px; align-items:flex-start; padding:16px 18px;
    border:1.5px solid var(--line); border-radius:var(--radius); background:var(--panel);
    cursor:pointer; margin-bottom:12px; transition:border-color .12s, background .12s; }
  .option:hover { border-color:var(--accent); }
  .option.selected { border-color:var(--accent); background:var(--panel2); }
  .option .letter { width:30px; height:30px; flex:0 0 30px; border-radius:8px;
    background:var(--panel2); color:var(--accent); font-weight:700;
    display:flex; align-items:center; justify-content:center; }
  .option.selected .letter { background:var(--accent); color:#fff; }
  .option h3 { margin:2px 0 3px; font-size:15px; }
  .option p { margin:0; color:var(--muted); font-size:13px; }
  .controls { display:grid; gap:14px; margin:8px 0 4px; }
  .control label { display:block; font-size:13px; color:var(--muted); margin-bottom:6px; }
  .control .row { display:flex; align-items:center; gap:12px; }
  .control input[type=range] { flex:1; accent-color:var(--accent); }
  .control .cval { min-width:52px; text-align:right; font-variant-numeric:tabular-nums; font-weight:600; }
  .freetext { margin:18px 0 8px; }
  textarea, input[type=text], input[type=number], select { width:100%; padding:12px 14px;
    background:var(--panel); color:var(--fg); border:1.5px solid var(--line);
    border-radius:var(--radius); font:inherit; }
  textarea { min-height:90px; resize:vertical; }
  textarea:focus, input:focus, select:focus { outline:none; border-color:var(--accent); }
  .actions { display:flex; flex-wrap:wrap; gap:10px; margin:16px 0 4px; }
  .actions button { background:var(--panel2); color:var(--fg); border:1.5px solid var(--line);
    padding:10px 18px; font-size:14px; font-weight:600; border-radius:10px; cursor:pointer; }
  .actions button.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
  .actions button:hover { border-color:var(--accent); }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:18px; }
  iframe#stage { width:100%; border:0; min-height:60vh; background:transparent; }
  .charts { display:grid; gap:16px; grid-template-columns:1fr; }
  @media(min-width:680px){ .charts.multi { grid-template-columns:1fr 1fr; } }
  .chart h4 { margin:0 0 2px; font-size:13px; color:var(--muted); font-weight:600; }
  .chart .val { font-size:22px; font-weight:700; }
  .chart svg { width:100%; height:120px; display:block; margin-top:6px; }
  .rawhtml :is(h1,h2,h3){ color:var(--fg); }
  .center { min-height:40vh; display:flex; align-items:center; justify-content:center; color:var(--muted); text-align:center; }

  #submitbar { position:fixed; right:24px; bottom:24px; z-index:20; display:flex; align-items:center; gap:12px; }
  #submithint { color:var(--muted); font-size:12px; background:var(--panel); border:1px solid var(--line); padding:6px 10px; border-radius:8px; max-width:260px; }
  #submit { background:var(--accent); color:#fff; border:none; padding:13px 26px; font-size:15px; font-weight:700; border-radius:12px; cursor:pointer; box-shadow:0 6px 20px rgba(79,140,255,.35); transition:transform .1s, opacity .15s; }
  #submit:hover:not(:disabled) { transform:translateY(-1px); }
  #submit:disabled { background:var(--panel2); color:var(--muted); cursor:not-allowed; box-shadow:none; }
  #submit.waiting { animation:pulse 1.8s ease-in-out infinite; }
  @keyframes pulse { 0%,100%{ box-shadow:0 6px 20px rgba(79,140,255,.35);} 50%{ box-shadow:0 6px 28px rgba(79,140,255,.7);} }
  #toast { position:fixed; left:50%; bottom:90px; transform:translateX(-50%); background:var(--panel2); border:1px solid var(--line); color:var(--fg); padding:10px 16px; border-radius:10px; font-size:13px; opacity:0; transition:opacity .2s; pointer-events:none; z-index:30; }
  #toast.show { opacity:1; }
</style>
</head>
<body>
<header>
  <span class="dot" id="conn"></span>
  <b>web-agent</b>
  <span class="status" id="status">connecting…</span>
</header>
<main id="app"><div class="center">Waiting for the agent…</div></main>

<div id="submitbar">
  <span id="submithint">The agent isn't waiting for input yet.</span>
  <button id="submit" disabled>Submit</button>
</div>
<div id="toast"></div>

<script>
const app = document.getElementById('app');
const statusEl = document.getElementById('status');
const connDot = document.getElementById('conn');
const submitBtn = document.getElementById('submit');
const submitHint = document.getElementById('submithint');
const toastEl = document.getElementById('toast');

let current = null;
let activeAskId = null;
let selected = new Set();
let stageFrame = null;                 // the sandboxed iframe when in custom mode
const charts = new Map();
const streamHist = {};                 // channel -> [values], for late-joining custom iframes

function esc(s){ return String(s??'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function toast(msg){ toastEl.textContent=msg; toastEl.classList.add('show');
  clearTimeout(toast._t); toast._t=setTimeout(()=>toastEl.classList.remove('show'),2200); }

// ---- the sandboxed custom-UI bridge (runs INSIDE the iframe) -----------
// Exposed to the agent's document as window.webagent. This is the ONLY channel out.
function bridgeFn(){
  var collector=null, streamCb=null;
  function send(m){ m.__wa=1; parent.postMessage(m,'*'); }
  window.webagent = {
    // Resolve the current ask() with ANY JSON value the UI constructs.
    submit:function(v){ send({type:'submit', value: v===undefined?null:v}); },
    // Register a function returning the value when the global Submit button is clicked.
    onCollect:function(fn){ collector=fn; },
    // Receive live stream datapoints: cb(channel, value).
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
    '<style>'+base+'</style><script>'+bridge+'<\\/script></head><body>'+
    (content||'')+'</body></html>';
}

// ---- screen rendering --------------------------------------------------
function renderScreen(s){
  current = s; selected = new Set(); stageFrame = null;
  app.innerHTML = '';
  if (!s){ app.innerHTML = '<div class="center">Waiting for the agent…</div>'; setAsk(null); return; }

  if (s.title){ const h=document.createElement('h2'); h.textContent=s.title; app.appendChild(h); }
  if (s.subtitle){ const p=document.createElement('p'); p.className='subtitle'; p.textContent=s.subtitle; app.appendChild(p); }

  // CUSTOM mode: the agent's own interactive document, sandboxed.
  if (s.doc){ renderCustom(s); setAsk(s.kind === 'ask' ? s : null); return; }

  // DECLARATIVE mode.
  if (s.html){ const d=document.createElement('div'); d.className='rawhtml card'; d.innerHTML=s.html; app.appendChild(d); }
  if (s.charts && s.charts.length){ mountCharts(s.charts); }
  if (s.kind === 'ask'){ renderAsk(s); }
  setAsk(s.kind === 'ask' ? s : null);
}

function renderCustom(s){
  const f = document.createElement('iframe');
  f.id = 'stage'; f.setAttribute('sandbox', 'allow-scripts');
  f.srcdoc = buildDoc(s.doc || '');
  app.appendChild(f); stageFrame = f;
}

function renderAsk(s){
  const letters = 'ABCDEFGH';
  (s.options||[]).forEach((opt, i) => {
    const el = document.createElement('div');
    el.className = 'option'; el.dataset.id = opt.id ?? String(i);
    el.innerHTML = '<div class="letter">'+(opt.letter||letters[i]||'•')+'</div>'+
      '<div><h3>'+esc(opt.label)+'</h3>'+(opt.description?'<p>'+esc(opt.description)+'</p>':'')+'</div>';
    el.onclick = () => toggle(el, s.multiSelect);
    app.appendChild(el);
  });
  if (s.controls && s.controls.length) renderControls(s.controls);
  if (s.freeText && s.freeText.enabled){
    const wrap=document.createElement('div'); wrap.className='freetext';
    const ta=document.createElement('textarea'); ta.id='freetext-input';
    ta.placeholder = s.freeText.placeholder || 'Type your answer…';
    wrap.appendChild(ta); app.appendChild(wrap);
  }
  if (s.actions && s.actions.length) renderActions(s.actions);
}

// The 'on' primitive (declarative): controls whose values are collected into fields.
function renderControls(controls){
  const box=document.createElement('div'); box.className='controls';
  controls.forEach(c => {
    const wrap=document.createElement('div'); wrap.className='control'; const id=c.id;
    const label=document.createElement('label'); label.textContent=c.label||id; label.setAttribute('for',id);
    wrap.appendChild(label);
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
  app.appendChild(box);
}

function renderActions(actions){
  const box=document.createElement('div'); box.className='actions';
  actions.forEach(a => {
    const b=document.createElement('button'); b.textContent=a.label||a.id;
    if (a.primary) b.className='primary';
    b.onclick=()=>doSubmit(a.id);
    box.appendChild(b);
  });
  app.appendChild(box);
}

function toggle(el, multi){
  const id = el.dataset.id;
  if (!multi){ document.querySelectorAll('.option').forEach(o=>o.classList.remove('selected')); selected.clear(); }
  if (el.classList.contains('selected')){ el.classList.remove('selected'); selected.delete(id); }
  else { el.classList.add('selected'); selected.add(id); }
}

// ---- the persistent submit button --------------------------------------
function setAsk(s){
  if (s){
    activeAskId = s.askId;
    submitBtn.disabled = false; submitBtn.classList.add('waiting');
    submitBtn.textContent = s.submitLabel || 'Submit';
    submitHint.textContent = s.doc ? 'Interact in the panel, then Submit (or the panel may submit itself).'
      : 'Interact above, then click Submit to send it back to the agent.';
  } else {
    activeAskId = null;
    submitBtn.disabled = true; submitBtn.classList.remove('waiting');
    submitBtn.textContent = 'Submit';
    submitHint.textContent = "The agent isn't waiting for input yet.";
  }
}

function collectValue(action){
  const value = { action: action ?? null, selected:[...selected], selectedLabels:[], text:'', fields:{} };
  value.selectedLabels = (current?.options||[])
    .filter(o => selected.has(String(o.id)) || selected.has(o.id)).map(o => o.label);
  app.querySelectorAll('input, textarea, select').forEach(el => {
    const key = el.name || el.id; if (!key) return;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'radio'){ if (!el.checked) return; v = el.value; }
    else if (el.type === 'range' || el.type === 'number') v = el.value === '' ? null : Number(el.value);
    else v = el.value;
    value.fields[key] = v;
  });
  const ft = document.getElementById('freetext-input');
  if (ft) value.text = ft.value.trim();
  return value;
}

async function submitToServer(value){
  submitBtn.disabled = true; submitBtn.classList.remove('waiting');
  const askId = activeAskId;
  try {
    const r = await fetch('/submit', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ askId, value }) });
    if (!r.ok){ toast('Could not submit (already answered?).'); setAsk(current && current.kind==='ask'?current:null); }
  } catch(e){ toast('Network error while submitting.'); setAsk(current && current.kind==='ask'?current:null); }
}

function doSubmit(action){
  if (!activeAskId){ toast("The agent isn't waiting for input right now."); return; }
  if (current && current.doc){                       // custom mode: ask the iframe to produce the value
    if (stageFrame) stageFrame.contentWindow.postMessage({ __wa:1, type:'collect' }, '*');
    return;
  }
  submitToServer(collectValue(action));
}
submitBtn.addEventListener('click', () => doSubmit(null));

// messages from the sandboxed custom iframe
window.addEventListener('message', (e) => {
  const m = e.data; if (!m || m.__wa !== 1) return;
  if (m.type === 'submit'){ if (activeAskId) submitToServer(m.value); }
  else if (m.type === 'height'){ if (stageFrame && m.px) stageFrame.style.height = Math.min(m.px + 8, 4000) + 'px'; }
  else if (m.type === 'ready'){ if (stageFrame) for (const ch in streamHist)
    stageFrame.contentWindow.postMessage({ __wa:1, type:'streamInit', channel:ch, points:streamHist[ch] }, '*'); }
});

// ---- live charts (declarative panels) ----------------------------------
function mountCharts(defs){
  const box=document.createElement('div'); box.className='charts'+(defs.length>1?' multi':'');
  charts.clear();
  defs.forEach(def => {
    const c=document.createElement('div'); c.className='chart card';
    c.innerHTML='<h4>'+esc(def.label||def.channel)+'</h4><div class="val" data-val>—</div>'+
      '<svg viewBox="0 0 300 120" preserveAspectRatio="none"><path data-path fill="none" stroke="var(--accent)" stroke-width="2"/></svg>';
    box.appendChild(c);
    charts.set(def.channel, { points:[], val:c.querySelector('[data-val]'), path:c.querySelector('[data-path]') });
  });
  app.appendChild(box);
}
function pushPoint(channel, value){
  const ch = charts.get(channel); if (!ch) return;
  const num = Number(value);
  ch.points.push(num); if (ch.points.length > 300) ch.points.shift();
  ch.val.textContent = num.toFixed(4).replace(/\\.?0+$/,'');
  const pts=ch.points, n=pts.length;
  if (n < 2){ ch.path.setAttribute('d',''); return; }
  const min=Math.min(...pts), max=Math.max(...pts), span=(max-min)||1;
  ch.path.setAttribute('d', pts.map((v,i)=>{
    const x=(i/(n-1))*300, y=120-((v-min)/span)*110-5;
    return (i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1);
  }).join(' '));
}

// ---- SSE wiring --------------------------------------------------------
function forwardStream(channel, value){
  (streamHist[channel] = streamHist[channel] || []).push(value);
  if (streamHist[channel].length > 300) streamHist[channel].shift();
  pushPoint(channel, value);
  if (stageFrame) stageFrame.contentWindow.postMessage({ __wa:1, type:'stream', channel, value }, '*');
}
function connect(){
  const es = new EventSource('/events');
  es.addEventListener('open', ()=>{ connDot.classList.add('live'); statusEl.textContent='connected'; });
  es.addEventListener('screen', e => renderScreen(JSON.parse(e.data)));
  es.addEventListener('streamInit', e => { const {channel, points}=JSON.parse(e.data);
    streamHist[channel] = (points||[]).slice(); (points||[]).forEach(v=>pushPoint(channel,v));
    if (stageFrame) stageFrame.contentWindow.postMessage({ __wa:1, type:'streamInit', channel, points }, '*'); });
  es.addEventListener('stream', e => { const {channel, value}=JSON.parse(e.data); forwardStream(channel, value); });
  es.addEventListener('resolved', e => { const {message}=JSON.parse(e.data||'{}'); setAsk(null); toast(message||'Submitted — the agent is continuing.'); });
  es.onerror = () => { connDot.classList.remove('live'); statusEl.textContent='reconnecting…'; };
}
connect();
</script>
</body>
</html>`;
}
