import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the shipped recovery handler with a controllable player and clock.
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const playback = app.slice(app.indexOf('function startPlayback(url)'), app.indexOf('function playbackSnapshot()'));

function player() {
  const elements = new Map();
  const timers = new Map();
  let nextTimer = 0;
  const state = { playGeneration: 1, playing: { id: 'test' } };
  const video = Object.assign(new EventTarget(), { dataset: {}, currentTime: 0, paused: false, seeking: false, readyState: 4, play: () => Promise.resolve() });
  class Hls {
    static Events = { MANIFEST_PARSED: 'manifest', BUFFER_CODECS: 'codecs', FRAG_LOADED: 'loaded', FRAG_BUFFERED: 'buffered', ERROR: 'error' };
    static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
    static ErrorDetails = { MANIFEST_LOAD_ERROR: 'manifestLoadError', MANIFEST_LOAD_TIMEOUT: 'manifestLoadTimeOut', FRAG_LOAD_ERROR: 'fragLoadError' };
    static isSupported() { return true; }
    handlers = new Map(); levels = [{}]; sourceLoads = 0; starts = 0;
    constructor(config) { this.config = config; }
    on(name, handler) { this.handlers.set(name, handler); }
    emit(name, data) { this.handlers.get(name)?.(name, data); }
    loadSource() { this.sourceLoads++; }
    attachMedia() {}
    stopLoad() {}
    startLoad() { this.starts++; }
    recoverMediaError() {}
  }
  const clock = { value: 0, now() { return this.value; } };
  const failures = [];
  const context = vm.createContext({
    state, video, window: { Hls }, performance: clock, AbortController,
    playbackEvents: null, reconnectTimer: null, videoCheckTimer: null,
    $: selector => {
      if (!elements.has(selector)) elements.set(selector, { dataset: {}, classList: { add() {} } });
      return elements.get(selector);
    },
    setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    playbackError: message => failures.push(message),
    offerCompatibleVariant: () => {},
    showPlaybackPlaying: () => { state.playbackPhase = 'playing'; },
  });
  vm.runInContext(playback + '\nstartPlayback("/opaque-test-playlist");', context);
  const error = (detail = Hls.ErrorDetails.FRAG_LOAD_ERROR) => state.hls.emit(Hls.Events.ERROR, { type: Hls.ErrorTypes.NETWORK_ERROR, details: detail, fatal: true });
  const retry = () => { const entry = timers.entries().next().value; assert.ok(entry); timers.delete(entry[0]); entry[1](); };
  return { state, video, clock, Hls, error, retry, failures, timers };
}

test('a segment interruption resumes loading without replacing the source or decoder', () => {
  const p = player(); p.error(); p.retry();
  assert.equal(p.state.hls.sourceLoads, 1);
  assert.equal(p.state.hls.starts, 1);
  assert.equal(p.state.hls.config.preferManagedMediaSource, true);
  assert.deepEqual(p.failures, []);
});

test('an initial manifest failure reloads the manifest and has a finite retry budget', () => {
  const p = player(); p.state.hls.levels = [];
  p.error(p.Hls.ErrorDetails.MANIFEST_LOAD_ERROR); p.retry();
  p.error(p.Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT); p.retry(); p.error();
  assert.equal(p.state.hls.sourceLoads, 3);
  assert.equal(p.failures.length, 1);
  assert.equal(p.timers.size, 0);
});

test('thirty seconds of advancing video renews the retry budget; a seek alone does not', () => {
  const p = player();
  p.error(); p.retry(); p.error(); p.retry();
  p.video.dispatchEvent(new Event('playing'));
  p.video.currentTime = 31; p.clock.value = 31000;
  p.video.dispatchEvent(new Event('timeupdate'));
  p.error(); p.retry();
  assert.equal(p.failures.length, 0);
  assert.equal(p.state.playbackStats.recoveries, 3);
  p.error(); p.retry();
  p.video.dispatchEvent(new Event('seeking'));
  p.video.currentTime = 100; p.clock.value = 62000;
  p.video.dispatchEvent(new Event('seeked'));
  p.video.dispatchEvent(new Event('timeupdate'));
  p.error();
  assert.equal(p.failures.length, 1);
});

test('changing channel prevents a queued recovery from restarting the old source', () => {
  const p = player(); p.error(); p.state.playGeneration++; p.retry();
  assert.equal(p.state.hls.starts, 0);
  assert.equal(p.state.hls.sourceLoads, 1);
});
