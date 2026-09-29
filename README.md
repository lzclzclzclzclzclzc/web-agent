# Web Agent

一个由 agent 自行选择交互方式的本地 Web 工作台。用户在网页发起任务，Codex 生成适合任务的 HTML/SVG 界面；用户选择、编辑、标注并提交结构化结果后，agent 在同一回合继续执行。界面可以是方案比较、架构图、指标监控，也可以是其他自定义交互。

直接调用已安装的 `codex app-server`，复用登录、模型、工具和权限配置。**不需要修改、构建或运行 Codex fork。** 原有 Claude Code MCP 工具和独立 demo 继续可用。

## 启动

要求：Node.js **22.17+**（使用 `node:sqlite`）、已安装并登录的 Codex。初次验证为 **0.155.0-alpha.9.2 / Windows**，全屏画布改版后的真实协议回归使用 **0.158.0-alpha.2.1 / Windows**。SQLite 的 experimental 提示来自 Node，不影响启动。

```sh
npm install
npm run build
npm start
```

打开终端打印的完整链接（带 `#token=…`，默认端口 3210）。首次进入后令牌会从地址栏移除，转为 HttpOnly 会话 cookie。服务重启后需要使用新打印的链接。

首次打开时填写任务描述，按需展开「工作目录」填写项目**绝对路径**，点击「开始」。Agent 发布页面后，启动表单消失，**整个窗口都是 Agent 的画布**：没有侧边栏、顶栏、界面标签、固定输入框或宿主提交按钮。输入方式、导航、结果展示及下一步操作均由 Agent 自行设计。

**一个端口对应一个对话**，完成或停止后仍继续同一会话。需要另一个对话时，用另一个 `WEB_AGENT_PORT` 启动服务。同一端口重启后恢复绑定的对话和当前页面。旧版数据库首次升级时绑定最近创建的对话，其余记录保留在数据库中。

随时按 **Esc** 打开临时任务菜单，查看记录、停止或继续任务；关闭后回到完整画布。命令审批仅在需要时以宿主弹窗出现。页面也可以自行提供 `webagent.openControls()` 入口。

开发模式无需预先构建：

```sh
npm run dev
```

开发模式由同一个本地 HTTP 服务挂载 Vite。前端修改后刷新浏览器即可；服务端文件修改后重新启动命令。生产模式由 Node 统一提供 `dist/` 和 API，无需另起前端服务。

### 配置

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `WEB_AGENT_CODEX_BIN` | 从 PATH 查找 Codex | Codex 原生可执行文件路径；Windows 可指定 `codex.exe`，不接受命令行参数或 `.cmd/.bat` 包装器 |
| `WEB_AGENT_PORT` | `3210`；MCP/demo 为随机空闲端口 | 本地服务端口，`0` 使用空闲端口 |
| `WEB_AGENT_DATA_DIR` | 应用根目录 `.web-agent-data/` | 数据根目录；3210 使用根目录数据库，其他固定端口使用 `ports/<端口>/web-agent.sqlite` |
| `WEB_AGENT_NO_OPEN` | 未设置 | 禁止 MCP/demo 自动打开浏览器 |

PowerShell 示例：

```powershell
$env:WEB_AGENT_CODEX_BIN = 'C:\path\to\codex.exe'
$env:WEB_AGENT_PORT = '3210'
npm start
```

保留第一个服务运行，在另一个终端设置 `$env:WEB_AGENT_PORT = '3211'` 后执行 `npm start`，即可打开独立对话。端口 `0` 每次启动创建独立的临时会话目录；要稳定恢复请使用固定端口。

服务始终仅监听回环地址。现有登录失效时，网页提供 Codex App Server 返回的网页登录入口。不会要求用户把 API key 填入本应用。

## 交互运行时

通过 `thread/start.dynamicTools` 注册 `web_agent` 命名空间。agent 在项目目录内生成文件，然后发布句柄，完整 HTML 不作为工具结果回传。

| 工具 | 作用 |
| --- | --- |
| `present({path,title,assets?,activate?})` | 发布并显示页面，返回 `id`、`version` 和后台数据写入地址/令牌；`activate:false` 在后台准备页面 |
| `update({id,path,preserveState?,assets?,title?,activate?})` | 发布新版本；仅保留指定的顶层状态键，旧等待请求失效；默认显示新版本 |
| `update({id,activate:true})` | 显示已有页面，不创建新版本、不清空编辑状态 |
| `update({channel,value})` | 推送任意 JSON 数据；长期指标应改用后台 HTTP 接口 |
| `request_input({artifactId,version,prompt,schema?})` | 等待该版本的一次 JSON 回答，支持 JSON Schema 校验 |
| `inspect({id})` | 读取加载状态、脚本错误、页面摘要、保存状态和输入请求状态 |
| `close({id})` | 关闭界面并取消其等待请求 |

每个界面有独立 ID 和版本。Agent 可以在同一页面组织所有内容，或在自己设计的导航中调用 `webagent.navigate(id)` 切换页面；宿主不自动生成导航。后台页面继续接收数据，输入请求不会强制切换页面。主 agent 负责发布和接收回答；子 agent 可只生成文件，不依赖动态工具继承。界面确认与命令审批使用独立通道。

### 页面 bridge

自包含 HTML/CSS/JS、内联 SVG 和注册图片运行在 `sandbox="allow-scripts allow-forms"` iframe 内。表单可通过 `submit` 事件和 `preventDefault()` 使用 bridge；CSP 的 `form-action 'none'` 禁止直接提交到其他地址。页面不能直接访问网络、宿主 DOM、任意本地文件或宿主权限接口。页面内自动注入：

```js
const initial = webagent.state;              // 刷新后恢复的 JSON 对象
await webagent.saveState({ node: 'api', comment: '拆分接口层' });
webagent.onState(state => { /* 初始化编辑器 */ });
webagent.onRequest(request => { button.disabled = !request; });

try {
  await webagent.submit({ node: selectedNode, comment: editor.value });
  // 服务端已持久化接受；此时再显示提交成功。
} catch (error) {
  // 保留用户输入，显示错误并允许重试。
}

webagent.onStream(({ channel, value, history }) => { /* 更新图表 */ });
webagent.report('已选择 API 节点，填写了两条意见');

// 页面自行设计按钮/编辑器，在用户操作时调用：
await webagent.sendMessage('把选中的方案实现出来'); // 下一回合，运行中则追加输入
await webagent.navigate(otherPageId);              // 切换已有页面，不调用模型
await webagent.stop();                             // 停止当前回合
webagent.openControls();                           // 临时宿主菜单
webagent.onSession(({ status, interfaces, activeArtifactId, lastMessage }) => {
  // 自行决定是否展示运行状态、下一步操作和导航。
});
```

图片用 `present({assets:{logo:"./logo.png"}})` 注册，然后使用 `webagent.asset('logo')` 或 `<img src="web-agent-asset:logo">`。服务端验证真实路径属于项目目录，并在发布时保存资源快照；不提供通用文件读取接口。HTML 上限 2 MB，单张图片 5 MB、每次发布全部图片合计 10 MB。

有 `id` 的普通输入框会自动保存表单值（密码和文件输入除外）；画布、图编辑器和自定义控件应使用 `saveState`。`request_input` 尚未发起、版本失效、请求已结束时，提交会被拒绝。页面必须提供自己的提交操作，`onCollect` 仅保留旧调用兼容，不再有宿主提交按钮。

`submit` 回答当前 `request_input`；`sendMessage` 在同一对话中发起新请求或追加输入，仅 Codex 入口可用。不要在页面加载、数据推送或状态回调中自动发送消息。失败时保留输入，浏览器为相同内容重试复用事件 ID。只有当前打开且版本有效的页面可以发送消息、停止或导航。`webagent.session` 可同步读取最近一次会话摘要。

### 独立实时数据

`present` 返回 `ingestUrl` 和仅能向该任务写入数据的 `ingestToken`。训练/后台进程直接发送：

```js
await fetch(ingestUrl, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${ingestToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ channel: 'metrics', value: { epoch: 12, loss: 0.21, f1: 0.88 } }),
});
```

每次刷新曲线不调用模型。历史按通道保留最近 300 条，最多 100 个通道，单条 JSON 上限 64 KB。令牌交给生产数据的进程，不要写进生成页面。其他界面的待确认输入不会被数据更新覆盖。

## 恢复与权限

- SQLite 保存本应用任务索引、Codex thread ID、界面版本及资源、草稿、关键事件、输入回执和有界数据历史。对话完整历史使用 Codex 的分页接口读取；本地保存有限的执行记录用于即时展示。
- 刷新或浏览器断线不停止回合。SSE 重连先接收完整快照，再接收后续事件，无需重放工具调用。
- 服务或 Codex 子进程重启时，旧等待与旧审批全部失效。保留页面和草稿，点击「继续任务」恢复原会话并附上界面/状态摘要；需要确认时 agent 发起新请求。
- 同一提交事件 ID 重试只返回原回执；版本不匹配的回答被拒绝。网页在提交失败时保留输入，网络丢失回执时可重试确认。
- 命令、文件及额外权限请求只在临时宿主弹窗处理，使用原始 App Server request ID 回复。没有覆盖 Codex 的 approval policy、sandbox、model 等设置；若现有配置使用自动审核器，是否出现手动审批由 Codex 决定。
- 服务检查 Host、Origin 和会话令牌；iframe 消息绑定实际窗口来源、界面 ID 和版本。数据库有进程锁，防止多个服务同时写同一个数据目录。

## Claude Code 与 demo

```sh
npm run build
npm run demo          # 无需 Codex/Claude，render → ask → stream 演示
npm run mcp           # MCP stdio 入口，供 MCP 客户端使用
npm run setup         # 可选：注册 Claude Code MCP，并安装原有 skill/agent/command
```

`setup` 会写入 Claude Code 用户配置；正常 Codex Web 用法不需要运行它。

保留 `open_panel`、`render`、`ask`、`stream`、`route`、`say`、`converse` 的工具名称与输入参数。`render` 创建并显示页面，`ask` 关联当前界面而不抹掉之前的内容；声明式控件显示在该页面内部，不占用宿主固定区域。自定义 `docPath` 与原有 `(channel,value)` stream 回调继续支持。`open_panel` 返回后台数据写入 URL/令牌。路径读取限定在 MCP 启动目录；需要访问其他项目时将 MCP 的 `cwd` 设置为该项目。

旧的未认证 `/ingest` 不再开放；生产进程使用 `open_panel` 返回的地址和 Bearer token。`route` 返回带资源能力令牌的地址，脚本在沙箱策略下执行，不再拥有宿主同源权限。旧入口默认使用进程内会话，浏览器刷新可恢复，跨服务重启的历史恢复属于 Codex 主入口。`WEB_AGENT_MCP_APPS=1` 仍只是未验证的可选资源适配脚手架，主要交互入口是本地浏览器。

## 验证

```sh
npm test             # node:test；模拟 App Server、HTTP/持久化、MCP、完整 demo 回归
npm run build        # TypeScript 检查 + 生产构建
npm run test:real     # 真实已登录 Codex，会消耗模型用量，不自动批准命令
node scripts/smoke-approval.mjs # 可选：真实审批协议，收到一次无害 echo 的审批后拒绝
```

真实 smoke 只在 `.web-agent-data/smoke-project/` 中放置测试页面，验证真实动态工具、HTTP 回答、模型继续、历史读取、Codex 进程重启恢复与停止。它不会修改 fork 或改写用户 Codex 设置。

浏览器验收使用 Python Playwright 和已安装的 Chrome（也可设置 `WEB_AGENT_TEST_BROWSER=msedge`）：

```sh
python -m pip install playwright
python test/browser.py
python test/browser-legacy.py # 原有 MCP 声明式表单在画布内提交/刷新/继续
```

测试自动启动独立服务和临时数据库，检查画布占满视口、无常驻宿主 UI、页面内导航/消息、来源隔离、节点反馈、独立指标、刷新/草稿、丢失回执重试、临时审批、停止、重启恢复及手机尺寸。截图写入 `test-results/`，不进入 Git。

## 实现位置与边界

```text
src/codex-client.js   App Server 子进程与逐行 JSON-RPC
src/controller.js     会话/回合/审批/恢复协调
src/dynamic-tools.js  工具协议与 agent 开发者指令
src/runtime.js       界面、输入请求、状态、数据通道与去重
src/store.js         SQLite 存储与进程锁
src/http-server.js   本地服务、认证、SSE、前端和 API
src/bridge.js        iframe bridge 和内容策略
src/engine.js        原有 MCP/demo 适配层
web/src/             React + TypeScript 浏览器工作台
test/                模拟协议、回归与 Playwright 验收
```

首版限定本机单用户、每个端口一个对话和一个运行中的顶层任务；没有远程访问、多用户协作、独立模型 API 或生图服务。App Server 的动态工具仍是实验协议。版本不兼容时显示具体协议错误，不自动改用 fork。MCP 设备证明类 `openai/userVerification` 需要原生客户端，网页不会伪造授权。
