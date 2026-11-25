/* Public website configuration. Never put secrets or a Telegram bot token here. */
window.RYZOR_CONFIG = {
  apiBase: "", // Example: https://ryzor-api.YOUR-SUBDOMAIN.workers.dev
  googleClientId: "", // Public Google OAuth Client ID; never place the Telegram token here.
  paymentsEnabled: false, // Keep false until streaming and lawful payment setup are live.
  payment: {
    bank: "",
    recipient: "",
    cardNumber: "",
    iban: ""
  }
};
