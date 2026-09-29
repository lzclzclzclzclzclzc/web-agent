// Kept for the optional MCP Apps resource adapter. A host-specific MCP Apps
// bridge is not implemented; all supported interaction runs in the local shell.
export function framePage() {
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>body{font:15px/1.8 sans-serif;padding:24px;color:#344635}</style><h2>Web Agent</h2><p>请调用 open_panel，然后打开返回的本地工作台链接。</p><p>此 MCP Apps 资源是实验适配入口；当前交互在本地浏览器中运行。</p></html>';
}
