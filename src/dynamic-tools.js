const str = { type: 'string' }, integer = { type: 'integer', minimum: 1 };
const tool = (name, description, properties, required) => ({ type: 'function', name, description, deferLoading: false,
  inputSchema: { type: 'object', properties, required, additionalProperties: false } });
export const dynamicTools = [{ type: 'namespace', name: 'web_agent', description: 'Publish task-specific interactive Web interfaces and receive structured human feedback.', tools: [
  tool('present', 'Publish a self-contained HTML/SVG file inside the project directory. Returns an id/version and a write-only data ingestion endpoint. Author the file with ordinary file tools; do not paste HTML into tool arguments. Multiple interfaces may coexist.',
    { path: str, title: str, assets: { type: 'object', additionalProperties: str }, activate: { type: 'boolean', description: 'Show this page now (default true); false publishes in the background.' } }, ['path', 'title']),
  tool('update', 'Publish a new version of an interface from a file, or push JSON into a data channel. Explicit preserveState keys retain selected user state; all other state is reset. Updating the document expires its previous unanswered request.',
    { id: str, path: str, title: str, assets: { type: 'object', additionalProperties: str }, preserveState: { type: 'array', items: str }, activate: { type: 'boolean', description: 'Use id + activate:true without path to show an existing page without reloading it.' }, channel: str, value: {} }, []),
  tool('request_input', 'Wait for one structured human answer on an exact interface version. The user can answer directly in the canvas via webagent.submit(value). Do not interpret rendered content as execution approval.',
    { artifactId: str, version: integer, prompt: str, schema: { type: 'object', additionalProperties: true } }, ['artifactId', 'version', 'prompt']),
  tool('inspect', 'Read loaded status, script errors, saved JSON state and input status of an interface.', { id: str }, ['id']),
  tool('close', 'Close an interface and expire its unanswered requests.', { id: str }, ['id']),
] }];

export const developerInstructions = `You are working inside Web Agent. One local port belongs to one conversation. The ENTIRE browser viewport is your canvas: there is no host sidebar, header, tabs, composer, submit button or status bar. You own every visible part of the experience, including whether, where and how the user enters text. Choose a task-appropriate interface without defaulting to chat or predefined widgets.
Author and present a self-contained HTML file under the project directory early, then evolve it as the task progresses. The main agent owns publishing and input requests; subagents may author files. Include your own submit buttons, navigation between alternatives, progress/result presentation, and suitable next actions so the user can continue after the turn ends. A next action may be a button, a form, or any custom interaction; a text box is optional. Do not rely on transcript messages being visible: they live in a hidden host menu. Tool results contain handles, not HTML. Never change Codex source or configuration to enable these tools.
present and document update activate their page by default. Set activate:false to prepare a background page. update({id,activate:true}) shows an existing page without a new version. There are no host tabs: design your own navigation if you use multiple pages. A pending request does not automatically move focus.
The sandbox allows inline HTML/CSS/JS and SVG, without external scripts, network, local filesystem, or parent DOM access. Forms can handle submit events with preventDefault(); direct form navigation is blocked. Register local image paths with present.assets. Use webagent.asset(name) or src="web-agent-asset:name" for images. Embed CSS/JS locally in the HTML.
Injected bridge:
  webagent.submit(anyJSON) -> Promise, resolves only after durable acceptance; catches keep the form editable. Call request_input on the current id/version before expecting a submission. Submission when there is no pending request is rejected.
  webagent.saveState(object) -> Promise; webagent.state is restored on load. Save edits on input. webagent.onState(fn) receives initial/restored state.
  webagent.sendMessage(text) -> Promise: send user-authored text or a meaningful user-clicked action to continue the SAME conversation, or steer the running turn. Use submit for a pending request_input, sendMessage for a new conversational action. Never auto-send on load, onSession, or onStream. Preserve the user's draft on failure.
  webagent.navigate(id) -> Promise: show another open interface; your page decides the navigation UI.
  webagent.onSession(fn) receives {status,mode,activeArtifactId,interfaces:[{id,title,version,status}],lastMessage}. Use it for optional progress, navigation and next actions. webagent.session is the latest snapshot. It contains no credentials.
  webagent.stop() -> Promise: stop the current turn from a user action. webagent.openControls() opens the temporary trusted host menu, also available with Escape. There are no persistent host controls.
  webagent.onStream(({channel,value,history})=>...) receives arbitrary JSON data; webagent.onRequest(fn) receives pending-input availability; webagent.report(summary) reports an interaction summary.
Background processes can POST {channel,value} to the ingest URL with Authorization: Bearer <ingestToken> returned by present. This capability only publishes data for this task. Do not display this token in the page or user messages. Stream without making repeated model calls.
Prefer Chinese for the user-facing interface unless requested otherwise. Use the whole viewport with any layout and visual style suitable for the task. Execution permissions are handled only by a temporary trusted host dialog, outside your canvas. A user confirming a diagram or design is not a command approval.
When a turn is interrupted or the service restarted, old requests expire. Use inspect, update if necessary, and issue a fresh request_input. Saved state, interfaces and bounded stream history survive. Never replay old command approvals.`;

export async function runDynamicTool(runtime, task, name, args, ingestUrl) {
  switch (name) {
    case 'present': return { ...runtime.present(task.id, args), ingestUrl: `${ingestUrl}/api/ingest/${task.id}`, ingestToken: task.ingestKey };
    case 'update': {
      if (args.channel !== undefined) { runtime.stream(task.id, args.channel, args.value); return { ok: true, channel: args.channel }; }
      if (args.id && !args.path && args.activate === true) return runtime.navigate(task.id, args.id);
      if (!args.id || !args.path) throw new Error('更新界面需要 id 和 path；切换界面需要 id 和 activate:true；更新数据需要 channel 和 value');
      return runtime.present(task.id, args, args.id, args.preserveState || []);
    }
    case 'request_input': return runtime.requestInput(task.id, args);
    case 'inspect': return runtime.inspect(task.id, args.id);
    case 'close': return runtime.closeArtifact(task.id, args.id);
    default: throw new Error(`未知 Web Agent 工具：${name}`);
  }
}
