(() => {
  const installCard = document.querySelector('#install-card');
  const installButton = document.querySelector('#install-button');
  const dialog = document.querySelector('#install-dialog');
  const updateCard = document.querySelector('#app-update');
  const updateButton = document.querySelector('#update-button');
  const displayMode = matchMedia('(display-mode: standalone)');
  const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let installPrompt;
  let registration;
  let applyingUpdate = false;
  function updateInstallCard() {
    installCard.hidden = displayMode.matches || navigator.standalone === true;
  }
  updateInstallCard();
  displayMode.addEventListener('change', updateInstallCard);
  document.querySelector('#iphone-install-steps').hidden = !isAppleMobile;
  document.querySelector('#install-requirement').hidden = window.isSecureContext;
  if (isAppleMobile) document.querySelector('#install-description').textContent = 'En iPhone, la instalación se hace desde el menú Compartir de Safari.';
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event; updateInstallCard();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null; installCard.hidden = true; dialog.close();
  });
  document.querySelector('#close-install').addEventListener('click', () => dialog.close());
  installButton.addEventListener('click', async () => {
    if (!installPrompt) { dialog.showModal(); return; }
    const prompt = installPrompt; installPrompt = null;
    installButton.disabled = true;
    try { await prompt.prompt(); await prompt.userChoice; }
    catch { dialog.showModal(); }
    finally { installButton.disabled = false; }
  });
  function showUpdate() {
    if (registration?.waiting && navigator.serviceWorker.controller) updateCard.hidden = false;
  }
  updateButton.addEventListener('click', () => {
    if (!registration?.waiting) return;
    applyingUpdate = true; updateButton.disabled = true;
    updateButton.textContent = 'Actualizando…';
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  });
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (applyingUpdate) window.location.reload();
    });
    window.addEventListener('load', async () => {
      try {
        registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
        showUpdate();
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => { if (worker.state === 'installed') showUpdate(); });
        });
      } catch {
        document.querySelector('#install-description').textContent = 'No se pudo preparar la app para uso sin conexión. Comprueba tu conexión y recarga la página.';
      }
    });
  }
})();
