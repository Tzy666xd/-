#!/usr/bin/env node
// 开发期静态服务器：只服务 web/ 目录，端口固定，给 browser-use 抓动画中间态用。
// 不用 file:// 是因为 ES module 会被同源策略拦掉。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../web/', import.meta.url));
const port = Number(process.argv[2] ?? 8617);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

createServer(async (req, res) => {
  let path;
  try { path = decodeURIComponent((req.url ?? '/').split('?')[0]); }
  catch { res.writeHead(400);res.end('Bad URI');return; }
  if (path === '/') path = '/index.html';
  const target = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  try {
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': mime[extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404');
  }
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} → http://127.0.0.1:${port}/`));
