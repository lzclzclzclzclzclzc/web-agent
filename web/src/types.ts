export type Json = any;
export interface Artifact { id: string; taskId: string; version: number; title: string; status: string; state: Json; errors: string[]; loaded: boolean }
export interface Input { id: string; taskId: string; artifactId: string; version: number; prompt: string; status: string; spec?: Json; reason?: string }
export interface Approval { id: string; method: string; status: string; params: Json }
export interface Task { id: string; title: string; cwd: string; mode: string; status: string; activeArtifactId?: string; turnId: string | null; threadId: string | null; draft: string; items: Json[]; requests: Approval[]; artifacts: Artifact[]; inputs: Input[]; channels: Record<string, Json[]> }
export interface Snapshot { tasks: Task[]; codex: Json; cwd: string; mode: string }
export async function api(path: string, body?: Json, headers?: Record<string, string>): Promise<any> {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error || `HTTP ${response.status}`), { status: response.status });
  return value;
}
export function saved(key: string, fallback: any = '') { try { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); } catch { return fallback; } }
export function remember(key: string, value: any) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Server remains authoritative if browser storage is full. */ } }
export const running = (task?: Task) => !!task && ['starting', 'running', 'stopping'].includes(task.status);
export const statusLabel: Record<string, string> = { idle: '已就绪', starting: '正在启动', running: '执行中', stopping: '正在停止', interrupted: '已停止 · 可继续', error: '需要处理' };
