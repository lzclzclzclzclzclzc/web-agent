import { InteractionServer } from '../src/engine.js';
const engine = new InteractionServer();
await engine.start();
process.stdout.write(JSON.stringify({ url: engine.url }) + '\n');
process.stdin.resume(); process.stdin.on('data', async () => { await engine.close(); process.exit(0); });
engine.render({ title: 'MCP 自定义内容', html: '<h2>保留在页面中的原始内容</h2>' });
const answer = await engine.ask({ title: '选择下一步', options: [{ id: 'a', label: '方向 A' }, { id: 'b', label: '方向 B' }], controls: [{ id: 'epochs', type: 'number', label: '训练轮数', value: 3 }], freeText: { enabled: true }, submitLabel: '提交页面表单' });
const reply = await engine.converse('继续补充');
engine.render({ title: 'MCP 完成', message: JSON.stringify({ answer, reply }) });
