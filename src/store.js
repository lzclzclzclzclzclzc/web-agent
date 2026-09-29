import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, openSync, readFileSync, writeFileSync, closeSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

// The small, single-user store intentionally uses synchronous transactions: an
// accepted answer and its deduplication receipt become durable before resolving.
export class Store {
  constructor(path = ':memory:') {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
      this.lockPath = `${path}.lock`;
      try { this.acquireLock(); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let pid;
        try { pid = Number(readFileSync(this.lockPath, 'utf8')); } catch {}
        let alive = true;
        if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; } }
        if (alive) throw new Error(`数据目录已被其他 Web Agent 进程占用：${dirname(path)}`);
        unlinkSync(this.lockPath); this.acquireLock();
      }
    }
    try { this.db = new DatabaseSync(path); }
    catch (error) { this.releaseLock(); throw error; }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (kind TEXT, id TEXT, value TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, value TEXT NOT NULL);
      PRAGMA user_version=1;`);
  }
  acquireLock() {
    this.lock = openSync(this.lockPath, 'wx'); writeFileSync(this.lock, String(process.pid));
  }
  releaseLock() {
    if (this.lock !== undefined) { closeSync(this.lock); this.lock = undefined; unlinkSync(this.lockPath); }
  }
  get(kind, id) { const row = this.db.prepare('SELECT value FROM records WHERE kind=? AND id=?').get(kind, id); return row ? JSON.parse(row.value) : undefined; }
  all(kind) { return this.db.prepare('SELECT value FROM records WHERE kind=?').all(kind).map(r => JSON.parse(r.value)); }
  put(kind, id, value) { this.db.prepare('INSERT OR REPLACE INTO records VALUES (?,?,?)').run(kind, id, JSON.stringify(value)); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  event(taskId, event) {
    const result = this.db.prepare('INSERT INTO events(task_id,value) VALUES (?,?)').run(taskId, JSON.stringify(event));
    this.db.prepare('DELETE FROM events WHERE task_id=? AND seq NOT IN (SELECT seq FROM events WHERE task_id=? ORDER BY seq DESC LIMIT 1000)').run(taskId, taskId);
    return Number(result.lastInsertRowid);
  }
  close() { this.db.close(); this.releaseLock(); }
}
