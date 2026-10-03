import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.WORLDGEN_PORT || 4173);
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const normalized = path.posix.normalize(pathname.replaceAll('\\', '/'));
    const relative = normalized === '/' ? 'index.html' : normalized.slice(1);
    // Only the browser application and its source modules are public.
    if (!(relative === 'index.html' || relative === 'style.css' || relative.startsWith('src/'))) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(target);
    res.writeHead(200, {'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control':'no-store'});
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  console.log(`WorldGen: ${url}`);
  if (process.argv.includes('--open')) {
    if (process.platform === 'win32') spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {windowsHide:true, stdio:'ignore'});
  }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
