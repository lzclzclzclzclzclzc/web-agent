import { useEffect, useRef, useState } from 'react';
import { api, remember, saved, type Artifact, type Task } from './types';

const session = (task: Task) => ({ status: task.status, mode: task.mode, activeArtifactId: task.activeArtifactId, interfaces: task.artifacts.map(({ id, version, title, status }) => ({ id, version, title, status })), lastMessage: task.items.filter(i => i.type === 'agentMessage').at(-1)?.text || '' });

export function Canvas({ artifact, task, visible, onControls }: { artifact: Artifact; task: Task; visible: boolean; onControls: () => void }) {
  const ref = useRef<HTMLIFrameElement>(null), latest = useRef({ artifact, task, visible, onControls }); latest.current = { artifact, task, visible, onControls };
  const [document, setDocument] = useState(''), [failure, setFailure] = useState('');
  const pending = task.inputs.find(r => r.artifactId === artifact.id && r.version === artifact.version && r.status === 'pending');
  const send = (type: string, data: any = {}) => ref.current?.contentWindow?.postMessage({ __webAgentHost: true, id: artifact.id, version: artifact.version, type, ...data }, '*');
  useEffect(() => {
    let stale = false; setDocument(''); setFailure('');
    const restore = async () => {
      const key = `canvas:${artifact.id}:${artifact.version}`, pendingState = saved(key, null);
      if (pendingState?.pending) { await api(`/api/artifacts/${artifact.id}/state`, { version: artifact.version, value: pendingState.value }); localStorage.removeItem(key); }
      const result = await api(`/api/artifacts/${artifact.id}/${artifact.version}`); if (!stale) setDocument(result.document);
    };
    restore().catch(e => { if (!stale) setFailure(e.message); });
    return () => { stale = true; };
  }, [artifact.id, artifact.version]);
  useEffect(() => {
    const receive = async (event: MessageEvent) => {
      const m = event.data, { artifact: a, task: t, visible: active } = latest.current;
      if (event.source !== ref.current?.contentWindow || !m?.__webAgent || m.id !== a.id || m.version !== a.version) return;
      try {
        let result;
        if (m.type === 'ready') {
          send('init', { channels: t.channels, session: session(t), request: t.inputs.find(r => r.artifactId === a.id && r.version === a.version && r.status === 'pending') || null });
          await api(`/api/artifacts/${a.id}/report`, { version: a.version, loaded: true }); return;
        }
        if (m.type === 'controls' && active) { latest.current.onControls(); return; }
        if (['submit', 'message', 'navigate', 'stop', 'controls'].includes(m.type) && (!active || a.status !== 'open')) throw new Error('只有当前打开的页面可以发起此操作');
        if (m.type === 'controls') { latest.current.onControls(); return; }
        if (m.type === 'submit') {
          const request = t.inputs.find(r => r.id === m.requestId && r.artifactId === a.id && r.version === a.version);
          if (!request) throw new Error('此界面当前没有待处理确认');
          const key = `submission:${request.id}`, previous = saved(key, null);
          const body = previous && JSON.stringify(previous.value) === JSON.stringify(m.value) ? previous : { eventId: m.eventId, artifactId: a.id, version: a.version, value: m.value };
          remember(key, body); result = await api(`/api/inputs/${request.id}/submit`, body); localStorage.removeItem(key);
        } else if (['message', 'navigate', 'stop'].includes(m.type)) {
          const key = `message:${a.id}:${a.version}`, previous = saved(key, null);
          const body = { action: m.type, artifactId: a.id, version: a.version, id: m.targetId, text: m.text, eventId: m.type === 'message' && previous?.text === m.text ? previous.eventId : m.eventId };
          if (m.type === 'message') remember(key, body);
          try { result = await api(`/api/tasks/${t.id}/interact`, body); if (m.type === 'message') localStorage.removeItem(key); }
          catch (e: any) { if (e.status && e.status < 500 && m.type === 'message') localStorage.removeItem(key); throw e; }
        } else if (m.type === 'state') {
          const key = `canvas:${a.id}:${a.version}`;
          remember(key, { pending: true, value: m.value, eventId: m.eventId });
          result = await api(`/api/artifacts/${a.id}/state`, { version: a.version, value: m.value });
          if (saved(key, null)?.eventId === m.eventId) localStorage.removeItem(key);
        } else if (m.type === 'error' || m.type === 'report') {
          await api(`/api/artifacts/${a.id}/report`, { version: a.version, error: m.error, summary: m.summary }); return;
        } else return;
        setFailure(''); send('ack', { eventId: m.eventId, result });
      } catch (error: any) { if (active) setFailure(error.message); send('ack', { eventId: m.eventId, error: error.message }); }
    };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, [artifact.id, artifact.version]);
  useEffect(() => { send('request', { request: pending || null }); }, [pending?.id, pending?.status]);
  const sessionJSON = JSON.stringify(session(task));
  useEffect(() => { send('session', { session: JSON.parse(sessionJSON) }); }, [sessionJSON]);
  useEffect(() => { for (const [channel, history] of Object.entries(task.channels)) send('stream', { channel, history, value: history.at(-1) }); }, [task.channels]);
  const retryRequest = task.inputs.slice().reverse().find(r => r.artifactId === artifact.id && saved(`submission:${r.id}`, null));
  const retry = saved(`submission:${retryRequest?.id}`, null);
  async function retrySubmission() {
    if (!retryRequest || !retry) return;
    try { await api(`/api/inputs/${retryRequest.id}/submit`, retry); localStorage.removeItem(`submission:${retryRequest.id}`); setFailure(''); }
    catch (error: any) { setFailure(error.message); }
  }
  return <section className="canvas-view" hidden={!visible} aria-label={artifact.title}>
    <iframe title={artifact.title} ref={ref} srcDoc={document || undefined} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" />
    {!document && <div className="canvas-loading">{failure || '正在加载页面…'}</div>}
    {failure && <div className="toast" role="alert"><span>{failure}</span>{retry && <button onClick={retrySubmission}>重试上次提交</button>}<button onClick={() => setFailure('')}>关闭</button></div>}
  </section>;
}
