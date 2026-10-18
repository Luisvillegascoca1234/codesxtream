# XtremeVille · prueba local

Aplicación para conectar una cuenta Xtream Codes, consultar canales de TV en vivo y probar reproducción HLS desde PC o Safari en iPhone. Node.js 22 o superior. Compatible con Windows y con una futura instalación en Raspberry Pi que tenga esa versión de Node.

## Iniciar

```powershell
npm.cmd install
npm.cmd start
```

Abre **http://localhost:3000** en este PC. Para detener: `Ctrl+C` en la consola del servidor.

También puedes ejecutar `iniciar.cmd` con doble clic en Windows; instala las dependencias solo si faltan y deja el servidor en segundo plano. Con ese lanzador, utiliza `detener.cmd` para detenerlo. El archivo `.local-runtime.json` guarda únicamente el identificador del proceso y el puerto, nunca credenciales. En Linux/Raspberry usa `npm install` y `npm start`.

Al abrir la app sin una sesion activa aparece **Entra a tu cuenta**. El servidor `http://121212.io:80` esta preconfigurado; introduce solo tu usuario y tu contraseña y pulsa **Entrar y cargar canales**. La direccion se encontro en la instalacion local de MasTV y el usuario ya confirmo acceso en nuestra app. Primero se comprueba la cuenta y despues se carga el catalogo.

**Cambiar servidor** permite editar la URL base si necesitas otro proveedor, incluyendo el puerto cuando corresponda. No pegues una lista M3U ni una URL que contenga credenciales o parametros. El servidor predeterminado tambien se puede configurar con la variable de entorno `PROVIDER_URL` antes de iniciar Node.js. El campo de servidor se mantiene plegado en el acceso habitual.

Las credenciales permanecen en memoria del servidor durante la sesion; no se guardan en archivos ni en localStorage. Cerrar la ventana de acceso permite usar el canal gratuito. Al desconectar o caducar la sesion se vuelve a pedir el acceso. El servidor preconfigurado usa HTTP, por lo que las credenciales viajan sin cifrar desde el PC hasta el proveedor; esta condicion aparece en el formulario.

No se incluyen cuentas del proveedor. **Explorar ejemplo** muestra datos ficticios. **Probar video** reproduce un video HLS público de Big Buck Bunny, servido por test-streams.mux.dev y enlazado desde la documentación de hls.js. Solo esta prueba de video usa ese servicio externo; las credenciales de tu proveedor no se envían allí. Ademas, se incluye la señal real gratuita descrita a continuacion.

### Canal gratuito en vivo

La tarjeta **France 24 Español → Ver en vivo**, visible arriba del reproductor, abre una señal real de noticias sin cuenta Xtream. Usa el flujo HLS publico del dominio oficial `live.france24.com`, a calidad 576p (variante master_900), pasando por el proxy local para probar el mismo recorrido de video PC/iPhone. El enlace **Fuente oficial** lleva a [France 24 en vivo](https://www.france24.com/es/en-vivo). Su disponibilidad depende de France 24.

La ruta publica solo admite el canal predefinido; no acepta una URL arbitraria ni comparte las sesiones o credenciales del proveedor. Los segmentos y las listas se sirven desde `/api/free/media/`, separados de `/api/media/` privado. El catalogo de ejemplo y Big Buck Bunny siguen siendo opciones distintas; los canales ficticios no son emisiones reales.

## Probar en iPhone

1. Conecta PC e iPhone a la misma red doméstica (sin aislamiento entre clientes).
2. Mantén el servidor y el PC encendidos.
3. Abre en Safari la dirección `Red local` que imprime la consola. En este equipo se detectó `http://192.168.0.6:3000`; puede cambiar al reconectar la red.
4. Si no carga, permite Node.js en el firewall de Windows **solo en redes privadas** y comprueba que no usas una red wifi de invitados. No hace falta abrir puertos en el router.
5. Introduce tu cuenta y elige un canal. Safari compatible usa hls.js con ManagedMediaSource, con HLS nativo como respaldo. Si no empieza automaticamente, toca reproducir en el video.

### Si Safari no abre la pagina

El 18 de octubre se confirmo que el servidor escucha en `0.0.0.0:3000`, responde en `192.168.0.6` y la conexion Ethernet de Windows esta en perfil Publico con bloqueo entrante predeterminado. Desde esta sesion no se pueden administrar reglas del firewall (Acceso denegado). Esto apunta al firewall como posible causa, sin descartar aislamiento entre wifi y Ethernet.

Se preparo `permitir-iphone.cmd`: clic derecho y **Ejecutar como administrador** en el PC. Solo agrega una regla entrante TCP al puerto 3000, en la IP 192.168.0.6 y la interfaz Ethernet, desde la subred 192.168.0.0/24. Funciona para los perfiles Publico y Privado, conserva el firewall activo y no toca el router. No elimina bloqueos previos. Si la IP cambia, el script se detiene sin aplicar otra configuracion.

Se puede revisar sin modificar Windows con `powershell.exe -NoProfile -File .\permitir-iphone.ps1 -VistaPrevia`. Para revertir exclusivamente esta regla, desde PowerShell como administrador: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\permitir-iphone.ps1 -Revertir`.

Si el permiso no resuelve el acceso, revisar la IP del iPhone (debe pertenecer a la misma subred), el aislamiento de la red de invitados, VPN y reglas de bloqueo explicitas. No desactivar el firewall globalmente.

### Bloqueo explicito de Node.js encontrado y ajustado

Se confirmo que el iPhone usa `192.168.0.199/24` y el mismo router `192.168.0.1`. El permiso inicial ya estaba instalado, pero una regla entrante explicita bloqueaba la instalacion de Node.js en el perfil Publico. Esos bloqueos prevalecen sobre permisos ordinarios: [documentacion de Microsoft](https://learn.microsoft.com/es-es/windows/security/operating-system-security/network-security/windows-firewall/rules).

Se aplico `reparar-iphone.ps1` con autorizacion de administrador de Windows. Conserva el bloqueo original de Node.js en los puertos 1-2999 y 3001-65535. En TCP 3000, agrega bloqueos complementarios que conservan el bloqueo para todas las direcciones excepto el iPhone `192.168.0.199` hacia este PC `192.168.0.6`. El permiso previo sigue limitado a Ethernet. No se cambio el perfil de red ni se desactivo el firewall. IPv6 queda bloqueado en las reglas complementarias.

`.iphone-firewall-backup.json` conserva los puertos originales; `.iphone-firewall-result.json` registra el resultado del ajuste. Ambos son locales e ignorados por Git. No contienen credenciales del proveedor.

Si cambia la IP del iPhone, esta excepcion dejara de coincidir. Para revertir el ajuste y restaurar el bloqueo original, desde PowerShell como administrador: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\reparar-iphone.ps1 -Revertir`. Para retirar tambien el permiso inicial, ejecutar despues `permitir-iphone.ps1 -Revertir`.

`localhost` en el iPhone apunta al propio iPhone, no a este PC. Los favoritos se guardan en cada navegador y dirección usada. Un teléfono y un PC pueden ocupar dos conexiones del proveedor; detén la reproducción anterior si tu cuenta solo permite una.

La prueba de red local sigue usando HTTP. La app incluye ahora manifest, iconos PNG, instalacion y un service worker. En localhost se puede verificar como PWA; en el iPhone se necesita HTTPS con certificado valido para habilitar todas las funciones. Los canales en vivo siempre necesitan conexion y el servidor encendido.

## Instalar como PWA

En Chrome o Edge en este PC, abre `http://localhost:3000` y pulsa **Instalar app**; tambien puedes usar la opcion de instalacion del navegador. En iPhone, abre la direccion HTTPS de la app en Safari: **Compartir → Agregar a pantalla de inicio → Agregar**; si aparece **Abrir como app**, activalo. La app detecta la instalacion y oculta la tarjeta cuando se abre en su propia ventana. La direccion actual `http://192.168.0.6:3000` permite ver canales, pero no es un origen seguro para un service worker. Un acceso directo agregado desde HTTP no equivale a la PWA completa.

El service worker solo conserva una lista explicita de archivos estaticos. No guarda respuestas de `/api/`, cuentas, catalogos, listas HLS, segmentos ni credenciales. Si el servidor no responde al abrir la app, muestra una pantalla sin conexion con **Volver a intentar**. Esto no permite ver TV sin internet. La sesion sigue caducando a las ocho horas; reinstalar o abrir desde otro origen puede requerir iniciar sesion otra vez.

Las actualizaciones se preparan en segundo plano. Cuando hay una version esperando, aparece **Actualizar app**, que recarga la pagina y detiene el video tras pulsarlo. Al modificar archivos precargados, incrementa el nombre de `CACHE` en `public/sw.js`.

### HTTPS con certificados propios

El servidor admite HTTPS directo mediante dos variables. Usa un certificado valido para el dominio o IP que se abrira, con su clave privada. Para pruebas locales, la autoridad emisora debe estar expresamente instalada y ser de confianza en cada dispositivo; aceptar una advertencia de certificado no garantiza que el service worker funcione.

```powershell
$env:TLS_KEY_FILE = 'D:\ruta\privada\clave.pem'
$env:TLS_CERT_FILE = 'D:\ruta\privada\certificado.pem'
npm.cmd start
```

Con esas variables, el mismo puerto sirve HTTPS en lugar de HTTP. El navegador y la cookie usan HTTPS; las peticiones al proveedor conservan el protocolo que este ofrezca. `iniciar.cmd` queda para la prueba HTTP: para HTTPS usa `npm.cmd start`. No se generan ni instalan certificados automaticamente ni se modifica el dominio o router. `certs/` y los formatos habituales de claves/certificados estan excluidos de Git. Para volver a HTTP, elimina las dos variables del entorno antes de iniciar. La configuracion de un dominio y su certificado real sigue pendiente.

Referencias: [instalacion PWA y origen seguro](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [Safari en iPhone](https://support.apple.com/guide/iphone/bookmark-a-website-iph42ab2f3a7/ios).

## Qué incluye

- Validación de autenticación, estado y vencimiento de la cuenta.
- Categorías, búsqueda, favoritos y carga incremental de canales.
- hls.js completo como primera opcion, con MSE o ManagedMediaSource en Safari compatible. HLS nativo como respaldo cuando esas APIs no estan disponibles.
- Video, listas HLS anidadas, segmentos, claves AES y rangos de bytes a través del servidor local.
- URLs opacas en el navegador; las credenciales del proveedor permanecen en memoria del servidor.
- Identidad de segmentos estable aunque cambien las firmas de la query: ruta HMAC por sesion y token opaco separado para cada URL completa. Las URLs firmadas no se mezclan ni se exponen.
- Sesiones separadas por navegador, cookie HttpOnly/SameSite y caducidad de 8 horas.
- Desconexión que invalida la sesión y cancela sus conexiones de video.
- Protección contra solicitudes cruzadas y contra acceso del proxy a direcciones privadas. El proveedor debe ser accesible por una dirección pública. Las pruebas usan un mock privado habilitado únicamente en su proceso.

## Límites de esta prueba

- Solo TV en vivo HLS (`.m3u8`). Películas, series, EPG y conversión desde TS quedan fuera de esta versión.
- El proveedor puede tener bloqueos por IP, user-agent o número de conexiones. Cambiar a `.m3u8` no convierte una transmisión TS en HLS.
- Un contenedor HLS no garantiza que sus códecs puedan reproducirse en cada dispositivo. La app no transcodifica audio ni video.
- Los canales HEVC/H.265 en TS pueden dar solo audio con HLS nativo. hls.js los reempaqueta en MP4 sin recodificar, siempre que el dispositivo admita HEVC. Se verifico imagen real en D SPORTS HD (Arg) y D SPORTS HD (Peru) en este PC. Si el dispositivo carece del decodificador, aun puede requerir otra variante del canal o conversion en servidor.
- En iPhone, ManagedMediaSource requiere Safari/iOS compatible (17.1 o superior); este modo desactiva la reproduccion remota para habilitar esa API. Versiones anteriores recurren al HLS nativo y pueden mantener la limitacion de HEVC en TS. Referencia: [WebKit sobre Safari 17.1](https://webkit.org/blog/14735/webkit-features-in-safari-17-1/).
- Si el audio avanza sin imagen durante 12 segundos de reproduccion, la interfaz avisa; no presenta esa situacion como reproduccion de video correcta.
- Ante errores fatales de red, hls.js intenta reconectar dos veces; los errores multimedia tienen un intento de recuperacion. Si falla, aparece Reintentar con una explicacion del fallo. Detener o cambiar canal cancela las reconexiones pendientes.
- La recuperacion de segmentos/listas conserva el buffer y el decodificador; solo vuelve a cargar la fuente completa si falla el manifiesto inicial. El presupuesto de intentos se renueva tras 30 segundos de reproduccion estable con avance real.
- Si la lista del proveedor presenta inconsistencias y hay una variante H.264 con el mismo nombre base, aparece Probar version H.264. Se comprobo GOL BOL 1 HD - h264 en este PC durante 35 segundos sin pausas ni cuadros perdidos; las otras fuentes y periodos mas largos dependen del proveedor. El cambio es voluntario.
- Para una Samsung compatible con AirPlay, se puede probar Duplicar pantalla desde el Centro de control del iPhone con ambos en la misma red. Esta version no integra envio directo a la TV; la duplicacion del video concreto requiere comprobarse en los dispositivos fisicos.
- Para evitar CORS y URLs con credenciales en el navegador, **todo el video de tu proveedor pasa por el PC**. La subida de su conexión limita la reproducción fuera del equipo; no es todavía la arquitectura de producción propuesta.
- La API y el video están aislados por sesión; no hay cuentas propias de la app ni controles para publicarla en internet. No expongas esta versión por un router o túnel.
- Si tu proveedor solo ofrece HTTP, las credenciales viajan sin cifrar desde el PC al proveedor. El acceso del iPhone al PC también usa HTTP en esta prueba.
- Las credenciales no se escriben en archivos ni localStorage. Se eliminan al desconectar, caducar la sesión o reiniciar el proceso. El usuario sí las introduce en su navegador; sus gestores de contraseñas son externos a la app.
- La reproducción real requiere probar tu cuenta: los tests automáticos usan un servidor simulado y no verifican el servicio de terceros.

## Verificación

```powershell
npm.cmd run check
npm.cmd test
```

Las pruebas integradas verifican autenticación, cuentas vencidas, aislamiento de sesiones, ocultación de credenciales, redirecciones, reescritura HLS, claves, rangos, cierre de transmisiones y bloqueo de orígenes privados/cruzados.

Para cambiar puerto/escucha en PowerShell:

```powershell
$env:PORT = '3001'
$env:HOST = '0.0.0.0'
npm.cmd start
```

En el puerto predeterminado, la escucha en `0.0.0.0` permite conexiones desde tu red local. Para limitar al propio PC, utiliza `HOST=127.0.0.1`.
