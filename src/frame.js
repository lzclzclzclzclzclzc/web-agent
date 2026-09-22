// frame.js — the single-page frame served to the browser.
// Zero build step: one HTML document with inline CSS + client JS.
//   server -> browser : Server-Sent Events on GET /events
//   browser -> server : POST /submit  (answers)  |  POST /ingest (external stream data)
//
// Interaction model: one persistent Submit button pinned bottom-right. The agent renders
// options / form controls / action buttons / freehand HTML; the user interacts freely and
// clicks Submit to send the whole interaction state back — resuming the agent. Declared
// "actions" are buttons that submit immediately (e.g. Approve/Reject). The submit button is
// enabled only while the agent is actually waiting on an ask().

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
  .control .cval { min-width:52px; text-align:right; font-variant-numeric:tabular-nums;
    font-weight:600; color:var(--fg); }
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
  .card { background:var(--panel); border:1px solid var(--line);
    border-radius:var(--radius); padding:18px; }
  .charts { display:grid; gap:16px; grid-template-columns:1fr; }
  @media(min-width:680px){ .charts.multi { grid-template-columns:1fr 1fr; } }
  .chart h4 { margin:0 0 2px; font-size:13px; color:var(--muted); font-weight:600; }
  .chart .val { font-size:22px; font-weight:700; }
  .chart svg { width:100%; height:120px; display:block; margin-top:6px; }
  .rawhtml :is(h1,h2,h3){ color:var(--fg); }
  .center { min-height:40vh; display:flex; align-items:center; justify-content:center;
    color:var(--muted); text-align:center; }

  /* persistent bottom-right submit bar */
  #submitbar { position:fixed; right:24px; bottom:24px; z-index:20;
    display:flex; align-items:center; gap:12px; }
  #submithint { color:var(--muted); font-size:12px; background:var(--panel);
    border:1px solid var(--line); padding:6px 10px; border-radius:8px; max-width:260px; }
  #submit { background:var(--accent); color:#fff; border:none; padding:13px 26px;
    font-size:15px; font-weight:700; border-radius:12px; cursor:pointer;
    box-shadow:0 6px 20px rgba(79,140,255,.35); transition:transform .1s, opacity .15s; }
  #submit:hover:not(:disabled) { transform:translateY(-1px); }
  #submit:disabled { background:var(--panel2); color:var(--muted); cursor:not-allowed; box-shadow:none; }
  #submit.waiting { animation:pulse 1.8s ease-in-out infinite; }
  @keyframes pulse { 0%,100%{ box-shadow:0 6px 20px rgba(79,140,255,.35);} 50%{ box-shadow:0 6px 28px rgba(79,140,255,.7);} }
  #toast { position:fixed; left:50%; bottom:90px; transform:translateX(-50%);
    background:var(--panel2); border:1px solid var(--line); color:var(--fg);
    padding:10px 16px; border-radius:10px; font-size:13px; opacity:0;
    transition:opacity .2s; pointer-events:none; z-index:30; }
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

let current = null;              // current screen object
let activeAskId = null;          // non-null while the agent is awaiting an ask()
let selected = new Set();        // selected option ids (for ask)
const charts = new Map();        // channel -> {points:[], val, path}

function esc(s){ return String(s??'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function toast(msg){ toastEl.textContent=msg; toastEl.classList.add('show');
  clearTimeout(toast._t); toast._t=setTimeout(()=>toastEl.classList.remove('show'),2200); }

// ---- screen rendering --------------------------------------------------
function renderScreen(s){
  current = s; selected = new Set();
  app.innerHTML = '';
  if (!s){ app.innerHTML = '<div class="center">Waiting for the agent…</div>'; setAsk(null); return; }

  if (s.title){ const h=document.createElement('h2'); h.textContent=s.title; app.appendChild(h); }
  if (s.subtitle){ const p=document.createElement('p'); p.className='subtitle'; p.textContent=s.subtitle; app.appendChild(p); }

  // Freehand HTML (trusted: authored by the agent/subagent under the agent-web contract).
  // Any inputs/selects/textareas inside are collected automatically on submit.
  if (s.html){ const d=document.createElement('div'); d.className='rawhtml card'; d.innerHTML=s.html; app.appendChild(d); }

  if (s.charts && s.charts.length){ mountCharts(s.charts); }
  if (s.kind === 'ask'){ renderAsk(s); }

  setAsk(s.kind === 'ask' ? s : null);
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

// The 'on' primitive: declarative controls whose values are collected into fields.
function renderControls(controls){
  const box=document.createElement('div'); box.className='controls';
  controls.forEach(c => {
    const wrap=document.createElement('div'); wrap.className='control';
    const id = c.id;
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
      wrap.querySelector('label').prepend(inp); wrap.querySelector('label').style.display='flex';
      wrap.querySelector('label').style.gap='8px';
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
    } else { // text
      const inp=document.createElement('input'); inp.type='text'; inp.id=id;
      inp.value=c.value??''; if(c.placeholder)inp.placeholder=c.placeholder; wrap.appendChild(inp);
    }
    box.appendChild(wrap);
  });
  app.appendChild(box);
}

// Action buttons submit immediately with {action:id} (e.g. Approve / Reject).
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
    submitHint.textContent = 'Interact above, then click Submit to send it back to the agent.';
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

async function doSubmit(action){
  if (!activeAskId){ toast("The agent isn't waiting for input right now."); return; }
  submitBtn.disabled = true; submitBtn.classList.remove('waiting');
  const askId = activeAskId;
  try {
    const r = await fetch('/submit', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ askId, value: collectValue(action) }) });
    if (!r.ok){ toast('Could not submit (already answered?).'); setAsk(current?.kind==='ask'?current:null); }
  } catch(e){ toast('Network error while submitting.'); setAsk(current?.kind==='ask'?current:null); }
}
submitBtn.addEventListener('click', () => doSubmit(null));

// ---- live charts -------------------------------------------------------
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
function connect(){
  const es = new EventSource('/events');
  es.addEventListener('open', ()=>{ connDot.classList.add('live'); statusEl.textContent='connected'; });
  es.addEventListener('screen', e => renderScreen(JSON.parse(e.data)));
  es.addEventListener('streamInit', e => { const {channel, points}=JSON.parse(e.data); (points||[]).forEach(v=>pushPoint(channel,v)); });
  es.addEventListener('stream', e => { const {channel, value}=JSON.parse(e.data); pushPoint(channel, value); });
  es.addEventListener('resolved', e => { const {message}=JSON.parse(e.data||'{}'); setAsk(null); toast(message||'Submitted — the agent is continuing.'); });
  es.onerror = () => { connDot.classList.remove('live'); statusEl.textContent='reconnecting…'; };
}
connect();
</script>
</body>
</html>`;
}
