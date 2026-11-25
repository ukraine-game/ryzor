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
    if (!apiBase) throw new Error('Сервіс тимчасово недоступний. Спробуй трохи пізніше.');
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      mode: 'cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json', ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) {
      const detail = String(payload.error || '');
      const internal = /(worker|cloudflare|config\.js|власник|адміністратор|не налаштован|не підключено|d1|auth_salt|google_client_id)/i.test(detail);
      throw new Error(internal ? 'Сервіс тимчасово недоступний. Спробуй трохи пізніше.' : (detail || `Помилка запиту (${response.status})`));
    }
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

  // Reflect an account already signed in during this browser tab.
  const accountLink = $('#accountLink');
  if (accountLink) {
    try {
      const user = JSON.parse(sessionStorage.getItem('ryzor.auth.user.v1') || 'null');
      if (user && typeof user.fullName === 'string') {
        accountLink.textContent = user.fullName.split(/\s+/)[0];
        accountLink.setAttribute('aria-label', `Мій акаунт: ${user.fullName}`);
      }
    } catch { sessionStorage.removeItem('ryzor.auth.user.v1'); }
  }

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
    launchState.innerHTML = '<span class="state-marker">1</span><div><strong>Перед запуском</strong><p>Підтверди, що хочеш продовжити, та натисни Start у Telegram-боті <b>@ryzor_bot</b>. Після цього сайт підтвердить підключення.</p></div>';
    launchButton.disabled = false;
    launchButton.innerHTML = 'Перейти до Telegram';
    launchHint.textContent = 'Перейди до Telegram та натисни Start у боті. Вікно сайту можна залишити відкритим.';
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
    launchButton.textContent = 'Створюємо запит…';
    launchHint.textContent = 'Зараз відкриється Telegram для підтвердження.';
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
      launchState.innerHTML = '<span class="state-marker">2</span><div><strong>Очікуємо на /start</strong><p>Відкрий бота та натисни Start. Сайт перевірятиме підтвердження автоматично. Посилання дійсне 5 хвилин.</p></div>';
      launchButton.textContent = 'Очікуємо підтвердження…';
      launchDeadline = Date.now() + 5 * 60 * 1000;
      clearInterval(launchPoll);
      const check = async () => {
        if (Date.now() > launchDeadline) {
          clearInterval(launchPoll);
          launchButton.disabled = false;
          launchButton.textContent = 'Спробувати ще раз';
          launchHint.textContent = 'Час підтвердження минув. Створи нове посилання та повтори /start.';
          return;
        }
        try {
          const status = await api('/api/launch/status', { method: 'POST', body: JSON.stringify({ sessionId, sessionToken }) });
          if (status.verified) {
            clearInterval(launchPoll);
            launchState.innerHTML = '<span class="state-marker state-ok">✓</span><div><strong>Telegram підтверджено</strong><p>Бот отримав команду /start. Тепер Ryzor може пов’язати цей запит із твоїм Telegram.</p></div>';
            launchButton.disabled = true;
            launchButton.textContent = 'Підтверджено';
            launchHint.textContent = 'Telegram успішно підтверджено. Дякуємо!';
          }
        } catch (error) {
          launchHint.textContent = error.message;
          clearInterval(launchPoll);
          launchButton.disabled = false;
          launchButton.textContent = 'Спробувати ще раз';
        }
      };
      launchPoll = setInterval(check, 2500);
      await check();
    } catch (error) {
      if (telegramTab && !telegramTab.closed) telegramTab.close();
      launchButton.disabled = false;
      launchButton.textContent = 'Повторити';
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
    button.disabled = true; button.textContent = 'Надсилаємо…';
    const data = new FormData(form);
    try {
      const result = await api('/api/support/create', {
        method: 'POST',
        body: JSON.stringify({ nickname: data.get('nickname'), email: data.get('email'), category: data.get('category'), game: data.get('game'), message: data.get('message'), privacyConsent: data.get('privacyConsent') === 'on' })
      });
      const tickets = getSavedTickets();
      tickets.unshift({ id: result.ticketId, key: result.accessKey, category: String(data.get('category')), status: 'open' });
      saveTickets(tickets);
      setSupportStatus(result.adminNotified ? `Звернення ${result.ticketId} створено й надіслано адміністратору. Ключ доступу збережено в цьому браузері. Не передавай його іншим і не очищай дані сайту, поки діалог потрібен.` : `Звернення ${result.ticketId} збережено, але команда підтримки ще не отримала сповіщення. Спробуй оновити сторінку пізніше.` , !result.adminNotified);
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


  // A local allow-list of Steam catalog suggestions. Typed text stays in this browser;
  // only the selected title is included in the support ticket.
  const ticketGameInput = $('#ticketGame');
  const gameSuggestions = $('#gameSuggestions');
  const steamSuggestions = [
    { name: 'Grand Mountain Adventure: Wonderlands', app: '1247360' },
    { name: 'Grand Mountain Adventure 2', app: '3605330' },
    { name: 'Euro Truck Simulator 2', app: '227300' },
    { name: 'Trackmania', app: '2225070' },
    { name: 'City Car Driving', app: '493490' },
    { name: 'Farming Simulator 25', app: '2300320' },
    { name: 'EA SPORTS FC 26', app: '3405690' },
    { name: 'Supermarket Simulator', app: '2670630' },
    { name: 'PowerWash Simulator', app: '1290000' },
    { name: 'Unpacking', app: '1135690' },
    { name: 'Stardew Valley', app: '413150' },
    { name: 'House Flipper', app: '613100' }
  ];
  let activeSuggestionIndex = -1;
  let filteredSuggestions = [];
  function closeGameSuggestions() {
    if (!gameSuggestions || !ticketGameInput) return;
    gameSuggestions.hidden = true;
    gameSuggestions.replaceChildren();
    ticketGameInput.setAttribute('aria-expanded', 'false');
    ticketGameInput.removeAttribute('aria-activedescendant');
    activeSuggestionIndex = -1;
  }
  function renderGameSuggestions() {
    if (!ticketGameInput || !gameSuggestions) return;
    const query = ticketGameInput.value.trim().toLocaleLowerCase('uk-UA');
    filteredSuggestions = query.length >= 2
      ? steamSuggestions.filter(item => item.name.toLocaleLowerCase('uk-UA').includes(query)).slice(0, 6)
      : [];
    gameSuggestions.replaceChildren();
    if (!filteredSuggestions.length) return closeGameSuggestions();
    filteredSuggestions.forEach((game, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.id = `game-suggestion-${index}`;
      option.className = 'game-suggestion';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(index === activeSuggestionIndex));
      const cover = document.createElement('img');
      cover.src = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.app}/header.jpg`;
      cover.alt = '';
      cover.loading = 'lazy';
      cover.referrerPolicy = 'no-referrer';
      const title = document.createElement('span');
      title.textContent = game.name;
      const label = document.createElement('small');
      label.textContent = 'Steam';
      option.append(cover, title, label);
      option.addEventListener('click', () => {
        ticketGameInput.value = game.name;
        ticketGameInput.dataset.steamAppId = game.app;
        closeGameSuggestions();
      });
      gameSuggestions.append(option);
    });
    gameSuggestions.hidden = false;
    ticketGameInput.setAttribute('aria-expanded', 'true');
  }
  ticketGameInput?.addEventListener('input', () => {
    delete ticketGameInput.dataset.steamAppId;
    activeSuggestionIndex = -1;
    renderGameSuggestions();
  });
  ticketGameInput?.addEventListener('keydown', event => {
    if (gameSuggestions?.hidden || !filteredSuggestions.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); activeSuggestionIndex = (activeSuggestionIndex + 1) % filteredSuggestions.length; renderGameSuggestions(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); activeSuggestionIndex = (activeSuggestionIndex - 1 + filteredSuggestions.length) % filteredSuggestions.length; renderGameSuggestions(); }
    else if (event.key === 'Enter' && activeSuggestionIndex >= 0) { event.preventDefault(); const game = filteredSuggestions[activeSuggestionIndex]; ticketGameInput.value = game.name; ticketGameInput.dataset.steamAppId = game.app; closeGameSuggestions(); }
    else if (event.key === 'Escape') closeGameSuggestions();
  });
  document.addEventListener('click', event => { if (gameSuggestions && !gameSuggestions.contains(event.target) && event.target !== ticketGameInput) closeGameSuggestions(); });

  // The three displayed ping values are deliberately illustrative, randomized within the ranges shown.
  // They are not measured network latency; refresh once per minute for the live UI effect requested.
  const serverCards = $$('.server-card[data-min][data-max]');
  function randomServerPing(card) {
    const min = Number(card.dataset.min);
    const max = Number(card.dataset.max);
    const valueNode = $('[data-server-ping]', card);
    if (!valueNode || !Number.isFinite(min) || !Number.isFinite(max) || max < min) return;
    const previous = Number(card.dataset.currentPing);
    let value = Math.floor(Math.random() * (max - min + 1)) + min;
    if (max > min && value === previous) value = min + ((value - min + 1) % (max - min + 1));
    card.dataset.currentPing = String(value);
    valueNode.textContent = `~ ${value}`;
  }
  function refreshServerPings() { serverCards.forEach(randomServerPing); }
  refreshServerPings();
  window.setInterval(refreshServerPings, 60000);

  // Users can permanently remove a support thread they own, using the private access key.
  $('#deleteTicket')?.addEventListener('click', async () => {
    const ticket = activeTicket();
    if (!ticket || !confirm(`Видалити звернення ${ticket.id} та всю історію повідомлень? Цю дію не можна скасувати.`)) return;
    const button = $('#deleteTicket');
    button.disabled = true;
    try {
      const removal = await api('/api/support/delete', { method: 'POST', body: JSON.stringify({ ticketId: ticket.id, accessKey: ticket.key }) });
      saveTickets(getSavedTickets().filter(item => item.id !== ticket.id));
      selectedTicketId = '';
      $('#ticketChat').hidden = true;
      renderTicketList();
      const failedCopies = Number(removal.telegramCopies?.failed || 0);
      setSupportStatus(failedCopies ? `Веб-дані звернення ${ticket.id} видалено. Частину Telegram-повідомлень не вдалося стерти автоматично — звернися до адміністратора.` : `Звернення ${ticket.id} та доступні копії повідомлень видалено.` , failedCopies > 0);
      notify('Звернення видалено.');
    } catch (error) { notify(error.message); }
    finally { button.disabled = false; }
  });

  $('#year').textContent = String(new Date().getFullYear());
})();
