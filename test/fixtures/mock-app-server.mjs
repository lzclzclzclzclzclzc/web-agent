import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const notify = (method, params) => send({ method, params });
let next = 1000; const pending = new Map(), threads = new Map();
const serverRequest = (method, params) => new Promise((resolve, reject) => { const id = `server:${next++}`; pending.set(id, { resolve, reject, turnId: params.turnId }); send({ id, method, params }); });
async function run(thread, turn, text) {
  const params = { threadId: thread.id, turnId: turn.id }, call = (tool, args) => serverRequest('item/tool/call', { ...params, callId: randomUUID(), namespace: 'web_agent', tool, arguments: args });
  try {
    if (text.includes('complete')) { finish(thread, turn, '已完成'); return; }
    if (text.includes('approvals') || text.includes('审批')) {
      const approval = await serverRequest('item/commandExecution/requestApproval', { ...params, itemId: 'cmd1', command: 'echo web-agent-test', cwd: thread.cwd, reason: '测试命令确认', availableDecisions: ['accept', 'decline', 'cancel'] });
      thread.lastApproval = approval;
      const question = await serverRequest('item/tool/requestUserInput', { ...params, itemId: 'question1', isBlocking: true, questions: [{ id: 'direction', header: '方向', question: '采用哪个方向？', options: [{ label: '方案 A', description: '保持简单' }, { label: '方案 B', description: '增加细节' }] }] });
      finish(thread, turn, `审批 ${approval.decision}，回答 ${question.answers.direction.answers[0]}`); return;
    }
    const present = async (path, title, activate = true) => {
      const response = await call('present', { path: resolve(thread.cwd, path), title, activate });
      if (!response.success) throw new Error(response.contentItems?.[0]?.text || 'present failed');
      return JSON.parse(response.contentItems[0].text);
    };
    const a = await present('choices.html', '方案选择');
    const b = await present('architecture.html', '架构评审', false);
    await present('metrics.html', '训练指标', false);
    const answer = await call('request_input', { artifactId: a.id, version: a.version, prompt: '选择一个方案并填写意见', schema: { type: 'object', properties: { selected: { enum: ['A', 'B'] }, feedback: { type: 'string' } }, required: ['selected'] } });
    if (!answer.success) throw new Error(answer.contentItems[0].text);
    notify('item/completed', { ...params, item: { id: 'answer-' + turn.id, type: 'agentMessage', text: '已收到方案：' + answer.contentItems[0].text } });
    const graph = await call('request_input', { artifactId: b.id, version: b.version, prompt: '选择架构节点并提交意见', schema: { type: 'object', properties: { node: { type: 'string' }, comment: { type: 'string' } }, required: ['node'] } });
    if (!graph.success) throw new Error(graph.contentItems[0].text);
    await call('update', { id: a.id, path: resolve(thread.cwd, 'choices.html'), title: '已修改的方案', preserveState: ['selected', 'feedback'] });
    finish(thread, turn, '已收到架构反馈，已继续修改对应方案。');
  } catch (error) { if (thread.turn?.id === turn.id && turn.status === 'inProgress') finish(thread, turn, `工具已结束：${error.message}`); }
}
function finish(thread, turn, text) {
  if (turn.status !== 'inProgress') return;
  const item = { id: randomUUID(), type: 'agentMessage', text }; turn.items.push(item);
  notify('item/agentMessage/delta', { threadId: thread.id, turnId: turn.id, itemId: item.id, delta: text });
  notify('item/completed', { threadId: thread.id, turnId: turn.id, item });
  turn.status = 'completed'; notify('turn/completed', { threadId: thread.id, turn }); thread.turn = null;
}
async function handle({ id, method, params = {}, result, error }) {
  if (!method) { const p = pending.get(id); if (p) { pending.delete(id); error ? p.reject(new Error(error.message)) : p.resolve(result); } return; }
  if (method === 'initialized') return;
  let response;
  switch (method) {
    case 'initialize': if (!params.capabilities?.experimentalApi) throw new Error('experimentalApi required'); response = { userAgent: 'mock-codex/0.155', platformFamily: 'windows', platformOs: 'windows' }; break;
    case 'account/read': response = { requiresOpenaiAuth: false, account: null }; break;
    case 'account/login/start': response = { type: 'chatgpt', loginId: 'login-test', authUrl: 'https://auth.openai.com/test' }; break;
    case 'account/login/cancel': response = { status: 'canceled' }; break;
    case 'thread/start': {
      if (params.approvalPolicy || params.sandbox || params.model) throw new Error('must inherit config');
      if (!params.dynamicTools?.some(t => t.type === 'namespace' && t.name === 'web_agent' && t.tools.length === 5)) throw new Error('dynamic tools missing');
      const thread = { id: randomUUID(), cwd: params.cwd, turns: [], turn: null }; threads.set(thread.id, thread); response = { thread }; break;
    }
    case 'thread/resume': {
      let thread = threads.get(params.threadId); if (!thread) { thread = { id: params.threadId, cwd: params.cwd, turns: [], turn: null }; threads.set(thread.id, thread); }
      response = { thread }; break;
    }
    case 'turn/start': {
      const thread = threads.get(params.threadId); if (!thread) throw new Error('thread missing');
      const turn = { id: randomUUID(), status: 'inProgress', items: [{ id: params.clientUserMessageId, type: 'userMessage', content: params.input }] }; thread.turns.push(turn); thread.turn = turn;
      notify('turn/started', { threadId: thread.id, turn }); response = { turn };
      setTimeout(() => run(thread, turn, params.input[0].text), 20); break;
    }
    case 'turn/steer': {
      const thread = threads.get(params.threadId); if (thread?.turn?.id !== params.expectedTurnId) throw new Error('turn mismatch'); response = { turnId: thread.turn.id }; break;
    }
    case 'turn/interrupt': {
      const thread = threads.get(params.threadId), turn = thread?.turn;
      if (turn) { turn.status = 'interrupted'; notify('turn/completed', { threadId: thread.id, turn }); thread.turn = null; }
      for (const [key, p] of pending) if (p.turnId === params.turnId) { pending.delete(key); p.reject(new Error('interrupted')); }
      response = {}; break;
    }
    case 'thread/turns/list': response = { data: (threads.get(params.threadId)?.turns || []).slice().reverse(), nextCursor: null }; break;
    case 'test/echo': response = params; break;
    case 'test/hang': return;
    case 'test/crash': process.exit(3); break;
    case 'test/malformed': process.stdout.write('not json\n'); return;
    default: throw new Error(`unsupported: ${method}`);
  }
  if (id !== undefined) send({ id, result: response });
}
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', line => { let m; try { m = JSON.parse(line); } catch { return; } handle(m).catch(e => send({ id: m.id, error: { code: -32602, message: e.message } })); });
