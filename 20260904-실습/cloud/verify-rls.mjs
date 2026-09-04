// verify-rls.mjs — RLS 정책이 정말 막는지 직접 공격해 본다
//
//   node verify-rls.mjs
//
// 어제 프로젝트 README의 '공격 테스트' 표와 같은 생각이다.
// "정책을 넣었다"가 아니라 "정말 막히는지" 를 확인한다.

const URL = 'https://qxyaxkvxpnrtcyqppahr.supabase.co';
const KEY = 'sb_publishable_L7VTeYU48mfIQXEEjsLxpA_XGfLelPY';

const results = [];
const ok   = (name, detail) => { results.push(['PASS', name, detail]); console.log(`  ✅ ${name}\n     ${detail}`); };
const bad  = (name, detail) => { results.push(['FAIL', name, detail]); console.log(`  ❌ ${name}\n     ${detail}`); };
const head = (s) => console.log(`\n${s}\n${'─'.repeat(66)}`);

const H = (token) => ({
  apikey: KEY,
  Authorization: `Bearer ${token ?? KEY}`,
  'Content-Type': 'application/json',
});

async function call(path, { method = 'GET', token, body, prefer } = {}) {
  const headers = H(token);
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(URL + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: res.status, data };
}

async function signInAnon(label) {
  const r = await call('/auth/v1/signup', { method: 'POST', body: {} });
  if (!r.data?.access_token) throw new Error(`${label} 익명 로그인 실패: ${JSON.stringify(r.data)}`);
  console.log(`  ${label} = ${r.data.user.id}  (is_anonymous: ${r.data.user.is_anonymous})`);
  return { token: r.data.access_token, id: r.data.user.id };
}

// ══════════════════════════════════════════════════════════════════
head('0) 어제 제출물이 무사한가 — results 표');
{
  const r = await call('/rest/v1/rpc/get_stats', { method: 'POST', body: { p_code: 'NPVL' } });
  if (r.status === 200 && typeof r.data?.total === 'number') {
    ok('어제 results 표 살아 있음', `get_stats → total=${r.data.total}, count=${r.data.count}`);
  } else {
    bad('어제 results 표 확인 실패', `HTTP ${r.status} ${JSON.stringify(r.data)}`);
  }
}

head('1) 익명 사용자 두 명 만들기');
const A = await signInAnon('A');
const B = await signInAnon('B');
if (A.id !== B.id) ok('서로 다른 user_id 발급', `A ≠ B`);
else bad('같은 user_id 발급됨', 'RLS 분리가 불가능해진다');

head('2) A가 할 일을 추가 (add_todo — 트랜잭션 하나로)');
let todoIdA;
{
  const r = await call('/rest/v1/rpc/add_todo', {
    method: 'POST', token: A.token,
    body: { p_title: "A의 비밀 할 일", p_due: null, p_tags: ['업무', '긴급'] },
  });
  if (r.status === 200 && Number.isInteger(r.data)) {
    todoIdA = r.data;
    ok('A 추가 성공', `todo id = ${todoIdA}`);
  } else {
    bad('A 추가 실패', `HTTP ${r.status} ${JSON.stringify(r.data)}`);
  }
}

head('3) A는 자기 것을 읽을 수 있나 (읽혀야 정상)');
{
  const r = await call('/rest/v1/todos?select=id,title,todo_tags(tags(name))', { token: A.token });
  const n = Array.isArray(r.data) ? r.data.length : -1;
  const tags = r.data?.[0]?.todo_tags?.map(t => t.tags.name).join(',') ?? '';
  if (n === 1) ok('A가 자기 할 일 1건 조회', `title="${r.data[0].title}" tags=[${tags}]`);
  else bad('A 조회 이상', `${n}건 — ${JSON.stringify(r.data)}`);
}

head('4) ⚔ B가 A의 할 일을 볼 수 있나 (0건이어야 정상)');
{
  const r = await call('/rest/v1/todos?select=id,title', { token: B.token });
  const n = Array.isArray(r.data) ? r.data.length : -1;
  if (n === 0) ok('B에게 A의 할 일이 안 보인다', `HTTP ${r.status}, 0건 — RLS가 행을 숨김`);
  else bad('B가 남의 할 일을 봤다', `${n}건 — ${JSON.stringify(r.data)}`);
}

head('5) ⚔ B가 A의 할 일을 지울 수 있나 (0건이어야 정상)');
{
  const r = await call(`/rest/v1/todos?id=eq.${todoIdA}`, {
    method: 'DELETE', token: B.token, prefer: 'return=representation',
  });
  const n = Array.isArray(r.data) ? r.data.length : -1;
  if (n === 0) ok('B가 A의 할 일을 못 지운다', `HTTP ${r.status}, 지워진 행 0개`);
  else bad('B가 남의 할 일을 지웠다', JSON.stringify(r.data));
}

head('6) ⚔ B가 A의 할 일을 고칠 수 있나 (0건이어야 정상)');
{
  const r = await call(`/rest/v1/todos?id=eq.${todoIdA}`, {
    method: 'PATCH', token: B.token, body: { title: 'B가 덮어씀' }, prefer: 'return=representation',
  });
  const n = Array.isArray(r.data) ? r.data.length : -1;
  if (n === 0) ok('B가 A의 할 일을 못 고친다', `HTTP ${r.status}, 고쳐진 행 0개`);
  else bad('B가 남의 할 일을 고쳤다', JSON.stringify(r.data));
}

head("7) ⚔ B가 'A의 이름으로' 새 할 일을 넣을 수 있나 (거부돼야 정상)");
{
  const r = await call('/rest/v1/todos', {
    method: 'POST', token: B.token, body: { title: '사칭', user_id: A.id }, prefer: 'return=representation',
  });
  if (r.status >= 400) ok('남의 이름으로 못 넣는다', `HTTP ${r.status} — ${r.data?.message ?? 'with check 위반'}`);
  else bad('사칭 삽입이 통과됐다', JSON.stringify(r.data));
}

head('8) ⚔ 로그인 안 한 상태(anon)로 조회 (거부돼야 정상)');
{
  const r = await call('/rest/v1/todos?select=id,title');   // 토큰 없이 publishable 키만
  const n = Array.isArray(r.data) ? r.data.length : -1;
  if (r.status >= 400) ok('anon 은 접근 자체가 거부', `HTTP ${r.status} — ${r.data?.message ?? ''}`);
  else if (n === 0) ok('anon 에게는 아무 행도 안 보인다', `HTTP ${r.status}, 0건`);
  else bad('anon 이 데이터를 읽었다', JSON.stringify(r.data));
}

head('9) 제약이 작동하나 — 빈 제목 / 너무 긴 제목');
{
  const r1 = await call('/rest/v1/rpc/add_todo', { method: 'POST', token: A.token, body: { p_title: '   ' } });
  if (r1.status >= 400) ok('빈 제목 거부', `HTTP ${r1.status} — todos_title_len 제약`);
  else bad('빈 제목이 통과됐다', JSON.stringify(r1.data));

  const r2 = await call('/rest/v1/rpc/add_todo', { method: 'POST', token: A.token, body: { p_title: 'ㄱ'.repeat(300) } });
  if (r2.status >= 400) ok('300자 제목 거부', `HTTP ${r2.status} — todos_title_len 제약`);
  else bad('300자 제목이 통과됐다', JSON.stringify(r2.data));
}

head('10) SQL 주입 시도 — 제목으로만 저장돼야 정상');
{
  const payload = "Robert'); DROP TABLE todos;--";
  const r = await call('/rest/v1/rpc/add_todo', { method: 'POST', token: A.token, body: { p_title: payload } });
  if (r.status !== 200) { bad('주입 테스트 삽입 실패', JSON.stringify(r.data)); }
  else {
    const chk = await call('/rest/v1/todos?select=id,title&order=id.desc&limit=1', { token: A.token });
    const stored = chk.data?.[0]?.title;
    if (stored === payload) ok('주입 문자열이 제목으로만 저장됨', `todos 표는 그대로 살아 있다 (title="${stored}")`);
    else bad('저장 결과가 예상과 다름', JSON.stringify(chk.data));
  }
}

head('11) 정리 — A가 만든 것 삭제 (자기 것은 지워져야 정상)');
{
  const mine = await call('/rest/v1/todos?select=id', { token: A.token });
  const ids = (mine.data ?? []).map(r => r.id);
  const r = await call(`/rest/v1/todos?id=in.(${ids.join(',')})`, {
    method: 'DELETE', token: A.token, prefer: 'return=representation',
  });
  const n = Array.isArray(r.data) ? r.data.length : -1;
  if (n === ids.length && n > 0) ok('A는 자기 것을 지울 수 있다', `${n}건 삭제 (연결 표는 CASCADE)`);
  else bad('A 삭제 이상', `요청 ${ids.length}건 / 삭제 ${n}건`);
}

// ══════════════════════════════════════════════════════════════════
const pass = results.filter(r => r[0] === 'PASS').length;
const fail = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${'═'.repeat(66)}`);
console.log(`  결과: ${pass} PASS / ${fail} FAIL`);
console.log('═'.repeat(66));
if (fail) { console.log('\n  ❌ 실패한 항목이 있다. 정책을 다시 봐야 한다.\n'); process.exit(1); }
console.log('\n  ✅ 여러 사람이 같은 링크를 써도 서로의 할 일에 손댈 수 없다.\n');
