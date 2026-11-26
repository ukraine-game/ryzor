(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const ORDER_KEY = 'ryzor.local.orders.v1';
  const ACCOUNT_KEY = 'ryzor.local.accounts.v1';
  const SESSION_KEY = 'ryzor.local.session.v1';
  const plans = {
    free: { name: 'Безкоштовний', price: 0, duration: 'Безстроково', period: 'назавжди', description: 'Для знайомства з Ryzor.' },
    pro: { name: 'Професійний', price: 299, originalPrice: 599, duration: '30 днів', period: '/ 30 днів', description: 'Для регулярних ігрових сесій.' },
    unlimited: { name: 'Безлімітний', price: 499, originalPrice: 999, duration: '30 днів', period: '/ 30 днів', description: 'Максимум можливостей у межах доступної послуги.' }
  };
  const money = value => `${new Intl.NumberFormat('uk-UA').format(value)} ₴`;
  const read = (key, fallback) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value ?? fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const toast = $('#paymentToast');
  let toastTimer = null;
  let order = null;
  const form = $('#checkoutForm');
  const planSelect = $('#checkoutPlan');

  function notify(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3000);
  }

  function currentUser() {
    const email = String(localStorage.getItem(SESSION_KEY) || '').toLowerCase();
    const accounts = read(ACCOUNT_KEY, []);
    return Array.isArray(accounts) ? accounts.find(item => item.email === email) || null : null;
  }

  function newSerial() {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const values = crypto.getRandomValues(new Uint8Array(32));
    return [...values].map(value => alphabet[value % alphabet.length]).join('');
  }

  function updateSummary() {
    const plan = plans[planSelect.value] || plans.pro;
    const buttonText = $('#checkoutContinue').firstChild;
    if (buttonText) buttonText.textContent = 'Створити серійний код ';
    $('#summaryPlanName').textContent = plan.name;
    $('#summaryPlanDescription').textContent = plan.description;
    $('#summaryPlanPrice').textContent = money(plan.price);
    $('#summaryPlanPeriod').textContent = plan.period;
    const oldPrice = $('#summaryOldPrice');
    const discount = $('#summaryDiscount');
    if (plan.originalPrice) {
      oldPrice.textContent = money(plan.originalPrice);
      oldPrice.hidden = false;
      discount.hidden = false;
      discount.textContent = '−50%';
    } else {
      oldPrice.hidden = true;
      discount.hidden = true;
    }
    $('#summaryPlanShort').textContent = plan.name;
    $('#summaryPlanDuration').textContent = plan.duration;
    $('#summaryTotal').textContent = money(plan.price);
  }

  function showStatus(message) {
    const node = $('#checkoutStepStatus');
    node.textContent = message;
    node.hidden = false;
  }

  const user = currentUser();
  if (!user) {
    const next = `payment.html${location.search || ''}`;
    location.replace(`auth.html?next=${encodeURIComponent(next)}`);
    return;
  }

  $('#checkoutFullName').value = user.fullName;
  $('#checkoutEmail').value = user.email;
  $('#checkoutNickname').value = user.nickname || user.fullName.split(/\s+/)[0].slice(0, 24);
  const params = new URLSearchParams(location.search);
  if (plans[params.get('plan')]) planSelect.value = params.get('plan');
  planSelect.addEventListener('change', updateSummary);
  updateSummary();

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (!$('#checkoutPrivacyConsent').checked) {
      showStatus('Підтверди ознайомлення з політикою конфіденційності.');
      return;
    }

    const data = new FormData(form);
    const planCode = String(data.get('plan'));
    const plan = plans[planCode];
    const nickname = String(data.get('nickname') || '').trim();
    if (!plan || nickname.length < 2) return;

    order = {
      serial: newSerial(),
      planCode,
      planName: plan.name,
      amount: plan.price,
      originalAmount: plan.originalPrice || plan.price,
      discountPercent: plan.originalPrice ? 50 : 0,
      duration: plan.duration,
      nickname,
      fullName: user.fullName,
      email: user.email,
      createdAt: Date.now(),
      status: 'awaiting-manager'
    };

    const stored = read(ORDER_KEY, []);
    stored.unshift(order);
    write(ORDER_KEY, stored.slice(0, 30));

    const notifyConsent = $('#telegramNotifyConsent').checked;
    window.RyzorNotify?.setConsent(notifyConsent);
    if (notifyConsent) window.RyzorNotify?.notify('order_created', { plan: planCode, serial: order.serial });

    $('#successOrderId').textContent = order.serial;
    $('#successPlanName').textContent = order.planName;
    $('#checkoutStepOne').hidden = true;
    $('#paymentSuccess').hidden = false;
    document.querySelectorAll('[data-step-indicator]').forEach(node => {
      const stepNumber = Number(node.dataset.stepIndicator);
      node.classList.toggle('is-active', stepNumber === 2);
      node.classList.toggle('is-done', stepNumber < 2);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  $('#copySerial').addEventListener('click', async () => {
    if (!order?.serial) return;
    const message = `Вітаю! Хочу отримати тариф «${order.planName}». Серійний код: ${order.serial}.`;
    try {
      await navigator.clipboard.writeText(message);
      notify('Повідомлення скопійовано. Встав його в чаті менеджера.');
    } catch {
      notify('Не вдалося скопіювати. Серійний код можна виділити вручну.');
    }
  });

  $('#paymentYear').textContent = String(new Date().getFullYear());
})();
