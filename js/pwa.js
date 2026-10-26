// Kept independent of authentication so installation also works while signed out.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register(
        new URL('../sw.js', import.meta.url),
        { scope: new URL('../', import.meta.url).pathname, updateViaCache: 'none' }
      );
      // Never reload automatically: an open editor may contain unsaved work.
      const checkForUpdate = () => registration.update().catch(() => {});
      checkForUpdate();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
    } catch (error) {
      // Installation is optional; a failed/offline registration must not stop the app.
      console.warn('Home Screen app setup unavailable:', error);
    }
  }, { once: true });
}
