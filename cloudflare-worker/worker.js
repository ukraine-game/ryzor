const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime',
  'application/pdf', 'application/zip', 'application/x-zip-compressed', 'text/plain', 'application/octet-stream',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]);

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': origin || 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin'
    }
  });
}

function safeText(value, max = 500) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigins = String(env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
    const corsOrigin = allowedOrigins.includes(origin) ? origin : '';

    if (request.method === 'OPTIONS') {
      if (!corsOrigin) return json({ ok: false, error: 'Origin not allowed' }, 403, 'null');
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': corsOrigin,
          'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
          'Vary': 'Origin'
        }
      });
    }

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return corsOrigin ? json({ ok: true, service: 'Ryzor payment relay' }, 200, corsOrigin) : json({ ok: false }, 403, 'null');
    }
    if (request.method !== 'POST' || url.pathname !== '/payment') return json({ ok: false, error: 'Not found' }, 404, corsOrigin || 'null');
    if (!corsOrigin) return json({ ok: false, error: 'Origin not allowed' }, 403, 'null');
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return json({ ok: false, error: 'Telegram is not configured' }, 503, corsOrigin);
    if (!request.headers.get('content-type')?.toLowerCase().includes('multipart/form-data')) return json({ ok: false, error: 'Expected multipart form data' }, 415, corsOrigin);
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_UPLOAD_BYTES + 128 * 1024) return json({ ok: false, error: 'File is larger than 20 MB' }, 413, corsOrigin);

    let form;
    try {
      form = await request.formData();
    } catch {
      return json({ ok: false, error: 'Invalid form data' }, 400, corsOrigin);
    }

    // A hidden honeypot field catches basic automated submissions.
    if (safeText(form.get('website'), 200)) return json({ ok: true }, 200, corsOrigin);

    const orderId = safeText(form.get('orderId'), 24);
    const nickname = safeText(form.get('nickname'), 24);
    const email = safeText(form.get('email'), 120);
    const telegram = safeText(form.get('telegram'), 40);
    const plan = safeText(form.get('plan'), 40);
    const price = safeText(form.get('price'), 24);
    const createdAt = safeText(form.get('createdAt'), 40);
    const comment = safeText(form.get('comment'), 300);
    if (!/^RZ-[A-Z0-9]{5,12}$/i.test(orderId) || !nickname || !email || !plan || !price) {
      return json({ ok: false, error: 'Required order fields are missing' }, 400, corsOrigin);
    }

    const file = form.get('attachment');
    const isFreePlan = plan === 'Безкоштовний' && price === '0 UAH';
    if (!isFreePlan && (!(file instanceof File) || file.size < 1)) return json({ ok: false, error: 'Payment proof file is missing' }, 400, corsOrigin);
    if (file instanceof File && file.size > MAX_UPLOAD_BYTES) return json({ ok: false, error: 'File is larger than 20 MB' }, 413, corsOrigin);
    if (file instanceof File && file.type && !ALLOWED_TYPES.has(file.type)) return json({ ok: false, error: 'Unsupported file type' }, 415, corsOrigin);

    const message = [
      '🧾 RYZOR — НОВЕ ПІДТВЕРДЖЕННЯ ОПЛАТИ',
      `Заявка: ${orderId}`,
      `Нікнейм: ${nickname}`,
      `Email: ${email}`,
      `Telegram: ${telegram || 'Не вказано'}`,
      `Тариф: ${plan}`,
      `Сума: ${price}`,
      `Створено: ${createdAt || 'Не вказано'}`,
      ...(file instanceof File ? [`Файл: ${safeText(file.name, 100)} (${(file.size / 1024 / 1024).toFixed(2)} MB)`] : ['Безкоштовний тариф — підтвердження переказу не потрібне']),
      `Коментар: ${comment || 'Немає'}`
    ].join('\n');

    const apiRoot = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
    let method = 'sendDocument';
    if (file instanceof File && file.type.startsWith('image/') && file.size <= 10 * 1024 * 1024) method = 'sendPhoto';
    else if (file instanceof File && file.type.startsWith('video/')) method = 'sendVideo';
    // Images above Telegram's sendPhoto limit are delivered as documents instead.

    const telegramForm = new FormData();
    telegramForm.set('chat_id', env.TELEGRAM_CHAT_ID);
    if (file instanceof File) {
      telegramForm.set('caption', message.slice(0, 1024));
      telegramForm.set(method === 'sendPhoto' ? 'photo' : method === 'sendVideo' ? 'video' : 'document', file, safeText(file.name, 100) || 'payment-proof');
    } else {
      telegramForm.set('text', message);
    }

    try {
      const telegramResponse = await fetch(`${apiRoot}/${file instanceof File ? method : 'sendMessage'}`, { method: 'POST', body: telegramForm });
      const telegramResult = await telegramResponse.json();
      if (!telegramResponse.ok || telegramResult.ok !== true) {
        return json({ ok: false, error: 'Telegram did not accept the attachment' }, 502, corsOrigin);
      }
      return json({ ok: true, orderId }, 200, corsOrigin);
    } catch {
      return json({ ok: false, error: 'Could not reach Telegram' }, 502, corsOrigin);
    }
  }
};
