# Verificación local · 18 de octubre de 2026

## Fluidez de video: revision con dos subagentes

El usuario aclaro que los tirones ocurren en PC e iPhone en GOL BOL 1 HD. Dos subagentes revisaron por separado interfaz y reproduccion/proxy; ambos confirmaron que la recuperacion anterior llamaba a loadSource ante cualquier error fatal de red, recreando MediaSource y descartando el buffer. La interfaz no hace renderizados periodicos durante el video; no se encontraron tareas largas del hilo principal en los 30 segundos iniciales medidos. El proxy ya usa pipeline con backpressure y cancela solicitudes al cerrar el cliente.

Hallazgos y cambios aplicados:

- Recuperar listas/segmentos ya abiertos con startLoad(-1), conservando MediaSource. loadSource queda para errores del manifiesto inicial o cuando no hay niveles cargados.
- Renovar el presupuesto de recuperacion tras 30 segundos de reproduccion estable y al menos 25 segundos de avance. Un salto de posicion no lo renueva. Los listeners se eliminan con AbortController al detener/cambiar canal.
- Conservar la identidad de ruta de cada recurso aunque rote su query firmada. La ruta del proxy es un HMAC por sesion de origen + pathname; un token opaco r identifica la URL completa. Se valida la correspondencia antes de solicitar el recurso. Se conservan las firmas anteriores, las protecciones SSRF y el aislamiento de sesiones. No se expone la ruta ni la query original.
- Metricas acotadas en memoria por reproduccion, consultables en playbackSnapshot(): buffer, cuadros, pausas, recuperaciones, ultimo codigo de error y duracion de descarga de segmento. Sin URLs, mensajes crudos ni credenciales.
- Ante levelParsingError, si el catalogo tiene una variante H.264 con el mismo nombre base, se ofrece Probar version H.264. Solo se cambia al pulsarlo. No se impone una calidad ni se modifica el catalogo del proveedor.

Pruebas y limites de la evidencia:

- GOL BOL 1 HD, fuente 8397: 1280 x 720 AVC. Antes se observo levelParsingError por media sequence mismatch y reinicio de tiempo/contadores de video en unos 30 segundos. Los mensajes crudos no se guardaron porque pueden incluir listas y URLs.
- Tras corregir la recuperacion, 45 segundos de la misma fuente conservaron MediaSource (cero detach durante reproduccion), con una recuperacion y una pausa breve; la inconsistencia de segmentos no desaparecio por completo. La correccion de firma opaca evita fabricar diferencias de ruta por query, pero no garantiza corregir incoherencias reales de origen/CDN.
- Se probo un margen de cinco segmentos respecto del directo. No elimino las pausas en esa fuente, por lo que se restablecio la configuracion de latencia original en la version final.
- GOL BOL 1 HD - h264, fuente 484151: 35 segundos medidos, avance de 34,8 segundos, imagen 1280 x 720, 1080 cuadros, cero descartados, cero pausas y cero errores. Es una observacion limitada, no garantia de disponibilidad del proveedor.
- France 24 con fallo de segmento inyectado: fuente MSE sin cambios, cero detach, video avanzando, buffer de 10 a 18,3 segundos, cero pausas y cero cuadros descartados durante la recuperacion.
- Boton de alternativa comprobado con un error controlado: ofrece 484151, cambia al pulsarlo, muestra imagen real y oculta la sugerencia. En una espera natural posterior de 30 segundos no aparecio el error; se uso inyeccion para verificar la interfaz sin depender del fallo intermitente.
- 17 pruebas aprobadas: firmas rotatorias conservan identidad sin mezclar cuerpos, manipulacion de ruta rechazada, sesiones aisladas, recuperacion sin reemplazar fuente, limite finito de intentos y renovacion solo tras avance estable. npm run check correcto.

Pendiente: confirmacion del usuario en Safari fisico y observacion mas larga del proveedor. Una mejora adicional detectada por el subagente para sesiones largas es proteger los tokens de manifiestos raiz frente al limite FIFO de 8192 recursos y renovar la URL al reintentar si ya caduco. El subagente reprodujo esa caducidad con un proveedor sintetico de 8192 segmentos; no es la causa demostrada de los cortes a los pocos segundos y no se amplio esta reparacion a esa politica de recursos. Tambien se pospuso optimizar la reconstruccion del catalogo, porque el problema informado ocurre durante reproduccion sin interaccion.

## PWA instalable

Manifest con identidad estable, inicio y alcance en /, display standalone e iconos PNG 192, 512, maskable y apple-touch-icon 180. Boton Instalar app con beforeinstallprompt en navegadores compatibles y ayuda Compartir / Agregar a pantalla de inicio en iPhone. Tarjeta oculta al abrir en modo standalone. Service worker con lista cerrada de archivos estaticos, pantalla sin conexion y actualizaciones esperando confirmacion mediante Actualizar app.

Verificado con Chromium sobre servidor separado de QA en localhost:3001:

- Manifest sin errores; Page.getInstallabilityErrors sin incidencias en el perfil normal. Un contexto aislado devolvio solamente in-incognito, como corresponde.
- Service worker activo y cache con 11 recursos estaticos. Tras reproducir France 24 (1024 x 576), ninguna ruta /api/ en cache.
- Sin red, navegar al inicio muestra No hay conexion; fetch /api/session falla en red, sin devolver datos ni HTML de respaldo. Volver a intentar con red recupera la app.
- Actualizacion real de worker v1 a v2: banner visible con worker esperando; pulsar Actualizar app activa, recarga y elimina la cache antigua. Sin recarga forzada antes de pulsarlo.
- Vista 393 x 852 revisada visualmente sin desbordamiento horizontal. Ayuda de instalacion para iPhone comprobada con user-agent simulado; no sustituye una instalacion en Safari fisico.
- HTTPS directo comprobado con certificado efimero de QA y proveedor simulado: salud HTTP 200, acceso con Origin HTTPS correcto, cookie Secure y rechazo 403 de Origin HTTP. Solo la peticion local de QA omitio verificacion del certificado autofirmado; la app no desactiva validacion TLS.
- npm run check correcto y 12 pruebas integradas aprobadas, incluyendo tipos MIME del manifest/worker y dimensiones de los PNG. Certificados de QA eliminados y formatos de claves excluidos de Git.

Pendiente para el iPhone: disponer de HTTPS con certificado valido y comprobar Agregar a pantalla de inicio en el dispositivo. La URL LAN HTTP actual sigue sirviendo TV, pero no habilita el service worker. No se publico un dominio ni se instalaron certificados de confianza. El servidor local se reinicia para activar las nuevas rutas, lo que elimina las sesiones en memoria.

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

## Películas y series · 18 de octubre de 2026

Rama `codex/peliculas-y-series`. Se agregaron apartados para películas y series, con categorías, búsqueda, favoritos separados y carga incremental; Series incluye sinopsis, temporadas, episodios y reintento de consultas fallidas. TV en vivo conserva su catálogo y el mecanismo de recuperación HLS. Los archivos VOD utilizan el reproductor nativo y el proxy privado con soporte de rangos de bytes.

- `npm.cmd run check`: correcto.
- `npm.cmd test`: 20 pruebas aprobadas. Las nuevas comprobaciones cubren IDs compartidos entre TV y películas, reproducción de archivos y HLS, rangos y HEAD, aislamiento entre sesiones, desconexión, rechazo de IDs/extensiones inválidos, pertenencia de episodios y selección del motor nativo para archivos VOD.
- Chrome automatizado con API simulada: categorías, búsqueda, carga de 48 a 60 títulos, favoritos por apartado y persistencia al recargar, selección de temporadas, reintento tras error y solicitud del episodio correcto. Los metadatos con HTML se muestran como texto.
- Navegación comprobada a 1440, 768 y 390 píxeles, sin desbordamiento horizontal ni errores JavaScript. Las respuestas lentas de otro apartado no reemplazan el catálogo visible. El ejemplo funciona sin cuenta para películas, series y temporadas.
- Capturas y script de verificación en `test-results/`, excluido de Git. Caché PWA incrementada a `xtremeville-static-v7`.

La disponibilidad y reproducción de películas y episodios del proveedor real siguen pendientes de comprobación con la cuenta del usuario. Estas pruebas usan datos simulados; no confirman compatibilidad de todos los contenedores/códecs ni reproducción en un iPhone físico. No se añade transcodificación.

### Botones de Películas y Series sin respuesta

El usuario precisó que los botones no respondían. Se encontró una pestaña de Chrome con la interfaz anterior, todavía titulada «XtremeVille · TV en vivo». Además, el HTML nuevo solicitaba `/app.js` sin versión: un service worker antiguo podía devolver el código previo, que no registra los botones `data-section`. Las pruebas anteriores de navegador bloqueaban el service worker y no cubrían esa actualización.

Se versionaron scripts y estilos con `?v=8`, lo que evita las respuestas de los workers antiguos para esas rutas. La caché v8 conserva la ruta y la query completas; no recurre a archivos sin versión y mantiene todas las rutas `/api/` fuera de caché. El HTML y la pantalla sin conexión referencian los mismos recursos precargados. No se reinició el servidor ni se eliminaron sesiones para este arreglo.

La prueba de regresión falló antes del arreglo por `/styles.css` sin versión y pasó después. `npm.cmd run check` correcto y 23 pruebas aprobadas, incluyendo coincidencia de versiones y exclusión de APIs. En Chrome conectado se comprobó Películas con seis ejemplos, el cambio a Series y la apertura de temporadas y episodios. No hubo errores de JavaScript. Captura de esa comprobación: `test-results/botones-series-corregidos.png` (contenido ficticio). Se recargó la pestaña de red local del usuario, que quedó en el formulario de inicio de sesión.

### Indicadores de carga

Se añadieron ocho tarjetas skeleton para TV, películas y series, junto a un spinner y un texto de estado. Mientras se consulta el catálogo, se ocultan los resultados anteriores y el estado vacío, se deshabilitan búsqueda/categorías y se marca el contenido con `aria-busy`. Cambiar de apartado cancela visualmente la carga anterior; una respuesta atrasada no elimina el indicador de la consulta vigente. Los episodios tienen un spinner propio, que se retira al recibir resultados, fallar la consulta o cerrar la ventana. Las animaciones respetan la preferencia de reducir movimiento.

Recursos y caché PWA actualizados a v9. `npm.cmd run check` correcto y 23 pruebas aprobadas. En Chrome, con un servidor temporal de datos simulados y ocho segundos de demora, se verificaron skeletons visibles, estado vacío oculto y `aria-busy=true`; al llegar el catálogo se restauraron resultados y controles con `aria-busy=false`. Se capturó el spinner de episodios. Evidencias locales: `test-results/skeleton-peliculas.png` y `test-results/spinner-episodios.png`. No se reinicia el servidor habitual ni se usan cuentas reales para esta comprobación.

### Logos y portadas

El catálogo ahora conserva `stream_icon`, `cover` y `cover_big` únicamente en el servidor y devuelve rutas locales de imágenes para cada tipo e identificador. El proxy requiere una sesión con ese título en su catálogo, valida las redirecciones y limita cada imagen a 5 MiB. Solo admite tipos de imagen y aplica sandbox a SVG. La caché se mantiene en memoria durante cinco minutos y está limitada a 128 imágenes/8 MiB por sesión; las respuestas conservan `no-store` y quedan fuera del service worker.

Las tarjetas usan carga diferida y decodificación asíncrona. Se mantienen iniciales cuando no hay imagen o falla su descarga, y las URLs fallidas se reintentan al actualizar el catálogo. Las películas y series tienen proporción 2:3; los canales muestran el logo completo. El avatar del reproductor usa la imagen seleccionada, incluyendo la portada de la serie al elegir un episodio. Las imágenes no interceptan los botones de las tarjetas.

`npm.cmd run check` correcto y 25 pruebas aprobadas. Las nuevas pruebas verifican imágenes de los tres apartados, URLs originales ocultas, imágenes relativas, redirecciones, caché en memoria, HEAD, aislamiento de sesiones, desconexión, rechazo de solicitudes cruzadas, esquemas no admitidos, respuestas HTML y tamaño excesivo. El service worker excluye explícitamente las rutas de portadas en su prueba. Recursos y caché PWA incrementados a v10.

Chrome con un proveedor local simulado: cuatro imágenes cargadas y dos alternativas (una ausente y una con error) en cada apartado. Se comprobaron favoritos con portadas, apertura de series al pulsar su tarjeta y ausencia de errores JavaScript. Captura de películas: `test-results/portadas-peliculas.png`; las portadas de esa captura son de prueba. Pendiente comprobar las imágenes concretas del proveedor real tras iniciar sesión.
