# 设计文档：Agent 富交互层（Web Rich-Interaction Layer for Claude Code）

- 日期：2026-09-21
- 状态：设计草案，待评审
- 方向：**增强现有 Claude Code**（不 fork Codex、不替换终端）

---

## 1. 问题与目标

当前 agent ↔ 用户的交互几乎全靠文字。很多开发场景下文字不够用：

- Agent 做几套前端页面让用户挑最终方案；
- Agent 给出类 UML 架构图让用户确认方向（纯字符难看、缺细节）；
- Agent 用生图能力设计 UI 方案给用户看、再确认；
- 用户让 agent 训练模型，却看不到 loss / F1 / precision 随 epoch 的变化曲线。

**目标**：为 Claude Code 造一个**通用的 agent ↔ 人富交互层**——agent 能按需起一个本地 web 服务，在浏览器里承载"展示 / 征询 / 实时监控 / 用户主动操作"等交互，而不局限于任何单一场景。

**明确的非目标（Non-goals）**：

- 不 fork / 魔改 Codex，不做"网页当主界面"的全新 agent（那是另一个更大的产品赌注，代价是丢掉 Claude 模型与 Claude Code 生态）。
- 不针对"挑选器"或"训练面板"两个具体场景硬编码；它们只是通用能力的实例。
- 不追求在终端里内联渲染富 UI（终端渲染不了 iframe）。

**成功判据**：

1. 一次交互里，用户在网页提交后，agent **在同一回合内继续**，无需回终端敲 `continue`。
2. 用户能在网页里做**结构化选择**与**自由文本输入**，都能确定性地回流给 agent。
3. 训练/长任务的指标能在网页里**实时跳动**，且**不消耗 agent 的回合**。
4. 上述三个原始痛点场景都能由同一套原语拼出，无需为各自写专门通路。

---

## 2. 关键事实（决策依据）

以下结论均经并行调研 + 对抗式核验得到（详见 §10 引用）。

### 2.1 回合模型：点击无法自行唤醒 agent（confirmed）

LLM agent 没有常驻事件循环。推理是无状态的请求/响应；两次 "turn" 之间模型并不在运行。一个 turn 只由三种方式产生：(a) 用户消息；(b) **agent 正卡在某个已发起的工具调用上，该调用返回了结果**；(c) harness 级的定时/循环自唤醒。

因此，浏览器点击打到一个独立本地 web server 上，只能改写文件/socket 状态，**无法把 agent 唤醒**——agent 只在下一个 turn、且主动去读时才看得到。这正是"纯 skill 方案"的天花板，也是我们撞到的"点完还要回终端 continue"的根因。

### 2.2 MCP 阻塞式工具：一击解决"点完即继续 + 自由输入"（confirmed）

MCP 的工具调用是同步 JSON-RPC：模型发 `tools/call` 后这一回合挂起等结果。MCP server 是普通进程，可以：

1. 收到调用后**长挂响应不返回**（long-poll），同时**自起本地 HTTP/WebSocket 服务并打开浏览器**；
2. 用户在网页提交（点选或**自由文本**）→ server 拿到 → **返回工具结果**；
3. 结果在**同一 turn** 内喂回模型，agent 直接继续，无需新的用户消息。

约束：受**客户端请求超时**限制，需用 `notifications/progress` 心跳续命或做**有界长轮询**（超时前先返回"尚无提交"，由 harness 重发）。

### 2.3 渲染面必须可插拔

- **官方 MCP Apps**（`ext-apps`，规范 2026-01-26；社区 MCP-UI 的标准化后继）是"工具挂 `ui://` HTML 资源、宿主在沙箱 iframe 里渲染 + 双向 JSON-RPC"的正道，**但要求 GUI 宿主**（claude.ai 桌面 / VS Code 等）。
- **终端里的 Claude Code CLI 渲染不了 iframe**，所以 CLI 场景只能退回"MCP server 自起本地 web + 打开浏览器"。
- 通用设计因此把**渲染面做成可插拔**：GUI 宿主走 MCP Apps，终端宿主走自起 web。

### 2.4 子 agent：隔离 + 能调 MCP + 能替父 agent 阻塞等待（confirmed）

Claude Code 子 agent 有独立 context（其 token 不进父 agent 历史），只把收尾消息交回父 agent；**能调用 MCP 工具**，也**能替父 agent 卡在阻塞的 `ask()` 里**、只把结构化答案回传。子 agent 是**单发、无状态、不可跨回合恢复、不建议递归**。

上下文污染的经济账（高置信）：内联手写的 HTML 会每个 turn 重发一遍——一个 300 行 mockup 在 20 轮会话里被反复计费约 55–70k token·turns。委托给子 agent 可把它降为一个 O(1) 句柄；代价是 spawn 延迟、重新交代意图、多屏连续性丢失。

---

## 3. 架构总览

```
┌─ 层 1 · Skill（薄）
│    使用说明书 + agent-web 契约 + 何时委托子 agent 的规则
│
├─ 层 2 · MCP Server（引擎，长驻进程）
│    暴露 4 个工具：render / ask / stream / on
│    自起本地 HTTP + WebSocket；管理会话与渲染面
│
├─ 层 3 · 渲染面（可插拔）
│    · GUI 宿主 → MCP Apps（ui:// 资源，沙箱 iframe）
│    · 终端宿主 → 自起本地 web + 打开浏览器
│
└─ 层 4 · UI-author 子 agent（按需）
     只在"自由 HTML"档被父 agent 委托来"作画"，返回句柄
```

职责边界（每个单元一个清晰目的）：

- **Skill**：不含运行逻辑，只教 agent 何时用哪个原语、遵守什么契约、何时把作画委托出去。
- **MCP Server**：唯一的"真相源"。持有会话状态、web 服务、渲染面适配、阻塞等待与超时/心跳。对 agent 暴露 4 个工具。
- **渲染面适配器**：把"要展示什么"翻译成具体宿主的渲染方式。可替换、可独立测试。
- **UI-author 子 agent**：无状态的作画工，输入一份自包含 brief，输出一段合规 HTML 的句柄。

---

## 4. 四个通用原语

任何场景都由这四个拼出。签名为示意，最终以实现为准。

| 原语 | 语义 | 返回 | 是否占 agent 回合 |
|---|---|---|---|
| `render(view)` | 向网页推一屏 UI（不等待） | 立即返回句柄 | 占（一次调用） |
| `ask(spec) → answer` | 展示并**阻塞**等用户提交（点选/自由文本） | 结构化答案（同一回合继续） | 占（长挂直到提交） |
| `stream(channel, data)` | 向某个通道推实时增量数据 | 立即返回 | **不占**（见 §6） |
| `on(event) → payload` | 声明网页可回传的用户主动动作 | 事件 payload | 视实现 |

原语到"生成档"的映射（见 §5）：

- `ask` → 声明式（server 按 schema 渲染表单 + 校验）
- `stream` → 声明式（typed deltas 进固定 frame，且与 agent 无关）
- `render` → **分裂**：标准（表格/图表/组件）走声明式；定制（mockup/设计对比/生图 UI）走自由 HTML
- `on` → 契约层，与作画者无关

---

## 5. 生成模型：声明式优先的降级阶梯 + 作画/导演分离

### 5.1 降级阶梯

省 token 的第一原则不是"委托生成"，而是"**能不生成就不生成**"：

1. **声明式（默认档）**：agent 传一份紧凑的声明（schema / 组件清单），server 端固定 frame 渲染标准表单/图表。token 极少、安全、一致、可缓存。**无需子 agent。**
2. **自由 HTML（逃生舱）**：agent 需要 bespoke mockup / 设计对比 / 生图 UI 时，才手写任意 HTML/CSS。token 重、需设计判断、有安全面——**此档且仅此档交给 `UI-author` 子 agent。**

两档共用同一份契约（§7），安全与回传路径不因档位分叉。

### 5.2 作画 vs 导演分离

为消除"委托导致的多屏连续性丢失"：

- **作画（verbose、专业）→ 子 agent**：产出 HTML，返回短句柄/清单，**不把标记贴回**。
- **导演（编排 render/ask/stream、握对话主线、解读答案）→ 父 agent**：父 agent 手里只有句柄 + 短答案，本身很轻，天然保有跨屏连续性。

即：**委托的是"画这一屏"，不是"和用户的整场对话"。**

### 5.3 何时委托 / 何时内联（启发式）

- **委托**：产物大（>~150 行 / >~2k token）且一次性；其内部标记本会话不再被引用/diff；希望父 agent 当干净的协调者。
- **内联**：UI 很小（片段）；需逐轮迭代同一文件（编辑-查看-编辑）；父 agent 需就精确标记推理（调布局）；本就是声明式；或一场需前后屏互相依赖的连续对话。

---

## 6. 实时监控（`stream`）：绕开 agent 回合

训练曲线这类"广播"**不应消耗 agent 的回合**：

```
训练脚本 ──(写文件 / POST 指标)──▶ MCP Server ──(WebSocket 推)──▶ 浏览器
                                    （曲线跳动与 agent 是否在场无关）
```

- 数据源（训练脚本、长任务）把指标写入约定文件或 POST 到 server 的本地 ingest 端点；
- server 通过 WebSocket 直推浏览器 frame；
- agent 只需在开场调用一次 `render` 摆出面板 + 声明 `stream` 通道，之后**完全不介入**每一 tick。

（可选增强，中等置信、待核实）若希望 agent 对某个 web 事件"主动响应"而它并没卡在 `ask()` 里，Claude Code 的 `asyncRewake` hook（后台进程退出码 2 唤醒）或 SDK stream input 可作为额外唤醒路。非核心，列为后续探索。

---

## 7. agent-web 契约（与作画者无关）

无论主 agent 还是子 agent 生成页面，都必须满足：

1. **通信面**：页面只能通过约定协议回传；**禁止任意外部网络请求**（防外泄）；回传必须带**声明式 response schema**，让 agent 确定性解读，而非猜 DOM。
2. **安全面**：本地回环绑定（127.0.0.1）+ 校验 Origin（防 DNS rebinding）；**页面内不得出现密钥/凭证/敏感数据**，客户端 JS 也不得可达。
3. **CSP**：无 `unsafe-eval`、无任意远程脚本/资源源、沙箱化 origin。
4. **能力受限**：网页只能触发**预声明的 `on` 动作**，不能发起任意工具调用。
5. **边界校验**：frame 边界对回传值做校验 + 转义（永不信任返回值，防注入）。
6. **生命周期**：短命、单一真相源（server 权威，页面是投影）、**确定性拆除**、体积/时间有界。
7. **降级**：宿主不支持富渲染时，`ask`/`render` 要能降级为文本。

---

## 8. 三个原始场景的验证（用原语拼出）

- **挑前端方案**：`UI-author` 子 agent 作画 3 个 mockup（自由 HTML）→ 返回句柄 → 父 agent `render` 展示 + `ask({单选})` 阻塞 → 用户点选 → 同回合拿到选择继续。
- **确认 UML 架构图**：子 agent 作画架构图（自由 HTML/SVG）→ `render` + `ask({确认 | 修改意见:自由文本})`。
- **训练监控**：`render` 声明式面板 + 声明 `stream("metrics")` → 训练脚本推 loss/F1 → 浏览器实时跳动（不占回合）；训练结束可 `ask` 让用户决定下一步。
- **生图 UI 方案**：子 agent（可挂 `frontend-design`）产出 UI 稿 → `render` + `ask` 挑选。

四个场景零专用通路，全是四原语组合。

---

## 9. 组件分解（供后续 writing-plans 用）

1. **MCP Server 骨架**：初始化、传输（stdio + Streamable HTTP）、会话管理、工具注册。
2. **本地 web + WebSocket 子系统**：起服务、绑回环、开浏览器、frame 模板、client 助手（回传/重连/reload）。
3. **`ask` 阻塞机制**：long-poll + progress 心跳 + 有界超时 + 取消处理。
4. **声明式渲染器**：schema → 标准表单/图表/组件；response 校验。
5. **`stream` 通道**：ingest 端点/文件 tail → WebSocket 广播。
6. **渲染面适配器**：MCP Apps 适配 + 自起 web 适配（可插拔）。
7. **契约执行**：CSP、Origin 校验、response schema 校验、密钥扫描、拆除。
8. **Skill**：用法 + 契约 + 委托规则 + `UI-author` 子 agent 的 brief 模板。
9. **UI-author 子 agent 定义**：系统提示（含契约）、输入 brief 结构、输出句柄约定。

各单元通过明确接口通信，可独立理解与测试。

---

## 10. 风险与开放问题

- **超时/长等待**：人可能很久不提交；需 progress 心跳 + 有界长轮询 + 友好取消。
- **权限弹窗**：非交互子 agent 若未 allowlist `ask/render` 工具会卡死 → 必须预授权。
- **子 agent 单发/无状态**：多屏对话靠"父 agent 导演 + 子 agent 只作画"化解；不要指望长驻子 agent。
- **渲染面差异**：MCP Apps 与自起 web 的能力/安全模型不同，适配器要吸收差异并统一契约。
- **`asyncRewake` / SDK stream input**：仅中等置信，作为 `stream` 主动响应的后续探索项，非 v1 依赖。
- **文档可达性**：部分 MCP/Claude Code 官方文档在本环境被网络策略拦截，若干细节（客户端超时默认值、MCP Apps 精确字段名）需在实现前二次核对。

---

## 11. 引用

- MCP 核心规范 2025-06-18：`server/tools`、`basic/transports`、`basic/lifecycle`、`utilities/progress`、`utilities/cancellation`、`client/elicitation`（modelcontextprotocol/modelcontextprotocol）。
- MCP Apps 扩展 2026-01-26：modelcontextprotocol/ext-apps（README + `specification/2026-01-26/apps.mdx`）；社区前身 idosal/mcp-ui。
- Claude Code：扩展面（skills / hooks / plugins / MCP / subagents）、closed-source、`asyncRewake` hook、SDK stream input（code.claude.com/docs，部分待二次核对）。
- 对抗核验（均 confirmed）：①阻塞式 MCP 工具令网页提交在同一回合恢复 agent；②纯 skill 无法令点击唤醒 agent；③委托自由 HTML 给子 agent 使其不进父 context；④子 agent 能调 MCP 工具并替父 agent 阻塞等待。

---

## 12. 实现状态（v1，2026-09-22）

已实现并验证（代码在仓库根 `src/`、`demo/`、`agents/`、`skills/`）：

- **MCP server**（`src/mcp.js`，官方 SDK）暴露 `open_panel / render / ask / stream`；已用真实 MCP 客户端 stdio 握手验证（列工具 + 调用成功）。
- **本地 web 引擎**（`src/engine.js`，零依赖 HTTP+SSE）：`ask` 长挂→提交解析、`stream` 广播、外部 `/ingest`、favicon 204，均 headless 验证。
- **固定右下角 Submit 按钮 + 通用收集器**（`src/frame.js`）：按用户要求，交互完点固定按钮才回传;无 ask 时自动禁用。浏览器端已验证。
- **`on` 原语**：声明式 `controls`（slider/number/checkbox/text/select，收进 `answer.fields`）+ 立即提交的 `actions`（`answer.action`）。浏览器端验证：拨滑块→点 Approve 立即带值提交。
- **自定义 UI 模式（最大自由度）**：`render/ask` 接受 `doc`/`docPath` —— agent 交付完整交互文档,跑在 **sandbox iframe**(allow-scripts,无 same-origin)+ CSP(禁外网/远程资源)里,经注入的 `webagent` 桥(`submit`/`onCollect`/`onStream`,postMessage)回传**任意自定义 JSON**。agent 自定义交互与返回结构。浏览器端验证:自绘滑块+标签+备注→全局 Submit 走 `onCollect`→返回 `{confidence,tags,note}`。
- **UI-author 路径**：`render({htmlPath})` handle 化 + `agents/ui-author.md` 子 agent 定义 + `skills/web-agent/SKILL.md` 播报手册。
- **可插拔渲染面 + MCP Apps 适配**（`src/mcp-apps.js`）：`WEB_AGENT_MCP_APPS=1` 时注册 `ui://web-agent/panel` 资源;默认关闭、非破坏（已验证开关两态）。
- **接入**：`claude mcp add web-agent --scope user`，`✓ Connected`;子 agent 与 skill 安装到 `~/.claude/`。

架构性未尽（诚实标注）：MCP Apps 的宿主侧 iframe↔工具 JSON-RPC 桥是宿主相关、且终端 Claude Code CLI 无法渲染 iframe，故该路径为脚手架、未在 CLI 目标运行时验证。`on` 的"render 期间即时唤醒 agent"受回合模型限制不做（需 agent 卡在 ask 内）。
