(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const ACCOUNT_KEY = 'ryzor.local.accounts.v1';
  const SESSION_KEY = 'ryzor.local.session.v1';
  const ORDER_KEY = 'ryzor.local.orders.v1';
  const TICKET_KEY = 'ryzor.local.support.v1';
  const ITERATIONS = 240000;
  let mode = 'login';

  const read = (key, fallback) => {
    try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value ?? fallback; }
    catch { return fallback; }
  };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const accounts = () => { const value = read(ACCOUNT_KEY, []); return Array.isArray(value) ? value : []; };
  const bytesToBase64 = bytes => btoa(String.fromCharCode(...bytes));
  const base64ToBytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
  const bytesToHex = bytes => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  async function hashPassword(password, salt) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: base64ToBytes(salt), iterations: ITERATIONS, hash: 'SHA-256' }, key, 256);
    return bytesToHex(new Uint8Array(bits));
  }
  function currentUser() {
    const email = String(localStorage.getItem(SESSION_KEY) || '').toLowerCase();
    return accounts().find(user => user.email === email) || null;
  }
  function status(message, error = false) {
    const node = $('#authStatus');
    node.textContent = message;
    node.hidden = false;
    node.classList.toggle('is-error', error);
  }
  function switchMode(next) {
    mode = next;
    $('#loginPanel').hidden = mode !== 'login';
    $('#registerPanel').hidden = mode !== 'register';
    document.querySelectorAll('[data-mode]').forEach(button => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    $('#authTitle').textContent = mode === 'login' ? 'Увійти в акаунт' : 'Створити акаунт';
    $('#authSubtitle').textContent = mode === 'login' ? 'Продовжуй з того місця, де зупинився.' : 'Заповни дані, щоб створити профіль.';
    $('#authStatus').hidden = true;
  }
  function listOrders(email) {
    const orders = read(ORDER_KEY, []);
    return Array.isArray(orders) ? orders.filter(order => order.email === email).sort((a,b) => b.createdAt - a.createdAt) : [];
  }
  function showAccount(user) {
    $('#authMain').hidden = true;
    $('#accountPanel').hidden = false;
    $('#accountName').textContent = user.fullName;
    $('#accountEmail').textContent = user.email;
    $('#accountAvatar').textContent = user.fullName.trim().charAt(0).toLocaleUpperCase('uk-UA');
    const orders = listOrders(user.email);
    const latest = orders[0];
    $('#accountPlanName').textContent = latest ? `${latest.planName} — заявка створена` : 'Без активної підписки';
    $('#accountPlanMeta').textContent = latest ? 'Зв’яжись із менеджером у Telegram для уточнення статусу. Дані заявки збережені лише в цьому браузері.' : 'Після оформлення тут з’явиться локальна історія заявок.';
    const holder = $('#accountOrders'); holder.replaceChildren();
    if (!orders.length) {
      const empty = document.createElement('p'); empty.className = 'account-muted'; empty.textContent = 'Замовлень поки немає.'; holder.append(empty);
    } else {
      orders.slice(0, 5).forEach(order => {
        const row = document.createElement('div'); row.className = 'account-order-row';
        const top = document.createElement('div'); top.className = 'account-order-top';
        const id = document.createElement('b'); id.textContent = order.serial;
        const state = document.createElement('span'); state.textContent = 'Очікує зв’язку';
        top.append(id, state);
        const meta = document.createElement('small'); meta.textContent = `${order.planName} · ${new Intl.NumberFormat('uk-UA').format(order.amount)} ₴ · ${new Date(order.createdAt).toLocaleDateString('uk-UA')}`;
        row.append(top, meta); holder.append(row);
      });
    }
  }
  function showAuth() {
    $('#accountPanel').hidden = true;
    $('#authMain').hidden = false;
    switchMode('login');
  }

  if (!window.isSecureContext || !crypto?.subtle) {
    status('Для локального захисту пароля відкрий сайт через HTTPS (GitHub Pages) або локальний безпечний сервер.', true);
  }
  document.querySelectorAll('[data-mode], [data-switch]').forEach(button => button.addEventListener('click', () => switchMode(button.dataset.mode || button.dataset.switch)));
  if (new URLSearchParams(location.search).get('mode') === 'register') switchMode('register');

  $('#registerForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    if (!window.isSecureContext || !crypto?.subtle) return status('Реєстрація потребує HTTPS-з’єднання.', true);
    const data = new FormData(form);
    const fullName = String(data.get('fullName') || '').trim().replace(/\s+/g, ' ');
    const email = String(data.get('email') || '').trim().toLowerCase();
    const password = String(data.get('password') || '');
    const confirmPassword = String(data.get('passwordConfirm') || '');
    if (fullName.split(' ').length < 2) return status('Вкажи ім’я та прізвище.', true);
    if (password.length < 10) return status('Пароль має містити щонайменше 10 символів.', true);
    if (password !== confirmPassword) return status('Паролі не збігаються.', true);
    if (!data.get('privacyConsent')) return status('Підтверди ознайомлення з політикою конфіденційності.', true);
    const button = form.querySelector('button[type="submit"]'); button.disabled = true; button.textContent = 'Створюємо…';
    try {
      const existing = accounts();
      if (existing.some(user => user.email === email)) return status('Акаунт із цією поштою вже існує на цьому пристрої.');
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const saltValue = bytesToBase64(salt);
      const passwordHash = await hashPassword(password, saltValue);
      const user = { fullName, email, salt: saltValue, passwordHash, iterations: ITERATIONS, createdAt: Date.now() };
      existing.push(user); write(ACCOUNT_KEY, existing);
      localStorage.setItem(SESSION_KEY, email);
      status('Акаунт створено на цьому пристрої.');
      showAccount(user);
      const next = new URLSearchParams(location.search).get('next');
      if (next && /^payment\.html(?:\?.*)?$/.test(next)) location.href = next;
    } catch (error) { status('Не вдалося створити локальний акаунт. Перевір налаштування браузера.', true); }
    finally { button.disabled = false; button.textContent = 'Створити акаунт'; }
  });

  $('#loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const email = String(data.get('email') || '').trim().toLowerCase();
    const password = String(data.get('password') || '');
    const user = accounts().find(item => item.email === email);
    if (!user) return status('Акаунт із такою поштою не знайдено на цьому пристрої.', true);
    const button = form.querySelector('button[type="submit"]'); button.disabled = true; button.textContent = 'Перевіряємо…';
    try {
      const attempt = await hashPassword(password, user.salt);
      if (attempt !== user.passwordHash) return status('Неправильна пошта або пароль.', true);
      localStorage.setItem(SESSION_KEY, email);
      status('Вхід виконано.'); showAccount(user);
      const next = new URLSearchParams(location.search).get('next');
      if (next && /^payment\.html(?:\?.*)?$/.test(next)) location.href = next;
    } catch { status('Не вдалося перевірити пароль у цьому браузері.', true); }
    finally { button.disabled = false; button.textContent = 'Увійти'; }
  });

  $('#logoutButton').addEventListener('click', () => {
    localStorage.removeItem(SESSION_KEY);
    $('#loginForm').reset(); showAuth(); status('Ти вийшов з акаунта.');
  });
  $('#refreshAccount')?.addEventListener('click', () => {
    const user = currentUser(); if (user) { showAccount(user); status('Дані оновлено з цього пристрою.'); }
  });
  $('#exportAccountButton')?.addEventListener('click', () => {
    const user = currentUser(); if (!user) return;
    const tickets = read(TICKET_KEY, []).filter(ticket => ticket.ownerEmail === user.email || ticket.email?.toLowerCase() === user.email);
    const orders = listOrders(user.email);
    const blob = new Blob([JSON.stringify({ fullName: user.fullName, email: user.email, createdAt: user.createdAt, tickets, orders }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = 'ryzor-local-data.json'; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    status('Файл із локальними даними завантажено.');
  });
  $('#deleteAccountButton')?.addEventListener('click', () => {
    const user = currentUser(); if (!user) return;
    if (!confirm(`Видалити локальний акаунт ${user.email}, його заявки та звернення з цього браузера?`)) return;
    write(ACCOUNT_KEY, accounts().filter(item => item.email !== user.email));
    write(TICKET_KEY, read(TICKET_KEY, []).filter(ticket => ticket.ownerEmail !== user.email && ticket.email?.toLowerCase() !== user.email));
    write(ORDER_KEY, read(ORDER_KEY, []).filter(order => order.email !== user.email));
    localStorage.removeItem(SESSION_KEY);
    $('#loginForm').reset(); showAuth(); status('Локальний акаунт і пов’язані дані видалено.');
  });

  const user = currentUser();
  if (user) showAccount(user); else showAuth();
})();
