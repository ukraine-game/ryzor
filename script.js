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
    const count = $('#visibleGameCount');
    if (count) count.textContent = String(visible).padStart(2, '0');
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
    launchButton.textContent = 'Створюємо запит…';
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
            launchHint.textContent = 'Хмарні ігрові сервери ще готуються. Це підтверджує Telegram, але поки не створює віддалену ігрову сесію.';
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

  // API health is distinct from game-server readiness; the site never pretends streaming is online.
  const apiStatusText = $('#apiStatusText');
  const apiStatusHint = $('#apiStatusHint');
  const apiStatusTag = $('#apiStatusTag');
  const apiStatusDot = $('#apiStatusDot');
  async function checkApiHealth() {
    if (!apiBase) {
      if (apiStatusText) apiStatusText.textContent = 'Не підключено';
      if (apiStatusHint) apiStatusHint.textContent = 'Адміністратор ще не вказав адресу Worker.';
      if (apiStatusTag) apiStatusTag.textContent = 'ОЧІКУЄ';
      apiStatusDot?.classList.add('status-offline');
      return;
    }
    try {
      const response = await fetch(`${apiBase}/health`, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
      const data = await response.json();
      if (!response.ok || data.ok !== true) throw new Error('API не відповідає');
      if (apiStatusText) apiStatusText.textContent = 'Підключено';
      if (apiStatusHint) apiStatusHint.textContent = 'Сервіс обробки акаунтів і звернень доступний.';
      if (apiStatusTag) apiStatusTag.textContent = 'ПРАЦЮЄ';
      apiStatusDot?.classList.add('status-online');
      apiStatusDot?.classList.remove('status-offline');
    } catch {
      if (apiStatusText) apiStatusText.textContent = 'Недоступний';
      if (apiStatusHint) apiStatusHint.textContent = 'Перевір підключення або налаштування Worker.';
      if (apiStatusTag) apiStatusTag.textContent = 'ПОМИЛКА';
      apiStatusDot?.classList.add('status-offline');
      apiStatusDot?.classList.remove('status-online');
    }
  }
  checkApiHealth();
  setInterval(() => { if (!document.hidden) checkApiHealth(); }, 60000);

  // Curated Steam suggestions are local: no typed support text is sent to a third-party search proxy.
  // Only supported, non-weapon-focused titles are included here.
  const supportGames = [
    { name: 'Grand Mountain Adventure 2', appId: '3605330', category: 'Пригоди' },
    { name: 'Grand Mountain Adventure: Wonderlands', appId: '1247360', category: 'Пригоди' },
    { name: 'Trackmania', appId: '2225070', category: 'Гонки' },
    { name: 'Euro Truck Simulator 2', appId: '227300', category: 'Симулятор' },
    { name: 'City Car Driving', appId: '493490', category: 'Симулятор' },
    { name: 'Farming Simulator 25', appId: '2300320', category: 'Симулятор' },
    { name: 'EA SPORTS FC 26', appId: '3405690', category: 'Спорт' },
    { name: 'Supermarket Simulator', appId: '2670630', category: 'Менеджмент' },
    { name: 'MECCHA CHAMELEON', appId: '4704690', category: 'Мультиплеєр' },
    { name: 'Stardew Valley', appId: '413150', category: 'Симулятор життя' },
    { name: 'PowerWash Simulator', appId: '1290000', category: 'Симулятор' },
    { name: 'Unpacking', appId: '1135690', category: 'Головоломка' },
    { name: 'House Flipper', appId: '613100', category: 'Симулятор' }
  ];
  const categorySelect = $('#supportCategory');
  const gameField = $('#supportGameField');
  const gameInput = $('#supportGame');
  const suggestionsBox = $('#steamSuggestions');
  let suggestionIndex = -1;
  let visibleSuggestions = [];
  function closeSuggestions() {
    if (!suggestionsBox || !gameInput) return;
    suggestionsBox.hidden = true;
    gameInput.setAttribute('aria-expanded', 'false');
    suggestionIndex = -1;
  }
  function selectSupportGame(game) {
    gameInput.value = game.name;
    gameInput.dataset.appId = game.appId;
    gameInput.dataset.selected = 'true';
    closeSuggestions();
  }
  function renderSuggestions() {
    if (!gameInput || !suggestionsBox) return;
    const query = gameInput.value.trim().toLocaleLowerCase('uk-UA');
    suggestionsBox.replaceChildren();
    visibleSuggestions = query.length < 2 ? [] : supportGames.filter(game => game.name.toLocaleLowerCase('uk-UA').includes(query)).slice(0, 6);
    if (!visibleSuggestions.length) { closeSuggestions(); return; }
    visibleSuggestions.forEach((game, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'steam-suggestion';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(index === suggestionIndex));
      const image = document.createElement('img');
      image.src = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.appId}/header.jpg`;
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      const details = document.createElement('span');
      const title = document.createElement('strong'); title.textContent = game.name;
      const kind = document.createElement('small'); kind.textContent = game.category;
      details.append(title, kind);
      option.append(image, details);
      option.addEventListener('click', () => selectSupportGame(game));
      suggestionsBox.append(option);
    });
    suggestionsBox.hidden = false;
    gameInput.setAttribute('aria-expanded', 'true');
  }
  function updateSupportGameField() {
    if (!categorySelect || !gameField || !gameInput) return;
    const required = categorySelect.value === 'Замовлення гри';
    gameField.hidden = !required;
    gameInput.required = required;
    if (!required) {
      gameInput.value = '';
      delete gameInput.dataset.appId;
      delete gameInput.dataset.selected;
      closeSuggestions();
    }
  }
  categorySelect?.addEventListener('change', updateSupportGameField);
  gameInput?.addEventListener('input', () => {
    delete gameInput.dataset.appId;
    delete gameInput.dataset.selected;
    renderSuggestions();
  });
  gameInput?.addEventListener('keydown', event => {
    if (suggestionsBox?.hidden) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); suggestionIndex = Math.min(suggestionIndex + 1, visibleSuggestions.length - 1); renderSuggestions(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); suggestionIndex = Math.max(suggestionIndex - 1, 0); renderSuggestions(); }
    else if (event.key === 'Enter' && suggestionIndex >= 0 && visibleSuggestions[suggestionIndex]) { event.preventDefault(); selectSupportGame(visibleSuggestions[suggestionIndex]); }
    else if (event.key === 'Escape') closeSuggestions();
  });
  document.addEventListener('click', event => {
    if (gameField && !gameField.contains(event.target)) closeSuggestions();
  });
  updateSupportGameField();

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
        body: JSON.stringify({ nickname: data.get('nickname'), email: data.get('email'), category: data.get('category'), gameName: data.get('gameName') || '', message: data.get('message') })
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
