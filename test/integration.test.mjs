import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { normalizeProvider, rewriteManifest } from '../lib/provider.mjs';

let provider, app, secureApp, origin, secureOrigin, providerOrigin;
let upstreamClosed = false;
let rotatingPlaylist = 0;
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; };
const post = (base, route, data, cookie, headers = {}) => fetch(`${base}/api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: JSON.stringify(data) });
const login = async (base = origin, overrides = {}) => {
  const response = await post(base, 'connect', { url: providerOrigin, username: 'test-user', password: 'test-password', ...overrides });
  return { response, cookie: response.headers.get('set-cookie')?.split(';')[0], data: await response.json() };
};

before(async () => {
  provider = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/hls/rotating.m3u8') {
      const version = ++rotatingPlaylist;
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.end(`#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:7\n#EXTINF:5,\nsigned.ts?signature=first-${version}\n#EXTINF:5,\nsigned.ts?signature=second-${version}\n`);
    }
    if (url.pathname === '/hls/signed.ts') { res.setHeader('Content-Type', 'video/mp2t'); return res.end(url.searchParams.get('signature')); }
    if (url.pathname === '/player_api.php') {
      res.setHeader('Content-Type', 'application/json');
      if (url.searchParams.get('password') !== 'test-password') return res.end(JSON.stringify({ user_info: { auth: 0 } }));
      const action = url.searchParams.get('action');
      if (action === 'get_live_categories') return res.end(JSON.stringify([{ category_id: '1', category_name: 'Pruebas' }]));
      if (action === 'get_live_streams') return res.end(JSON.stringify([
        { stream_id: 101, name: 'Canal de prueba', category_id: '1', direct_source: 'secret', stream_icon: 'secret' },
        { stream_id: 102, name: '<script>alert(1)</script>', category_id: '1' },
        { stream_id: 103, name: 'Manifest inválido', category_id: '1' },
        { stream_id: 104, name: 'Transmisión larga', category_id: '1' },
        { stream_id: '../unsafe', name: 'Invalid' },
      ]));
      const username = url.searchParams.get('username');
      return res.end(JSON.stringify({ user_info: {
        auth: 1, status: username === 'disabled' ? 'Disabled' : 'Active',
        exp_date: username === 'expired' ? '1' : '0', max_connections: '1', active_cons: '0',
        username, password: 'test-password', allowed_output_formats: ['m3u8', 'ts'],
      }, server_info: { secret: 'not-for-browser' } }));
    }
    if (url.pathname.endsWith('/101.m3u8')) { res.writeHead(302, { Location: '/hls/master.m3u8' }); return res.end(); }
    if (url.pathname.endsWith('/103.m3u8')) { res.setHeader('Content-Type', 'video/mp2t'); return res.end('THIS IS NOT HLS'); }
    if (url.pathname.endsWith('/104.m3u8')) { res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); return res.end('#EXTM3U\n#EXTINF:2,\n/hls/long.ts\n'); }
    if (url.pathname === '/hls/master.m3u8') { res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); return res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\nlevel.m3u8?credential=test-password\n'); }
    if (url.pathname === '/hls/level.m3u8') { res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); return res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin?secret=test-password"\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2,\nsegment.ts\n#EXT-X-ENDLIST\n'); }
    if (url.pathname === '/hls/key.bin') { res.setHeader('Content-Type', 'application/octet-stream'); return res.end(Buffer.alloc(16, 5)); }
    if (url.pathname === '/hls/long.ts') {
      res.setHeader('Content-Type', 'video/mp2t'); res.write('start');
      const timer = setInterval(() => res.write('segment'), 30);
      res.on('close', () => { clearInterval(timer); upstreamClosed = true; }); return;
    }
    if (url.pathname === '/hls/segment.ts' || url.pathname === '/hls/init.mp4') {
      if (req.headers.range) res.writeHead(206, { 'Content-Type': 'video/mp2t', 'Content-Range': 'bytes 0-3/8', 'Accept-Ranges': 'bytes', 'Content-Length': 4 });
      else res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      return res.end(req.headers.range ? 'TEST' : 'TESTDATA');
    }
    res.writeHead(404); res.end();
  });
  providerOrigin = await listen(provider);
  // Private origins are enabled only for this in-process mock, never the normal app.
  app = createApp({ allowPrivate: true, defaultProvider: providerOrigin, freeChannels: [{ id: 'france24-es', name: 'France 24 Español', source: 'https://www.france24.com/es/en-vivo', url: `${providerOrigin}/live/test-user/test-password/101.m3u8` }, { id: 'rotating', name: 'Firmas rotatorias', url: `${providerOrigin}/hls/rotating.m3u8` }] }); origin = await listen(app);
  secureApp = createApp(); secureOrigin = await listen(secureApp);
});
after(async () => {
  for (const server of [app, secureApp, provider]) {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});

test('serves PWA manifest, worker, offline page and correctly sized PNG icons', async () => {
  const root = await (await fetch(origin)).text();
  assert.match(root, /rel="manifest" href="\/manifest.webmanifest"/);
  assert.match(root, /rel="apple-touch-icon"/);
  const response = await fetch(origin + '/manifest.webmanifest');
  assert.match(response.headers.get('content-type'), /application\/manifest\+json/);
  const manifest = await response.json();
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  for (const icon of [...manifest.icons, { src: '/icons/apple-touch-icon.png', sizes: '180x180' }]) {
    const image = await fetch(origin + icon.src);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    const png = Buffer.from(await image.arrayBuffer());
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
  for (const route of ['/sw.js', '/pwa.js', '/offline.html']) {
    const result = await fetch(origin + route);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'no-cache');
  }
});

test('serves the application and locally installed HLS library', async () => {
  for (const route of ['/', '/app.js', '/styles.css', '/vendor/hls.min.js']) {
    const response = await fetch(origin + route); assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  }
  assert.deepEqual(await (await fetch(origin + '/api/session')).json(), { account: null });
  assert.equal((await fetch(origin + '/api/catalog')).status, 401);
});
test('rejects credential-bearing URLs and normalizes API suffixes', () => {
  assert.equal(normalizeProvider('https://example.com:443/xtream/player_api.php').href, 'https://example.com/xtream/');
  for (const url of ['file:///etc/passwd', 'https://user:pass@example.com', 'https://example.com/?password=secret']) assert.throws(() => normalizeProvider(url));
});
test('blocks private upstreams in the normal application', async () => {
  const { response, data } = await login(secureOrigin);
  assert.equal(response.status, 400); assert.match(data.error, /pública/);
});
test('rejects invalid, expired and disabled accounts', async () => {
  assert.equal((await login(origin, { password: 'wrong' })).response.status, 401);
  assert.equal((await login(origin, { username: 'expired' })).response.status, 403);
  assert.equal((await login(origin, { username: 'disabled' })).response.status, 403);
});
test('credentials stay server-side and session cookies have protections', async () => {
  const { response, cookie, data } = await login();
  assert.equal(response.status, 200); assert.ok(cookie); assert.equal(data.account.connections, '1');
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.ok(!JSON.stringify(data).includes('test-password'));
  const catalog = await (await fetch(origin + '/api/catalog', { headers: { cookie } })).json();
  assert.equal(catalog.channels.length, 4);
  assert.ok(!JSON.stringify(catalog).includes('direct_source'));
  assert.ok(!JSON.stringify(catalog).includes('secret'));
  assert.equal((await post(origin, 'play', { channelId: '../secret' }, cookie)).status, 404);
});
test('proxies redirects, nested HLS, encryption keys, init maps and byte ranges without leaking upstream URLs', async () => {
  const { cookie } = await login();
  await fetch(origin + '/api/catalog', { headers: { cookie } });
  const playback = await (await post(origin, 'play', { channelId: '101' }, cookie)).json();
  assert.match(playback.url, /^\/api\/media\/[a-f0-9]{48}\?r=[a-f0-9]{48}$/);
  const master = await (await fetch(origin + playback.url, { headers: { cookie } })).text();
  assert.ok(!master.includes('test-password')); assert.ok(!master.includes('127.0.0.1'));
  const levelPath = master.split('\n').find(line => line.startsWith('/api/media/'));
  const level = await (await fetch(origin + levelPath, { headers: { cookie } })).text();
  const resources = [...level.matchAll(/URI="([^"]+)"/g)].map(match => match[1]);
  assert.equal(resources.length, 2); assert.ok(!level.includes('test-password'));
  const key = await fetch(origin + resources[0], { headers: { cookie } });
  assert.equal((await key.arrayBuffer()).byteLength, 16);
  const segmentPath = level.split('\n').find(line => line.startsWith('/api/media/'));
  const segment = await fetch(origin + segmentPath, { headers: { cookie, Range: 'bytes=0-3' } });
  assert.equal(segment.status, 206); assert.equal(segment.headers.get('content-range'), 'bytes 0-3/8'); assert.equal(await segment.text(), 'TEST');
  const other = await login();
  assert.equal((await fetch(origin + playback.url, { headers: { cookie: other.cookie } })).status, 404);
  await post(origin, 'disconnect', {}, cookie);
  assert.equal((await fetch(origin + playback.url, { headers: { cookie } })).status, 401);
});
test('rejects non-HLS data and unsupported manifest URI schemes', async () => {
  const { cookie } = await login(); await fetch(origin + '/api/catalog', { headers: { cookie } });
  const play = await (await post(origin, 'play', { channelId: '103' }, cookie)).json();
  const response = await fetch(origin + play.url, { headers: { cookie } });
  assert.equal(response.status, 502); assert.match((await response.json()).error, /HLS/);
  assert.throws(() => rewriteManifest('not HLS', 'https://example.com/', () => ''));
  assert.throws(() => rewriteManifest('#EXTM3U\nfile:///private\n', 'https://example.com/', () => ''));
  assert.throws(() => rewriteManifest('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="data:secret"\n', 'https://example.com/', () => ''));
});
test('disconnect aborts active upstream video requests', async () => {
  const { cookie } = await login(); await fetch(origin + '/api/catalog', { headers: { cookie } });
  const play = await (await post(origin, 'play', { channelId: '104' }, cookie)).json();
  const manifest = await (await fetch(origin + play.url, { headers: { cookie } })).text();
  const resource = manifest.split('\n').find(line => line.startsWith('/api/media/'));
  const controller = new AbortController();
  const response = await fetch(origin + resource, { headers: { cookie }, signal: controller.signal });
  const reader = response.body.getReader(); await reader.read();
  await post(origin, 'disconnect', {}, cookie);
  for (let index = 0; index < 30 && !upstreamClosed; index++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(upstreamClosed, true); controller.abort(); await reader.cancel().catch(() => {});
});
test('rejects cross-origin mutations and leaves the session intact', async () => {
  const { cookie } = await login();
  const denied = await post(origin, 'disconnect', {}, cookie, { Origin: 'https://unrelated.example' });
  assert.equal(denied.status, 403);
  const session = await fetch(origin + '/api/session', { headers: { cookie } });
  assert.equal((await session.json()).account.username, 'test-user');
});

test('free live TV works without credentials and stays separate from private account media', async () => {
  const playback = await post(origin, 'free/play', { channelId: 'france24-es' });
  assert.equal(playback.status, 200);
  assert.equal(playback.headers.get('set-cookie'), null);
  const data = await playback.json();
  assert.match(data.url, /^\/api\/free\/media\/[a-f0-9]{48}\?r=[a-f0-9]{48}$/);
  assert.equal(data.channel.name, 'France 24 Español');
  const master = await (await fetch(origin + data.url)).text();
  assert.ok(!master.includes('test-password'));
  const levelPath = master.split('\n').find(line => line.startsWith('/api/free/media/'));
  const level = await (await fetch(origin + levelPath)).text();
  const segmentPath = level.split('\n').find(line => line.startsWith('/api/free/media/'));
  assert.equal(await (await fetch(origin + segmentPath)).text(), 'TESTDATA');
  const keyPath = /URI="([^"]+)"/.exec(level)[1];
  assert.equal((await (await fetch(origin + keyPath)).arrayBuffer()).byteLength, 16);
  assert.equal((await fetch(origin + data.url.replace('/free/media/', '/media/'))).status, 401);
  assert.equal((await fetch(origin + '/api/catalog')).status, 401);
  assert.deepEqual(await (await fetch(origin + '/api/session')).json(), { account: null });
  assert.equal((await post(origin, 'free/play', { channelId: 'http://127.0.0.1/private' })).status, 404);
  assert.equal((await post(origin, 'free/play', { channelId: 'france24-es' }, null, { Origin: 'https://unrelated.example' })).status, 403);
});

test('preserves HLS path identity across query rotation without merging distinct resources', async () => {
  const playback = await (await post(origin, 'free/play', { channelId: 'rotating' })).json();
  const paths = async () => (await (await fetch(origin + playback.url)).text()).split('\n').filter(line => line.startsWith('/api/free/media/'));
  const first = await paths(); const second = await paths();
  const urls = [...first, ...second].map(path => new URL(path, origin));
  assert.ok(urls.every(url => url.pathname === urls[0].pathname));
  assert.equal(new Set(urls.map(url => url.search)).size, 4);
  for (const url of urls) {
    assert.match(url.search, /^\?r=[a-f0-9]{48}$/);
    assert.ok(!url.href.includes('signature'));
  }
  const bodies = await Promise.all(urls.map(async url => (await fetch(url)).text()));
  assert.equal(new Set(bodies).size, 4);
  assert.match(bodies[0], /^first-/); assert.match(bodies[1], /^second-/);
  const wrongPath = new URL(first[0], origin); wrongPath.pathname = new URL(playback.url, origin).pathname;
  assert.equal((await fetch(wrongPath)).status, 404);
  const noResource = new URL(first[0], origin); noResource.search = '';
  assert.equal((await fetch(noResource)).status, 404);
});

test('uses the preconfigured provider when login only supplies credentials', async () => {
  const config = await fetch(origin + '/api/config');
  assert.equal(config.status, 200);
  assert.deepEqual(await config.json(), { providerUrl: providerOrigin });
  const response = await post(origin, 'connect', { username: 'test-user', password: 'test-password' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.account.username, 'test-user');
  assert.ok(!JSON.stringify(result).includes('test-password'));
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const catalog = await fetch(origin + '/api/catalog', { headers: { cookie } });
  assert.equal(catalog.status, 200);
  assert.equal((await catalog.json()).channels.length, 4);
});
