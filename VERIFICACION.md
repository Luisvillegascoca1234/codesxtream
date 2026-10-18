# Verificación local · 18 de octubre de 2026

## Cortes intermitentes y Samsung con AirPlay

Se agregaron dos intentos de reconexion ante errores fatales de red de hls.js y un intento de recuperacion del motor multimedia. Si no se recupera la senal, se muestra una causa mas concreta y el boton Reintentar. Un error terminal oculta el indicador de carga y cambia el estado a Reproduccion interrumpida; un evento waiting posterior no vuelve a activar el indicador. Detener o cambiar canal cancela las reconexiones pendientes.

Verificacion en navegador:

- GOL BOL 2 SD del catalogo autenticado: imagen 720 x 480, AVC, audio/video activos y sin error al comprobarlo. El corte intermitente del usuario no se reprodujo en esa comprobacion y su causa exacta sigue sin confirmar.
- France 24 con dos respuestas HTTP 503 simuladas: recuperacion automatica e imagen 1024 x 576.
- Fallo HTTP 503 persistente: dos ciclos de reconexion, aviso terminal con codigo HTTP, boton Reintentar y sin indicador de carga incluso tras disparar waiting. Al retirar el fallo y pulsar Reintentar vuelve la imagen.
- Detener durante la espera de reconexion: no se emitieron nuevas solicitudes despues de detener.
- npm run check correcto; 11 pruebas integradas aprobadas. Los errores HTTP del navegador durante estas pruebas fueron intencionales. Reproduccion detenida al terminar; servidor y sesion conservados.

El usuario confirma que su Samsung tiene Configuracion de Apple AirPlay. Puede probar Duplicar pantalla desde el Centro de control del iPhone, con ambos en la misma red y AirPlay activado en la TV. No se implemento envio directo al receptor ni se verifico imagen en esa TV fisica. El motor ManagedMediaSource mantiene desactivada la reproduccion remota del elemento video; no se anuncia un boton AirPlay directo. Referencias: [Apple](https://support.apple.com/en-us/102661), [Samsung](https://www.samsung.com/uk/support/tv-audio-video/streaming-through-airplay/).

## Correccion de canales con audio sin imagen

El usuario confirmo conexion real al proveedor y fallo de imagen en PC e iPhone. Desde la sesion ya autenticada de la app se inspecciono una muestra de segmentos, sin leer ni registrar credenciales. D SPORTS HD (Arg) contiene video HEVC/H.265 (PMT tipo 0x24) y audio AAC (tipo 0x0f), transportados en TS. El reproductor nativo del PC avanzaba audio sin dimensiones de video.

Se confirmo que el mismo recurso muestra imagen al usar hls.js completo, que reempaqueta HEVC en MP4 para MSE. Se cambio la prioridad para usar ese motor antes del HLS nativo, con ManagedMediaSource en Safari compatible y respaldo nativo si no hay soporte. No se instalaron conversores ni se recodifico video. Fuente tecnica: [hls.js](https://github.com/video-dev/hls.js#readme), [WebKit Safari 17.1](https://webkit.org/blog/14735/webkit-features-in-safari-17-1/).

Validacion real desde la interfaz actualizada en este PC:

- D SPORTS HD (Peru), dos fuentes distintas: imagen 1280 x 720, HEVC `hvc1.1.6.L93.B0`, sin error fatal. En la primera prueba el contador avanzo a 106 cuadros decodificados mientras avanzaba el tiempo de reproduccion.
- D SPORTS HD (Arg): imagen 1280 x 720 al probar el motor alternativo.
- France 24 Espanol con hls.js: imagen 1024 x 576, AVC `avc1.4d401f`.
- Respaldo nativo comprobado con France 24 al simular ausencia de MSE: imagen 1024 x 576.
- `npm run check` correcto. Solo se editaron recursos estaticos y documentacion; el servidor no se reinicio, y la sesion autenticada se conservo. La reproduccion de QA se detuvo al terminar.

Se agrego una deteccion de audio que avanza sin imagen durante 12 segundos, con aviso y limpieza al detener/cambiar de canal. El usuario confirmo la prueba fisica en Safari: «Si, ya se ve y se escucha». Correccion del canal verificada en PC y en el iPhone del usuario. La version de Safari y el soporte HEVC del dispositivo siguen limitando los formatos admitidos; no se promete compatibilidad universal.

## Acceso con servidor preconfigurado

- Servidor predeterminado `http://121212.io:80`; formulario automatico de usuario y contraseña cuando no hay sesion activa, con opcion plegable para cambiar servidor.
- `npm run check` correcto y 11 pruebas integradas aprobadas. La nueva prueba autentica con un servidor simulado enviando solo usuario y contraseña, sin URL, y obtiene su catalogo.
- Navegador en vista movil de 393 x 852: formulario automatico visible, URL preconfigurada, foco en usuario, campo de URL plegado y sin desbordamiento horizontal. Envio de credenciales, carga de catalogo y desconexion comprobados con respuestas simuladas. No se envio una cuenta real a 121212.io.
- Contraseña eliminada del formulario tras entrar; sin contraseña en localStorage; la desconexion vuelve a pedir acceso. Campo Cambiar servidor editable y nota HTTP/HTTPS actualizada segun la URL.
- Servidor reiniciado y `/api/config` responde desde 192.168.0.6:3000 con la URL esperada. La compatibilidad real con la cuenta del usuario sigue pendiente de su prueba.

## Canal gratuito en vivo agregado

- France 24 Espanol, flujo HLS del dominio oficial live.france24.com, variante 900 (1024 x 576), sin cuenta Xtream.
- Respuesta HTTP 200, lista HLS sin ENDLIST y secuencia de medios avanzando entre consultas.
- Reproduccion real comprobada desde el boton Ver en vivo, a traves del proxy local, sin credenciales. Navegador: video 1024 x 576, readyState 4, paused false y tiempo avanzando.
- Tarjeta visible en escritorio y vista movil de 393 x 852 sin desbordamiento horizontal. Se detuvo la reproduccion de QA al terminar.
- `npm run check` correcto y 10 pruebas integradas aprobadas. La prueba nueva verifica medios publicos anidados sin sesion y el aislamiento respecto de las rutas privadas.
- Servidor reiniciado con la actualizacion. La validacion de esta nueva senal en un iPhone fisico queda para el usuario; el acceso a la app desde Safari ya habia sido confirmado.

- `npm run check`: correcto (servidor, integración y JavaScript del navegador).
- `npm test`: 9 pruebas integradas aprobadas con un proveedor simulado. Ninguna cuenta de terceros utilizada.
- HTTP 200 en `http://localhost:3000` y en `http://192.168.0.6:3000/api/health` desde este PC.
- Navegador Chromium automatizado: interfaz a 1440 × 1080 y 393 × 852, sin desbordamiento horizontal.
- Catálogo de ejemplo: 12 canales ficticios; filtro Deportes: 2; búsqueda Planeta: 1; favoritos y navegación comprobados.
- Video HLS público de Big Buck Bunny: reproducción efectiva, `readyState=4`, `paused=false`, tiempo de reproducción avanzando.
- Flujo de formulario con respuestas simuladas: credenciales incorrectas, conexión, catálogo, mostrar contraseña, borrado del campo y desconexión comprobados.
- Nombres de canales con etiquetas HTML se muestran como texto; no se insertan scripts.
- Ayuda y favoritos accesibles en la vista móvil; no se observaron errores JavaScript durante estos flujos. El rechazo HTTP 401 simulado es intencional.
- Lanzador de Windows: inicio, detección de proceso existente, detención y reinicio verificados. La entrega queda iniciada en segundo plano, con respuesta correcta en la IP de red local.

Pendiente de validación por el usuario: proveedor real, canales reales y reproducción en un iPhone físico/Safari. La vista móvil de Chromium no sustituye esa prueba. Durante la verificación inicial no se modificaron el router, la Raspberry, el firewall ni el DNS; el ajuste posterior del firewall se detalla debajo.

## Acceso desde iPhone

El usuario confirma que Safari no abre la pagina, usando la URL HTTP correcta y el mismo wifi. Servidor activo en todas las interfaces, IP Ethernet 192.168.0.6/24, comprobaciones HTTP locales correctas. Perfil Windows Ethernet Publico; firewall activado con BlockInbound/AllowOutbound. Consulta de reglas denegada por falta de privilegios. Se preparo una regla acotada para ejecucion manual como administrador; aun no se aplico ni se verifico acceso desde otro dispositivo.

Posteriormente se confirmo que el permiso inicial fue instalado. La captura del iPhone confirma IP 192.168.0.199/24 y router 192.168.0.1. La inspeccion con netsh encontro un bloqueo TCP explicito para el mismo ejecutable Node.js (ruta resuelta a traves del junction de fnm).

Se aplico la reparacion acotada mediante el permiso de administrador de Windows. Resultado `ok: true`. Netsh confirma bloqueo original en puertos 1-2999,3001-65535 y dos bloqueos complementarios de TCP 3000 para otros origenes/destinos. Se comprobo matematicamente la cobertura IPv4 (todas las direcciones excepto un host) e IPv6 completa de las reglas instaladas. HTTP local sigue correcto. No se modificaron perfil de red, router, Raspberry ni DNS. El usuario confirmo despues del ajuste: «Si, ya abre la app». Acceso desde Safari en iPhone verificado por el usuario. Siguen pendientes la conexion al proveedor real y la reproduccion de sus canales.
