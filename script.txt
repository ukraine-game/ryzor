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

  // Planned prices are informative only. Route users to the pricing FAQ instead of pretending to subscribe.
  $$('[data-plan]').forEach(button => {
    button.addEventListener('click', () => {
      const pricingFaq = $$('.faq-item').find(item => /ціни тарифів/i.test(item.textContent));
      if (pricingFaq) {
        $$('.faq-item').forEach(item => {
          const open = item === pricingFaq;
          item.classList.toggle('is-open', open);
          const question = $('.faq-question', item);
          if (question) question.setAttribute('aria-expanded', String(open));
          const marker = $('i', question);
          if (marker) marker.textContent = open ? '−' : '＋';
        });
        pricingFaq.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        $('#faq')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      showToast('Планові умови', 'Підписки ще не відкриті. Остаточні ціни та характеристики буде опубліковано до запуску.');
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
    const ticketId = `NX-${rawId}`;
    const nickname = String(data.get('nickname') || '').trim();
    const email = String(data.get('email') || '').trim() || 'Не вказано';
    const category = String(data.get('category') || '').trim();
    const game = String(data.get('game') || '').trim() || 'Не вказано';
    const message = String(data.get('message') || '').trim();

    const ticket = [
      'NEXORA — ЗВЕРНЕННЯ',
      '====================',
      `Номер: ${ticketId}`,
      `Дата: ${dateLabel}`,
      `Нікнейм: ${nickname}`,
      `Email: ${email}`,
      `Категорія: ${category}`,
      `Гра: ${game}`,
      '',
      'ОПИС',
      '-----',
      message,
      '',
      'Цей файл сформовано локально у браузері. Його не надіслано NEXORA, у Telegram чи на сервер.'
    ].join('\n');

    ticketFileContent = ticket;
    ticketFileName = `NEXORA-звернення-${ticketId}.txt`;
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
    anchor.download = ticketFileName || 'NEXORA-звернення.txt';
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
