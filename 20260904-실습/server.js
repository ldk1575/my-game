// server.js — 백엔드 (어제 배운 '눈에 안 보이는 주방')
//
// 창구(엔드포인트)는 정해진 것만 연다. 창구 = 주소(URL) + 동사(GET/POST/...)
//   GET    /api/todos?filter=all|today   목록 보기      (Read)
//   POST   /api/todos                    할 일 추가     (Create)
//   PATCH  /api/todos/:id/toggle         완료 토글      (Update)
//   DELETE /api/todos/:id                삭제           (Delete)
//   GET    /api/tags                     태그 목록
//
// 프론트와 백엔드의 공용어는 JSON.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import {
  addTodo, listTodos, toggleTodo, removeTodo, listTags, todayCount, todayStr, DB_PATH,
} from './db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3100);
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

async function readBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('본문이 너무 큽니다');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    // ── API ───────────────────────────────────────────────────────────────
    if (path === '/api/todos' && req.method === 'GET') {
      const filter = url.searchParams.get('filter') === 'today' ? 'today' : 'all';
      return json(res, 200, {
        today: todayStr(),
        todayCount: todayCount(),
        todos: listTodos(filter),
      });
    }

    if (path === '/api/todos' && req.method === 'POST') {
      const body = await readBody(req);
      const id = addTodo({ title: body.title, dueDate: body.dueDate, tags: body.tags });
      return json(res, 201, { id });
    }

    const toggleMatch = path.match(/^\/api\/todos\/(\d+)\/toggle$/);
    if (toggleMatch && req.method === 'PATCH') {
      const ok = toggleTodo(toggleMatch[1]);
      return json(res, ok ? 200 : 404, { ok });
    }

    const delMatch = path.match(/^\/api\/todos\/(\d+)$/);
    if (delMatch && req.method === 'DELETE') {
      const ok = removeTodo(delMatch[1]);
      return json(res, ok ? 200 : 404, { ok });
    }

    if (path === '/api/tags' && req.method === 'GET') {
      return json(res, 200, { tags: listTags() });
    }

    // ── 정적 파일 ─────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const rel = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
      // 상위 경로 탈출 방지
      const file = join(HERE, 'public', rel);
      if (!file.startsWith(join(HERE, 'public'))) return json(res, 403, { error: '금지' });
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      return res.end(data);
    }

    json(res, 404, { error: '그런 주소 없음' });
  } catch (err) {
    if (err.code === 'ENOENT') return json(res, 404, { error: '그런 주소 없음' });
    // 실패를 정직하게 안내한다
    console.error('[에러]', err.message);
    json(res, 400, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n  내 Todo 앱  ▸  http://localhost:${PORT}`);
  console.log(`  DB 파일     ▸  ${DB_PATH}`);
  console.log(`  오늘        ▸  ${todayStr()}\n`);
});
