import http from 'node:http';
import fs from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const docs = fileURLToPath(new URL('../docs/', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8'
};
function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

export function createSiteServer(root = docs) {
  return http.createServer(async (req, res) => {
    const fail = (status, text) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(text); };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD'); fail(405, 'Method not allowed'); return;
    }
    try {
      let name;
      try { name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
      catch { fail(400, 'Invalid URL'); return; }
      if (name.includes('\0') || name.includes('\\') || name.includes(':')) { fail(400, 'Invalid path'); return; }
      const base = await realpath(root);
      let file = path.resolve(base, '.' + name);
      if (!inside(base, file)) { fail(403, 'Forbidden'); return; }
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      file = await realpath(file);
      if (!inside(base, file)) { fail(403, 'Forbidden'); return; }
      const info = await stat(file);
      if (!info.isFile()) { fail(404, 'Not found'); return; }
      res.writeHead(200, {
        'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': info.size, 'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff'
      });
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = fs.createReadStream(file);
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      fail(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500, 'File unavailable');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = flag => { const at = args.indexOf(flag); return at < 0 ? undefined : args[at + 1]; };
  const port = Number(value('--port') || process.env.PORT || 5173);
  const host = value('--host') || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  const server = createSiteServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Choose --port <number>.` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, host, () => console.log(`Kalidoface PSX: http://${host}:${port}/ (serving docs/)`));
}
