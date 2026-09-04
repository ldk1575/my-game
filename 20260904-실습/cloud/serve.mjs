// serve.mjs — 배포 전 로컬 확인용 정적 서버
//
//   node serve.mjs      →  http://localhost:3200
//
// index.html 을 file:// 로 열면 안 된다.
//   · CDN에서 ESM(supabase-js) 를 가져오지 못한다
//   · localStorage 의 출처(origin)가 불안정해 세션이 유지되지 않는다
// GitHub Pages 도 http(s) 로 서빙하므로, 그 환경과 같게 맞춰 확인한다.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3200);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.sql':  'text/plain; charset=utf-8',
  '.svg':  'image/svg+xml',
};

createServer(async (req, res) => {
  const path = new URL(req.url, `http://${req.headers.host}`).pathname;
  const rel = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
  const file = normalize(join(HERE, rel));

  if (!file.startsWith(HERE)) {           // 상위 경로 탈출 방지
    res.writeHead(403).end('금지');
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('그런 주소 없음');
  }
}).listen(PORT, () => {
  console.log(`\n  Todo 앱 (클라우드)  ▸  http://localhost:${PORT}\n`);
});
