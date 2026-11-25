(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const config = window.RYZOR_CONFIG || {};
  const paymentConfig = config.payment || {};
  const apiBase = String(config.apiBase || '').replace(/\/$/, '');
  const sessionToken = sessionStorage.getItem('ryzor.auth.session.v1') || '';
  const user = (() => { try { return JSON.parse(sessionStorage.getItem('ryzor.auth.user.v1') || 'null'); } catch { return null; } })();
  const paymentsEnabled = config.paymentsEnabled === true;
  const plans = {
    free: { name: 'Безкоштовний', price: 0, duration: 'Безстроково', period: 'назавжди', description: 'Щоб познайомитися з Ryzor та спробувати хмарний формат.' },
    pro: { name: 'Професійний', price: 199, duration: '30 днів', period: '/ 30 днів', description: 'Для регулярних ігрових сесій та пріоритету.' },
    unlimited: { name: 'Безлімітний', price: 399, duration: '30 днів', period: '/ 30 днів', description: 'Максимум можливостей у межах доступної інфраструктури.' }
  };
  let order = null;
  let selectedFile = null;
  let secondsRemaining = 0;
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
  const isPaymentConfigured = () => Boolean(paymentsEnabled && cardNumber && paymentConfig.recipient && paymentConfig.bank && apiBase && sessionToken);
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
  async function api(path, body) {
    if (!apiBase) throw new Error('API Ryzor ще не підключено.');
    const response = await fetch(`${apiBase}${path}`, {
      method: 'POST', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify(body || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok !== true) throw new Error(data.error || `Помилка запиту (${response.status})`);
    return data;
  }
  async function apiForm(path, data) {
    const response = await fetch(`${apiBase}${path}`, {
      method: 'POST', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json', Authorization: `Bearer ${sessionToken}` }, body: data
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) throw new Error(result.error || `Помилка надсилання (${response.status})`);
    return result;
  }
  function updateSummary() {
    const plan = plans[planSelect.value] || plans.pro;
    $('#checkoutContinue').innerHTML = `${plan.price ? 'До оплати' : 'Подати заявку'} <svg viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>`;
    $('#summaryPlanName').textContent = plan.name;
    $('#summaryPlanDescription').textContent = plan.description;
    $('#summaryPlanPrice').textContent = money(plan.price);
    $('#summaryPlanPeriod').textContent = plan.period;
    $('#summaryPlanShort').textContent = plan.name;
    $('#summaryPlanDuration').textContent = plan.duration;
    $('#summaryTotal').textContent = money(plan.price);
    $('#checkoutContinue').disabled = !paymentsEnabled;
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
    if (!paymentsEnabled) span.textContent = 'Приймання оплат вимкнено до запуску хмарних серверів і перевірки платіжних реквізитів. Не переказуй кошти.';
    else if (!cardNumber || !paymentConfig.recipient || !paymentConfig.bank) span.textContent = 'Реквізити ще не додані власником Ryzor. Не переказуй кошти.';
    else if (!apiBase || !sessionToken) span.textContent = 'Не вдалося підключити API або акаунт. Увійди ще раз і перевір налаштування.';
  }
  function step(number) {
    document.querySelectorAll('[data-step-indicator]').forEach(node => {
      const value = Number(node.dataset.stepIndicator);
      node.classList.toggle('is-active', value === number);
      node.classList.toggle('is-done', value < number);
    });
  }
  function renderTimer() {
    secondsRemaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    const minutes = Math.floor(secondsRemaining / 60);
    const seconds = secondsRemaining % 60;
    $('#paymentTimer').textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    if (secondsRemaining <= 0) {
      clearInterval(timerId);
      $('#paymentTimer').classList.add('is-expired');
      sendButton.disabled = true;
      setStatus($('#paymentSubmitStatus'), 'Час для оплати завершився. Створи нове замовлення.');
    }
    refreshSubmitState();
  }
  function startTimer(serverExpiresAt) {
    clearInterval(timerId);
    expiresAt = Number(serverExpiresAt) * 1000;
    renderTimer();
    timerId = setInterval(renderTimer, 1000);
  }
  function validFile(file) {
    const allowedMime = /^(image\/(jpeg|png|webp)|video\/(mp4|webm|quicktime)|application\/pdf|text\/plain)$/i;
    const allowedExt = /\.(jpe?g|png|webp|mp4|webm|mov|pdf|txt)$/i.test(file.name);
    return allowedMime.test(file.type) || allowedExt;
  }
  function showFile(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { clearFile(); notify('Максимальний розмір файлу — 20 МБ.'); return; }
    if (!validFile(file)) { clearFile(); notify('Додай фото, відео, PDF або текстовий документ.'); return; }
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
    sendButton.disabled = !selectedFile || !consent || secondsRemaining <= 0 || !isPaymentConfigured() || !order;
  }
  function showSuccess(title, message) {
    clearInterval(timerId);
    $('#paymentSuccess').querySelector('h2').textContent = title;
    $('#paymentSuccess').querySelector('p').textContent = message;
    $('#successOrderId').textContent = order.id;
    $('#checkoutStepOne').hidden = true;
    $('#checkoutStepTwo').hidden = true;
    $('#paymentSuccess').hidden = false;
    step(3);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function createOrder() {
    const data = new FormData(form);
    const planCode = String(data.get('plan'));
    const nickname = String(data.get('nickname') || '').trim();
    const telegramUsername = String(data.get('telegram') || '').trim();
    const result = await api('/api/orders/create', { planCode, nickname, telegramUsername, privacyConsent: $('#checkoutPrivacyConsent').checked });
    order = { id: result.orderId, planCode, plan: plans[planCode], nickname, telegram: telegramUsername, expiresAt: result.expiresAt, status: result.status };
    return result;
  }

  if (!sessionToken || !user?.email) {
    const next = `payment.html${location.search || ''}`;
    location.replace(`auth.html?next=${encodeURIComponent(next)}`);
    return;
  }
  $('#checkoutEmail').value = user.email;
  $('#paymentsDisabledBanner').hidden = paymentsEnabled;
  const params = new URLSearchParams(location.search);
  if (plans[params.get('plan')]) planSelect.value = params.get('plan');
  planSelect.addEventListener('change', updateSummary);
  updateSummary();
  updateRequisites();

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (!paymentsEnabled) {
      setStatus($('#checkoutStepStatus'), 'Оформлення поки закрите. Не переказуй кошти до офіційного запуску Ryzor.');
      return;
    }
    const button = $('#checkoutContinue');
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = 'Створюємо замовлення…';
    try {
      const result = await createOrder();
      if (result.status === 'pending_review') {
        showSuccess('Заявку отримано!', result.adminNotified ? 'Заявку на безкоштовний тариф передано адміністратору. Її статус з’явиться у профілі після оновлення.' : 'Заявку збережено, але сповіщення адміністратору не пройшло. Статус можна перевірити в акаунті.');
        return;
      }
      $('#paymentOrderId').textContent = order.id;
      $('#paymentOrderPlan').textContent = `${order.plan.name} · ${money(result.amountUah)}`;
      $('#checkoutStepOne').hidden = true;
      $('#checkoutStepTwo').hidden = false;
      updateRequisites();
      step(2);
      startTimer(result.expiresAt);
      refreshSubmitState();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setStatus($('#checkoutStepStatus'), error.message);
    } finally {
      button.disabled = !paymentsEnabled;
      button.innerHTML = oldText;
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
    if (!order || !selectedFile || !$('#proofConsent').checked || secondsRemaining <= 0 || !isPaymentConfigured()) return;
    sendButton.disabled = true;
    sendButton.textContent = 'Надсилаємо…';
    try {
      const payload = new FormData();
      payload.set('orderId', order.id);
      payload.set('comment', $('#paymentComment').value.trim());
      payload.set('attachment', selectedFile, selectedFile.name);
      payload.set('privacyConsent', 'true');
      await apiForm('/api/orders/proof', payload);
      showSuccess('Дякуємо за оплату!', 'Підтвердження отримано й передано адміністратору. Після перевірки статус замовлення та підписка оновляться у твоєму профілі. Це ще не автоматичне підтвердження надходження коштів.');
    } catch (error) {
      setStatus($('#paymentSubmitStatus'), error.message);
      sendButton.innerHTML = 'Надіслати підтвердження <svg viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
      refreshSubmitState();
    }
  });
  $('#paymentYear').textContent = String(new Date().getFullYear());
})();
