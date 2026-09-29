import { readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

export function projectDirectory(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('项目目录必须是绝对路径');
  const actual = realpathSync(path);
  if (!statSync(actual).isDirectory()) throw new Error('项目目录不存在');
  return actual;
}
export function projectFile(cwd, path, maxBytes = 2 * 1024 * 1024) {
  if (typeof path !== 'string') throw new Error('需要本地文件路径');
  const root = realpathSync(cwd), actual = realpathSync(resolve(root, path));
  const rel = relative(root, actual);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('文件超出项目目录');
  const info = statSync(actual);
  if (!info.isFile() || info.size > maxBytes) throw new Error(`文件必须小于 ${maxBytes} 字节`);
  return readFileSync(actual);
}
const images = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
export function readAssets(cwd, paths = {}) {
  if (!paths || typeof paths !== 'object' || Array.isArray(paths) || Object.keys(paths).length > 20) throw new Error('最多注册 20 个图片资源');
  const assets = {}; let total = 0;
  for (const [name, path] of Object.entries(paths)) {
    const mime = images[extname(String(path)).toLowerCase()];
    if (!/^[\w.-]{1,80}$/.test(name) || !mime) throw new Error('资源必须使用简单名称和支持的图片类型');
    const body = projectFile(cwd, path, 5 * 1024 * 1024); total += body.length;
    if (total > 10 * 1024 * 1024) throw new Error('资源总大小超出 10 MB');
    assets[name] = `data:${mime};base64,${body.toString('base64')}`;
  }
  return assets;
}
