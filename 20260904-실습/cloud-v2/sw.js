// sw.js — Service Worker
//
// 하는 일은 하나다: '앱 껍데기(화면 파일)'를 미리 받아 두고,
// 다음부터는 네트워크 대신 그걸 먼저 준다.
//   → 연결이 느리거나 없어도 앱이 바로 뜬다.
//
// 데이터는 캐시하지 않는다. 할 일 목록은 Supabase에 있고, 그건 최신이어야 하니까.
// 그래서 오프라인이면 껍데기는 뜨지만 목록은 '오프라인' 상태로 표시된다.
//
// ★ 캐시 이름에 버전을 붙인다. 파일을 고치면 이 숫자를 올려야
//   사용자에게 새 화면이 간다. 안 올리면 옛 화면이 계속 나온다.

const CACHE = 'todo-shell-v4';

const SHELL = [
  './',
  './index.html',
  './vendor/supabase.js',   // 라이브러리도 캐시한다. CDN 을 안 쓰므로 이게 필수다.
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

// 설치 — 껍데기를 미리 받아 둔다
self.addEventListener('install', (e) => {
  e.waitUntil(
    // ★ addAll 은 하나만 실패해도 설치 전체가 실패한다.
    //   그러면 Service Worker 가 아예 안 붙어서 오프라인이 통째로 안 된다.
    //   그래서 개별로 넣고 실패는 넘긴다.
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())   // 새 버전을 기다리지 않고 바로 적용
  );
});

// 활성화 — 옛 버전 캐시를 지운다
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Supabase 요청은 절대 캐시하지 않는다.
  // 남의 토큰이 섞이거나 옛 데이터가 보이면 안 되니까.
  if (url.origin !== self.location.origin) return;

  // 화면 문서 — 네트워크 우선, 실패하면 캐시 (오프라인에서도 뜨게)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put('./index.html', res.clone()));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 나머지 정적 파일 — 캐시 우선 (빠르게), 없으면 네트워크
  e.respondWith(
    caches.match(req).then((hit) => hit ?? fetch(req).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    }))
  );
});
