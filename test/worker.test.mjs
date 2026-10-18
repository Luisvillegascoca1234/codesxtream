import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const appAsset = /src="(\/app\.js[^\"]*)"/.exec(html)[1];

function worker() {
  const listeners = new Map();
  const matched = [];
  vm.runInNewContext(source, {
    URL,
    self: { location: { origin: 'https://app.example' }, addEventListener: (name, callback) => listeners.set(name, callback) },
    caches: { open: async () => ({ match: async path => { matched.push(path); return path === appAsset ? 'CURRENT_APP' : 'OLD_UNVERSIONED_APP'; } }) },
    fetch: async () => 'NETWORK',
  });
  const dispatch = path => {
    let response;
    listeners.get('fetch')({ request: { url: `https://app.example${path}`, method: 'GET', mode: 'cors' }, respondWith: promise => { response = promise; } });
    return response;
  };
  return { dispatch, matched };
}

test('worker uses the complete asset version and never falls back to an old unversioned script', async () => {
  const w = worker();
  assert.equal(await w.dispatch(appAsset), 'CURRENT_APP');
  assert.deepEqual(w.matched, [appAsset]);
  assert.equal(w.dispatch('/app.js?v=previous-release'), undefined);
  assert.equal(w.dispatch('/app.js'), undefined);
});

test('worker never caches API requests, including requests with query parameters', () => {
  const w = worker();
  for (const path of ['/api/session', '/api/catalog?type=movies', '/api/catalog?type=series', '/api/series?id=101', '/api/media/opaque?r=secret', '/api/artwork/live/101', '/api/artwork/movies/101', '/api/artwork/series/101']) {
    assert.equal(w.dispatch(path), undefined);
  }
  assert.deepEqual(w.matched, []);
});
