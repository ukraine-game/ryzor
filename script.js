(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const config = window.RYZOR_CONFIG || {};
  const apiBase = String(config.apiBase || '').replace(/\/$/, '');
  const toast = $('#toast');
  let toastTimer;
  let activeGame = null;
  let launchPoll = null;
  let launchDeadline = 0;
  let selectedTicketId = '';
  let ticketRefresh = null;

  function notify(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
  }

  async function api(path, options = {}) {
    if (!apiBase) throw new Error('API Ryzor ще не підключено. Власнику потрібно вказати адресу Worker у config.js.');
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      mode: 'cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json', ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) throw new Error(payload.error || `Помилка запиту (${response.status})`);
    return payload;
  }

  // Navigation
  const navToggle = $('#navToggle');
  const mainNav = $('#mainNav');
  navToggle?.addEventListener('click', () => {
    const opened = mainNav.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(opened));
  });
  $$('#mainNav a').forEach(link => link.addEventListener('click', () => {
    mainNav.classList.remove('open');
    navToggle?.setAttribute('aria-expanded', 'false');
  }));

  // Search and filters
  let activeFilter = 'all';
  const gameCards = $$('.game-card');
  const search = $('#gameSearch');
  const filters = $$('.filter[data-filter]');
  function filterGames() {
    const query = (search?.value || '').trim().toLocaleLowerCase('uk-UA');
    let visible = 0;
    gameCards.forEach(card => {
      const matchFilter = activeFilter === 'all' || card.dataset.category === activeFilter;
      const matchText = !query || (card.dataset.search || '').toLocaleLowerCase('uk-UA').includes(query);
      card.hidden = !(matchFilter && matchText);
      if (!card.hidden) visible++;
    });
    $('#emptyGames').hidden = visible > 0;
  }
  filters.forEach(button => button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    filters.forEach(item => {
      const selected = item === button;
      item.classList.toggle('is-active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    filterGames();
  }));
  search?.addEventListener('input', filterGames);

  // Game launch gate: Telegram /start is verified server-side through a one-time deep-link token.
  const modal = $('#gameModal');
  const launchButton = $('#startTelegram');
  const launchHint = $('#launchHint');
  const launchState = $('#launchState');
  const botLink = $('.modal-secondary', modal);
  function closeGameModal() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    clearInterval(launchPoll);
    launchPoll = null;
  }
  function openGameModal(button) {
    activeGame = {
      name: button.dataset.game || 'Гра',
      image: button.dataset.image || '',
      description: button.dataset.description || '',
      kind: button.dataset.kind || 'GAME'
    };
    $('#modalGameTitle').textContent = activeGame.name;
    $('#modalGameDescription').textContent = activeGame.description;
    $('#modalGameKind').textContent = activeGame.kind;
    $('#modalGameImage').src = activeGame.image;
    $('#modalGameImage').alt = activeGame.name;
    launchState.innerHTML = '<span class="state-marker">01</span><div><strong>ПЕРЕД ЗАПУСКОМ</strong><p>Підтверди, що хочеш продовжити, та натисни Start у Telegram-боті <b>@ryzor_bot</b>. Після цього сайт підтвердить підключення.</p></div>';
    launchButton.disabled = false;
    launchButton.innerHTML = 'ПЕРЕЙТИ ДО TELEGRAM <span>↗</span>';
    launchHint.textContent = apiBase ? 'Після переходу натисни Start у боті. Вікно сайту можна залишити відкритим.' : 'Підключення ще не налаштоване: власник має додати адресу Worker у config.js.';
    botLink.href = 'https://t.me/ryzor_bot';
    clearInterval(launchPoll);
    modal.hidden = false;
    document.body.classList.add('modal-open');
    $('#closeGameModal').focus();
  }
  gameCards.forEach(card => {
    const button = $('.game-open', card);
    button?.addEventListener('click', () => openGameModal(button));
  });
  $('#closeGameModal')?.addEventListener('click', closeGameModal);
  modal?.addEventListener('click', event => { if (event.target === modal) closeGameModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && modal && !modal.hidden) closeGameModal(); });

  launchButton?.addEventListener('click', async () => {
    if (!activeGame) return;
    launchButton.disabled = true;
    launchButton.textContent = 'СТВОРЮЄМО ЗАПИТ…';
    launchHint.textContent = 'Готуємо одноразове посилання для перевірки Telegram.';
    let telegramTab = null;
    try {
      // Open a blank tab synchronously during the click so popup blockers do not swallow the Telegram link.
      telegramTab = window.open('about:blank', '_blank');
      if (telegramTab) telegramTab.opener = null;
      const result = await api('/api/launch/create', {
        method: 'POST',
        body: JSON.stringify({ game: activeGame.name })
      });
      const sessionId = result.sessionId;
      const sessionToken = result.sessionToken;
      if (!sessionId || !sessionToken || !result.botUrl) throw new Error('Сервер повернув неповні дані запуску.');
      botLink.href = result.botUrl;
      if (modal.hidden) {
        if (telegramTab && !telegramTab.closed) telegramTab.close();
        return;
      }
      if (telegramTab && !telegramTab.closed) {
        telegramTab.location.replace(result.botUrl);
      } else {
        launchHint.textContent = 'Браузер заблокував нову вкладку. Натисни «Відкрити @ryzor_bot окремо», а потім Start.';
      }
      launchState.innerHTML = '<span class="state-marker">02</span><div><strong>ОЧІКУЄМО НА /START</strong><p>Відкрий бота та натисни Start. Сайт перевірятиме підтвердження автоматично. Посилання дійсне 5 хвилин.</p></div>';
      launchButton.textContent = 'ОЧІКУЄМО ПІДТВЕРДЖЕННЯ…';
      launchDeadline = Date.now() + 5 * 60 * 1000;
      clearInterval(launchPoll);
      const check = async () => {
        if (Date.now() > launchDeadline) {
          clearInterval(launchPoll);
          launchButton.disabled = false;
          launchButton.textContent = 'СПРОБУВАТИ ЩЕ РАЗ';
          launchHint.textContent = 'Час підтвердження минув. Створи нове посилання та повтори /start.';
          return;
        }
        try {
          const status = await api('/api/launch/status', { method: 'POST', body: JSON.stringify({ sessionId, sessionToken }) });
          if (status.verified) {
            clearInterval(launchPoll);
            launchState.innerHTML = '<span class="state-marker state-ok">✓</span><div><strong>TELEGRAM ПІДТВЕРДЖЕНО</strong><p>Бот отримав команду /start. Тепер Ryzor може пов’язати цей запит із твоїм Telegram.</p></div>';
            launchButton.disabled = true;
            launchButton.textContent = 'ПІДТВЕРДЖЕНО';
            launchHint.textContent = 'Хмарні ігрові сервери ще готуються. Це підтверджує Telegram, але поки не створює віддалену ігрову сесію.';
          }
        } catch (error) {
          launchHint.textContent = error.message;
          clearInterval(launchPoll);
          launchButton.disabled = false;
          launchButton.textContent = 'СПРОБУВАТИ ЩЕ РАЗ';
        }
      };
      launchPoll = setInterval(check, 2500);
      await check();
    } catch (error) {
      if (telegramTab && !telegramTab.closed) telegramTab.close();
      launchButton.disabled = false;
      launchButton.textContent = 'ПОВТОРИТИ';
      launchHint.textContent = error.message;
    }
  });

  // Support inbox. Only random ticket credentials are stored locally; the Worker stores ticket content in D1.
  const STORAGE_KEY = 'ryzor.support.v1';
  function getSavedTickets() {
    try {
      const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(list) ? list.filter(item => /^RZ-[A-Z0-9]{5,10}$/.test(item.id) && typeof item.key === 'string') : [];
    } catch { return []; }
  }
  function saveTickets(list) { localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 10))); }
  function setSupportStatus(message, error = false) {
    const node = $('#supportStatus');
    node.textContent = message;
    node.classList.toggle('error', error);
  }
  function renderTicketList() {
    const holder = $('#ticketList');
    const tickets = getSavedTickets();
    holder.replaceChildren();
    if (!tickets.length) {
      const empty = document.createElement('div');
      empty.className = 'inbox-empty';
      empty.textContent = 'Поки немає звернень. Створи перше зліва.';
      holder.append(empty);
      return;
    }
    tickets.forEach(ticket => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `ticket-row${ticket.id === selectedTicketId ? ' selected' : ''}`;
      const id = document.createElement('b'); id.textContent = ticket.id;
      const meta = document.createElement('span'); meta.textContent = ticket.category || 'Підтримка';
      const arrow = document.createElement('i'); arrow.textContent = '↗';
      button.append(id, meta, arrow);
      button.addEventListener('click', () => selectTicket(ticket.id));
      holder.append(button);
    });
  }
  function activeTicket() { return getSavedTickets().find(item => item.id === selectedTicketId); }
  function appendMessage(message) {
    const box = $('#chatMessages');
    const bubble = document.createElement('article');
    bubble.className = `chat-bubble ${message.actor === 'admin' ? 'from-admin' : 'from-user'}`;
    const author = document.createElement('small'); author.textContent = message.actor === 'admin' ? 'RYZOR SUPPORT' : 'ТИ';
    const body = document.createElement('p'); body.textContent = message.body;
    const time = document.createElement('time');
    if (message.createdAt) time.textContent = new Date(message.createdAt * 1000).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    bubble.append(author, body, time);
    box.append(bubble);
  }
  async function selectTicket(ticketId) {
    selectedTicketId = ticketId;
    renderTicketList();
    const ticket = activeTicket();
    if (!ticket) return;
    $('#ticketChat').hidden = false;
    $('#activeTicketId').textContent = ticket.id;
    $('#activeTicketMeta').textContent = `${ticket.category || 'SUPPORT'} / ${ticket.status || 'OPEN'}`.toUpperCase();
    $('#chatMessages').replaceChildren();
    try {
      const data = await api('/api/support/messages', { method: 'POST', body: JSON.stringify({ id: ticket.id, key: ticket.key }) });
      $('#chatMessages').replaceChildren();
      data.messages.forEach(appendMessage);
      $('#activeTicketMeta').textContent = `${data.ticket.status.toUpperCase()} / ${ticket.category || 'SUPPORT'}`;
      $('#replyForm').hidden = data.ticket.status === 'closed';
      $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
    } catch (error) {
      const err = document.createElement('p'); err.className = 'chat-error'; err.textContent = error.message;
      $('#chatMessages').append(err);
    }
  }
  $('#supportForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const button = $('button[type="submit"]', form);
    const oldText = button.textContent;
    button.disabled = true; button.textContent = 'НАДСИЛАЄМО…';
    const data = new FormData(form);
    try {
      const result = await api('/api/support/create', {
        method: 'POST',
        body: JSON.stringify({ nickname: data.get('nickname'), email: data.get('email'), category: data.get('category'), message: data.get('message') })
      });
      const tickets = getSavedTickets();
      tickets.unshift({ id: result.ticketId, key: result.accessKey, category: String(data.get('category')), status: 'open' });
      saveTickets(tickets);
      setSupportStatus(result.adminNotified ? `Звернення ${result.ticketId} створено й надіслано адміністратору. Ключ доступу збережено в цьому браузері. Не передавай його іншим і не очищай дані сайту, поки діалог потрібен.` : `Звернення ${result.ticketId} збережено, але Telegram не підтвердив сповіщення адміністратора. Повідомлення залишилося в системі; власнику потрібно перевірити Telegram Worker.` , !result.adminNotified);
      form.reset();
      await selectTicket(result.ticketId);
      notify(result.adminNotified ? `Звернення ${result.ticketId} надіслано адміністратору.` : `Звернення ${result.ticketId} збережено, але Telegram не сповістив адміністратора.`);
    } catch (error) {
      setSupportStatus(error.message, true);
    } finally {
      button.disabled = false; button.textContent = oldText;
    }
  });
  $('#replyForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const ticket = activeTicket();
    const input = $('#replyText');
    const message = input.value.trim();
    if (!ticket || !message) return;
    const button = $('button[type="submit"]', event.currentTarget);
    button.disabled = true;
    try {
      const result = await api('/api/support/message', { method: 'POST', body: JSON.stringify({ ticketId: ticket.id, accessKey: ticket.key, message }) });
      input.value = '';
      if (!result.adminNotified) notify('Повідомлення збережено, але Telegram не сповістив адміністратора.');
      await selectTicket(ticket.id);
    } catch (error) { notify(error.message); }
    finally { button.disabled = false; }
  });
  $('#refreshTickets')?.addEventListener('click', async () => {
    renderTicketList();
    if (selectedTicketId) await selectTicket(selectedTicketId);
    else notify('Список звернень оновлено.');
  });
  $('#closeTicketChat')?.addEventListener('click', () => { $('#ticketChat').hidden = true; selectedTicketId = ''; renderTicketList(); });
  renderTicketList();
  const initialTickets = getSavedTickets();
  if (initialTickets.length) selectTicket(initialTickets[0].id);
  ticketRefresh = setInterval(() => { if (!document.hidden && selectedTicketId) selectTicket(selectedTicketId); }, 15000);

  $('#year').textContent = String(new Date().getFullYear());
})();
