const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const state = { account: null, demo: false, section: 'live', catalogs: {}, catalogLoading: false, channels: [], categories: [], category: 'all', view: 'all', favorites: new Set(), shown: 48, playing: null, playbackUrl: null, playbackFormat: 'hls', playbackPhase: 'idle', playGeneration: 0, catalogGeneration: 0, seriesGeneration: 0, series: null, episodes: [], hls: null, busy: false };
const sections = {
  live: { label: 'TV en vivo', noun: 'canales', all: 'Todos los canales', search: 'Buscar un canal', title: 'Tu TV. A tu manera', description: 'Todos tus canales, un solo lugar. Tú eliges qué ver.', icon: 'tv' },
  movies: { label: 'Películas', noun: 'películas', all: 'Todas las películas', search: 'Buscar una película', title: 'Hoy toca una buena película', description: 'Explora el cine de tu proveedor y elige tu próxima película.', icon: 'film' },
  series: { label: 'Series', noun: 'series', all: 'Todas las series', search: 'Buscar una serie', title: 'Una historia. Muchos capítulos', description: 'Encuentra una serie y elige la temporada y el episodio que quieres ver.', icon: 'series' },
};
const video = $('#video');
let toastTimer;
let videoCheckTimer;
let reconnectTimer;
let playbackEvents;
const artworkFailures = new Set();

function artworkHtml(item, fallback, lazy = true) {
  const source = item?.artwork;
  const valid = typeof source === 'string' && /^\/api\/artwork\/(?:live|movies|series)\/\d+$/.test(source) && !artworkFailures.has(source);
  return `<span class="artwork-fallback">${fallback}</span>${valid ? `<img class="artwork-image" src="${escapeHtml(source)}" alt="" loading="${lazy ? 'lazy' : 'eager'}" decoding="async" referrerpolicy="no-referrer">` : ''}`;
}
function renderPlayingArtwork(item) {
  const avatar = $('#playing-avatar');
  avatar.classList.add('artwork-frame');
  avatar.classList.remove('has-artwork');
  avatar.innerHTML = artworkHtml(item, item ? escapeHtml(item.free ? '24' : initials(item.name)) : icon('tv'), false);
}
document.addEventListener('load', event => {
  const image = event.target;
  if (image.matches?.('.artwork-image')) image.parentElement.classList.add('has-artwork');
}, true);
document.addEventListener('error', event => {
  const image = event.target;
  if (!image.matches?.('.artwork-image')) return;
  artworkFailures.add(image.getAttribute('src'));
  image.parentElement.classList.remove('has-artwork'); image.remove();
}, true);

async function api(path, data) {
  let response;
  try { response = await fetch(`/api/${path}`, data === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); }
  catch { throw new Error('No se pudo conectar con la app local. Comprueba que el servidor sigue abierto en tu PC.'); }
  let result;
  try { result = await response.json(); } catch { throw new Error('El servidor no devolvió una respuesta válida.'); }
  if (!response.ok) {
    if (response.status === 401 && path !== 'connect' && state.account) {
      stopPlayback(); state.account = null; resetCatalog(); loadFavorites(); renderConnection(); renderChannels();
      $('#refresh-button').disabled = false;
      openConnect();
    }
    throw new Error(result.error || 'No se pudo completar la solicitud.');
  }
  return result;
}

function toast(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}
function favoritesKey() {
  const scope = state.demo ? 'demo' : state.account ? `${state.account.provider}/${state.account.username}` : 'none';
  let hash = 2166136261;
  for (const char of scope) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `xtremeville:favorites:${(hash >>> 0).toString(16)}${state.section === 'live' ? '' : `:${state.section}`}`;
}
function loadFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem(favoritesKey()) || '[]');
    state.favorites = new Set(Array.isArray(saved) ? saved.filter(id => typeof id === 'string') : []);
  } catch { state.favorites = new Set(); }
  $('#favorite-count').textContent = state.favorites.size;
}
function toggleFavorite(id) {
  if (!state.channels.some(c => c.id === id)) return;
  if (state.favorites.has(id)) state.favorites.delete(id); else state.favorites.add(id);
  try { localStorage.setItem(favoritesKey(), JSON.stringify([...state.favorites])); } catch { /* Keep favorites in memory if storage is unavailable. */ }
  $('#favorite-count').textContent = state.favorites.size; renderChannels();
}
function initials(name) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'TV'; }
function categoryName(id) { return state.categories.find(category => category.id === id)?.name || sections[state.section].label; }
function openConnect() {
  $('#connect-error').hidden = true;
  if (!$('#connect-dialog').open) $('#connect-dialog').showModal();
}
function renderProviderPreset() {
  const url = $('#provider-url').value.trim();
  $('#provider-display').textContent = url;
  $('#transport-note').textContent = url.startsWith('https://')
    ? 'Las credenciales se envían al proveedor por HTTPS. No se guardan en archivos.'
    : 'Este servidor usa HTTP: las credenciales viajan sin cifrar hasta el proveedor. No se guardan en archivos.';
}
function renderConnection() {
  const account = state.account;
  $('#connection-status').classList.toggle('connected', Boolean(account));
  $('#connection-status span:last-child').textContent = account ? 'Proveedor conectado' : state.demo ? 'Explorando un ejemplo' : 'Sin proveedor conectado';
  $('#connection-title').innerHTML = account ? escapeHtml(account.provider) : 'Tu cuenta.<br> Tu contenido.';
  $('#connection-description').textContent = account ? `Sesión de ${account.username}. Explora tu TV, películas y series.` : 'Usa los datos que te entregó tu proveedor Xtream Codes para cargar tu contenido.';
  $('#connection-details').hidden = !account;
  if (account) {
    const expiry = account.expires ? new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(account.expires) : 'No informado';
    $('#connection-details').innerHTML = [['Estado', account.status], ['Vencimiento', expiry], ['Conexiones máx.', account.connections || 'No informado'], ['Conexiones al entrar', account.activeConnections || '0'], ['Origen', account.transport]].map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
  }
  $('#connect-button').innerHTML = `${account ? 'Cambiar proveedor' : 'Iniciar sesión'}${icon('arrow')}`;
  $('#disconnect-button').hidden = !account;
  $('#account-button').textContent = account ? initials(account.username) : 'XV';
  $('#player-connect').textContent = account ? 'Elegir contenido ↓' : 'Iniciar sesión →';
}
function renderCategories() {
  $('#categories').innerHTML = [{ id: 'all', name: sections[state.section].all }, ...state.categories].map(category => `<button class="category${state.category === category.id ? ' active' : ''}" data-category="${escapeHtml(category.id)}" aria-pressed="${state.category === category.id}">${escapeHtml(category.name)}</button>`).join('');
}
function renderChannels() {
  const section = sections[state.section];
  const query = $('#search').value.trim().toLocaleLowerCase('es');
  const channels = state.channels.filter(channel =>
    (state.category === 'all' || channel.category === state.category) &&
    (state.view !== 'favorites' || state.favorites.has(channel.id)) &&
    (!query || channel.name.toLocaleLowerCase('es').includes(query)));
  $('#channel-count').textContent = state.catalogLoading ? '…' : channels.length;
  $('#favorite-count').textContent = state.favorites.size;
  const hasChannels = channels.length > 0;
  $('#channel-grid').hidden = state.catalogLoading || !hasChannels;
  $('#empty-state').hidden = state.catalogLoading || hasChannels;
  $('#load-more').hidden = state.catalogLoading || channels.length <= state.shown;
  const tones = ['green', 'amber', 'blue', 'rose'];
  $('#channel-grid').classList.toggle('vod-grid', state.section !== 'live');
  $('#channel-grid').innerHTML = channels.slice(0, state.shown).map((channel, index) => {
    const fallback = state.section === 'live' ? escapeHtml(initials(channel.name)) : `${icon(section.icon)}<span>${escapeHtml(initials(channel.name))}</span>`;
    return `<article class="channel-card${state.playing?.id === channel.id && (state.playing.kind || 'live') === state.section ? ' selected' : ''}">
      <button class="channel-select" data-play="${escapeHtml(channel.id)}" aria-label="${escapeHtml(`${state.section === 'series' ? 'Ver episodios de' : 'Ver'} ${channel.name}`)}"></button>
      <span class="channel-number">${state.section === 'live' ? String(index + 1).padStart(2, '0') : state.section === 'series' ? 'SERIE' : 'PELÍCULA'}</span>
      <div class="channel-avatar artwork-frame tone-${tones[index % 4]}" aria-hidden="true">${artworkHtml(channel, fallback)}</div>
      <div class="channel-text"><strong>${escapeHtml(channel.name)}</strong><span>${escapeHtml([categoryName(channel.category), channel.year, channel.rating ? `★ ${channel.rating}` : ''].filter(Boolean).join(' · '))}</span>${state.section === 'series' ? '<small>Ver temporadas y episodios →</small>' : ''}</div>
      <button class="icon-button channel-favorite${state.favorites.has(channel.id) ? ' is-favorite' : ''}" data-favorite="${escapeHtml(channel.id)}" aria-label="${escapeHtml(`${state.favorites.has(channel.id) ? 'Quitar de' : 'Añadir a'} favoritos: ${channel.name}`)}" aria-pressed="${state.favorites.has(channel.id)}">${icon('heart')}</button>
    </article>`;
  }).join('');
  const noConnection = !state.account && !state.demo;
  $('#empty-state h3').textContent = noConnection ? 'Tu contenido está por llegar' : state.view === 'favorites' && !state.favorites.size ? 'Tus favoritos van aquí' : state.channels.length ? 'No encontramos resultados' : `No hay ${section.noun} disponibles`;
  $('#empty-state>p').innerHTML = noConnection ? 'Conecta tu cuenta para ver el contenido disponible.<br>O explora la interfaz con un catálogo de ejemplo.' : state.view === 'favorites' && !state.favorites.size ? 'Toca el corazón de un título para encontrarlo aquí.' : state.channels.length ? 'Prueba otra búsqueda o cambia de categoría.' : 'Actualiza el catálogo o consulta la disponibilidad con tu proveedor.';
  $('.empty-actions').hidden = !noConnection;
  $('#catalog-title').firstChild.textContent = state.view === 'favorites' ? `${section.label} · Favoritos ` : `Explora tus ${section.noun} `;
  $('#catalog-description').textContent = state.demo ? 'Catálogo ficticio para explorar la interfaz. No es contenido real.' : state.section === 'series' ? 'Abre una serie para elegir temporada y episodio.' : 'Un mundo por descubrir, a un clic de distancia.';
  $('#load-more').textContent = `Mostrar más ${section.noun}`;
}
function setView(view) {
  state.view = view; state.shown = 48;
  $('#mobile-favorites').classList.toggle('active', view === 'favorites');
  $('#mobile-favorites').setAttribute('aria-pressed', String(view === 'favorites'));
  $$('.nav-item[data-view]').forEach(button => { button.classList.toggle('active', button.dataset.view === view); button.setAttribute('aria-pressed', String(button.dataset.view === view)); });
  $$('[data-section]').forEach(button => { button.classList.toggle('active', button.dataset.section === state.section && (view !== 'favorites' || !button.classList.contains('nav-item'))); button.setAttribute('aria-pressed', String(button.dataset.section === state.section)); });
  const section = sections[state.section];
  $('#breadcrumb-view').textContent = `${section.label}${view === 'favorites' ? ' / Favoritos' : ''}`;
  $('#page-title').innerHTML = view === 'favorites' ? 'Siempre a mano<span>.</span>' : `${section.title}<span>.</span>`;
  $('#page-description').textContent = section.description;
  $('#search').placeholder = `${section.search}…`; $('#search').setAttribute('aria-label', section.search);
  $('#display-label').textContent = `VISTA DE ${section.noun.toLocaleUpperCase('es')}`;
  $('.free-live-card').hidden = state.section !== 'live';
  renderChannels();
}
function setSection(section) {
  if (!sections[section]) return;
  if (section === state.section) { setView('all'); return; }
  ++state.catalogGeneration; closeSeries();
  $('#playback-suggestion').hidden = true;
  state.section = section; state.channels = []; state.categories = []; state.category = 'all'; state.shown = 48;
  setCatalogLoading(false);
  $('#search').value = ''; $('#refresh-button').disabled = false; message('');
  loadFavorites(); setView('all'); renderCategories();
  if (state.demo) enterDemo();
  else if (state.catalogs[section]) {
    state.channels = state.catalogs[section].channels; state.categories = state.catalogs[section].categories;
    renderCategories(); renderChannels();
  } else if (state.account) loadCatalog();
}
function message(text, error = false) {
  const element = $('#catalog-message'); element.classList.toggle('error', error); element.textContent = text; element.hidden = !text;
}
function setCatalogLoading(loading) {
  state.catalogLoading = loading;
  $('#catalog-loading').hidden = !loading;
  $('#catalog-loading-text').textContent = `Cargando tus ${sections[state.section].noun}…`;
  $('#catalog-content').setAttribute('aria-busy', String(loading));
  $('#refresh-button').disabled = loading;
  $('#search').disabled = loading;
  $$('#categories button').forEach(button => { button.disabled = loading; });
  const skeleton = $('#catalog-skeleton');
  skeleton.hidden = !loading;
  skeleton.classList.toggle('vod-grid', state.section !== 'live');
  skeleton.innerHTML = loading ? Array.from({ length: 8 }, () => '<div class="skeleton-card"><span class="skeleton-art skeleton-block"></span><div class="skeleton-copy"><span class="skeleton-line skeleton-block"></span><span class="skeleton-line short skeleton-block"></span></div></div>').join('') : '';
  renderChannels();
}
function resetCatalog() {
  ++state.catalogGeneration;
  closeSeries(); state.catalogs = {};
  artworkFailures.clear();
  state.channels = []; state.categories = []; state.category = 'all'; state.shown = 48; state.demo = false;
  setCatalogLoading(false);
  $('#search').value = ''; message(''); renderCategories(); renderChannels();
}
async function loadCatalog() {
  const generation = ++state.catalogGeneration;
  const account = state.account;
  const section = state.section;
  artworkFailures.clear();
  message(''); setCatalogLoading(true);
  try {
    const catalog = await api(`catalog?type=${section}`);
    if (generation !== state.catalogGeneration || account !== state.account) return;
    state.catalogs[section] = catalog; state.channels = catalog.channels; state.categories = catalog.categories;
    state.category = 'all'; state.shown = 48; message(''); renderCategories(); renderChannels();
    if (!catalog.channels.length) message(`La cuenta está conectada, pero el proveedor devolvió una lista vacía de ${sections[section].noun}.`);
  } catch (error) { if (generation === state.catalogGeneration) message(error.message, true); }
  finally { if (generation === state.catalogGeneration) setCatalogLoading(false); }
}
function setConnecting(busy) {
  state.busy = busy;
  $('#connect-submit').disabled = busy;
  $('#connect-submit').innerHTML = busy ? '<span class="spinner"></span>Comprobando tu cuenta…' : `Entrar y cargar contenido${icon('arrow')}`;
  $('#connect-form [data-close]').disabled = busy;
  $$('#connect-form input').forEach(input => { input.readOnly = busy; });
}
$('#connect-form').addEventListener('submit', async event => {
  event.preventDefault(); if (state.busy) return;
  $('#connect-error').hidden = true; setConnecting(true);
  try {
    const data = { url: $('#provider-url').value.trim(), username: $('#provider-user').value.trim(), password: $('#provider-password').value };
    const result = await api('connect', data);
    stopPlayback(); resetCatalog(); state.account = result.account; state.demo = false;
    loadFavorites(); renderConnection(); renderChannels();
    $('#connect-dialog').close(); $('#connect-form').reset(); renderProviderPreset();
    toast('Cuenta conectada. Preparando tu catálogo.');
    await loadCatalog();
  } catch (error) {
    $('#connect-error').textContent = error.message; $('#connect-error').hidden = false;
  } finally { setConnecting(false); }
});
$('#connect-dialog').addEventListener('cancel', event => { if (state.busy) event.preventDefault(); });
$('#provider-url').addEventListener('input', renderProviderPreset);
$('#provider-url').addEventListener('invalid', () => { $('#provider-settings').open = true; });
$('#connect-dialog').addEventListener('close', () => { $('#provider-password').value = ''; $('#provider-password').type = 'password'; $('#toggle-password').setAttribute('aria-pressed', 'false'); $('#toggle-password').setAttribute('aria-label', 'Mostrar contraseña'); });
$('#toggle-password').addEventListener('click', () => {
  const visible = $('#provider-password').type === 'password'; $('#provider-password').type = visible ? 'text' : 'password';
  $('#toggle-password').setAttribute('aria-pressed', String(visible)); $('#toggle-password').setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
});
function stopPlayback() {
  ++state.playGeneration;
  playbackEvents?.abort(); playbackEvents = null;
  clearTimeout(videoCheckTimer);
  clearTimeout(reconnectTimer);
  state.playbackPhase = 'idle'; state.playbackUrl = null;
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  video.pause(); video.removeAttribute('src'); video.load(); video.hidden = true;
  delete video.dataset.playbackEngine; delete video.dataset.videoCodec;
  state.playing = null;
  $('#player-screen').classList.remove('has-video'); $('#player-placeholder').hidden = false;
  $('#player-loading').hidden = true; $('#playback-error').hidden = true;
  $('#playback-suggestion').hidden = true;
  $('#stop-button').disabled = true; $('#fullscreen-button').disabled = true;
  $('#free-live-button').setAttribute('aria-pressed', 'false');
  $('#playing-name').textContent = 'Nada en reproducción'; $('#playing-detail').textContent = 'Elige qué ver para comenzar';
  renderPlayingArtwork(null); renderChannels();
  $('#player-badge').textContent = 'LISTO PARA REPRODUCIR';
  video.setAttribute('aria-label', 'Reproductor de contenido');
}
function playbackError(text) {
  clearTimeout(reconnectTimer);
  state.playbackPhase = 'error';
  $('#player-loading').hidden = true;
  delete $('#playback-error').dataset.kind;
  $('#playback-error').textContent = text;
  if (state.playing) {
    $('#playing-detail').textContent = 'Reproducción interrumpida';
    const retry = document.createElement('button');
    retry.type = 'button'; retry.className = 'button button-secondary';
    retry.dataset.retryPlayback = ''; retry.textContent = 'Reintentar';
    $('#playback-error').append(retry);
  }
  $('#playback-error').hidden = false;
}
function retryPlayback() {
  const channel = state.playing;
  const url = state.playbackUrl;
  const format = state.playbackFormat;
  if (!channel) return;
  if (!url) {
    if (channel.free) $('#free-live-button').click();
    else playItem(channel);
    return;
  }
  stopPlayback(); state.playing = channel;
  $('#playing-name').textContent = channel.name;
  renderPlayingArtwork(channel);
  $('#playing-detail').textContent = 'Preparando conexión…';
  if (channel.free) $('#free-live-button').setAttribute('aria-pressed', 'true');
  renderChannels(); startPlayback(url, format);
}
$('#playback-error').addEventListener('click', event => { if (event.target.closest('[data-retry-playback]')) retryPlayback(); });
function offerCompatibleVariant() {
  if (!state.playing || state.demo || state.playing.free || state.section !== 'live' || (state.playing.kind && state.playing.kind !== 'live')) return;
  const baseName = name => name.toLocaleLowerCase('es').replace(/\s*[-·]?\s*h\.?264\b/gi, '').replace(/\s+/g, ' ').trim();
  const base = baseName(state.playing.name);
  const alternative = state.channels.find(channel => channel.id !== state.playing.id && /h\.?264\b/i.test(channel.name) && baseName(channel.name) === base);
  if (!alternative) return;
  $('#alternative-button').dataset.channel = alternative.id;
  $('#playback-suggestion').hidden = false;
}
$('#alternative-button').addEventListener('click', event => playChannel(event.currentTarget.dataset.channel));
function startPlayback(url, format = 'hls') {
  const generation = state.playGeneration;
  let networkRecoveries = 0;
  let mediaRecoveries = 0;
  let stableSince = null;
  let stablePosition = 0;
  playbackEvents?.abort(); playbackEvents = new AbortController();
  const eventOptions = { signal: playbackEvents.signal };
  const stats = state.playbackStats = { stalls: 0, recoveries: 0, sourceReloads: 0, lastError: null, lastSegmentMs: null, hasPlayed: false };
  video.addEventListener('playing', () => {
    stats.hasPlayed = true;
    stableSince = performance.now(); stablePosition = video.currentTime;
  }, eventOptions);
  video.addEventListener('waiting', () => {
    if (stats.hasPlayed && !video.paused) stats.stalls++;
    stableSince = null;
  }, eventOptions);
  for (const event of ['pause', 'seeking']) video.addEventListener(event, () => { stableSince = null; }, eventOptions);
  video.addEventListener('seeked', () => {
    if (!video.paused && video.readyState >= 3) { stableSince = performance.now(); stablePosition = video.currentTime; }
  }, eventOptions);
  video.addEventListener('timeupdate', () => {
    if (stableSince === null || video.paused || video.seeking || video.readyState < 3) return;
    if (performance.now() - stableSince >= 30000 && video.currentTime - stablePosition >= 25) {
      networkRecoveries = 0; mediaRecoveries = 0;
      stableSince = performance.now(); stablePosition = video.currentTime;
    }
  }, eventOptions);
  state.playbackUrl = url; state.playbackFormat = format; state.playbackPhase = 'opening';
  $('#player-badge').textContent = state.playing?.kind === 'movies' ? 'PELÍCULA' : state.playing?.kind === 'episode' ? 'SERIE · EPISODIO' : state.playing?.id === 'demo-video' ? 'VIDEO DE PRUEBA' : 'TV EN VIVO';
  video.setAttribute('aria-label', `Reproductor: ${state.playing?.name || 'video'}`);
  $('#player-loading > span:last-child').textContent = 'Abriendo transmisión…';
  video.hidden = false; $('#player-placeholder').hidden = true; $('#player-screen').classList.add('has-video'); $('#player-loading').hidden = false;
  $('#stop-button').disabled = false; $('#fullscreen-button').disabled = false;
  const play = () => {
    if (generation !== state.playGeneration) return;
    video.play().catch(error => {
      if (generation !== state.playGeneration || error.name === 'AbortError') return;
      playbackError(error.name === 'NotAllowedError' ? 'Toca el botón de reproducción del video para empezar.' : 'No se pudo iniciar el video. El formato o los códecs del proveedor pueden no ser compatibles con tu dispositivo.');
    });
  };
  const recover = (action, label, delay) => {
    clearTimeout(reconnectTimer); clearTimeout(videoCheckTimer);
    state.playbackPhase = 'recovering';
    $('#playback-error').hidden = true;
    $('#player-loading > span:last-child').textContent = label;
    $('#player-loading').hidden = false;
    $('#playing-detail').textContent = label;
    reconnectTimer = setTimeout(() => {
      if (generation !== state.playGeneration || !state.playing) return;
      action();
    }, delay);
  };
  // Native HLS can accept HEVC-in-TS but silently play only its AAC track.
  // The full hls.js build transmuxes HEVC into MP4 for MSE/ManagedMediaSource.
  if (format !== 'hls') {
    video.disableRemotePlayback = false;
    video.dataset.playbackEngine = 'native-file';
    video.src = url; video.load(); play();
  } else if (window.Hls?.isSupported()) {
    video.disableRemotePlayback = Boolean(window.ManagedMediaSource);
    video.dataset.playbackEngine = 'hls.js';
    const hls = new window.Hls({ enableWorker: true, preferManagedMediaSource: true, backBufferLength: 30, manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 2, fragLoadingMaxRetry: 2 });
    state.hls = hls; hls.loadSource(url); hls.attachMedia(video);
    hls.on(window.Hls.Events.MANIFEST_PARSED, play);
    hls.on(window.Hls.Events.BUFFER_CODECS, (_event, data) => {
      if (generation === state.playGeneration) video.dataset.videoCodec = data.video?.codec || '';
    });
    hls.on(window.Hls.Events.FRAG_LOADED, (_event, data) => {
      const segmentStats = data.part?.stats || data.frag?.stats;
      const duration = segmentStats?.loading?.end - segmentStats?.loading?.start;
      if (Number.isFinite(duration) && duration >= 0) stats.lastSegmentMs = Math.round(duration);
    });
    hls.on(window.Hls.Events.FRAG_BUFFERED, () => {
      if (stableSince === null && !video.paused && !video.seeking && video.readyState >= 3) {
        stableSince = performance.now(); stablePosition = video.currentTime;
        if (state.playbackPhase === 'recovering') showPlaybackPlaying();
      }
    });
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      // Keep only bounded, non-sensitive diagnostics; error messages may contain URLs.
      if (generation !== state.playGeneration) return;
      if (Object.values(window.Hls.ErrorDetails).includes(data.details)) stats.lastError = data.details;
      if (data.details === window.Hls.ErrorDetails.LEVEL_PARSING_ERROR) offerCompatibleVariant();
      if (!data.fatal || generation !== state.playGeneration) return;
      stableSince = null;
      hls.stopLoad();
      let explanation = 'La transmisión se interrumpió. Elige el canal otra vez para reconectar.';
      if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
        if (networkRecoveries < 2) {
          networkRecoveries++;
          stats.recoveries++;
          const reloadManifest = !hls.levels.length || [window.Hls.ErrorDetails.MANIFEST_LOAD_ERROR, window.Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT].includes(data.details);
          recover(() => {
            // loadSource recreates MediaSource and discards buffered video.
            // A loaded playlist/segment can resume without resetting the decoder.
            if (reloadManifest) { stats.sourceReloads++; hls.loadSource(url); }
            hls.startLoad(-1);
          }, `Reconectando señal (${networkRecoveries}/2)…`, networkRecoveries * 1500);
          return;
        }
        const causes = {
          manifestLoadError: 'No se pudo abrir la señal del canal.',
          manifestLoadTimeOut: 'El servidor tardó demasiado en abrir la señal.',
          levelLoadError: 'El proveedor dejó de actualizar la transmisión.',
          levelLoadTimeOut: 'La actualización de la transmisión tardó demasiado.',
          levelParsingError: 'El proveedor devolvió una actualización inconsistente de la señal.',
          fragLoadError: 'No se pudo descargar un segmento del video.',
          fragLoadTimeOut: 'La descarga de un segmento del video agotó el tiempo de espera.',
          keyLoadError: 'No se pudo obtener la clave de esta transmisión.',
          keyLoadTimeOut: 'La clave de la transmisión tardó demasiado en llegar.',
        };
        const rawStatus = data.response?.code ?? data.networkDetails?.status;
        const status = Number(rawStatus);
        const http = Number.isInteger(status) && status >= 400 && status <= 599 ? ` HTTP ${status}.` : '';
        explanation = `${causes[data.details] || 'Se perdió la conexión con la señal.'}${http} Se intentó reconectar dos veces. Puedes reintentar o elegir otra variante del canal.`;
        try {
          const upstream = typeof data.response?.data === 'string' ? JSON.parse(data.response.data) : data.response?.data;
          if (typeof upstream?.error === 'string') explanation = `${upstream.error} Puedes reintentar la reproducción.`;
        } catch { /* Never display raw upstream responses or URLs. */ }
      } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
        if (mediaRecoveries < 1) {
          mediaRecoveries++;
          stats.recoveries++;
          recover(() => hls.recoverMediaError(), 'Recuperando reproductor…', 750);
          return;
        }
        explanation = 'No se pudo recuperar el audio o video de esta señal. Reintenta o prueba otra variante del canal.';
      }
      playbackError(explanation);
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.disableRemotePlayback = false;
    video.dataset.playbackEngine = 'native';
    video.src = url; video.load(); play();
  } else playbackError('Este navegador no puede reproducir HLS. Prueba Safari en iPhone o un navegador de escritorio actualizado.');
}
function playbackSnapshot() {
  if (!state.playing || !state.playbackStats) return null;
  let bufferSeconds = 0;
  for (let index = 0; index < video.buffered.length; index++) {
    if (video.buffered.start(index) <= video.currentTime && video.buffered.end(index) > video.currentTime) bufferSeconds = video.buffered.end(index) - video.currentTime;
  }
  const quality = video.getVideoPlaybackQuality?.();
  return { engine: video.dataset.playbackEngine, width: video.videoWidth, height: video.videoHeight, bufferSeconds: Math.round(bufferSeconds * 10) / 10, totalFrames: quality?.totalVideoFrames ?? null, droppedFrames: quality?.droppedVideoFrames ?? null, ...state.playbackStats };
}
async function playChannel(channelId) {
  const channel = state.channels.find(c => c.id === channelId); if (!channel) return;
  if (state.section === 'series') return openSeries(channel);
  if (state.demo) { toast('Este título es ficticio. Usa “Probar video” para comprobar el reproductor.'); return; }
  return playItem({ ...channel, kind: state.section, detail: categoryName(channel.category) });
}
async function playItem(channel) {
  stopPlayback(); state.playing = channel;
  const generation = state.playGeneration;
  $('#playing-name').textContent = channel.name; $('#playing-detail').textContent = 'Preparando reproducción…';
  renderPlayingArtwork(channel); $('#player-loading').hidden = false; $('#stop-button').disabled = false; renderChannels();
  try {
    const result = await api('play', { channelId: channel.id, type: channel.kind || 'live', seriesId: channel.seriesId }); if (generation !== state.playGeneration) return;
    startPlayback(result.url, result.format);
    if (matchMedia('(max-width: 760px)').matches) $('#player-screen').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { if (generation === state.playGeneration) playbackError(error.message); }
}
function closeSeries() {
  ++state.seriesGeneration; state.series = null; state.episodes = [];
  setSeriesLoading(false);
  if ($('#series-dialog').open) $('#series-dialog').close();
}
function setSeriesLoading(loading) {
  $('#series-loading').hidden = !loading;
  $('#series-content').setAttribute('aria-busy', String(loading));
}
async function openSeries(series) {
  const generation = ++state.seriesGeneration;
  state.series = series; state.episodes = [];
  $('#series-title').textContent = series.name;
  $('#series-plot').textContent = '';
  $('#series-status').textContent = '';
  $('#series-status').classList.remove('error'); $('#series-status').hidden = true;
  setSeriesLoading(true);
  $('#series-retry').hidden = true;
  $('#season-field').hidden = true; $('#episode-list').replaceChildren();
  if (!$('#series-dialog').open) $('#series-dialog').showModal();
  try {
    const result = state.demo ? { plot: 'Serie ficticia para explorar temporadas y episodios.', episodes: [1, 2].flatMap(season => [1, 2, 3].map(number => ({ id: `demo-${season}-${number}`, name: `Episodio ${number}`, season: String(season), number: String(number), kind: 'episode' }))) } : await api(`series?id=${encodeURIComponent(series.id)}`);
    if (generation !== state.seriesGeneration) return;
    state.episodes = result.episodes;
    $('#series-plot').textContent = result.plot;
    const seasons = [...new Set(result.episodes.map(episode => episode.season))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    $('#season-select').innerHTML = seasons.map(season => `<option value="${escapeHtml(season)}">${season === '0' ? 'Especiales' : `Temporada ${escapeHtml(season)}`}</option>`).join('');
    $('#season-field').hidden = !seasons.length;
    $('#series-status').hidden = Boolean(result.episodes.length);
    $('#series-status').textContent = 'No hay episodios disponibles para esta serie.';
    renderEpisodes();
  } catch (error) {
    if (generation !== state.seriesGeneration) return;
    $('#series-status').textContent = error.message; $('#series-status').classList.add('error');
    $('#series-status').hidden = false;
    $('#series-retry').hidden = false;
  } finally { if (generation === state.seriesGeneration) setSeriesLoading(false); }
}
function renderEpisodes() {
  const episodes = state.episodes.filter(episode => episode.season === $('#season-select').value).sort((a, b) => a.number.localeCompare(b.number, 'es', { numeric: true }));
  $('#episode-list').innerHTML = episodes.map(episode => `<button class="episode-button" data-episode="${escapeHtml(episode.id)}">${icon('play')}<span><strong>${escapeHtml(episode.name)}</strong><small>Episodio ${escapeHtml(episode.number || '—')}${episode.duration ? ` · ${escapeHtml(episode.duration)}` : ''}</small></span>${icon('arrow')}</button>`).join('');
}
$('#season-select').addEventListener('change', renderEpisodes);
$('#series-retry').addEventListener('click', () => { if (state.series) openSeries(state.series); });
$('#series-dialog').addEventListener('close', () => { ++state.seriesGeneration; state.series = null; state.episodes = []; setSeriesLoading(false); });
$('#episode-list').addEventListener('click', event => {
  const button = event.target.closest('[data-episode]');
  const episode = state.episodes.find(item => item.id === button?.dataset.episode);
  if (!episode) return;
  if (state.demo) { toast('Este episodio es ficticio. Usa “Probar video” para comprobar el reproductor.'); return; }
  const series = state.series;
  const item = { ...episode, name: `${series.name} · ${episode.name}`, artwork: series.artwork, detail: `Temporada ${episode.season} · Episodio ${episode.number || '—'}` };
  closeSeries(); playItem(item);
});
function showPlaybackPlaying() {
  clearTimeout(videoCheckTimer);
  state.playbackPhase = 'playing';
  $('#player-loading > span:last-child').textContent = 'Abriendo transmisión…';
  $('#player-loading').hidden = true; $('#playback-error').hidden = true;
  $('#playing-detail').textContent = state.playing?.free ? 'Señal pública · En vivo · Sin cuenta Xtream' : state.playing?.id === 'demo-video' ? 'Video público de prueba · Big Buck Bunny · No es TV en vivo' : `${state.playing?.detail || 'TV en vivo'} · En reproducción`;
  const generation = state.playGeneration;
  const startedAt = video.currentTime;
  videoCheckTimer = setTimeout(() => {
    if (generation !== state.playGeneration || video.paused || video.videoWidth > 0 || video.currentTime - startedAt < 3) return;
    playbackError('Se recibe audio, pero no se ha podido mostrar imagen. Este contenido puede necesitar un formato que tu navegador no admite. Prueba otra versión y verifica que tu navegador esté actualizado.');
    $('#playback-error').dataset.kind = 'missing-video';
  }, 12000);
}
video.addEventListener('playing', showPlaybackPlaying);
video.addEventListener('resize', () => {
  if (!video.videoWidth) return;
  clearTimeout(videoCheckTimer);
  if ($('#playback-error').dataset.kind === 'missing-video') { $('#playback-error').hidden = true; state.playbackPhase = 'playing'; }
});
video.addEventListener('waiting', () => {
  if (state.playing && !['error', 'idle'].includes(state.playbackPhase)) $('#player-loading').hidden = false;
});
video.addEventListener('pause', () => { clearTimeout(videoCheckTimer); $('#player-loading').hidden = true; });
video.addEventListener('ended', () => { $('#player-loading').hidden = true; $('#playing-detail').textContent = 'La reproducción terminó'; });
video.addEventListener('error', () => {
  if (video.dataset.playbackEngine === 'native-file' && state.playing) playbackError('No se pudo reproducir este archivo. Comprueba la conexión; formatos como MKV o sus códecs pueden no ser compatibles con este navegador.');
  if (video.dataset.playbackEngine === 'native' && state.playing) playbackError('El reproductor del navegador no pudo continuar con esta señal. Reintenta o prueba otra variante del canal.');
});
$('#stop-button').addEventListener('click', stopPlayback);
$('#fullscreen-button').addEventListener('click', async () => {
  try {
    if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    else if (video.requestFullscreen) await video.requestFullscreen();
    else toast('Usa el control de pantalla completa del reproductor.');
  } catch { toast('Usa el control de pantalla completa del reproductor.'); }
});
function enterDemo() {
  stopPlayback(); resetCatalog(); state.demo = true;
  state.categories = ['Deportes', 'Noticias', 'Cultura', 'Cine', 'Música', 'Naturaleza'].map((name, index) => ({ id: String(index + 1), name }));
  state.channels = [['Arena Sports', '1'], ['Mundo Noticias', '2'], ['Horizonte', '3'], ['Cinema Club', '4'], ['Ritmo Live', '5'], ['Planeta Verde', '6'], ['Deporte Central', '1'], ['Actual 24', '2'], ['Atlas Cultural', '3'], ['Sesión de Cine', '4'], ['Sonora', '5'], ['Tierra Abierta', '6']].map(([name, category], index) => ({ id: `demo-${index}`, name, category }));
  if (state.section !== 'live') {
    state.categories = ['Aventura', 'Drama', 'Comedia'].map((name, index) => ({ id: String(index + 1), name }));
    state.channels = (state.section === 'movies' ? ['Rumbo al horizonte', 'La última estación', 'Un verano diferente', 'Más allá del mapa', 'Luces de la ciudad', 'Plan de domingo'] : ['Rutas cruzadas', 'Los días del norte', 'Vecinos de siempre', 'Tierra adentro', 'La casa del lago', 'Una nueva semana']).map((name, index) => ({ id: `demo-${index}`, name, category: String(index % 3 + 1), kind: state.section, year: '2026' }));
  }
  loadFavorites(); renderConnection(); renderCategories(); renderChannels();
  message('Modo ejemplo · Contenido ficticio. Puedes probar el reproductor con un video público.');
  const button = document.createElement('button'); button.className = 'button button-secondary'; button.textContent = 'Probar video';
  button.addEventListener('click', () => {
    stopPlayback(); state.playing = { id: 'demo-video', name: 'Big Buck Bunny · Video de prueba', category: '' };
    $('#playing-name').textContent = state.playing.name; $('#playing-avatar').textContent = 'BB'; $('#playing-detail').textContent = 'Video público de prueba · No es TV en vivo';
    startPlayback('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8');
  });
  $('#catalog-message').append(button);
}
$$('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$$('[data-section]').forEach(button => button.addEventListener('click', () => setSection(button.dataset.section)));
['#connect-button', '#manage-connection', '#account-button'].forEach(selector => $(selector).addEventListener('click', openConnect));
$('#player-connect').addEventListener('click', () => { if (state.account) $('.catalog-section').scrollIntoView({ behavior: 'smooth' }); else openConnect(); });
['#help-button', '#help-top'].forEach(selector => $(selector).addEventListener('click', () => $('#help-dialog').showModal()));
$$('[data-close]').forEach(button => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));
$('#disconnect-button').addEventListener('click', async () => {
  $('#disconnect-button').disabled = true;
  try {
    stopPlayback(); await api('disconnect', {}); state.account = null; resetCatalog(); loadFavorites(); renderConnection();
    $('#refresh-button').disabled = false; toast('Cuenta desconectada. Credenciales eliminadas de la sesión.'); openConnect();
  } catch (error) { toast(error.message); }
  finally { $('#disconnect-button').disabled = false; }
});
$('#refresh-button').addEventListener('click', () => { if (state.account) loadCatalog(); else if (state.demo) enterDemo(); else openConnect(); });
$('#demo-button').addEventListener('click', enterDemo);
$('#free-live-button').addEventListener('click', async () => {
  stopPlayback();
  state.playing = { id: 'free-france24-es', name: 'France 24 Español', category: '', free: true };
  const generation = state.playGeneration;
  $('#playing-name').textContent = state.playing.name;
  $('#playing-avatar').textContent = '24';
  $('#playing-detail').textContent = 'Conectando con la señal pública en vivo…';
  $('#player-loading').hidden = false;
  $('#stop-button').disabled = false;
  try {
    const result = await api('free/play', { channelId: 'france24-es' });
    if (generation !== state.playGeneration) return;
    $('#free-live-button').setAttribute('aria-pressed', 'true');
    startPlayback(result.url);
    if (matchMedia('(max-width: 760px)').matches) $('#player-screen').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { if (generation === state.playGeneration) playbackError(error.message); }
});
$('#mobile-favorites').addEventListener('click', () => setView(state.view === 'favorites' ? 'all' : 'favorites'));
$('#search').addEventListener('input', () => { state.shown = 48; renderChannels(); });
$('#categories').addEventListener('click', event => {
  const button = event.target.closest('[data-category]'); if (!button) return;
  state.category = button.dataset.category; state.shown = 48;
  $$('#categories button').forEach(element => { element.classList.toggle('active', element === button); element.setAttribute('aria-pressed', String(element === button)); });
  renderChannels();
});
$('#channel-grid').addEventListener('click', event => {
  const favorite = event.target.closest('[data-favorite]'); if (favorite) return toggleFavorite(favorite.dataset.favorite);
  const play = event.target.closest('[data-play]'); if (play) playChannel(play.dataset.play);
});
$('#load-more').addEventListener('click', () => { state.shown += 48; renderChannels(); });
document.addEventListener('keydown', event => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && !document.querySelector('dialog[open]')) { event.preventDefault(); $('#search').focus(); }
});
window.addEventListener('pagehide', () => { playbackEvents?.abort(); clearTimeout(videoCheckTimer); clearTimeout(reconnectTimer); if (state.hls) state.hls.destroy(); video.pause(); video.removeAttribute('src'); video.load(); });
window.addEventListener('pageshow', event => { if (event.persisted) stopPlayback(); });
async function init() {
  loadFavorites(); renderConnection(); setView('all'); renderCategories();
  try {
    const [config, result] = await Promise.all([api('config'), api('session')]);
    $('#provider-url').defaultValue = config.providerUrl;
    $('#provider-url').value = config.providerUrl;
    renderProviderPreset();
    if (result.account) { state.account = result.account; loadFavorites(); renderConnection(); await loadCatalog(); }
    else openConnect();
  } catch (error) { message(error.message, true); openConnect(); }
}
init();
