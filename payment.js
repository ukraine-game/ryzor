(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const config = window.RYZOR_CONFIG || {};
  const paymentConfig = config.payment || {};
  const apiBase = String(config.apiBase || '').replace(/\/$/, '');
  const plans = {
    free: { name: 'Безкоштовний', price: 0, duration: 'Безстроково', period: 'назавжди', description: 'Щоб познайомитися з Ryzor та спробувати хмарний формат.' },
    pro: { name: 'Професійний', price: 199, duration: '30 днів', period: '/ 30 днів', description: 'Для регулярних ігрових сесій та пріоритету.' },
    unlimited: { name: 'Безлімітний', price: 399, duration: '30 днів', period: '/ 30 днів', description: 'Максимум можливостей у межах доступної інфраструктури.' }
  };
  const AUTH_SESSION_KEY = 'ryzor.auth.session.v1';
  const accountToken = sessionStorage.getItem(AUTH_SESSION_KEY) || '';
  let accountUser = null;
  try { accountUser = JSON.parse(sessionStorage.getItem('ryzor.auth.user.v1') || 'null'); } catch { accountUser = null; }
  let order = null;
  let selectedFile = null;
  let secondsRemaining = 600;
  let expiresAt = 0;
  let timerId = null;
  let toastId = null;
  const form = $('#checkoutForm');
  const planSelect = $('#checkoutPlan');
  const fileInput = $('#paymentProof');
  const sendButton = $('#sendPaymentProof');
  const uploadZone = $('#uploadZone');
  const toast = $('#paymentToast');
  const money = value => `${new Intl.NumberFormat('uk-UA').format(value)} ₴`;
  const cardNumber = String(paymentConfig.cardNumber || '').replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim();
  const isPaymentConfigured = () => Boolean(cardNumber && paymentConfig.recipient && paymentConfig.bank && apiBase);

  const notify = message => {
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastId);
    toastId = setTimeout(() => toast.classList.remove('is-visible'), 3000);
  };
  const setStatus = (node, message, type = 'error') => {
    node.textContent = message;
    node.className = `payment-submit-status is-${type}`;
    node.hidden = false;
  };
  function authHeaders() {
    return { Authorization: `Bearer ${accountToken}` };
  }
  async function postJson(path, body) {
    const response = await fetch(`${apiBase}${path}`, {
      method: 'POST', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) throw new Error(result.error || `Помилка запиту (${response.status})`);
    return result;
  }
  function updateSummary() {
    const plan = plans[planSelect.value] || plans.pro;
    $('#checkoutContinue').innerHTML = `${plan.price ? 'До оплати' : 'Надіслати заявку'} <svg viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>`;
    $('#summaryPlanName').textContent = plan.name;
    $('#summaryPlanDescription').textContent = plan.description;
    $('#summaryPlanPrice').textContent = money(plan.price);
    $('#summaryPlanPeriod').textContent = plan.period;
    $('#summaryPlanShort').textContent = plan.name;
    $('#summaryPlanDuration').textContent = plan.duration;
    $('#summaryTotal').textContent = money(plan.price);
  }
  function updateRequisites() {
    $('#bankCardNumber').textContent = cardNumber || '•••• •••• •••• ••••';
    $('#bankRecipient').textContent = paymentConfig.recipient || 'Реквізити ще не додані';
    $('#bankName').textContent = paymentConfig.bank || 'Банк не вказано';
    $('#copyCardValue').textContent = cardNumber || 'Не налаштовано';
    $('#copyRecipientValue').textContent = paymentConfig.recipient || 'Не налаштовано';
    $('#copyIbanValue').textContent = paymentConfig.iban || '';
    $('#ibanRow').hidden = !paymentConfig.iban;
    const warning = $('#paymentSetupWarning');
    warning.hidden = isPaymentConfigured();
    const span = warning.querySelector('span');
    if (!cardNumber || !paymentConfig.recipient || !paymentConfig.bank) {
      span.textContent = 'Реквізити ще не додані власником Ryzor. Не переказуй кошти. Заповнювати потрібно лише публічні реквізити отримувача у config.js.';
    } else if (!apiBase) {
      span.textContent = 'Реквізити додані, але Telegram Worker не підключено. Не переказуй кошти, доки API не налаштовано.';
    }
  }
  function step(number) {
    document.querySelectorAll('[data-step-indicator]').forEach(node => {
      const value = Number(node.dataset.stepIndicator);
      node.classList.toggle('is-active', value === number);
      node.classList.toggle('is-done', value < number);
    });
  }
  function renderTimer() {
    secondsRemaining = Math.max(0, Math.ceil((expiresAt * 1000 - Date.now()) / 1000));
    const minutes = Math.floor(secondsRemaining / 60);
    const seconds = secondsRemaining % 60;
    $('#paymentTimer').textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    if (secondsRemaining <= 0) {
      clearInterval(timerId);
      $('#paymentTimer').classList.add('is-expired');
      sendButton.disabled = true;
      setStatus($('#paymentSubmitStatus'), 'Час для оплати завершився. Повернися до першого кроку та створи нове замовлення.');
    }
    refreshSubmitState();
  }
  function startTimer(serverExpiry) {
    clearInterval(timerId);
    expiresAt = Number(serverExpiry) || Math.floor(Date.now() / 1000) + 600;
    renderTimer();
    timerId = setInterval(renderTimer, 1000);
  }
  function validFile(file) {
    const allowedMime = /^(image\/(jpeg|png|webp)|video\/(mp4|webm|quicktime)|application\/pdf|text\/plain)$/i;
    const allowedExt = /\.(jpe?g|png|webp|mp4|webm|mov|pdf|txt)$/i.test(file.name);
    return allowedMime.test(file.type) || (file.type === '' && allowedExt);
  }
  function showFile(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { clearFile(); notify('Максимальний розмір файлу — 20 МБ.'); return; }
    if (!validFile(file)) { clearFile(); notify('Додай фото, відео, PDF або текстовий документ підтримуваного формату.'); return; }
    selectedFile = file;
    $('#fileName').textContent = file.name;
    $('#fileSize').textContent = `${(file.size / 1048576).toFixed(2)} МБ`;
    $('#filePreview').hidden = false;
    uploadZone.hidden = true;
    refreshSubmitState();
  }
  function clearFile() {
    selectedFile = null;
    fileInput.value = '';
    $('#filePreview').hidden = true;
    uploadZone.hidden = false;
    refreshSubmitState();
  }
  function refreshSubmitState() {
    if (!sendButton) return;
    const consent = $('#proofConsent')?.checked;
    sendButton.disabled = !selectedFile || !consent || secondsRemaining <= 0 || !isPaymentConfigured() || !accountToken || !order;
  }
  async function sendOrder(formData) {
    const response = await fetch(`${apiBase}/payment`, {
      method: 'POST', body: formData, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json', ...authHeaders() }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) throw new Error(result.error || `Помилка надсилання (${response.status})`);
    return result;
  }
  function showSuccess(title, message) {
    clearInterval(timerId);
    $('#paymentSuccess').querySelector('h2').textContent = title;
    $('#paymentSuccess').querySelector('p').textContent = message;
    $('#successOrderId').textContent = order.id;
    $('#checkoutStepOne').hidden = true;
    $('#checkoutStepTwo').hidden = true;
    $('#paymentAuthRequired').hidden = true;
    $('#paymentSuccess').hidden = false;
    step(3);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function setupAccountGate() {
    const gate = $('#paymentAuthRequired');
    const badge = $('#paymentAccountBadge');
    const emailField = form.elements.email;
    const continueButton = $('#checkoutContinue');
    if (!accountToken) {
      gate.hidden = false;
      const next = `payment.html${location.search}`;
      $('#paymentAuthLink').href = `auth.html?next=${encodeURIComponent(next)}`;
      continueButton.disabled = true;
      return;
    }
    badge.hidden = false;
    badge.textContent = accountUser?.fullName ? `Акаунт: ${accountUser.fullName}` : 'Акаунт Ryzor підключено';
    if (accountUser?.email) {
      emailField.value = accountUser.email;
      emailField.readOnly = true;
    }
  }

  const params = new URLSearchParams(location.search);
  if (plans[params.get('plan')]) planSelect.value = params.get('plan');
  setupAccountGate();
  updateSummary();
  updateRequisites();
  planSelect.addEventListener('change', updateSummary);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!accountToken) {
      $('#paymentAuthRequired').hidden = false;
      setStatus($('#checkoutStepStatus'), 'Увійди в акаунт, щоб замовлення та підтверджена підписка були прив’язані до твого профілю.');
      return;
    }
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const planKey = String(data.get('plan'));
    const plan = plans[planKey];
    if (!plan) return;
    if (plan.price > 0 && !isPaymentConfigured()) {
      setStatus($('#checkoutStepStatus'), 'Оплата поки не відкрита: власник ще не налаштував перевірені реквізити та Worker. Не переказуй кошти.');
      return;
    }
    const button = $('#checkoutContinue');
    button.disabled = true;
    const originalText = button.innerHTML;
    button.textContent = 'Створюємо замовлення…';
    try {
      const intent = await postJson('/payment/intent', {
        plan: planKey,
        nickname: String(data.get('nickname')).trim(),
        telegram: String(data.get('telegram') || '').trim()
      });
      order = { id: intent.orderId, nickname: String(data.get('nickname')).trim(), email: String(data.get('email')).trim(), telegram: String(data.get('telegram') || '').trim(), plan, planKey, expiresAt: intent.expiresAt };
      if (plan.price === 0) {
        showSuccess('Заявку надіслано!', intent.adminNotified
          ? `Заявку ${order.id} на безкоштовний тариф передано адміністратору. Після перевірки її статус з’явиться в акаунті. Хмарні сесії стануть доступні після запуску серверів.`
          : `Заявку ${order.id} збережено, але Telegram не підтвердив сповіщення адміністратору. Статус можна буде перевірити в акаунті.`);
        return;
      }
      $('#paymentOrderId').textContent = order.id;
      $('#paymentOrderPlan').textContent = `${plan.name} · ${money(plan.price)}`;
      $('#checkoutStepOne').hidden = true;
      $('#checkoutStepTwo').hidden = false;
      updateRequisites();
      step(2);
      startTimer(intent.expiresAt);
      refreshSubmitState();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setStatus($('#checkoutStepStatus'), error.message);
    } finally {
      button.innerHTML = originalText;
      button.disabled = !accountToken;
    }
  });

  fileInput.addEventListener('change', () => showFile(fileInput.files?.[0]));
  $('#removeFile').addEventListener('click', clearFile);
  $('#proofConsent').addEventListener('change', refreshSubmitState);
  ['dragenter', 'dragover'].forEach(type => uploadZone.addEventListener(type, event => { event.preventDefault(); uploadZone.classList.add('is-dragover'); }));
  ['dragleave', 'drop'].forEach(type => uploadZone.addEventListener(type, event => { event.preventDefault(); uploadZone.classList.remove('is-dragover'); }));
  uploadZone.addEventListener('drop', event => { const file = event.dataTransfer?.files?.[0]; if (file) showFile(file); });
  document.querySelectorAll('[data-copy-target]').forEach(button => button.addEventListener('click', async () => {
    const target = button.dataset.copyTarget;
    const value = target === 'card' ? cardNumber : target === 'recipient' ? paymentConfig.recipient : paymentConfig.iban;
    if (!value) return notify('Реквізити ще не налаштовано.');
    try { await navigator.clipboard.writeText(value); notify('Скопійовано.'); } catch { notify('Не вдалося скопіювати автоматично.'); }
  }));
  sendButton.addEventListener('click', async () => {
    if (!order || !selectedFile || !$('#proofConsent').checked || secondsRemaining <= 0 || !isPaymentConfigured() || !accountToken) return;
    sendButton.disabled = true;
    sendButton.textContent = 'Надсилаємо…';
    try {
      const payload = new FormData();
      payload.set('orderId', order.id);
      payload.set('comment', $('#paymentComment').value.trim());
      payload.set('attachment', selectedFile, selectedFile.name);
      await sendOrder(payload);
      showSuccess('Дякуємо за оплату!', `Підтвердження замовлення ${order.id} надіслано адміністратору. Після перевірки оплати підписка з’явиться у твоєму профілі. Сама хмарна гра стане доступною після запуску серверів.`);
    } catch (error) {
      setStatus($('#paymentSubmitStatus'), error.message);
      sendButton.textContent = 'Надіслати підтвердження';
      refreshSubmitState();
    }
  });
  $('#paymentYear').textContent = String(new Date().getFullYear());
})();
