(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const toastRegion = $('#toastRegion');
  const ticketModal = $('#ticketModal');
  const menuToggle = $('#menuToggle');
  const mainNav = $('#mainNav');
  const gameCards = $$('.game-card');
  const filterButtons = $$('.filter-button[data-filter]');
  const searchInput = $('#gameSearch');
  const noResults = $('#noResults');
  const gameCount = $('#gameCount');
  let activeFilter = 'all';
  let ticketFileContent = '';
  let ticketFileName = '';

  function showToast(title, message) {
    if (!toastRegion) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '✦';
    const content = document.createElement('div');
    const heading = document.createElement('strong');
    const description = document.createElement('p');
    heading.textContent = title;
    description.textContent = message;
    content.append(heading, description);
    toast.append(icon, content);
    toastRegion.append(toast);
    window.setTimeout(() => {
      toast.classList.add('toast-out');
      window.setTimeout(() => toast.remove(), 220);
    }, 4200);
  }

  function closeMobileMenu() {
    if (!menuToggle || !mainNav) return;
    mainNav.classList.remove('is-open');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Відкрити меню');
  }

  // Mobile navigation
  if (menuToggle && mainNav) {
    menuToggle.addEventListener('click', () => {
      const willOpen = menuToggle.getAttribute('aria-expanded') !== 'true';
      menuToggle.setAttribute('aria-expanded', String(willOpen));
      menuToggle.setAttribute('aria-label', willOpen ? 'Закрити меню' : 'Відкрити меню');
      mainNav.classList.toggle('is-open', willOpen);
    });

    $$('.nav-link', mainNav).forEach(link => {
      link.addEventListener('click', closeMobileMenu);
    });

    document.addEventListener('click', event => {
      if (mainNav.classList.contains('is-open') && !mainNav.contains(event.target) && !menuToggle.contains(event.target)) {
        closeMobileMenu();
      }
    });
  }

  // Highlight the sticky header after scrolling
  const header = $('.site-header');
  const updateHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 12);
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

  // Game filters and search work together
  function updateCatalog() {
    const query = (searchInput?.value || '').trim().toLocaleLowerCase('uk-UA');
    let visibleCount = 0;

    gameCards.forEach(card => {
      const tags = (card.dataset.tags || '').split(/\s+/);
      const searchableText = `${card.dataset.search || ''} ${card.textContent || ''}`.toLocaleLowerCase('uk-UA');
      const filterMatch = activeFilter === 'all' || tags.includes(activeFilter);
      const searchMatch = !query || searchableText.includes(query);
      const visible = filterMatch && searchMatch;
      card.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    if (gameCount) gameCount.textContent = String(visibleCount).padStart(2, '0');
    if (noResults) noResults.hidden = visibleCount !== 0;
  }

  filterButtons.forEach(button => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.filter || 'all';
      filterButtons.forEach(item => {
        const selected = item === button;
        item.classList.toggle('is-active', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
      updateCatalog();
    });
  });

  searchInput?.addEventListener('input', updateCatalog);
  searchInput?.addEventListener('keydown', event => {
    if (event.key === 'Escape' && searchInput.value) {
      searchInput.value = '';
      updateCatalog();
    }
  });

  // Graceful artwork fallback when a Steam CDN image is unavailable
  $$('.game-art img, .showcase-card img').forEach(image => {
    image.addEventListener('error', () => {
      image.closest('.game-art, .showcase-card')?.classList.add('image-failed');
      image.remove();
    }, { once: true });
  });

  // Continue to the dedicated checkout page with the selected plan prefilled.
  const planSlugs = { Безкоштовний: 'free', Професійний: 'pro', Безлімітний: 'unlimited' };
  $$('[data-plan]').forEach(button => {
    button.addEventListener('click', () => {
      const plan = planSlugs[button.dataset.plan] || 'pro';
      window.location.href = `payment.html?plan=${encodeURIComponent(plan)}`;
    });
  });

  // FAQ accordion
  $$('.faq-question').forEach(button => {
    button.addEventListener('click', () => {
      const item = button.closest('.faq-item');
      if (!item) return;
      const willOpen = !item.classList.contains('is-open');
      item.classList.toggle('is-open', willOpen);
      button.setAttribute('aria-expanded', String(willOpen));
      const marker = $('i', button);
      if (marker) marker.textContent = willOpen ? '−' : '＋';
    });
  });

  // Modal helpers
  function openTicketModal() {
    if (!ticketModal) return;
    ticketModal.hidden = false;
    document.body.classList.add('modal-open');
    $('[data-close-modal]', ticketModal)?.focus();
  }

  function closeTicketModal() {
    if (!ticketModal) return;
    ticketModal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  $$('[data-close-modal]').forEach(button => button.addEventListener('click', closeTicketModal));
  ticketModal?.addEventListener('click', event => {
    if (event.target === ticketModal) closeTicketModal();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeTicketModal();
      closeMobileMenu();
    }
  });

  // Steam autocomplete: the visitor's typed game title is the only search parameter.
  // Suggestions are restricted to a small, curated list of non-violent games.
  const gameInput = $('#ticketGame');
  const categorySelect = $('#ticketForm select[name="category"]');
  const suggestionsBox = $('#steamGameSuggestions');
  const searchHint = $('#steamSearchHint');
  const gameWrap = $('#gameAutocompleteWrap');
  const safeSteamAppIds = new Set([227300, 2225070, 493490, 2670630, 3405690, 1247360, 3605330, 413150, 1290000, 1135690, 613100, 1222670]);
  const steamCache = new Map();
  let steamTimer = 0;
  let steamController = null;
  let steamResults = [];
  let activeSuggestion = -1;

  function setSteamHint(message) {
    if (searchHint) searchHint.textContent = message;
  }

  function closeSteamSuggestions() {
    if (!suggestionsBox || !gameInput) return;
    suggestionsBox.hidden = true;
    suggestionsBox.replaceChildren();
    gameInput.setAttribute('aria-expanded', 'false');
    gameInput.removeAttribute('aria-activedescendant');
    activeSuggestion = -1;
  }

  function selectSteamGame(game) {
    gameInput.value = game.name;
    gameInput.dataset.steamAppid = String(game.id);
    gameInput.dataset.steamUrl = `https://store.steampowered.com/app/${game.id}/`;
    closeSteamSuggestions();
    setSteamHint('Гру вибрано. Її назва та сторінка Steam додадуться до локального файлу звернення.');
  }

  function renderSteamSuggestions(items) {
    if (!suggestionsBox || !gameInput) return;
    steamResults = items;
    suggestionsBox.replaceChildren();
    activeSuggestion = -1;
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'steam-suggestion-empty';
      empty.textContent = 'У перевіреній добірці збігів немає. Можеш ввести назву вручну.';
      suggestionsBox.append(empty);
    } else {
      items.forEach((game, index) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'steam-suggestion';
        option.id = `steam-option-${index}`;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        const art = document.createElement('span');
        art.className = 'steam-suggestion-art';
        if (game.image) {
          const image = document.createElement('img');
          image.src = game.image;
          image.alt = '';
          image.loading = 'lazy';
          image.referrerPolicy = 'no-referrer';
          image.addEventListener('error', () => image.remove(), { once: true });
          art.append(image);
        } else {
          art.textContent = game.name.slice(0, 1).toLocaleUpperCase('uk-UA');
        }
        const copy = document.createElement('span');
        copy.className = 'steam-suggestion-copy';
        const name = document.createElement('strong');
        name.textContent = game.name;
        const source = document.createElement('small');
        source.textContent = 'Перевірена гра · Steam';
        copy.append(name, source);
        const arrow = document.createElement('span');
        arrow.className = 'steam-suggestion-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M7 17 17 7M8 7h9v9');
        svg.append(path);
        arrow.append(svg);
        option.append(art, copy, arrow);
        option.addEventListener('click', () => selectSteamGame(game));
        suggestionsBox.append(option);
      });
    }
    suggestionsBox.hidden = false;
    gameInput.setAttribute('aria-expanded', 'true');
  }

  async function searchSteamGames(term) {
    const query = term.trim();
    if (!gameInput || !suggestionsBox || query.length < 2) {
      closeSteamSuggestions();
      return;
    }
    const cacheKey = query.toLocaleLowerCase('uk-UA');
    if (steamCache.has(cacheKey)) {
      renderSteamSuggestions(steamCache.get(cacheKey));
      return;
    }
    steamController?.abort();
    steamController = new AbortController();
    setSteamHint('Шукаємо збіги в каталозі Steam…');
    suggestionsBox.replaceChildren();
    const loading = document.createElement('div');
    loading.className = 'steam-suggestion-empty';
    loading.textContent = 'Завантаження…';
    suggestionsBox.append(loading);
    suggestionsBox.hidden = false;
    gameInput.setAttribute('aria-expanded', 'true');
    const steamUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=ukrainian&cc=UA`;
    try {
      // The read-only relay is needed because Steam Store does not provide browser CORS headers.
      // Only the game-name query is sent; ticket fields are never included in this request.
      const response = await fetch(`https://proxy.cors.dev/${steamUrl}`, {
        method: 'GET', signal: steamController.signal, credentials: 'omit', cache: 'no-store',
        referrerPolicy: 'no-referrer', headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) throw new Error(`Steam search returned ${response.status}`);
      const payload = await response.json();
      if (gameInput.value.trim() !== query) return;
      const items = Array.isArray(payload.items) ? payload.items
        .filter(item => safeSteamAppIds.has(Number(item.id)))
        .slice(0, 6)
        .map(item => {
          let image = '';
          try {
            const url = new URL(item.tiny_image);
            const trustedHosts = ['cdn.cloudflare.steamstatic.com', 'shared.akamai.steamstatic.com', 'shared.fastly.steamstatic.com', 'cdn.akamai.steamstatic.com'];
            if (url.protocol === 'https:' && trustedHosts.includes(url.hostname)) image = url.href;
          } catch (_) { /* No image: render a local letter mark. */ }
          return { id: Number(item.id), name: String(item.name || '').slice(0, 100), image };
        }).filter(item => item.id && item.name) : [];
      steamCache.set(cacheKey, items);
      renderSteamSuggestions(items);
      setSteamHint(items.length ? 'Збіги з перевіреної добірки. Обери потрібну гру.' : 'Збігів у перевіреній добірці немає. Назву можна ввести вручну.');
    } catch (error) {
      if (error.name === 'AbortError') return;
      closeSteamSuggestions();
      setSteamHint('Підказки Steam тимчасово недоступні. Перевір інтернет або введи назву вручну.');
    }
  }

  if (gameInput) {
    gameInput.addEventListener('input', () => {
      delete gameInput.dataset.steamAppid;
      delete gameInput.dataset.steamUrl;
      if (categorySelect?.value !== 'Замовлення гри') {
        closeSteamSuggestions();
        return;
      }
      window.clearTimeout(steamTimer);
      const query = gameInput.value;
      if (query.trim().length < 2) {
        closeSteamSuggestions();
        setSteamHint('Введи щонайменше 2 символи для пошуку.');
        return;
      }
      steamTimer = window.setTimeout(() => searchSteamGames(query), 350);
    });
    gameInput.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeSteamSuggestions();
        return;
      }
      if (suggestionsBox?.hidden || !steamResults.length) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        activeSuggestion = (activeSuggestion + step + steamResults.length) % steamResults.length;
        $$('.steam-suggestion', suggestionsBox).forEach((option, index) => {
          const active = index === activeSuggestion;
          option.classList.toggle('is-active', active);
          option.setAttribute('aria-selected', String(active));
        });
        gameInput.setAttribute('aria-activedescendant', `steam-option-${activeSuggestion}`);
      } else if (event.key === 'Enter' && activeSuggestion >= 0) {
        event.preventDefault();
        selectSteamGame(steamResults[activeSuggestion]);
      }
    });
    document.addEventListener('click', event => {
      if (!gameWrap?.contains(event.target)) closeSteamSuggestions();
    });
  }

  categorySelect?.addEventListener('change', () => {
    const enabled = categorySelect.value === 'Замовлення гри';
    gameWrap?.classList.toggle('is-search-enabled', enabled);
    if (!enabled) closeSteamSuggestions();
    setSteamHint(enabled ? 'Введи 2+ символи. Пошук передає лише назву гри, не дані звернення.' : 'Для підказок обери категорію «Замовлення гри».');
    if (enabled && gameInput?.value.trim().length >= 2) searchSteamGames(gameInput.value);
  });
  if (categorySelect && gameWrap) {
    const enabled = categorySelect.value === 'Замовлення гри';
    gameWrap.classList.toggle('is-search-enabled', enabled);
    setSteamHint(enabled ? 'Введи 2+ символи. Пошук передає лише назву гри, не дані звернення.' : 'Для підказок обери категорію «Замовлення гри».');
  }

  // Build a local ticket document. No network request, storage, or Telegram message is sent.
  $('#ticketForm')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const data = new FormData(form);
    const createdAt = new Date();
    const dateLabel = new Intl.DateTimeFormat('uk-UA', {
      dateStyle: 'long', timeStyle: 'short'
    }).format(createdAt);
    const rawId = `${createdAt.getTime()}`.slice(-8);
    const ticketId = `RZ-${rawId}`;
    const nickname = String(data.get('nickname') || '').trim();
    const email = String(data.get('email') || '').trim() || 'Не вказано';
    const category = String(data.get('category') || '').trim();
    const game = String(data.get('game') || '').trim() || 'Не вказано';
    const steamAppId = gameInput?.dataset.steamAppid || '';
    const steamGameUrl = steamAppId ? `https://store.steampowered.com/app/${steamAppId}/` : ''; 
    const message = String(data.get('message') || '').trim();

    const ticket = [
      '= RYZOR — ЗВЕРНЕННЯ',
      '====================',
      `Номер: ${ticketId}`,
      `Дата: ${dateLabel}`,
      `Нікнейм: ${nickname}`,
      `Email: ${email}`,
      `Категорія: ${category}`,
      `Гра: ${game}`,
      ...(steamAppId ? [`Steam App ID: ${steamAppId}`, `Сторінка Steam: ${steamGameUrl}`] : []),
      '',
      'ОПИС',
      '-----',
      message,
      '',
      'Цей файл сформовано локально у браузері. Його не надіслано = Ryzor, у Telegram чи на сервер.'
    ].join('\n');

    ticketFileContent = ticket;
    ticketFileName = `Ryzor-звернення-${ticketId}.txt`;
    $('#ticketIdLabel').textContent = ticketId;
    $('#ticketPreview').textContent = ticket;
    openTicketModal();
  });

  $('#downloadTicket')?.addEventListener('click', () => {
    if (!ticketFileContent) return;
    const blob = new Blob([ticketFileContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = ticketFileName || 'Ryzor-звернення.txt';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Файл підготовлено', 'Звернення завантажується на цей пристрій. Воно не надсилається автоматично.');
  });

  $('#copyTicket')?.addEventListener('click', async () => {
    if (!ticketFileContent) return;
    try {
      await navigator.clipboard.writeText(ticketFileContent);
      showToast('Текст скопійовано', 'Звернення можна вставити у лист або повідомлення.');
    } catch (error) {
      const preview = $('#ticketPreview');
      const range = document.createRange();
      range.selectNodeContents(preview);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      showToast('Виділено текст звернення', 'Скопіюй виділений текст клавішами Ctrl+C.');
    }
  });

  // Launcher is not distributed yet; never start a download before release.
  $('#downloadLauncher')?.addEventListener('click', () => {
    showToast('Лаунчер готується', 'Файл для Windows буде доступний після завершення розробки та перевірки.');
  });

  // Scroll reveal is progressive enhancement: the stylesheet keeps content visible by default.
  const revealElements = $$('.reveal');
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -35px 0px' });
    revealElements.forEach(element => revealObserver.observe(element));

    const sections = ['home', 'games', 'plans', 'status', 'support'].map(id => document.getElementById(id)).filter(Boolean);
    const navObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        $$('.nav-link').forEach(link => {
          link.classList.toggle('is-active', link.getAttribute('href') === `#${entry.target.id}`);
        });
      });
    }, { rootMargin: '-32% 0px -58% 0px' });
    sections.forEach(section => navObserver.observe(section));
  } else {
    revealElements.forEach(element => element.classList.add('is-visible'));
  }

  const year = $('#currentYear');
  if (year) year.textContent = String(new Date().getFullYear());
  updateCatalog();
})();
