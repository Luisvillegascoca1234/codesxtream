import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { AppError, normalizeProvider, playerApi, remoteRequest, readLimited, rewriteManifest } from './lib/provider.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SESSION_TTL = 8 * 60 * 60 * 1000;
const DEFAULT_PROVIDER_URL = process.env.PROVIDER_URL || 'http://121212.io:80';
const FREE_CHANNELS = Object.freeze([
  Object.freeze({ id: 'france24-es', name: 'France 24 Español', source: 'https://www.france24.com/es/en-vivo', url: 'https://live.france24.com/hls/live/2037220/F24_ES_HI_HLS/master_900.m3u8' }),
]);
const json = (res, data, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};
const id = () => randomBytes(24).toString('hex');
const textValue = (value, max = 180) => typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, max) : '';

async function body(req) {
  try { return JSON.parse((await readLimited(req, 8192)).toString('utf8')); }
  catch { throw new AppError('La solicitud no es válida.'); }
}

export function createApp({ allowPrivate = false, freeChannels = FREE_CHANNELS, defaultProvider = DEFAULT_PROVIDER_URL } = {}) {
  normalizeProvider(defaultProvider);
  const sessions = new Map();
  const attempts = new Map();
  const publicMedia = { public: true, media: new Map(), mediaByUrl: new Map(), controllers: new Set() };
  const gc = setInterval(() => {
    for (const [key, value] of sessions) if (Date.now() > value.expires) {
      for (const controller of value.controllers) controller.abort();
      sessions.delete(key);
    }
    for (const [key, value] of attempts) if (Date.now() > value.reset) attempts.delete(key);
  }, 60000).unref();

  function destroySession(key) {
    const session = sessions.get(key);
    if (session) for (const controller of session.controllers) controller.abort();
    sessions.delete(key);
  }
  function register(session, url) {
    const prefix = session.public ? '/api/free/media/' : '/api/media/';
    const string = String(url);
    if (!['http:', 'https:'].includes(new URL(string).protocol)) throw new AppError('El proveedor usa un protocolo no compatible.', 502);
    const existing = session.mediaByUrl.get(string);
    if (existing) return `${prefix}${existing}`;
    while (session.media.size >= 8192) {
      const first = session.media.keys().next().value;
      session.mediaByUrl.delete(session.media.get(first)); session.media.delete(first);
    }
    const token = id(); session.media.set(token, string); session.mediaByUrl.set(string, token);
    return `${prefix}${token}`;
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob: https://test-streams.mux.dev; connect-src 'self' https://test-streams.mux.dev; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host}`);
      const rawCookie = /(?:^|;\s*)xc_session=([a-f0-9]{48})(?:;|$)/.exec(req.headers.cookie || '');
      const key = rawCookie?.[1];
      let session = key && sessions.get(key);
      if (session && Date.now() > session.expires) { destroySession(key); session = null; }

      if (url.pathname.startsWith('/api/')) {
        res.setHeader('Cache-Control', 'no-store');
        if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== url.origin)) throw new AppError('Abre la aplicación desde su dirección local para continuar.', 403);
        if (req.method === 'POST' && !req.headers['content-type']?.startsWith('application/json')) throw new AppError('Se requiere JSON.', 415);
        if (url.pathname === '/api/health' && req.method === 'GET') return json(res, { ok: true });
        if (url.pathname === '/api/config' && req.method === 'GET') return json(res, { providerUrl: defaultProvider });
        if (url.pathname === '/api/free/play' && req.method === 'POST') {
          const { channelId } = await body(req);
          const channel = freeChannels.find(item => item.id === channelId);
          if (!channel) throw new AppError('Canal gratuito no disponible.', 404);
          return json(res, { url: register(publicMedia, channel.url), format: 'hls', channel: { id: channel.id, name: channel.name, source: channel.source } });
        }

        if (url.pathname === '/api/connect' && req.method === 'POST') {
          const address = req.socket.remoteAddress;
          const limit = attempts.get(address) || { count: 0, reset: Date.now() + 60000 };
          if (Date.now() > limit.reset) { limit.count = 0; limit.reset = Date.now() + 60000; }
          if (++limit.count > 12) throw new AppError('Demasiados intentos. Espera un minuto y vuelve a intentar.', 429);
          attempts.set(address, limit);
          const data = await body(req);
          if (typeof data.username !== 'string' || !data.username.trim() || data.username.length > 256 || typeof data.password !== 'string' || !data.password || data.password.length > 256) throw new AppError('Completa el usuario y la contraseña.');
          const base = normalizeProvider(data.url || defaultProvider);
          const candidate = { base, username: data.username.trim(), password: data.password };
          const info = await playerApi(candidate, null, {}, { allowPrivate });
          if (Number(info?.user_info?.auth) !== 1) throw new AppError('El proveedor no aceptó el usuario o la contraseña.', 401);
          if (info.user_info.status && String(info.user_info.status).toLowerCase() !== 'active') throw new AppError('La cuenta no está activa. Revisa el estado con tu proveedor.', 403);
          const expiry = Number(info.user_info.exp_date);
          if (expiry > 0 && expiry * 1000 < Date.now()) throw new AppError('La cuenta del proveedor está vencida.', 403);
          candidate.account = {
            username: candidate.username,
            provider: base.host,
            status: 'Activa',
            expires: Number.isFinite(expiry) && expiry > 0 ? expiry * 1000 : null,
            connections: textValue(info.user_info.max_connections, 8),
            activeConnections: textValue(info.user_info.active_cons, 8),
            formats: Array.isArray(info.user_info.allowed_output_formats) ? info.user_info.allowed_output_formats.map(v => textValue(v, 12)) : [],
            transport: base.protocol === 'https:' ? 'HTTPS' : 'HTTP',
          };
          candidate.expires = Date.now() + SESSION_TTL;
          candidate.media = new Map(); candidate.mediaByUrl = new Map(); candidate.channels = new Map(); candidate.controllers = new Set();
          const newKey = id();
          if (key) destroySession(key);
          if (sessions.size >= 50) throw new AppError('Hay demasiadas sesiones abiertas. Intenta más tarde.', 503);
          sessions.set(newKey, candidate);
          res.setHeader('Set-Cookie', `xc_session=${newKey}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`);
          return json(res, { account: candidate.account });
        }
        if (url.pathname === '/api/disconnect' && req.method === 'POST') {
          if (key) destroySession(key);
          res.setHeader('Set-Cookie', 'xc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
          return json(res, { ok: true });
        }
        if (url.pathname === '/api/session' && req.method === 'GET') return json(res, { account: session?.account || null });
        const publicResource = url.pathname.startsWith('/api/free/media/');
        if (publicResource) session = publicMedia;
        if (!session) throw new AppError('Conecta tu cuenta para continuar.', 401);
        if (url.pathname === '/api/catalog' && req.method === 'GET') {
          const [categories, streams] = await Promise.all([
            playerApi(session, 'get_live_categories', {}, { allowPrivate }),
            playerApi(session, 'get_live_streams', {}, { allowPrivate }),
          ]);
          if (!Array.isArray(categories) || !Array.isArray(streams)) throw new AppError('El proveedor no devolvió un catálogo de TV válido.', 502);
          const channels = streams.filter(s => /^\d+$/.test(String(s.stream_id))).map(s => ({
            id: String(s.stream_id), name: textValue(s.name), category: textValue(s.category_id, 64),
            epg: textValue(s.epg_channel_id),
          }));
          session.channels = new Map(channels.map(c => [c.id, c]));
          return json(res, {
            categories: categories.map(c => ({ id: textValue(c.category_id, 64), name: textValue(c.category_name) })),
            channels,
          });
        }
        if (url.pathname === '/api/play' && req.method === 'POST') {
          const { channelId } = await body(req);
          if (!session.channels.has(String(channelId))) throw new AppError('El canal no está en tu catálogo.', 404);
          const stream = new URL(`live/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${channelId}.m3u8`, session.base);
          return json(res, { url: register(session, stream), format: 'hls' });
        }
        if ((publicResource || url.pathname.startsWith('/api/media/')) && ['GET', 'HEAD'].includes(req.method)) {
          const token = url.pathname.slice(publicResource ? '/api/free/media/'.length : '/api/media/'.length);
          const target = session.media.get(token);
          if (!target) throw new AppError('La dirección de reproducción caducó. Vuelve a elegir el canal.', 404);
          const controller = new AbortController();
          session.controllers.add(controller);
          res.once('close', () => { controller.abort(); session.controllers.delete(controller); });
          const headers = {};
          if (req.headers.range && /^bytes=\d*-\d*$/.test(req.headers.range)) headers.Range = req.headers.range;
          const upstream = await remoteRequest(target, { allowPrivate, signal: controller.signal, headers, timeout: 25000 });
          const type = upstream.response.headers['content-type'] || '';
          const playlist = /mpegurl/i.test(type) || /\.m3u8$/i.test(upstream.url.pathname);
          if (playlist) {
            const manifest = rewriteManifest((await readLimited(upstream.response, 2 * 1024 * 1024)).toString('utf8'), upstream.url, uri => register(session, uri));
            res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Length': Buffer.byteLength(manifest) });
            return res.end(req.method === 'HEAD' ? undefined : manifest);
          }
          const allowed = /^(?:video\/|audio\/|text\/vtt|application\/(?:octet-stream|mp4))/i.test(type);
          if (!allowed) { upstream.response.destroy(); throw new AppError('El proveedor no devolvió un recurso de video compatible.', 502); }
          res.setHeader('Content-Type', type);
          for (const name of ['content-length', 'content-range', 'accept-ranges']) if (upstream.response.headers[name]) res.setHeader(name, upstream.response.headers[name]);
          res.statusCode = upstream.response.statusCode;
          if (req.method === 'HEAD') { upstream.response.destroy(); return res.end(); }
          await pipeline(upstream.response, res);
          return;
        }
        throw new AppError('Ruta no disponible.', 404);
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new AppError('Método no permitido.', 405);
      const files = {
        '/': ['public/index.html', 'text/html; charset=utf-8'],
        '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
        '/styles.css': ['public/styles.css', 'text/css; charset=utf-8'],
        '/icon.svg': ['public/icon.svg', 'image/svg+xml'],
        '/vendor/hls.min.js': ['node_modules/hls.js/dist/hls.min.js', 'text/javascript; charset=utf-8'],
      };
      const file = files[url.pathname];
      if (!file) throw new AppError('Página no encontrada.', 404);
      const bytes = await readFile(path.join(ROOT, file[0]));
      res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache', 'Content-Length': bytes.length });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) return res.destroy();
      // Deliberately do not log errors or upstream URLs: they can contain credentials.
      json(res, { error: error instanceof AppError ? error.message : 'No se pudo completar la solicitud. Intenta nuevamente.' }, error instanceof AppError ? error.status : 500);
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.on('close', () => {
    clearInterval(gc);
    for (const key of sessions.keys()) destroySession(key);
    for (const controller of publicMedia.controllers) controller.abort();
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const server = createApp();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `El puerto ${port} está ocupado. Prueba con otro puerto (PORT).` : 'No se pudo iniciar el servidor local.');
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log(`\n  XtremeCodesVille · prueba local\n  PC: http://localhost:${port}`);
    for (const list of Object.values(os.networkInterfaces())) for (const entry of list || []) {
      if (entry.family === 'IPv4' && !entry.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address)) console.log(`  Red local: http://${entry.address}:${port}`);
    }
    console.log('  Detener: Ctrl+C\n');
  });
}
