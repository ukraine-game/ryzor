(() => {
  'use strict';

  // Public display settings. These values are visible to every website visitor.
  // Never put a Telegram bot token or any private key in this file.
  const PAYMENT_CONFIG = {
    workerUrl: '', // Example: https://ryzor-payments.YOUR-SUBDOMAIN.workers.dev/payment
    bank: '',
    recipient: '',
    cardNumber: '',
    iban: '',
    maxFileSizeMB: 20
  };

  const plans = {
    free: { name: 'Безкоштовний', price: 0, duration: 'Безстроково', period: 'назавжди', description: 'Щоб познайомитися з платформою та спробувати хмарний формат.' },
    pro: { name: 'Професійний', price: 199, duration: '30 днів', period: '/ 30 днів', description: 'Для регулярних ігрових сесій із пріоритетом.' },
    unlimited: { name: 'Безлімітний', price: 399, duration: '30 днів', period: '/ 30 днів', description: 'Максимальна свобода та продуктивність.' }
  };

  const $ = selector => document.querySelector(selector);
  const checkoutForm = $('#checkoutForm');
  const planSelect = $('#checkoutPlan');
  const fileInput = $('#paymentProof');
  const uploadZone = $('#uploadZone');
  const sendButton = $('#sendPaymentProof');
  const toast = $('#paymentToast');
  let order = null;
  let selectedFile = null;
  let secondsRemaining = 600;
  let timerId = null;
  let toastTimer = null;

  const formatPrice = value => `${new Intl.NumberFormat('uk-UA').format(value)} ₴`;
  const normalizeCard = value => String(value || '').replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim();
  const paymentConfigured = () => Boolean(PAYMENT_CONFIG.cardNumber && PAYMENT_CONFIG.recipient && PAYMENT_CONFIG.bank);

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2800);
  }

  function updateSummary() {
    const plan = plans[planSelect.value] || plans.pro;
    $('#checkoutContinue').textContent = plan.price === 0 ? 'Надіслати заявку' : 'До оплати';
    $('#summaryPlanName').textContent = plan.name;
    $('#summaryPlanDescription').textContent = plan.description;
    $('#summaryPlanPrice').textContent = formatPrice(plan.price);
    $('#summaryPlanPeriod').textContent = plan.period;
    $('#summaryPlanShort').textContent = plan.name;
    $('#summaryPlanDuration').textContent = plan.duration;
    $('#summaryTotal').textContent = formatPrice(plan.price);
  }

  function updatePaymentDetails() {
    const card = normalizeCard(PAYMENT_CONFIG.cardNumber);
    $('#bankCardNumber').textContent = card || '•••• •••• •••• ••••';
    $('#bankRecipient').textContent = PAYMENT_CONFIG.recipient || 'Реквізити ще не додані';
    $('#bankName').textContent = PAYMENT_CONFIG.bank || 'Банк буде вказано';
    $('#copyCardValue').textContent = card || 'Не налаштовано';
    $('#copyRecipientValue').textContent = PAYMENT_CONFIG.recipient || 'Не налаштовано';
    $('#copyIbanValue').textContent = PAYMENT_CONFIG.iban || '';
    $('#ibanRow').hidden = !PAYMENT_CONFIG.iban;
    const warning = $('#paymentSetupWarning');
    warning.hidden = paymentConfigured() && Boolean(PAYMENT_CONFIG.workerUrl);
    if (!PAYMENT_CONFIG.cardNumber || !PAYMENT_CONFIG.recipient || !PAYMENT_CONFIG.bank) {
      warning.querySelector('span').textContent = 'Власник сайту ще не додав платіжні реквізити. Не здійснюй переказ. Реквізити з’являться після налаштування PAYMENT_CONFIG у файлі payment.js.';
    } else if (!PAYMENT_CONFIG.workerUrl) {
      warning.querySelector('span').textContent = 'Платіжні реквізити додані, але перед прийманням коштів власник сайту має підключити Telegram Worker. Поки інтеграція не активна, не здійснюй переказ.';
    }
  }

  function setStep(step) {
    document.querySelectorAll('[data-step-indicator]').forEach(item => {
      const value = Number(item.dataset.stepIndicator);
      item.classList.toggle('is-active', value === step);
      item.classList.toggle('is-done', value < step);
    });
  }

  function startTimer() {
    window.clearInterval(timerId);
    secondsRemaining = 600;
    renderTimer();
    timerId = window.setInterval(() => {
      secondsRemaining -= 1;
      renderTimer();
      if (secondsRemaining <= 0) {
        window.clearInterval(timerId);
        $('#paymentTimer').classList.add('is-expired');
        sendButton.disabled = true;
        setStatus('Час для оплати завершився. Повернися до першого кроку та створи нову заявку.', 'error');
      }
    }, 1000);
  }

  function renderTimer() {
    const minutes = Math.floor(Math.max(0, secondsRemaining) / 60);
    const seconds = Math.max(0, secondsRemaining) % 60;
    $('#paymentTimer').textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function setStatus(message, type) {
    const node = $('#paymentSubmitStatus');
    node.textContent = message;
    node.className = `payment-submit-status is-${type}`;
    node.hidden = false;
  }

  function refreshSubmitState() {
    sendButton.disabled = !selectedFile || !$('#proofConsent').checked || secondsRemaining <= 0 || !paymentConfigured() || !PAYMENT_CONFIG.workerUrl;
  }

  function showFile(file) {
    if (!file) return;
    const maxBytes = PAYMENT_CONFIG.maxFileSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
      showToast(`Файл завеликий. Максимум — ${PAYMENT_CONFIG.maxFileSizeMB} МБ.`);
      fileInput.value = '';
      return;
    }
    const allowed = /^(image\/(jpeg|png|webp)|video\/(mp4|webm|quicktime)|application\/(pdf|zip|x-zip-compressed|msword|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|octet-stream)|text\/(plain|csv))$/i;
    const extensionAllowed = /\.(pdf|zip|txt|docx?|xlsx?|pptx?|csv)$/i.test(file.name);
    if (!allowed.test(file.type) && !extensionAllowed) {
      showToast('Цей тип файлу не підтримується. Додай зображення, відео, PDF або документ.');
      fileInput.value = '';
      return;
    }
    selectedFile = file;
    $('#fileName').textContent = file.name;
    $('#fileSize').textContent = `${(file.size / 1024 / 1024).toFixed(2)} МБ`;
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

  checkoutForm.addEventListener('submit', event => {
    event.preventDefault();
    if (!checkoutForm.reportValidity()) return;
    const data = new FormData(checkoutForm);
    const plan = plans[String(data.get('plan'))];
    const random = crypto.getRandomValues(new Uint32Array(1))[0].toString().slice(0, 7);
    order = {
      id: `RZ-${random.padStart(7, '0')}`,
      nickname: String(data.get('nickname')).trim(),
      email: String(data.get('email')).trim(),
      telegram: String(data.get('telegram') || '').trim(),
      plan,
      planKey: String(data.get('plan')),
      createdAt: new Date().toISOString()
    };
    if (plan.price === 0) {
      submitFreePlan();
      return;
    }
    $('#paymentOrderId').textContent = order.id;
    $('#paymentOrderPlan').textContent = `${plan.name} · ${formatPrice(plan.price)}`;
    $('#checkoutStepOne').hidden = true;
    $('#checkoutStepTwo').hidden = false;
    $('#paymentSuccess').hidden = true;
    updatePaymentDetails();
    setStep(2);
    startTimer();
    refreshSubmitState();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });


  async function submitFreePlan() {
    const button = $('#checkoutContinue');
    const status = $('#checkoutStepStatus');
    if (!PAYMENT_CONFIG.workerUrl) {
      status.textContent = 'Заявку не відправлено: власник сайту ще не підключив Telegram через Cloudflare Worker.';
      status.hidden = false;
      return;
    }
    button.disabled = true;
    button.textContent = 'Надсилаємо…';
    status.hidden = true;
    const formData = new FormData();
    formData.set('orderId', order.id);
    formData.set('nickname', order.nickname);
    formData.set('email', order.email);
    formData.set('telegram', order.telegram);
    formData.set('plan', order.plan.name);
    formData.set('price', '0 UAH');
    formData.set('createdAt', order.createdAt);
    try {
      const response = await fetch(PAYMENT_CONFIG.workerUrl, {
        method: 'POST', body: formData, mode: 'cors', credentials: 'omit',
        referrerPolicy: 'no-referrer', headers: { 'Accept': 'application/json' }
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) throw new Error(result.error || `Помилка відправлення (${response.status})`);
      window.clearInterval(timerId);
      $('#paymentSuccess').querySelector('h2').textContent = 'Заявку надіслано!';
      $('#paymentSuccess').querySelector('p').textContent = 'Заявку на безкоштовний тариф отримано. Адміністратор перевірить дані й зв’яжеться з тобою за вказаною поштою або Telegram. Платити за цей тариф не потрібно.';
      $('#successOrderId').textContent = order.id;
      $('#checkoutStepOne').hidden = true;
      $('#paymentSuccess').hidden = false;
      setStep(3);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      status.textContent = error.message || 'Не вдалося надіслати заявку. Спробуй ще раз.';
      status.hidden = false;
      button.disabled = false;
      button.textContent = 'Надіслати заявку';
    }
  }

  planSelect.addEventListener('change', updateSummary);
  $('#removeFile').addEventListener('click', clearFile);
  fileInput.addEventListener('change', () => showFile(fileInput.files?.[0]));
  $('#proofConsent').addEventListener('change', refreshSubmitState);

  ['dragenter', 'dragover'].forEach(type => uploadZone.addEventListener(type, event => {
    event.preventDefault();
    uploadZone.classList.add('is-dragover');
  }));
  ['dragleave', 'drop'].forEach(type => uploadZone.addEventListener(type, event => {
    event.preventDefault();
    uploadZone.classList.remove('is-dragover');
  }));
  uploadZone.addEventListener('drop', event => showFile(event.dataTransfer?.files?.[0]));

  document.querySelectorAll('[data-copy-target]').forEach(button => button.addEventListener('click', async () => {
    const values = {
      card: normalizeCard(PAYMENT_CONFIG.cardNumber),
      recipient: PAYMENT_CONFIG.recipient,
      iban: PAYMENT_CONFIG.iban
    };
    const value = values[button.dataset.copyTarget];
    if (!value) return showToast('Ці реквізити ще не налаштовані.');
    try {
      await navigator.clipboard.writeText(value);
      showToast('Скопійовано.');
    } catch {
      showToast('Не вдалося скопіювати. Виділи реквізити вручну.');
    }
  }));

  sendButton.addEventListener('click', async () => {
    if (!order || !selectedFile || !$('#proofConsent').checked) return;
    if (secondsRemaining <= 0) return setStatus('Час для оплати завершився. Створи нову заявку.', 'error');
    if (!paymentConfigured()) return setStatus('Власник сайту ще не налаштував реквізити. Заявку не відправлено.', 'error');
    if (!PAYMENT_CONFIG.workerUrl) return setStatus('Telegram-інтеграцію ще не підключено. Файл не був відправлений. Додай адресу Cloudflare Worker у payment.js.', 'error');

    sendButton.disabled = true;
    sendButton.dataset.originalText = sendButton.textContent;
    sendButton.textContent = 'Надсилаємо…';
    const formData = new FormData();
    formData.set('orderId', order.id);
    formData.set('nickname', order.nickname);
    formData.set('email', order.email);
    formData.set('telegram', order.telegram);
    formData.set('plan', order.plan.name);
    formData.set('price', `${order.plan.price} UAH`);
    formData.set('createdAt', order.createdAt);
    formData.set('comment', String($('#paymentComment').value || '').trim());
    formData.set('attachment', selectedFile, selectedFile.name);

    try {
      const response = await fetch(PAYMENT_CONFIG.workerUrl, {
        method: 'POST', body: formData, mode: 'cors', credentials: 'omit',
        referrerPolicy: 'no-referrer', headers: { 'Accept': 'application/json' }
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) throw new Error(result.error || `Помилка відправлення (${response.status})`);
      window.clearInterval(timerId);
      $('#successOrderId').textContent = order.id;
      $('#checkoutStepTwo').hidden = true;
      $('#paymentSuccess').hidden = false;
      setStep(3);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setStatus(error.message || 'Не вдалося надіслати заявку. Перевір з’єднання та спробуй ще раз.', 'error');
      refreshSubmitState();
    } finally {
      sendButton.textContent = 'Надіслати підтвердження';
    }
  });

  const params = new URLSearchParams(location.search);
  const requestedPlan = params.get('plan');
  if (requestedPlan && plans[requestedPlan]) planSelect.value = requestedPlan;
  updateSummary();
  updatePaymentDetails();
  $('#paymentYear').textContent = String(new Date().getFullYear());
})();
