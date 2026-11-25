(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const config = window.RYZOR_CONFIG || {};
  const apiBase = String(config.apiBase || '').replace(/\/$/, '');
  const googleClientId = String(config.googleClientId || '').trim();
  const SESSION_KEY = 'ryzor.auth.session.v1';
  let pendingCredential = '';
  let googleInitialized = false;

  function status(message, error = false) {
    const node = $('#authStatus');
    node.textContent = message;
    node.classList.toggle('is-error', error);
    node.hidden = false;
  }
  function clearStatus() {
    const node = $('#authStatus');
    node.hidden = true;
    node.textContent = '';
  }
  async function api(path, body, token = '') {
    if (!apiBase) throw new Error('API ще не підключено. Власнику потрібно вказати адресу Cloudflare Worker у config.js.');
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${apiBase}${path}`, {
      method: 'POST', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers, body: JSON.stringify(body || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok !== true) throw new Error(data.error || `Помилка запиту (${response.status})`);
    return data;
  }
  const PASSWORD_ITERATIONS = 600000;
  function toBase64Url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function fromBase64Url(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
  }
  async function derivePasswordProof(password, salt, iterations = PASSWORD_ITERATIONS) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64Url(salt), iterations }, material, 256);
    return toBase64Url(new Uint8Array(bits));
  }
  function switchMode(mode) {
    const isLogin = mode === 'login';
    $('#loginPanel').hidden = !isLogin;
    $('#registerPanel').hidden = isLogin;
    $$('.mode-tab').forEach(tab => {
      const selected = tab.dataset.mode === mode;
      tab.classList.toggle('is-active', selected);
      tab.setAttribute('aria-selected', String(selected));
    });
    $('#authTitle').textContent = isLogin ? 'Увійти в акаунт' : 'Створити акаунт';
    $('#authSubtitle').textContent = isLogin ? 'Продовжуй з того місця, де зупинився.' : 'Спочатку Google, потім дані профілю та пароль.';
    clearStatus();
    if (!isLogin) setTimeout(() => waitForGoogle(), 0);
  }
  $$('.mode-tab').forEach(tab => tab.addEventListener('click', () => switchMode(tab.dataset.mode)));
  $$('[data-switch]').forEach(button => button.addEventListener('click', () => switchMode(button.dataset.switch)));

  function showAccount(user) {
    $('#authMain').hidden = true;
    $('#accountPanel').hidden = false;
    $('#accountName').textContent = user.fullName || 'Твій акаунт';
    $('#accountEmail').textContent = user.email || '';
    $('#accountAvatar').textContent = (user.fullName || 'R').trim().charAt(0).toLocaleUpperCase('uk-UA');
    clearStatus();
  }
  function requestedNextUrl() {
    const raw = new URLSearchParams(location.search).get('next');
    if (!raw) return null;
    try {
      const target = new URL(raw, location.href);
      if (target.origin !== location.origin || target.pathname.endsWith('/auth.html') || target.pathname.includes('\\')) return null;
      return target.href;
    } catch { return null; }
  }
  function finishLogin(data) {
    sessionStorage.setItem(SESSION_KEY, data.sessionToken);
    sessionStorage.setItem('ryzor.auth.user.v1', JSON.stringify(data.user));
    showAccount(data.user);
    loadAccountOverview();
    status('Акаунт готовий.');
    const next = requestedNextUrl();
    if (next) setTimeout(() => location.replace(next), 450);
  }
  function renderAccountOverview(data) {
    const planName = $('#accountPlanName');
    const planMeta = $('#accountPlanMeta');
    if (data.subscription) {
      const names = { free: 'Безкоштовний тариф', pro: 'Професійний', unlimited: 'Безлімітний' };
      planName.textContent = names[data.subscription.plan_code] || data.subscription.plan_code;
      planMeta.textContent = data.subscription.ends_at ? `Активна до ${new Date(data.subscription.ends_at * 1000).toLocaleDateString('uk-UA')}` : 'Активна без кінцевої дати';
    } else {
      planName.textContent = 'Без активної підписки';
      planMeta.textContent = 'Після підтвердження замовлення статус з’явиться тут.';
    }
    const holder = $('#accountOrders');
    holder.replaceChildren();
    if (!data.orders?.length) {
      const empty = document.createElement('p'); empty.className = 'account-muted'; empty.textContent = 'Замовлень поки немає.'; holder.append(empty); return;
    }
    const states = { awaiting_payment: 'Очікує оплату', proof_processing: 'Надсилання підтвердження', pending_review: 'На перевірці', approved: 'Підтверджено', rejected: 'Відхилено', expired: 'Час минув' };
    data.orders.forEach(order => {
      const row = document.createElement('div'); row.className = 'account-order-row';
      const top = document.createElement('div'); top.className = 'account-order-top';
      const id = document.createElement('b'); id.textContent = order.order_id;
      const state = document.createElement('span'); state.textContent = states[order.status] || order.status;
      top.append(id, state);
      const meta = document.createElement('small'); meta.textContent = `${order.plan_name} · ${new Intl.NumberFormat('uk-UA').format(order.amount_uah)} ₴ · ${new Date(order.created_at * 1000).toLocaleDateString('uk-UA')}`;
      row.append(top, meta);
      if (order.review_note) { const note = document.createElement('small'); note.className = 'account-order-note'; note.textContent = `Коментар адміністратора: ${order.review_note}`; row.append(note); }
      holder.append(row);
    });
  }
  async function loadAccountOverview() {
    const token = sessionStorage.getItem(SESSION_KEY) || '';
    if (!token || !apiBase) return;
    try { renderAccountOverview(await api('/api/account/overview', {}, token)); }
    catch (error) { $('#accountPlanMeta').textContent = error.message; }
  }

  function renderGoogleButton() {
    if (googleInitialized) return true;
    if (!googleClientId) {
      $('#googleButton').textContent = 'Власнику сайту потрібно додати googleClientId у config.js.';
      return false;
    }
    if (!window.google?.accounts?.id) return false;
    googleInitialized = true;
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: async response => {
        clearStatus();
        if (!response?.credential) return status('Google не повернув підтвердження. Спробуй ще раз.', true);
        pendingCredential = response.credential;
        const button = $('#googleButton');
        button.classList.add('is-loading');
        try {
          const result = await api('/api/auth/google/verify', { credential: pendingCredential });
          if (result.registered) {
            $('#loginForm [name="email"]').value = result.email || '';
            switchMode('login');
            status('Цей Google-акаунт уже зареєстрований. Увійди за email і паролем.');
            pendingCredential = '';
            return;
          }
          $('#googleStep').hidden = true;
          $('#registerForm').hidden = false;
          $('#verifiedEmail').textContent = result.email;
          $('#registerForm [name="fullName"]').value = result.name || '';
          $('#registerForm [name="fullName"]').focus();
        } catch (error) {
          pendingCredential = '';
          status(error.message, true);
        } finally {
          button.classList.remove('is-loading');
        }
      }
    });
    $('#googleButton').replaceChildren();
    window.google.accounts.id.renderButton($('#googleButton'), {
      type: 'standard', theme: 'filled_black', size: 'large', text: 'continue_with',
      shape: 'rectangular', logo_alignment: 'left', locale: 'uk'
    });
    return true;
  }
  function waitForGoogle(attempt = 0) {
    if (renderGoogleButton()) return;
    if (attempt < 40) setTimeout(() => waitForGoogle(attempt + 1), 250);
  }
  // Render Google Identity Services only after the registration panel becomes visible.

  $('#changeGoogle')?.addEventListener('click', () => {
    pendingCredential = '';
    $('#registerForm').reset();
    $('#registerForm').hidden = true;
    $('#googleStep').hidden = false;
    clearStatus();
  });

  $('#registerForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    if (!pendingCredential) return status('Спочатку підтверди Google-акаунт.', true);
    if (!$('[name=privacyConsent]', form)?.checked) return status('Перед створенням акаунта ознайомся з Політикою конфіденційності.', true);
    const data = new FormData(form);
    const fullName = String(data.get('fullName') || '').trim().replace(/\s+/g, ' ');
    const password = String(data.get('password') || '');
    const confirmation = String(data.get('passwordConfirm') || '');
    if (fullName.length < 2) return status('Вкажи повне ім’я.', true);
    if (password !== confirmation) return status('Паролі не збігаються. Перевір повторне введення.', true);
    if (password.length < 10) return status('Пароль має містити щонайменше 10 символів.', true);
    const button = $('button[type="submit"]', form);
    button.disabled = true;
    button.innerHTML = 'Захищаємо пароль…';
    try {
      const saltBytes = crypto.getRandomValues(new Uint8Array(16));
      const passwordSalt = toBase64Url(saltBytes);
      const passwordProof = await derivePasswordProof(password, passwordSalt, PASSWORD_ITERATIONS);
      const result = await api('/api/auth/register', { credential: pendingCredential, fullName, passwordSalt, passwordProof, privacyConsent: true });
      pendingCredential = '';
      finishLogin(result);
    } catch (error) { status(error.message, true); }
    finally { button.disabled = false; button.innerHTML = 'Створити акаунт'; }
  });

  $('#loginForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const button = $('button[type="submit"]', form);
    button.disabled = true;
    button.textContent = 'Перевіряємо…';
    try {
      const email = String(data.get('email') || '').trim().toLowerCase();
      const password = String(data.get('password') || '');
      const challenge = await api('/api/auth/salt', { email });
      const passwordProof = await derivePasswordProof(password, challenge.salt, Number(challenge.iterations) || PASSWORD_ITERATIONS);
      const result = await api('/api/auth/login', { email, passwordProof });
      finishLogin(result);
    } catch (error) { status(error.message, true); }
    finally { button.disabled = false; button.innerHTML = 'Увійти'; }
  });

  $('#logoutButton')?.addEventListener('click', async () => {
    const token = sessionStorage.getItem(SESSION_KEY) || '';
    try { if (token) await api('/api/auth/logout', {}, token); } catch { /* Local sign-out still clears this browser session. */ }
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem('ryzor.auth.user.v1');
    $('#accountPanel').hidden = true;
    $('#authMain').hidden = false;
    $('#loginForm').reset();
    switchMode('login');
    status('Ти вийшов з акаунта.');
  });

  $('#refreshAccount')?.addEventListener('click', loadAccountOverview);
  $('#exportAccountButton')?.addEventListener('click', async () => {
    const token = sessionStorage.getItem(SESSION_KEY) || '';
    const button = $('#exportAccountButton');
    if (!token) return status('Увійди в акаунт ще раз.', true);
    button.disabled = true;
    try {
      const data = await api('/api/account/export', {}, token);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `ryzor-personal-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      status('Копію твоїх даних підготовлено.');
    } catch (error) { status(error.message, true); }
    finally { button.disabled = false; }
  });
  $('#deleteAccountButton')?.addEventListener('click', async () => {
    const token = sessionStorage.getItem(SESSION_KEY) || '';
    const email = String(sessionStorage.getItem('ryzor.auth.user.v1') ? JSON.parse(sessionStorage.getItem('ryzor.auth.user.v1')).email : '').toLowerCase();
    if (!token || !email) return status('Увійди в акаунт ще раз.', true);
    const confirmation = prompt(`Щоб видалити акаунт і пов’язані замовлення, введи email: ${email}`);
    if (!confirmation) return;
    if (confirmation.trim().toLowerCase() !== email) return status('Email не збігається. Видалення скасовано.', true);
    const button = $('#deleteAccountButton'); button.disabled = true;
    try {
      const removal = await api('/api/auth/delete', { confirmEmail: email }, token);
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem('ryzor.auth.user.v1');
      $('#accountPanel').hidden = true; $('#authMain').hidden = false; switchMode('login');
      const failedCopies = Number(removal.telegramCopies?.failed || 0);
      status(failedCopies ? 'Акаунт і веб-дані видалено. Частину старих повідомлень у Telegram не вдалося видалити автоматично — звернися до адміністратора.' : 'Акаунт і пов’язані замовлення видалено. Незалежні звернення до підтримки можна видалити окремо у відповідному чаті.');
    } catch (error) { status(error.message, true); }
    finally { button.disabled = false; }
  });

  async function restoreSession() {
    const token = sessionStorage.getItem(SESSION_KEY);
    if (!token) return;
    try {
      const result = await api('/api/auth/me', {}, token);
      showAccount(result.user);
      loadAccountOverview();
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem('ryzor.auth.user.v1');
    }
  }
  restoreSession();
  if (!apiBase) status('Підключення до сервера акаунтів ще не налаштоване. Після розгортання Cloudflare Worker реєстрація та вхід запрацюють.', true);
})();
