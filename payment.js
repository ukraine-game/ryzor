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
    secondsRemaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    const minutes = Math.floor(secondsRemaining / 60);
    const seconds = secondsRemaining % 60;
    $('#paymentTimer').textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    if (secondsRemaining <= 0) {
      clearInterval(timerId);
      $('#paymentTimer').classList.add('is-expired');
      sendButton.disabled = true;
      setStatus($('#paymentSubmitStatus'), 'Час для оплати завершився. Повернися до першого кроку та створи нову заявку.');
    }
    refreshSubmitState();
  }
  function startTimer() {
    clearInterval(timerId);
    expiresAt = Date.now() + 10 * 60 * 1000;
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
    if (!validFile(file)) { clearFile(); notify('Додай фото, відео, PDF або документ підтримуваного формату.'); return; }
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
    sendButton.disabled = !selectedFile || !consent || secondsRemaining <= 0 || !isPaymentConfigured();
  }
  async function sendOrder(formData) {
    const response = await fetch(`${apiBase}/payment`, { method: 'POST', body: formData, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' } });
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
    $('#paymentSuccess').hidden = false;
    step(3);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function submitFreePlan() {
    const button = $('#checkoutContinue');
    const status = $('#checkoutStepStatus');
    if (!apiBase) { setStatus(status, 'Заявку не відправлено: Telegram Worker ще не підключено.'); return; }
    button.disabled = true;
    try {
      const payload = new FormData();
      payload.set('orderId', order.id);
      payload.set('nickname', order.nickname);
      payload.set('email', order.email);
      payload.set('telegram', order.telegram);
      payload.set('plan', order.plan.name);
      payload.set('price', '0 UAH');
      payload.set('createdAt', order.createdAt);
      await sendOrder(payload);
      showSuccess('Заявку надіслано!', 'Заявку на безкоштовний тариф отримано адміністратором. Після перевірки тобі повідомлять про статус; хмарні сесії стануть доступні після запуску серверів.');
    } catch (error) {
      setStatus(status, error.message);
      button.disabled = false;
    }
  }

  const params = new URLSearchParams(location.search);
  if (plans[params.get('plan')]) planSelect.value = params.get('plan');
  planSelect.addEventListener('change', updateSummary);
  updateSummary();
  updateRequisites();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const plan = plans[String(data.get('plan'))];
    const suffix = [...crypto.getRandomValues(new Uint8Array(6))].map(value => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[value % 32]).join('');
    order = { id: `RZ-${suffix}`, nickname: String(data.get('nickname')).trim(), email: String(data.get('email')).trim(), telegram: String(data.get('telegram') || '').trim(), plan, createdAt: new Date().toISOString() };
    if (plan.price === 0) { await submitFreePlan(); return; }
    $('#paymentOrderId').textContent = order.id;
    $('#paymentOrderPlan').textContent = `${plan.name} · ${money(plan.price)}`;
    $('#checkoutStepOne').hidden = true;
    $('#checkoutStepTwo').hidden = false;
    updateRequisites();
    step(2);
    startTimer();
    refreshSubmitState();
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    sendButton.textContent = 'НАДСИЛАЄМО…';
    try {
      const payload = new FormData();
      payload.set('orderId', order.id);
      payload.set('nickname', order.nickname);
      payload.set('email', order.email);
      payload.set('telegram', order.telegram);
      payload.set('plan', order.plan.name);
      payload.set('price', `${order.plan.price} UAH`);
      payload.set('createdAt', order.createdAt);
      payload.set('comment', $('#paymentComment').value.trim());
      payload.set('attachment', selectedFile, selectedFile.name);
      await sendOrder(payload);
      showSuccess('Дякуємо за оплату!', 'Підтвердження надіслано адміністратору Ryzor. Після перевірки оплати з тобою зв’яжуться за вказаною поштою або Telegram. Підписка активується після підтвердження адміністратором і запуску хмарної платформи.');
    } catch (error) {
      setStatus($('#paymentSubmitStatus'), error.message);
      sendButton.innerHTML = 'НАДІСЛАТИ ПІДТВЕРДЖЕННЯ <svg viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
      refreshSubmitState();
    }
  });
  $('#paymentYear').textContent = String(new Date().getFullYear());
})();
