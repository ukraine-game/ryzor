(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const ORDER_KEY = 'ryzor.local.orders.v1';
  const ACCOUNT_KEY = 'ryzor.local.accounts.v1';
  const SESSION_KEY = 'ryzor.local.session.v1';
  const plans = {
    free: { name: 'Безкоштовний', price: 0, duration: 'Безстроково', period: 'назавжди', description: 'Для знайомства з Ryzor.' },
    pro: { name: 'Професійний', price: 199, duration: '30 днів', period: '/ 30 днів', description: 'Для регулярних ігрових сесій.' },
    unlimited: { name: 'Безлімітний', price: 399, duration: '30 днів', period: '/ 30 днів', description: 'Максимум можливостей у межах доступної послуги.' }
  };
  const money = value => `${new Intl.NumberFormat('uk-UA').format(value)} ₴`;
  const read = (key, fallback) => { try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value ?? fallback; } catch { return fallback; } };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const toast = $('#paymentToast');
  let toastTimer = null;
  let order = null;
  let selectedFile = null;
  let timerId = null;
  let expiresAt = 0;
  let secondsRemaining = 0;
  const form = $('#checkoutForm');
  const planSelect = $('#checkoutPlan');
  const fileInput = $('#paymentProof');
  const sendButton = $('#sendPaymentProof');
  const uploadZone = $('#uploadZone');

  function notify(message) {
    toast.textContent = message; toast.classList.add('is-visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
  }
  function setStatus(node, message, error = true) {
    node.textContent = message; node.className = `payment-submit-status ${error ? 'is-error' : 'is-success'}`; node.hidden = false;
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
    $('#checkoutContinue').innerHTML = `${plan.price ? 'До оплати' : 'Оформити'} <svg viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>`;
    $('#summaryPlanName').textContent = plan.name;
    $('#summaryPlanDescription').textContent = plan.description;
    $('#summaryPlanPrice').textContent = money(plan.price);
    $('#summaryPlanPeriod').textContent = plan.period;
    $('#summaryPlanShort').textContent = plan.name;
    $('#summaryPlanDuration').textContent = plan.duration;
    $('#summaryTotal').textContent = money(plan.price);
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
    const minutes = Math.floor(secondsRemaining / 60), seconds = secondsRemaining % 60;
    $('#paymentTimer').textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    if (secondsRemaining <= 0) {
      clearInterval(timerId); $('#paymentTimer').classList.add('is-expired');
      setStatus($('#paymentSubmitStatus'), 'Час завершився. Повернись до тарифів і створи нове замовлення.');
    }
    refreshSubmitState();
  }
  function refreshSubmitState() {
    const plan = order?.planCode ? plans[order.planCode] : null;
    const fileRequired = Boolean(plan?.price);
    sendButton.disabled = !order || (fileRequired && secondsRemaining <= 0) || !$('#proofConsent').checked || (fileRequired && !selectedFile);
  }
  function validFile(file) {
    return /^(image\/(jpeg|png|webp)|video\/(mp4|webm|quicktime)|application\/pdf)$/i.test(file.type) || /\.(jpe?g|png|webp|mp4|webm|mov|pdf)$/i.test(file.name);
  }
  function showFile(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { clearFile(); return notify('Максимальний розмір файлу — 20 МБ.'); }
    if (!validFile(file)) { clearFile(); return notify('Додай фото, відео або PDF.'); }
    selectedFile = file;
    $('#fileName').textContent = file.name;
    $('#fileSize').textContent = `${(file.size / 1048576).toFixed(2)} МБ`;
    $('#filePreview').hidden = false; uploadZone.hidden = true;
    refreshSubmitState();
  }
  function clearFile() {
    selectedFile = null; fileInput.value = '';
    $('#filePreview').hidden = true; uploadZone.hidden = false; refreshSubmitState();
  }
  function makeTelegramDraft() {
    return [
      'Вітаю! Хочу оформити тариф RYZOR.',
      `Серійний номер: ${order.serial}`,
      `Тариф: ${order.planName}`,
      `Сума: ${money(order.amount)}`,
      `Ім’я: ${order.fullName}`,
      `Нікнейм: ${order.nickname}`,
      `Email: ${order.email}`,
      order.telegram ? `Telegram: ${order.telegram}` : '',
      $('#paymentComment').value.trim() ? `Коментар: ${$('#paymentComment').value.trim()}` : '',
      order.amount ? 'Квитанцію прикріплю окремим файлом.' : 'Прошу підказати щодо безкоштовного тарифу.'
    ].filter(Boolean).join('\n');
  }
  function showSuccess() {
    clearInterval(timerId);
    $('#successOrderId').textContent = order.serial;
    $('#checkoutStepOne').hidden = true;
    $('#checkoutStepTwo').hidden = true;
    $('#paymentSuccess').hidden = false;
    step(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const user = currentUser();
  if (!user) {
    const next = `payment.html${location.search || ''}`;
    location.replace(`auth.html?next=${encodeURIComponent(next)}`);
    return;
  }
  $('#checkoutFullName').value = user.fullName;
  $('#checkoutEmail').value = user.email;
  const params = new URLSearchParams(location.search);
  if (plans[params.get('plan')]) planSelect.value = params.get('plan');
  planSelect.addEventListener('change', updateSummary);
  updateSummary();

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (!$('#checkoutPrivacyConsent').checked) return setStatus($('#checkoutStepStatus'), 'Підтверди ознайомлення з політикою конфіденційності.');
    const data = new FormData(form);
    const planCode = String(data.get('plan'));
    const plan = plans[planCode];
    if (!plan) return;
    order = {
      serial: newSerial(), planCode, planName: plan.name, amount: plan.price,
      fullName: String(data.get('fullName')).trim(), nickname: String(data.get('nickname')).trim(),
      email: String(data.get('email')).trim().toLowerCase(), telegram: String(data.get('telegram') || '').trim(),
      createdAt: Date.now(), status: 'local'
    };
    const stored = read(ORDER_KEY, []);
    stored.unshift(order); write(ORDER_KEY, stored.slice(0, 30));
    $('#paymentOrderPlan').textContent = `${plan.name} · ${money(plan.price)}`;
    $('#paymentAmount').textContent = money(plan.price);
    $('#paymentSerial').textContent = order.serial;
    $('#checkoutStepOne').hidden = true;
    $('#checkoutStepTwo').hidden = false;
    if (!plan.price) {
      $('#paymentTimer').textContent = '—';
      $('#paymentTimer').classList.remove('is-expired');
      $('#uploadZone').hidden = true;
      $('.proof-description').textContent = 'Для безкоштовного тарифу квитанція не потрібна. Відкрий чат, щоб узгодити доступ.';
      $('.proof-consent span').textContent = 'Підтверджую, що ознайомився(-лася) з умовами оформлення безкоштовного тарифу.';
      $('#proofConsent').checked = true;
    } else {
      $('.proof-consent span').textContent = 'Підтверджую, що квитанція стосується цього замовлення та не містить PIN, CVV або повного номера картки.';
      $('#proofConsent').checked = false;
      $('#paymentTimer').classList.remove('is-expired');
      expiresAt = Date.now() + 10 * 60 * 1000;
      renderTimer(); timerId = setInterval(renderTimer, 1000);
    }
    step(2); refreshSubmitState();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  fileInput.addEventListener('change', () => showFile(fileInput.files?.[0]));
  $('#removeFile').addEventListener('click', clearFile);
  $('#proofConsent').addEventListener('change', refreshSubmitState);
  ['dragenter', 'dragover'].forEach(type => uploadZone.addEventListener(type, event => { event.preventDefault(); uploadZone.classList.add('is-dragover'); }));
  ['dragleave', 'drop'].forEach(type => uploadZone.addEventListener(type, event => { event.preventDefault(); uploadZone.classList.remove('is-dragover'); }));
  uploadZone.addEventListener('drop', event => { const file = event.dataTransfer?.files?.[0]; if (file) showFile(file); });
  $('#copySerial').addEventListener('click', async () => {
    if (!order?.serial) return;
    try { await navigator.clipboard.writeText(order.serial); notify('Серійний номер скопійовано.'); }
    catch { notify('Не вдалося скопіювати. Виділи номер вручну.'); }
  });

  sendButton.addEventListener('click', () => {
    if (!order || (secondsRemaining <= 0 && order.amount > 0) || !$('#proofConsent').checked || (order.amount > 0 && !selectedFile)) return;
    const draft = makeTelegramDraft();
    $('#telegramDraft').value = draft;
    $('#telegramSuccessLink').href = 'https://t.me/st0fen';
    window.open('https://t.me/st0fen', '_blank', 'noopener,noreferrer');
    showSuccess();
    const copyRequest = navigator.clipboard ? navigator.clipboard.writeText(draft) : Promise.reject(new Error('Clipboard unavailable'));
    copyRequest.then(() => notify('Текст заявки скопійовано. Встав його в чаті Telegram та додай квитанцію.')).catch(() => notify('Скопіюй текст заявки вручну, потім відкрий Telegram.'));
  });
  $('#copyTelegramDraft').addEventListener('click', async () => {
    const draft = $('#telegramDraft').value;
    try { await navigator.clipboard.writeText(draft); notify('Текст заявки скопійовано.'); }
    catch { $('#telegramDraft').focus(); $('#telegramDraft').select(); notify('Виділи текст і скопіюй його вручну.'); }
  });

  $('#paymentYear').textContent = String(new Date().getFullYear());
})();
