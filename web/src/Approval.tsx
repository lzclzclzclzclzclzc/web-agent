import { useState } from 'react';
import { api, remember, saved, type Approval as Request } from './types';

export function Approval({ request, onError }: { request: Request; onError: (s: string) => void }) {
  const p = request.params, isQuestion = request.method === 'item/tool/requestUserInput', isMcp = request.method === 'mcpServer/elicitation/request';
  const key = `approval:${request.id}`, [values, setValues] = useState<any>(() => saved(key, {})), [sending, setSending] = useState(false);
  const update = (id: string, value: string) => { const next = { ...values, [id]: value }; setValues(next); remember(key, next); };
  async function respond(decision?: string) {
    setSending(true);
    try {
      const body: any = { eventId: crypto.randomUUID(), decision };
      if (isQuestion) body.answers = Object.fromEntries(p.questions.map((q: any) => [q.id, { answers: [values[q.id] || ''] }]));
      if (isMcp && decision === 'accept' && p.requestedSchema) body.content = JSON.parse(values.json || '{}');
      await api(`/api/requests/${request.id}/respond`, body);
    } catch (error: any) { onError(error.message); } finally { setSending(false); }
  }
  return <section className="approval" aria-label={isQuestion ? 'Agent 提问' : '权限确认'}>
    <div className="approval-heading"><span className="approval-mark">{isQuestion ? '?' : '!'}</span><div><span className="eyebrow">{isQuestion ? '需要你的回答' : '来自 Codex 的确认请求'}</span><h3>{isQuestion ? '补充任务信息' : isMcp ? `工具确认 · ${p.serverName}` : request.method.includes('fileChange') ? '确认文件修改' : request.method.includes('permissions') ? '确认权限范围' : '确认命令执行'}</h3></div></div>
    {isQuestion ? p.questions.map((q: any) => <fieldset key={q.id}><legend>{q.question}</legend>{q.options?.map((o: any) => <label className="choice" key={o.label}><input type="radio" name={q.id} checked={values[q.id] === o.label} onChange={() => update(q.id, o.label)} /><span>{o.label}<small>{o.description}</small></span></label>)}<input aria-label={q.question} value={values[q.id] || ''} placeholder="选择一个选项，或填写你的回答" onChange={e => update(q.id, e.target.value)} /></fieldset>) : <>
      {p.reason && <p>{p.reason}</p>}{p.message && <p>{p.message}</p>}
      {p.command && <pre>{p.command}</pre>}{p.cwd && <div className="path-label">工作目录：{p.cwd}</div>}
      {p.grantRoot && <pre>写入目录：{p.grantRoot}</pre>}
      {p.permissions && <pre>{JSON.stringify(p.permissions, null, 2)}</pre>}
      {isMcp && p.url && /^https?:\/\//i.test(p.url) && <a target="_blank" rel="noreferrer" href={p.url}>打开验证页面 ↗</a>}
      {isMcp && p.requestedSchema && <><details><summary>查看所需字段</summary><pre>{JSON.stringify(p.requestedSchema, null, 2)}</pre></details><textarea aria-label="确认数据 JSON" placeholder="填写 JSON 数据" value={values.json || ''} onChange={e => update('json', e.target.value)} /></>}
      {!p.command && !p.permissions && !isMcp && <details><summary>请求详情</summary><pre>{JSON.stringify(p, null, 2)}</pre></details>}
    </>}
    <div className="actions">{isQuestion ? <button className="primary" disabled={sending || p.questions.some((q: any) => !values[q.id]?.trim())} onClick={() => respond()}>发送回答</button> : <>
      {(!p.availableDecisions || p.availableDecisions.includes('decline')) && <button disabled={sending} onClick={() => respond('decline')}>拒绝</button>}
      {(!p.availableDecisions || p.availableDecisions.includes('accept')) && !['userVerification', 'openai/userVerification'].includes(p.mode) && <button className="primary" disabled={sending} onClick={() => respond('accept')}>仅允许本次</button>}
      {p.availableDecisions?.includes('acceptForSession') && <button disabled={sending} onClick={() => respond('acceptForSession')}>允许本会话</button>}
      {p.availableDecisions?.includes('cancel') && <button disabled={sending} onClick={() => respond('cancel')}>取消执行</button>}
    </>}</div>
  </section>;
}
