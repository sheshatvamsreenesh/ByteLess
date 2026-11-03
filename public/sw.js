const CACHE_NAME = 'byteless-shell-v1';
const APP_SHELL = '/';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const shell = await fetch(APP_SHELL, { credentials: 'omit' });
    if (!shell.ok) throw new Error('ByteLess app shell could not be cached.');
    const shellType = shell.headers.get('content-type') || '';
    const shellControl = shell.headers.get('cache-control') || '';
    if (shell.type === 'basic' && !shell.headers.get('set-cookie') && !/private|no-store/i.test(shellControl) && shellType.includes('text/html')) {
      await cache.put(APP_SHELL, shell.clone());
    }
    const markup = await shell.clone().text();
    const assets = [...markup.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map(match => match[1]);
    await Promise.all(assets.map(async path => {
      const response = await fetch(path, { credentials: 'omit' });
      const type = response.headers.get('content-type') || '';
      const cacheControl = response.headers.get('cache-control') || '';
      if (response.type === 'basic' && response.ok && !response.headers.get('set-cookie') && !/private|no-store/i.test(cacheControl) && (type.includes('javascript') || type.includes('text/css'))) {
        await cache.put(path, response);
      }
    }));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('byteless-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.match(APP_SHELL)) || Response.error()));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(request).then(async cached => {
      if (cached) return cached;
      const response = await fetch(request, { credentials: 'omit' });
      const type = response.headers.get('content-type') || '';
      const cacheControl = response.headers.get('cache-control') || '';
      const hasCookie = response.headers.get('set-cookie');
      if (response.ok && !hasCookie && !/private|no-store/i.test(cacheControl) && (type.includes('javascript') || type.includes('text/css'))) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    }));
  }
});
