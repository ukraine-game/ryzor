(() => {
  'use strict';
  const CONSENT_KEY = 'ryzor.telegram.notifications.consent.v1';
  const apiBase = String(window.RYZOR_API_BASE || '').replace(/\/$/, '');

  function hasConsent() {
    try { return localStorage.getItem(CONSENT_KEY) === 'yes'; }
    catch { return false; }
  }

  function setConsent(enabled) {
    try { localStorage.setItem(CONSENT_KEY, enabled ? 'yes' : 'no'); }
    catch { /* Сповіщення просто залишаються вимкненими, якщо сховище недоступне. */ }
  }

  async function notify(event, details = {}) {
    if (!hasConsent()) return false;
    try {
      const response = await fetch(`${apiBase}/api/telegram/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, details })
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  function syncConsentControls() {
    document.querySelectorAll('[name="telegramNotifyConsent"]').forEach(input => {
      input.checked = hasConsent();
    });
  }

  window.RyzorNotify = Object.freeze({ hasConsent, setConsent, notify, syncConsentControls });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncConsentControls, { once: true });
  else syncConsentControls();
})();
