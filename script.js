(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const toast = $('#toast');
  const SUPPORT_KEY = 'ryzor.local.support.v1';
  const ACCOUNT_KEY = 'ryzor.local.accounts.v1';
  const SESSION_KEY = 'ryzor.local.session.v1';
  let toastTimer;
  let activeGame = null;
  let selectedTicketId = '';

  function notify(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }
  function readJSON(key, fallback) {
    try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value ?? fallback; }
    catch { return fallback; }
  }
  function getTickets() {
    const items = readJSON(SUPPORT_KEY, []);
    return Array.isArray(items) ? items.filter(item => item && /^RZ-[A-Z0-9]{16}$/.test(item.id) && Array.isArray(item.messages)) : [];
  }
  function saveTickets(items) { localStorage.setItem(SUPPORT_KEY, JSON.stringify(items.slice(0, 30))); }
  function getSessionUser() {
    const email = String(localStorage.getItem(SESSION_KEY) || '').toLowerCase();
    const accounts = readJSON(ACCOUNT_KEY, []);
    return Array.isArray(accounts) ? accounts.find(user => user.email === email) || null : null;
  }
  function createId() {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return 'RZ-' + [...bytes].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
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

  // Local account indicator
  const accountLink = $('#accountLink');
  const signedInUser = getSessionUser();
  if (signedInUser) {
    const supportEmail = $('#supportForm [name="email"]');
    const supportNickname = $('#supportForm [name="nickname"]');
    if (supportEmail && !supportEmail.value) supportEmail.value = signedInUser.email;
    if (supportNickname && !supportNickname.value) supportNickname.value = signedInUser.fullName.split(/\s+/)[0].slice(0, 24);
  }
  if (accountLink && signedInUser) {
    accountLink.textContent = signedInUser.fullName.split(/\s+/)[0];
    accountLink.setAttribute('aria-label', `Мій акаунт: ${signedInUser.fullName}`);
  }

  // Catalog search and filters
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
    if ($('#emptyGames')) $('#emptyGames').hidden = visible > 0;
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

  // Game details modal. Registration unlocks the launch button placeholder.
  const modal = $('#gameModal');
  const launchButton = $('#startTelegram');
  function closeGameModal() {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  }
  function setLaunchState(title, description, signedIn) {
    const state = $('#launchState');
    state.replaceChildren();
    const marker = document.createElement('span');
    marker.className = `state-marker${signedIn ? ' state-ok' : ''}`;
    marker.textContent = signedIn ? '✓' : '1';
    const copy = document.createElement('div');
    const heading = document.createElement('strong');
    heading.textContent = title;
    const detail = document.createElement('p');
    detail.textContent = description;
    copy.append(heading, detail);
    state.append(marker, copy);
  }
  function openGameModal(button) {
    activeGame = {
      name: button.dataset.game || 'Гра', image: button.dataset.image || '',
      description: button.dataset.description || '', kind: button.dataset.kind || 'GAME'
    };
    $('#modalGameTitle').textContent = activeGame.name;
    $('#modalGameDescription').textContent = activeGame.description;
    $('#modalGameKind').textContent = activeGame.kind;
    $('#modalGameImage').src = activeGame.image;
    $('#modalGameImage').alt = activeGame.name;
    const signedIn = Boolean(getSessionUser());
    if (signedIn) {
      setLaunchState('Профіль підтверджено', 'Ти увійшов до RYZOR. Запуск гри стане доступним після підключення ігрових сесій.', true);
      launchButton.disabled = false;
      launchButton.textContent = 'Запуск';
      $('#launchHint').textContent = 'Акаунт активний.';
    } else {
      setLaunchState('Потрібна реєстрація', 'Перед запуском гри вам потрібно зареєструватися.', false);
      launchButton.disabled = false;
      launchButton.textContent = 'Зареєструватися';
      $('#launchHint').textContent = 'Створи профіль RYZOR, щоб продовжити.';
    }
    modal.hidden = false;
    document.body.classList.add('modal-open');
    $('#closeGameModal').focus();
  }
  launchButton?.addEventListener('click', () => {
    if (!getSessionUser()) window.location.href = 'auth.html?mode=register';
    // For signed-in users the "Запуск" button is intentionally a placeholder for a future update.
  });
  gameCards.forEach(card => $('.game-open', card)?.addEventListener('click', event => openGameModal(event.currentTarget)));
  $('#closeGameModal')?.addEventListener('click', closeGameModal);
  modal?.addEventListener('click', event => { if (event.target === modal) closeGameModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && modal && !modal.hidden) closeGameModal(); });

  // Support inbox: every ticket and message is stored only in this browser.
  function setSupportStatus(message, error = false) {
    const node = $('#supportStatus');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('error', error);
  }
  function renderTicketList() {
    const holder = $('#ticketList');
    if (!holder) return;
    const tickets = getTickets();
    holder.replaceChildren();
    if (!tickets.length) {
      const empty = document.createElement('div');
      empty.className = 'inbox-empty';
      empty.textContent = 'Тут з’являтимуться твої звернення.';
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
  function activeTicket() { return getTickets().find(item => item.id === selectedTicketId) || null; }
  function appendMessage(message) {
    const box = $('#chatMessages');
    const bubble = document.createElement('article');
    bubble.className = `chat-bubble ${message.actor === 'manager' ? 'from-admin' : 'from-user'}`;
    const author = document.createElement('small'); author.textContent = message.actor === 'manager' ? 'RYZOR' : 'ТИ';
    const body = document.createElement('p'); body.textContent = message.body;
    const time = document.createElement('time');
    if (message.createdAt) time.textContent = new Date(message.createdAt).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    bubble.append(author, body, time); box.append(bubble);
  }
  function selectTicket(ticketId) {
    selectedTicketId = ticketId;
    renderTicketList();
    const ticket = activeTicket();
    if (!ticket) return;
    $('#ticketChat').hidden = false;
    $('#activeTicketId').textContent = ticket.id;
    $('#activeTicketMeta').textContent = 'Відкрито';
    $('#chatMessages').replaceChildren();
    ticket.messages.forEach(appendMessage);
    $('#replyForm').hidden = false;
    $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
  }
  $('#supportForm')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const message = String(data.get('message') || '').trim();
    const user = getSessionUser();
    const ticket = {
      id: createId(),
      nickname: String(data.get('nickname') || '').trim(),
      email: String(data.get('email') || '').trim(),
      category: String(data.get('category') || 'Загальне питання'),
      game: String(data.get('game') || '').trim(),
      status: 'open',
      createdAt: Date.now(),
      ownerEmail: user?.email || '',
      messages: [{ actor: 'user', body: message, createdAt: Date.now() }]
    };
    const tickets = getTickets();
    tickets.unshift(ticket);
    saveTickets(tickets);
    selectedTicketId = ticket.id;
    form.reset();
    setSupportStatus('Звернення створено.');
    selectTicket(ticket.id);
    notify('Звернення створено.');
  });
  $('#replyForm')?.addEventListener('submit', event => {
    event.preventDefault();
    const ticket = activeTicket();
    const input = $('#replyText');
    const message = input.value.trim();
    if (!ticket || !message) return;
    ticket.messages.push({ actor: 'user', body: message, createdAt: Date.now() });
    const tickets = getTickets().map(item => item.id === ticket.id ? ticket : item);
    saveTickets(tickets);
    input.value = '';
    selectTicket(ticket.id);
  });
  $('#refreshTickets')?.addEventListener('click', () => { renderTicketList(); if (selectedTicketId) selectTicket(selectedTicketId); else notify('Список оновлено.'); });
  $('#closeTicketChat')?.addEventListener('click', () => { $('#ticketChat').hidden = true; selectedTicketId = ''; renderTicketList(); });
  $('#deleteTicket')?.addEventListener('click', () => {
    const ticket = activeTicket();
    if (!ticket || !confirm(`Видалити звернення ${ticket.id} з цього браузера?`)) return;
    saveTickets(getTickets().filter(item => item.id !== ticket.id));
    selectedTicketId = '';
    $('#ticketChat').hidden = true;
    renderTicketList();
    setSupportStatus('Звернення видалено.');
    notify('Звернення видалено.');
  });
  renderTicketList();
  const initialTickets = getTickets();
  if (initialTickets.length) selectTicket(initialTickets[0].id);

  // Static autocomplete suggestions. Only local text filtering is used.
  const ticketGameInput = $('#ticketGame');
  const gameSuggestions = $('#gameSuggestions');
  const steamSuggestions = [
    { name: 'Grand Mountain Adventure: Wonderlands', app: '1247360' },
    { name: 'Grand Mountain Adventure 2', app: '3605330' },
    { name: 'Euro Truck Simulator 2', app: '227300' },
    { name: 'City Car Driving', app: '493490' },
    { name: 'EA SPORTS FC 26', app: '3405690' },
    { name: 'Supermarket Simulator', app: '2670630' },
    { name: 'Counter-Strike 2', app: '730' },
    { name: 'PowerWash Simulator', app: '1290000' },
    { name: 'Unpacking', app: '1135690' },
    { name: 'Stardew Valley', app: '413150' },
    { name: 'House Flipper', app: '613100' },
    { name: 'Hello Neighbor', app: '521890' },
    { name: 'Terraria', app: '105600' }
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
    filteredSuggestions = query.length >= 2 ? steamSuggestions.filter(item => item.name.toLocaleLowerCase('uk-UA').includes(query)).slice(0, 6) : [];
    gameSuggestions.replaceChildren();
    if (!filteredSuggestions.length) return closeGameSuggestions();
    filteredSuggestions.forEach((game, index) => {
      const option = document.createElement('button');
      option.type = 'button'; option.id = `game-suggestion-${index}`; option.className = 'game-suggestion';
      option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(index === activeSuggestionIndex));
      const cover = document.createElement('img');
      cover.src = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.app}/header.jpg`;
      cover.alt = ''; cover.loading = 'lazy'; cover.referrerPolicy = 'no-referrer';
      const title = document.createElement('span'); title.textContent = game.name;
      const label = document.createElement('small'); label.textContent = 'Гра';
      option.append(cover, title, label);
      option.addEventListener('click', () => { ticketGameInput.value = game.name; closeGameSuggestions(); });
      gameSuggestions.append(option);
    });
    gameSuggestions.hidden = false;
    ticketGameInput.setAttribute('aria-expanded', 'true');
  }
  ticketGameInput?.addEventListener('input', renderGameSuggestions);
  ticketGameInput?.addEventListener('keydown', event => {
    if (gameSuggestions?.hidden || !filteredSuggestions.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); activeSuggestionIndex = (activeSuggestionIndex + 1) % filteredSuggestions.length; renderGameSuggestions(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); activeSuggestionIndex = (activeSuggestionIndex - 1 + filteredSuggestions.length) % filteredSuggestions.length; renderGameSuggestions(); }
    else if (event.key === 'Enter' && activeSuggestionIndex >= 0) { event.preventDefault(); ticketGameInput.value = filteredSuggestions[activeSuggestionIndex].name; closeGameSuggestions(); }
    else if (event.key === 'Escape') closeGameSuggestions();
  });
  document.addEventListener('click', event => { if (gameSuggestions && !gameSuggestions.contains(event.target) && event.target !== ticketGameInput) closeGameSuggestions(); });

  // Demo ping values requested for the status panel; these are not real measurements.
  const serverCards = $$('.server-card[data-min][data-max]');
  function refreshServerPings() {
    serverCards.forEach(card => {
      const min = Number(card.dataset.min), max = Number(card.dataset.max);
      const node = $('[data-server-ping]', card);
      if (!node || !Number.isFinite(min) || !Number.isFinite(max) || max < min) return;
      const old = Number(card.dataset.currentPing);
      let value = Math.floor(Math.random() * (max - min + 1)) + min;
      if (value === old && max > min) value = min + ((value - min + 1) % (max - min + 1));
      card.dataset.currentPing = String(value);
      node.textContent = `~ ${value}`;
    });
  }
  refreshServerPings();
  window.setInterval(refreshServerPings, 60000);
  $('#year').textContent = String(new Date().getFullYear());
})();
