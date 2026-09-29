import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from './Canvas';
import { Approval } from './Approval';
import { api, remember, running, saved, statusLabel, type Snapshot } from './types';
import './style.css';

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} aria-label={title} onCancel={e => { e.preventDefault(); onClose?.(); }}>
    <div className="dialog-heading"><strong>{title}</strong>{onClose && <button aria-label="返回画布" onClick={onClose}>关闭 · Esc</button>}</div>{children}
  </dialog>;
}

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [connected, setConnected] = useState(false), [error, setError] = useState('');
  const [cwd, setCwd] = useState(''), [text, setText] = useState(() => saved('initial-message', '')), [sending, setSending] = useState(false), [controls, setControls] = useState(false);
  const [history, setHistory] = useState<any[]>([]), [cursor, setCursor] = useState<string | null>(null), [historyLoaded, setHistoryLoaded] = useState(false);
  const task = snapshot?.tasks[0], activeId = task?.activeArtifactId || task?.artifacts.at(-1)?.id;
  const approval = task?.requests.find(r => r.status === 'pending');
  const loginRequired = snapshot?.codex?.account?.requiresOpenaiAuth && !snapshot?.codex?.account?.account;
  const systemIssue = loginRequired || snapshot?.codex?.error || snapshot?.codex?.login?.authUrl;
  useEffect(() => {
    let stream: EventSource | undefined, disposed = false;
    async function initialize() {
      try {
        const token = new URLSearchParams(location.hash.slice(1)).get('token');
        if (token) { await api('/api/session', {}, { Authorization: `Bearer ${token}` }); window.history.replaceState(null, '', location.pathname); }
        const initial = await api('/api/state'); if (disposed) return;
        setSnapshot(initial); setCwd(initial.cwd); setConnected(true);
        stream = new EventSource('/api/events');
        stream.addEventListener('snapshot', e => { setSnapshot(JSON.parse((e as MessageEvent).data)); setConnected(true); });
        stream.addEventListener('status', e => setSnapshot(s => s && ({ ...s, codex: JSON.parse((e as MessageEvent).data) })));
        stream.addEventListener('change', e => {
          const event = JSON.parse((e as MessageEvent).data);
          setSnapshot(s => !s ? s : event.kind === 'data' ? { ...s, tasks: s.tasks.map(t => t.id === event.taskId ? { ...t, channels: { ...t.channels, [event.channel]: [...(t.channels[event.channel] || []), event.value].slice(-300) } } : t) } : { ...s, tasks: [event.task] });
        });
        stream.onerror = () => setConnected(false);
      } catch (error: any) { if (!disposed) setError(error.message); }
    }
    initialize(); return () => { disposed = true; stream?.close(); };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open]')) { event.preventDefault(); setControls(v => !v); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  async function initialMessage() {
    if (!text.trim() || sending) return;
    setSending(true); setError(''); const original = text, previous = saved('initial-request', null);
    const eventId = previous?.text === original && previous?.cwd === cwd ? previous.eventId : crypto.randomUUID();
    remember('initial-request', { text: original, cwd, eventId });
    try { await api('/api/tasks', { text: original, cwd, eventId }); remember('initial-message', ''); localStorage.removeItem('initial-request'); }
    catch (error: any) { setError(error.message); if (error.status && error.status < 500) localStorage.removeItem('initial-request'); }
    finally { setSending(false); }
  }
  async function recover() {
    if (!task || sending) return;
    setSending(true);
    const key = `recover:${task.id}`, previous = saved(key, null), eventId = previous || crypto.randomUUID(); remember(key, eventId);
    try {
      const original = !task.items.some(i => i.type === 'userMessage') ? task.draft : '';
      await api(`/api/tasks/${task.id}/message`, { eventId, text: `${original ? `${original}\n\n` : ''}继续当前任务。整个网页都是你的画布，没有固定导航栏、输入框或提交按钮。请根据任务生成或更新完整的交互页面，自行设计所需的输入和下一步操作；如有失效的确认请求，请重新发起。` });
      localStorage.removeItem(key); setControls(false);
    } catch (error: any) { setError(error.message); if (error.status && error.status < 500) localStorage.removeItem(key); }
    finally { setSending(false); }
  }
  async function loadHistory() {
    if (!task) return;
    try { const result = await api(`/api/tasks/${task.id}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`); setHistory(h => [...(result.data || []).slice().reverse(), ...h]); setCursor(result.nextCursor || null); setHistoryLoaded(true); }
    catch (error: any) { setError(error.message); }
  }
  const transcript = historyLoaded ? [...history.flatMap(t => t.items || []), ...(task?.items || []).filter(i => !history.some(t => t.items?.some((x: any) => x.id === i.id)))] : task?.items || [];
  const systemControls = <>
    {!connected && <p role="status">连接中断，正在重连。服务仍在运行时，任务会继续。</p>}
    {snapshot?.codex?.error && <p>{snapshot.codex.error} <button onClick={() => api('/api/reconnect', {}).catch(e => setError(e.message))}>重新连接 Codex</button></p>}
    {loginRequired && !snapshot?.codex?.login?.authUrl && <button onClick={() => api('/api/login/start', {}).catch(e => setError(e.message))}>登录 Codex</button>}
    {snapshot?.codex?.login?.authUrl && <p><a target="_blank" rel="noreferrer" href={snapshot.codex.login.authUrl}>打开 Codex 登录页面 ↗</a> <button onClick={() => api('/api/login/cancel', {}).catch(e => setError(e.message))}>取消登录</button></p>}
  </>;
  return <>
    <main className="canvas-root">
      {task?.artifacts.length ? task.artifacts.map(a => <Canvas key={`${a.id}:${a.version}`} artifact={a} task={task} visible={a.id === activeId} onControls={() => setControls(true)} />) :
        <div className="bootstrap"><div className="bootstrap-content">
          {!snapshot ? <p>{error || '正在连接…'}</p> : !task && snapshot.mode === 'codex' ? <form onSubmit={e => { e.preventDefault(); initialMessage(); }}>
            <h1>从这里开始。</h1><p>说说你想做什么，接下来的整个页面交给 Agent。</p>
            <textarea aria-label="初始任务" autoFocus value={text} onChange={e => { setText(e.target.value); remember('initial-message', e.target.value); }} placeholder="描述你的任务…" onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); initialMessage(); } }} />
            <details><summary>工作目录</summary><input aria-label="项目绝对路径" value={cwd} onChange={e => setCwd(e.target.value)} /></details>
            <button className="primary" disabled={!connected || !text.trim() || sending || loginRequired}>{sending ? '正在启动…' : '开始'}</button>
            <small>一个端口，一个对话。随时按 Esc 查看记录、停止或恢复。</small>
          </form> : <><p role="status">{task && running(task) ? 'Agent 正在准备页面…' : snapshot.mode === 'legacy' ? '等待 Agent 发布页面…' : '当前还没有交互页面。'}</p>{task?.items.filter(i => i.type === 'agentMessage').slice(-1).map(i => <p className="waiting-message" key={i.id}>{i.text}</p>)}<button onClick={() => setControls(true)}>查看任务 · Esc</button>{task?.mode === 'codex' && !running(task) && <button disabled={sending} onClick={recover}>继续并生成页面</button>}</>}
          {systemControls}
        </div></div>}
    </main>
    {error && !approval && !controls && !(task?.artifacts.length && systemIssue) && <div className="toast" role="alert"><span>{error}</span><button onClick={() => setError('')}>关闭</button></div>}
    {approval ? <Dialog key={approval.id} title="Web Agent · 确认请求">{error && <p role="alert">{error}</p>}<Approval request={approval} onError={setError} /></Dialog> :
      (controls || (!!task?.artifacts.length && systemIssue)) && <Dialog title="任务控制" onClose={systemIssue ? undefined : () => setControls(false)}>
        {error && <p role="alert">{error}</p>}
        {systemControls}
        {task && <><p>{statusLabel[task.status]} <span className="muted">· {task.title}</span></p><div className="actions">
          {running(task) ? <button disabled={!task.turnId || task.status === 'stopping'} onClick={() => api(`/api/tasks/${task.id}/stop`, {}).catch(e => setError(e.message))}>停止任务</button> : task.mode === 'codex' && <button className="primary" disabled={sending || !connected} onClick={recover}>继续任务</button>}
          {task.threadId && <button disabled={historyLoaded && !cursor} onClick={loadHistory}>{historyLoaded ? cursor ? '加载更早记录' : '历史记录已加载' : '从 Codex 读取历史'}</button>}
        </div><section className="execution-log" aria-label="对话与执行记录">{transcript.map((item, i) => <LogItem key={`${item.id}:${i}`} item={item} />)}</section></>}
      </Dialog>}
  </>;
}
function LogItem({ item }: { item: any }) {
  const text = item.text || item.content?.filter((c: any) => c.type === 'text' || c.type === 'inputText').map((c: any) => c.text).join('\n');
  if (['userMessage', 'agentMessage', 'error'].includes(item.type)) return <article className="log-item"><small>{item.type === 'userMessage' ? '你' : item.type === 'error' ? '错误' : 'AGENT'}</small><p>{text}</p></article>;
  return <details className="tool-item"><summary>{item.type === 'commandExecution' ? '终端命令' : item.type === 'dynamicToolCall' ? `${item.namespace || 'web_agent'}.${item.tool || ''}` : item.type}</summary><pre>{item.command || item.aggregatedOutput || JSON.stringify(item, null, 2)}</pre></details>;
}
createRoot(document.getElementById('root')!).render(<App />);
