// inspect.js — 'DB 뷰어' 대신 쓰는 확인 스크립트
//
//   node inspect.js
//
// 노드 실습의 통과 기준 중 하나가 "DB 뷰어로 todo.db를 열어 todos 표에
// 행이 실제로 쌓였는지 눈으로 확인"이다. DB Browser for SQLite를 깔아도 되지만,
// 이 스크립트로도 같은 걸 확인할 수 있다.

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DB = join(dirname(fileURLToPath(import.meta.url)), 'todo.db');
const db = new DatabaseSync(DB, { readOnly: true });
const line = (s) => console.log('\n' + s + '\n' + '─'.repeat(58));

console.log(`DB 파일: ${DB}`);

line('표 목록');
console.log(
  db.prepare(
    `SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  ).all().map((r) => r.name).join('  ·  ')
);

line('todos — 디스크에 실제로 쌓인 행');
const todos = db.prepare('SELECT id,title,is_done,due_date,created_at FROM todos ORDER BY id').all();
if (!todos.length) console.log('  (없음)');
for (const r of todos) {
  console.log(`  #${r.id}  [${r.is_done ? 'x' : ' '}]  ${r.title}`);
  console.log(`        마감 ${r.due_date ?? '-'}   생성 ${r.created_at}`);
}

line('tags');
for (const r of db.prepare('SELECT id,name,color FROM tags ORDER BY id').all()) {
  console.log(`  #${r.id}  ${r.name}  ${r.color}`);
}

line('todo_tags — 연결 표 (N:M을 푼 곳)');
const links = db.prepare(`
  SELECT tt.todo_id, tt.tag_id, td.title, tg.name
    FROM todo_tags tt
    JOIN todos td ON td.id = tt.todo_id
    JOIN tags  tg ON tg.id = tt.tag_id
   ORDER BY tt.todo_id, tg.name
`).all();
if (!links.length) console.log('  (없음)');
for (const r of links) {
  console.log(`  todo ${r.todo_id} ↔ tag ${r.tag_id}    "${r.title}"  #${r.name}`);
}

line('색인');
console.log(
  db.prepare(
    `SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name`
  ).all().map((r) => r.name).join('  ·  ')
);

line("색인을 정말 타는가 — EXPLAIN QUERY PLAN ('오늘 할 일' 조회)");
for (const r of db.prepare('EXPLAIN QUERY PLAN SELECT * FROM todos WHERE due_date = ?').all()) {
  console.log('  ' + r.detail);
}
console.log(
  "\n  ↑ 'USING INDEX idx_todos_due' 가 보이면 색인을 탄 것이다.\n" +
  "    'SCAN todos' 만 보이면 처음부터 전부 훑는다는 뜻 (= 색인을 안 탐).\n"
);
