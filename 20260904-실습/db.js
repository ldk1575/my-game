// db.js — 데이터 계층
//
// 오늘 배운 것이 코드로 어디에 나타나는지 주석으로 표시해 뒀다.
//   · 표 세 개 + 연결 표(N:M)
//   · 파라미터화 쿼리 (SQL 주입 방어)
//   · 트랜잭션 (전부 되거나 전부 안 되거나)
//   · 색인 (실제 화면의 질문에 맞게 최소한만)

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = join(HERE, 'todo.db');

// DB 전체가 파일 하나. 서버를 따로 켤 필요가 없다.
const db = new DatabaseSync(DB_PATH);

// 외래키 제약을 켠다. 켜지 않으면 주인 없는 연결 줄이 남을 수 있다.
db.exec('PRAGMA foreign_keys = ON');

// ── 스키마 ────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS todos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT    NOT NULL,
    is_done    INTEGER NOT NULL DEFAULT 0,
    due_date   TEXT,                                  -- 'YYYY-MM-DD'
    created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS tags (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL UNIQUE,                       -- 같은 태그가 두 번 생기지 않게
    color TEXT NOT NULL DEFAULT '#1f4e79'
  );

  -- 연결 표: N:M을 '연결 표를 사이에 둔 두 개의 1:N'으로 푼다
  CREATE TABLE IF NOT EXISTS todo_tags (
    todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
    PRIMARY KEY (todo_id, tag_id)
  );

  -- 색인: "오늘 마감만 보여줘" / "이 할 일의 태그 줘" / "이 태그의 할 일 줘"
  CREATE INDEX IF NOT EXISTS idx_todos_due      ON todos(due_date);
  CREATE INDEX IF NOT EXISTS idx_todotags_todo  ON todo_tags(todo_id);
  CREATE INDEX IF NOT EXISTS idx_todotags_tag   ON todo_tags(tag_id);
`);

// ── 준비된 문장(prepared statement) ───────────────────────────────────────
// 자리표(?)를 미리 비워 둔 명령을 만들어 두고, 사용자 입력은 따로 건넨다.
// 그래서 제목에 `Robert'); DROP TABLE todos;--` 를 넣어도 DB는 그것을
// '명령'이 아니라 '그냥 글자'로만 취급한다.  ← 오늘 배운 SQL 주입 방어
const q = {
  insertTodo: db.prepare(
    'INSERT INTO todos (title, due_date) VALUES (?, ?)'
  ),
  insertTag: db.prepare(
    'INSERT INTO tags (name, color) VALUES (?, ?) ON CONFLICT(name) DO NOTHING'
  ),
  findTag: db.prepare('SELECT id FROM tags WHERE name = ?'),
  linkTag: db.prepare(
    'INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING'
  ),
  // 완료 토글은 앱에서 값을 읽어와 계산하지 않고 DB에서 뒤집는다.
  // 동시에 두 번 눌려도 경쟁에 강하다.
  toggle: db.prepare(
    'UPDATE todos SET is_done = 1 - is_done WHERE id = ?'
  ),
  remove: db.prepare('DELETE FROM todos WHERE id = ?'),
  listAll: db.prepare(`
    SELECT id, title, is_done, due_date, created_at
      FROM todos
     ORDER BY is_done ASC,
              CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
              due_date ASC,
              id DESC
  `),
  listToday: db.prepare(`
    SELECT id, title, is_done, due_date, created_at
      FROM todos
     WHERE due_date = ?
     ORDER BY is_done ASC, id DESC
  `),
  tagsOf: db.prepare(`
    SELECT t.name, t.color
      FROM tags t
      JOIN todo_tags tt ON tt.tag_id = t.id
     WHERE tt.todo_id = ?
     ORDER BY t.name
  `),
  allTags: db.prepare(`
    SELECT t.name, t.color, COUNT(tt.todo_id) AS cnt
      FROM tags t
      LEFT JOIN todo_tags tt ON tt.tag_id = t.id
     GROUP BY t.id
     ORDER BY cnt DESC, t.name
  `),
  countByDue: db.prepare(
    'SELECT COUNT(*) AS n FROM todos WHERE due_date = ? AND is_done = 0'
  ),
};

const PALETTE = ['#1f4e79', '#8a5a00', '#1f5f45', '#8f2f3c', '#5b3a8a', '#0f6674'];

export function todayStr(d = new Date()) {
  // 로컬 기준 YYYY-MM-DD (UTC로 바꾸면 하루가 어긋난다)
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 할 일 추가. 쓰기가 여러 번 일어나므로 트랜잭션으로 묶는다.
 * 중간에 실패하면 전부 취소되어, 태그 없는 할 일이나 주인 없는 연결 줄이 남지 않는다.
 */
export function addTodo({ title, dueDate, tags }) {
  const clean = String(title ?? '').trim();
  if (!clean) throw new Error('제목은 비울 수 없습니다');
  if (clean.length > 200) throw new Error('제목이 너무 깁니다 (200자 이내)');

  const due = normalizeDate(dueDate);
  const names = dedupeTags(tags);

  db.exec('BEGIN');
  try {
    const { lastInsertRowid } = q.insertTodo.run(clean, due);
    const todoId = Number(lastInsertRowid);

    for (const name of names) {
      q.insertTag.run(name, PALETTE[hash(name) % PALETTE.length]);
      const row = q.findTag.get(name);
      q.linkTag.run(todoId, row.id);
    }

    db.exec('COMMIT');
    return todoId;
  } catch (err) {
    db.exec('ROLLBACK'); // 반쪽만 남기지 않는다
    throw err;
  }
}

export function listTodos(filter = 'all') {
  const rows =
    filter === 'today' ? q.listToday.all(todayStr()) : q.listAll.all();

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    isDone: r.is_done === 1,
    dueDate: r.due_date,
    createdAt: r.created_at,
    tags: q.tagsOf.all(r.id).map((t) => ({ name: t.name, color: t.color })),
  }));
}

export function toggleTodo(id) {
  return q.toggle.run(Number(id)).changes > 0;
}

export function removeTodo(id) {
  // todo_tags 는 ON DELETE CASCADE 로 함께 지워진다
  return q.remove.run(Number(id)).changes > 0;
}

export function listTags() {
  return q.allTags.all().map((t) => ({ name: t.name, color: t.color, count: t.cnt }));
}

export function todayCount() {
  return q.countByDue.get(todayStr()).n;
}

// ── 입력 정리 ─────────────────────────────────────────────────────────────
function normalizeDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function dedupeTags(v) {
  const raw = Array.isArray(v) ? v : String(v ?? '').split(',');
  const seen = new Set();
  for (const t of raw) {
    const name = String(t).trim().replace(/^#/, '');
    if (name && name.length <= 20) seen.add(name);
  }
  return [...seen].slice(0, 5); // 태그는 최대 5개
}

function hash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)) % 1e9;
  return h;
}

export default db;
