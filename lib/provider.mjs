import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function normalizeProvider(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw new AppError('Introduce una URL válida, por ejemplo https://servidor:puerto.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new AppError('Usa la URL del servidor con http:// o https://, sin usuario, contraseña ni parámetros.');
  }
  url.pathname = url.pathname.replace(/\/(?:player_api|get|xmltv)\.php\/?$/i, '').replace(/\/+$/, '') + '/';
  return url;
}

async function resolveTarget(url, allowPrivate = false) {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new AppError('Dirección de contenido no admitida.', 502);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try {
    addresses = ipaddr.isValid(hostname)
      ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv6' ? 6 : 4 }]
      : await dns.lookup(hostname, { all: true });
  } catch { throw new AppError('No se encontró el servidor. Revisa la URL y tu conexión.', 502); }
  if (!addresses.length) throw new AppError('El servidor no tiene una dirección disponible.', 502);
  if (!allowPrivate && addresses.some(({ address }) => ipaddr.process(address).range() !== 'unicast')) {
    throw new AppError('El proveedor debe tener una dirección pública de internet.');
  }
  return addresses;
}

// Pin each request to the validated DNS result, including every redirect.
export async function remoteRequest(target, { allowPrivate = false, signal, headers = {}, redirects = 5, timeout = 20000 } = {}) {
  const url = new URL(target);
  const addresses = await resolveTarget(url, allowPrivate);
  if (signal?.aborted) throw new AppError('Solicitud cancelada.', 499);
  const response = await new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.get(url, {
      signal,
      headers: { 'User-Agent': 'XtremeCodesVille/0.1', Accept: '*/*', ...headers },
      lookup: (_host, options, callback) => {
        const filtered = options.family ? addresses.filter(a => a.family === options.family) : addresses;
        const selected = filtered.length ? filtered : addresses;
        if (options.all) callback(null, selected);
        else callback(null, selected[0].address, selected[0].family);
      },
    }, resolve);
    request.setTimeout(timeout, () => request.destroy(new Error('timeout')));
    request.once('error', () => reject(new AppError('No se pudo contactar al proveedor. Revisa la URL, el puerto y tu conexión.', 502)));
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
    response.destroy();
    if (!redirects) throw new AppError('El proveedor devuelve demasiadas redirecciones.', 502);
    return remoteRequest(new URL(response.headers.location, url), { allowPrivate, signal, headers, redirects: redirects - 1, timeout });
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    response.destroy();
    const message = [401, 403].includes(response.statusCode)
      ? 'El proveedor rechazó el acceso. Revisa las credenciales o las restricciones de tu cuenta.'
      : `El proveedor respondió con HTTP ${response.statusCode}. Intenta nuevamente.`;
    throw new AppError(message, 502);
  }
  return { response, url };
}

export async function readLimited(stream, max = 20 * 1024 * 1024) {
  const chunks = []; let size = 0;
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > max) { stream.destroy(); throw new AppError('La respuesta del proveedor excede el tamaño permitido.', 502); }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('La conexión con el proveedor se interrumpió. Intenta nuevamente.', 502);
  }
  return Buffer.concat(chunks);
}

export async function playerApi(session, action, extra = {}, options = {}) {
  const url = new URL('player_api.php', session.base);
  url.searchParams.set('username', session.username);
  url.searchParams.set('password', session.password);
  if (action) url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  const { response } = await remoteRequest(url, options);
  try { return JSON.parse((await readLimited(response)).toString('utf8')); }
  catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('La URL no devolvió una API Xtream válida. Comprueba la dirección y el puerto.', 502);
  }
}

export function rewriteManifest(text, base, register) {
  if (!text.trimStart().startsWith('#EXTM3U')) throw new AppError('El proveedor no devolvió una lista HLS válida. Este reproductor necesita HLS (.m3u8).', 502);
  const resource = uri => {
    let url;
    try { url = new URL(uri, base); } catch { throw new AppError('La lista HLS contiene una dirección inválida.', 502); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new AppError('La lista HLS usa una dirección no admitida.', 502);
    return register(url);
  };
  return text.split(/\r?\n/).map(line => {
    if (!line.trim()) return line;
    if (line.startsWith('#')) return line.replace(/URI="([^"\r\n]+)"/g, (_match, uri) => `URI="${resource(uri)}"`);
    return resource(line.trim());
  }).join('\n');
}
