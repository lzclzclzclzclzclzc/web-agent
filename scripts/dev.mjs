import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['src/main.js', '--dev'], { stdio: 'inherit', windowsHide: true });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('exit', code => { process.exitCode = code || 0; });
