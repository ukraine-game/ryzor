const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const PASSWORD_ITERATIONS = 600000;
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime',
  'application/pdf', 'text/plain'
]);

function json(data, status = 200, origin = '') {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin'
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(JSON.stringify(data), { status, headers });
}
function text(value, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function randomToken(bytes = 32) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const value of values) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
function makeId(prefix = 'RZ-') {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  return prefix + [...bytes].map(value => alphabet[value % alphabet.length]).join('').slice(0, 6);
}
function botToken(env) { return env.MY_API_KEY_TG || env.TELEGRAM_BOT_TOKEN || ''; }
function adminTelegramId(env) { return env.ADMIN_TG || env.ADMIN_TELEGRAM_ID || ''; }
function googleClientId(env) { return env.GOOGLE_CLIENT_ID || env.google_client_id || ''; }
function requireConfigured(env) {
  return Boolean(botToken(env) && adminTelegramId(env));
}
async function telegram(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${botToken(env)}/${method}`, {
    method: 'POST',
    headers: payload instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    body: payload instanceof FormData ? payload : JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true) throw new Error(`Telegram API ${method} failed`);
  return result;
}
async function sendAdmin(env, message) {
  return telegram(env, 'sendMessage', { chat_id: String(adminTelegramId(env)), text: message, disable_web_page_preview: true });
}
function getOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : '';
}
async function parseJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 12000) throw new Error('Request is too large');
  return request.json();
}
async function hitRateLimit(request, env, action, max, windowSeconds) {
  if (!env.DB) return false;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const subject = await sha256(ip);
  const now = Math.floor(Date.now() / 1000);
  const slot = Math.floor(now / windowSeconds) * windowSeconds;
  await env.DB.prepare(`INSERT INTO request_limits (subject_hash, action, window_start, count) VALUES (?, ?, ?, 1) ON CONFLICT(subject_hash, action) DO UPDATE SET count = CASE WHEN request_limits.window_start = excluded.window_start THEN request_limits.count + 1 ELSE 1 END, window_start = excluded.window_start`).bind(subject, action, slot).run();
  const row = await env.DB.prepare('SELECT count FROM request_limits WHERE subject_hash = ? AND action = ?').bind(subject, action).first();
  return Number(row?.count || 0) > max;
}

let googleJwksCache = null;
let googleJwksExpires = 0;

function base64UrlBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
function base64UrlJson(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
}
async function googleSigningKey(kid) {
  const now = Date.now();
  if (!googleJwksCache || now >= googleJwksExpires) {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/certs', {
      headers: { Accept: 'application/json' },
      cf: { cacheTtl: 1800, cacheEverything: true }
    });
    if (!response.ok) throw new Error('Не вдалося перевірити підпис Google.');
    const data = await response.json();
    googleJwksCache = Array.isArray(data.keys) ? data.keys : [];
    googleJwksExpires = now + 30 * 60 * 1000;
  }
  const key = googleJwksCache.find(item => item.kid === kid && item.kty === 'RSA' && item.use === 'sig');
  if (!key) {
    googleJwksExpires = 0;
    throw new Error('Ключ підпису Google не знайдено. Спробуй ще раз.');
  }
  return key;
}
async function verifyGoogleCredential(token, env) {
  const clientId = googleClientId(env);
  if (!clientId) throw new Error('Google Client ID ще не налаштовано в Cloudflare Worker.');
  if (typeof token !== 'string' || token.length < 100 || token.length > 10000) throw new Error('Google не надав коректне підтвердження.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Некоректний Google ID token.');
  const header = base64UrlJson(parts[0]);
  const claims = base64UrlJson(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Непідтримуваний підпис Google.');
  const jwk = await googleSigningKey(header.kid);
  const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const validSignature = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', publicKey, base64UrlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  const now = Math.floor(Date.now() / 1000);
  const audienceOk = Array.isArray(claims.aud) ? claims.aud.includes(clientId) : claims.aud === clientId;
  if (!validSignature || !audienceOk || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)
      || !Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= now
      || (claims.iat && Number(claims.iat) > now + 60)
      || claims.email_verified !== true || typeof claims.sub !== 'string' || typeof claims.email !== 'string') {
    throw new Error('Google не підтвердив цей акаунт. Перевір Client ID та спробуй ще раз.');
  }
  return {
    sub: text(claims.sub, 128),
    email: text(claims.email, 254).toLowerCase(),
    name: text(claims.name || '', 100)
  };
}
function constantTimeStringEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
async function createAccountSession(env, accountId) {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 14 * 86400;
  await env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').bind(now).run();
  await env.DB.prepare('INSERT INTO auth_sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(tokenHash, accountId, now, expiresAt).run();
  await env.DB.prepare('UPDATE accounts SET last_login_at = ? WHERE id = ?').bind(now, accountId).run();
  const account = await env.DB.prepare('SELECT id, email, full_name FROM accounts WHERE id = ?').bind(accountId).first();
  return { ok: true, sessionToken: token, expiresAt, user: { id: account.id, email: account.email, fullName: account.full_name } };
}
async function authenticateRequest(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+([A-Za-z0-9_-]{40,100})$/);
  if (!match || !env.DB) return null;
  const tokenHash = await sha256(match[1]);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(`SELECT a.id, a.email, a.full_name, s.token_hash, s.expires_at
    FROM auth_sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at >= ?`)
    .bind(tokenHash, now).first();
  return row ? { id: row.id, email: row.email, fullName: row.full_name, tokenHash } : null;
}
async function verifyGoogleForRegistration(request, env, origin) {
  if (!env.DB) return json({ ok: false, error: 'База акаунтів ще не налаштована.' }, 503, origin);
  if (await hitRateLimit(request, env, 'auth-google', 12, 900)) return json({ ok: false, error: 'Забагато спроб Google-входу. Спробуй пізніше.' }, 429, origin);
  let body;
  try { body = await parseJson(request); } catch { return json({ ok: false, error: 'Некоректний запит.' }, 400, origin); }
  try {
    const identity = await verifyGoogleCredential(body.credential, env);
    const existing = await env.DB.prepare('SELECT id FROM accounts WHERE google_sub = ? OR email = ?').bind(identity.sub, identity.email).first();
    return json({ ok: true, registered: Boolean(existing), email: identity.email, name: identity.name }, 200, origin);
  } catch (error) {
    return json({ ok: false, error: text(error.message, 220) || 'Не вдалося перевірити Google.' }, 401, origin);
  }
}
async function fakeLoginSalt(email, env) {
  if (!env.AUTH_SALT_PEPPER) throw new Error('Не налаштовано AUTH_SALT_PEPPER у Cloudflare Worker.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.AUTH_SALT_PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(email)));
  let binary = '';
  for (const value of signature.slice(0, 16)) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function getLoginSalt(request, env, origin) {
  if (!env.DB) return json({ ok: false, error: 'База акаунтів ще не налаштована.' }, 503, origin);
  if (await hitRateLimit(request, env, 'auth-login-salt', 20, 900)) return json({ ok: false, error: 'Забагато спроб входу. Спробуй пізніше.' }, 429, origin);
  let body;
  try { body = await parseJson(request); } catch { return json({ ok: false, error: 'Некоректний запит.' }, 400, origin); }
  const email = text(body.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'Перевір адресу електронної пошти.' }, 400, origin);
  const account = await env.DB.prepare('SELECT password_salt, password_iterations FROM accounts WHERE email = ?').bind(email).first();
  // Unknown emails receive a deterministic, secret-derived salt with the same response shape to reduce account enumeration.
  let salt;
  try { salt = account?.password_salt || await fakeLoginSalt(email, env); }
  catch (error) { return json({ ok: false, error: text(error.message, 180) }, 503, origin); }
  return json({ ok: true, salt, iterations: Number(account?.password_iterations || PASSWORD_ITERATIONS) }, 200, origin);
}

async function registerAccount(request, env, origin) {
  if (!env.DB) return json({ ok: false, error: 'База акаунтів ще не налаштована.' }, 503, origin);
  if (await hitRateLimit(request, env, 'auth-register', 5, 3600)) return json({ ok: false, error: 'Досягнуто ліміт реєстрацій. Спробуй пізніше.' }, 429, origin);
  let body;
  try { body = await parseJson(request); } catch { return json({ ok: false, error: 'Некоректний запит.' }, 400, origin); }
  const fullName = text(body.fullName, 100).replace(/\s+/g, ' ');
  const passwordSalt = text(body.passwordSalt, 100);
  const passwordProof = text(body.passwordProof, 100);
  if (fullName.length < 2 || !/^[A-Za-z0-9_-]{20,80}$/.test(passwordSalt) || !/^[A-Za-z0-9_-]{40,80}$/.test(passwordProof)) {
    return json({ ok: false, error: 'Не вдалося підготувати захищений пароль. Онови сторінку та повтори спробу.' }, 400, origin);
  }
  try {
    const identity = await verifyGoogleCredential(body.credential, env);
    const existing = await env.DB.prepare('SELECT id FROM accounts WHERE google_sub = ? OR email = ?').bind(identity.sub, identity.email).first();
    if (existing) return json({ ok: false, error: 'Цей Google-акаунт уже має реєстрацію. Увійди через email і пароль.' }, 409, origin);
    const passwordVerifierHash = await sha256(passwordProof);
    const now = Math.floor(Date.now() / 1000);
    const inserted = await env.DB.prepare('INSERT INTO accounts (google_sub, email, full_name, password_salt, password_hash, password_iterations, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(identity.sub, identity.email, fullName, passwordSalt, passwordVerifierHash, PASSWORD_ITERATIONS, now, now).run();
    return json(await createAccountSession(env, inserted.meta.last_row_id), 201, origin);
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) return json({ ok: false, error: 'Акаунт із цією поштою вже існує. Спробуй увійти.' }, 409, origin);
    return json({ ok: false, error: text(error.message, 220) || 'Не вдалося створити акаунт.' }, 400, origin);
  }
}
async function loginAccount(request, env, origin) {
  if (!env.DB) return json({ ok: false, error: 'База акаунтів ще не налаштована.' }, 503, origin);
  if (await hitRateLimit(request, env, 'auth-login', 12, 900)) return json({ ok: false, error: 'Забагато спроб входу. Спробуй пізніше.' }, 429, origin);
  let body;
  try { body = await parseJson(request); } catch { return json({ ok: false, error: 'Некоректний запит.' }, 400, origin); }
  const email = text(body.email, 254).toLowerCase();
  const passwordProof = text(body.passwordProof, 100);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[A-Za-z0-9_-]{40,80}$/.test(passwordProof)) return json({ ok: false, error: 'Неправильна пошта або пароль.' }, 401, origin);
  const account = await env.DB.prepare('SELECT id, password_hash FROM accounts WHERE email = ?').bind(email).first();
  const suppliedHash = await sha256(passwordProof);
  if (!account || !constantTimeStringEqual(suppliedHash, account.password_hash)) return json({ ok: false, error: 'Неправильна пошта або пароль.' }, 401, origin);
  return json(await createAccountSession(env, account.id), 200, origin);
}
async function getCurrentAccount(request, env, origin) {
  const account = await authenticateRequest(request, env);
  if (!account) return json({ ok: false, error: 'Сесія завершилася. Увійди знову.' }, 401, origin);
  return json({ ok: true, user: { id: account.id, email: account.email, fullName: account.fullName } }, 200, origin);
}
async function logoutAccount(request, env, origin) {
  const account = await authenticateRequest(request, env);
  if (account) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(account.tokenHash).run();
  return json({ ok: true }, 200, origin);
}

async function createSupportTicket(request, env, origin) {
  if (!env.DB) return json({ ok: false, error: 'Підтримка ще не налаштована: немає бази даних.' }, 503, origin);
  if (!requireConfigured(env)) return json({ ok: false, error: 'Telegram-бот ще не налаштований адміністратором.' }, 503, origin);
  let body;
  try { body = await parseJson(request); } catch { return json({ ok: false, error: 'Некоректне тіло запиту.' }, 400, origin); }
  const nickname = text(body.nickname, 24);
  const email = text(body.email, 120);
  const category = text(body.category, 60) || 'Загальне питання';
  const message = text(body.message, 2000);
  if (nickname.length < 2 || message.length < 8) return json({ ok: false, error: 'Перевір нікнейм і текст звернення.' }, 400, origin);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'Перевір адресу електронної пошти.' }, 400, origin);
  if (await hitRateLimit(request, env, 'ticket-create', 3, 3600)) return json({ ok: false, error: 'Досягнуто ліміт нових звернень. Спробуй пізніше.' }, 429, origin);
  const ticketId = makeId();
  const accessKey = randomToken(32);
  const accessHash = await sha256(accessKey);
  const now = Math.floor(Date.now() / 1000);
  try {
    await env.DB.prepare('INSERT INTO tickets (ticket_id, access_hash, nickname, email, category, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, \'open\', ?, ?)')
      .bind(ticketId, accessHash, nickname, email, category, now, now).run();
    await env.DB.prepare('INSERT INTO messages (ticket_id, actor, body, created_at) VALUES (?, \'user\', ?, ?)')
      .bind(ticketId, message, now).run();
  } catch {
    return json({ ok: false, error: 'Не вдалося зберегти звернення. Спробуй ще раз.' }, 503, origin);
  }
  let notified = true;
  try {
    await sendAdmin(env, `📩 НОВЕ ЗВЕРНЕННЯ RYZOR\nНомер: ${ticketId}\nНікнейм: ${nickname}\nEmail: ${email || 'Не вказано'}\nТема: ${category}\n\n${message}\n\nВідповідь на сайті:\n/reply ${ticketId} Текст відповіді`);
  } catch { notified = false; }
  return json({ ok: true, ticketId, accessKey, adminNotified: notified }, 201, origin);
}

async function addSupportMessage(request, env, origin) {
  if (!env.DB) return json({ ok: false, error: 'Підтримка ще не налаштована.' }, 503, origin);
  let body;
  try { body = await parseJson(request); } catch { return json({ ok: false, error: 'Некоректне тіло запиту.' }, 400, origin); }
  const ticketId = text(body.ticketId, 20).toUpperCase();
  const accessKey = text(body.accessKey, 100);
  const message = text(body.message, 2000);
  if (!/^RZ-[A-Z0-9]{6}$/.test(ticketId) || accessKey.length < 30 || message.length < 1) return json({ ok: false, error: 'Перевір дані повідомлення.' }, 400, origin);
  const ticket = await env.DB.prepare('SELECT status FROM tickets WHERE ticket_id = ? AND access_hash = ?').bind(ticketId, await sha256(accessKey)).first();
  if (!ticket) return json({ ok: false, error: 'Заявку не знайдено або ключ доступу неправильний.' }, 404, origin);
  if (ticket.status === 'closed') return json({ ok: false, error: 'Це звернення закрите. Створи нове, щоб продовжити.' }, 409, origin);
  const now = Math.floor(Date.now() / 1000);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS total FROM messages WHERE ticket_id = ? AND actor = 'user' AND created_at > ?").bind(ticketId, now - 60).first();
  if (Number(recent?.total || 0) >= 5) return json({ ok: false, error: 'Забагато повідомлень за хвилину. Спробуй трохи пізніше.' }, 429, origin);
  await env.DB.prepare('INSERT INTO messages (ticket_id, actor, body, created_at) VALUES (?, \'user\', ?, ?)').bind(ticketId, message, now).run();
  const owner = await env.DB.prepare('SELECT nickname FROM tickets WHERE ticket_id = ?').bind(ticketId).first();
  let notified = true;
  if (requireConfigured(env)) {
    try { await sendAdmin(env, `💬 НОВЕ ПОВІДОМЛЕННЯ ${ticketId}\nВід: ${text(owner?.nickname, 24)}\n\n${message}\n\n/reply ${ticketId} Текст відповіді`); }
    catch { notified = false; }
  } else notified = false;
  await env.DB.prepare('UPDATE tickets SET updated_at = ? WHERE ticket_id = ?').bind(now, ticketId).run();
  return json({ ok: true, adminNotified: notified }, 200, origin);
}

async function getSupportMessages(request, env, origin) {
  if (!env.DB) return json({ ok: false, error: 'Підтримка ще не налаштована.' }, 503, origin);
  let body;
  try { body = await parseJson(request); } catch { return json({ ok: false, error: 'Некоректний запит.' }, 400, origin); }
  const ticketId = text(body.id, 20).toUpperCase();
  const accessKey = text(body.key, 100);
  if (!/^RZ-[A-Z0-9]{6}$/.test(ticketId) || accessKey.length < 30) return json({ ok: false, error: 'Некоректний номер або ключ звернення.' }, 400, origin);
  const ticket = await env.DB.prepare('SELECT ticket_id, nickname, category, status, created_at, updated_at FROM tickets WHERE ticket_id = ? AND access_hash = ?').bind(ticketId, await sha256(accessKey)).first();
  if (!ticket) return json({ ok: false, error: 'Заявку не знайдено або ключ доступу неправильний.' }, 404, origin);
  const result = await env.DB.prepare('SELECT actor, body, created_at FROM messages WHERE ticket_id = ? ORDER BY id DESC LIMIT 100').bind(ticketId).all();
  return json({ ok: true, ticket, messages: (result.results || []).reverse().map(item => ({ actor: item.actor, body: item.body, createdAt: item.created_at })) }, 200, origin);
}

async function createLaunch(request, env, origin) {
  if (!env.DB) return json({ ok: false, error: 'Перевірка Telegram ще не налаштована.' }, 503, origin);
  if (!requireConfigured(env)) return json({ ok: false, error: 'Telegram-бот ще не підключено адміністратором.' }, 503, origin);
  let body;
  try { body = await parseJson(request); } catch { return json({ ok: false, error: 'Некоректний запит.' }, 400, origin); }
  const game = text(body.game, 100);
  if (!game) return json({ ok: false, error: 'Не вибрано гру.' }, 400, origin);
  if (await hitRateLimit(request, env, 'launch-create', 20, 3600)) return json({ ok: false, error: 'Забагато запитів запуску. Спробуй пізніше.' }, 429, origin);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('DELETE FROM launch_sessions WHERE expires_at < ?').bind(now - 86400).run();
  const sessionId = makeId('LZ-');
  const sessionToken = randomToken(32);
  const tokenHash = await sha256(sessionToken);
  const expires = now + 300;
  await env.DB.prepare('INSERT INTO launch_sessions (session_id, token_hash, game, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(sessionId, tokenHash, game, now, expires).run();
  return json({ ok: true, sessionId, sessionToken, botUrl: `https://t.me/ryzor_bot?start=${sessionToken}`, expiresAt: expires }, 201, origin);
}

async function getLaunchStatus(request, env, origin) {
  if (!env.DB) return json({ ok: false, error: 'Перевірка Telegram не налаштована.' }, 503, origin);
  let body;
  try { body = await parseJson(request); } catch { return json({ ok: false, error: 'Некоректний запит.' }, 400, origin); }
  const sessionId = text(body.sessionId, 20).toUpperCase();
  const sessionToken = text(body.sessionToken, 100);
  if (!/^LZ-[A-Z0-9]{6}$/.test(sessionId) || sessionToken.length < 30) return json({ ok: false, error: 'Некоректний код запуску.' }, 400, origin);
  const item = await env.DB.prepare('SELECT verified_at, expires_at FROM launch_sessions WHERE session_id = ? AND token_hash = ?').bind(sessionId, await sha256(sessionToken)).first();
  if (!item) return json({ ok: false, error: 'Запит запуску не знайдено.' }, 404, origin);
  const now = Math.floor(Date.now() / 1000);
  if (Number(item.expires_at) < now) return json({ ok: false, error: 'Час підтвердження минув. Спробуй ще раз.' }, 410, origin);
  return json({ ok: true, verified: Boolean(item.verified_at) }, 200, origin);
}

async function handleTelegramWebhook(request, env) {
  if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) return new Response('Forbidden', { status: 403 });
  if (!env.DB || !botToken(env)) return new Response('Not configured', { status: 503 });
  let update;
  try { update = await request.json(); } catch { return new Response('Bad Request', { status: 400 }); }
  const message = update.message;
  if (!message?.from?.id || typeof message.text !== 'string') return new Response('OK');
  if (message.chat?.type !== 'private') return new Response('OK');
  if (Number.isInteger(update.update_id)) {
    const marker = await env.DB.prepare('INSERT OR IGNORE INTO processed_updates (update_id, processed_at) VALUES (?, ?)').bind(update.update_id, Math.floor(Date.now() / 1000)).run();
    if (marker.meta?.changes === 0) return new Response('OK');
    await env.DB.prepare('DELETE FROM processed_updates WHERE processed_at < ?').bind(Math.floor(Date.now() / 1000) - 604800).run();
  }
  const telegramUserId = String(message.from.id);
  const chatId = String(message.chat?.id || message.from.id);
  const content = message.text.trim();

  const startMatch = content.match(/^\/start(?:\s+([A-Za-z0-9_-]{30,64}))?/);
  if (startMatch) {
    const token = startMatch[1];
    if (token) {
      const now = Math.floor(Date.now() / 1000);
      const tokenHash = await sha256(token);
      const session = await env.DB.prepare('SELECT session_id, game FROM launch_sessions WHERE token_hash = ? AND expires_at >= ?').bind(tokenHash, now).first();
      if (session) {
        const claimed = await env.DB.prepare('UPDATE launch_sessions SET verified_at = ?, telegram_user_id = ? WHERE session_id = ? AND verified_at IS NULL').bind(now, telegramUserId, session.session_id).run();
        if (Number(claimed.meta?.changes || 0) > 0) {
          await telegram(env, 'sendMessage', { chat_id: chatId, text: `✅ Telegram підтверджено для Ryzor.\nГра: ${text(session.game, 100)}\n\nПовернись на сайт. Хмарні сервери ще готуються, тому це поки що лише перевірка підключення.` });
        } else {
          await telegram(env, 'sendMessage', { chat_id: chatId, text: 'Це посилання вже використано. Повернись на сайт і створи новий запит, якщо потрібно підтвердити інший запуск.' });
        }
      } else {
        await telegram(env, 'sendMessage', { chat_id: chatId, text: 'Посилання вже недійсне. Повернись на сайт Ryzor, створи новий запит і натисни Start за новим посиланням.' });
      }
    } else {
      await telegram(env, 'sendMessage', { chat_id: chatId, text: 'Вітаю в Ryzor! Щоб підтвердити запуск гри, відкрий каталог на сайті, натисни «Відкрити гру» та перейди за персональним посиланням сюди.' });
    }
    return new Response('OK');
  }

  // Admin commands are accepted only in the admin's private chat, never in groups.
  const isAdmin = adminTelegramId(env)
    && telegramUserId === String(adminTelegramId(env))
    && message.chat?.type === 'private'
    && chatId === String(adminTelegramId(env));
  if (!isAdmin) {
    await telegram(env, 'sendMessage', { chat_id: chatId, text: 'Цей бот приймає підтвердження Ryzor. Команди адміністратора недоступні.' });
    return new Response('OK');
  }
  const replyMatch = content.match(/^\/reply(?:@\w+)?\s+(RZ-[A-Z0-9]{6})\s+([\s\S]{1,2000})$/i);
  if (replyMatch) {
    const ticketId = replyMatch[1].toUpperCase();
    const reply = text(replyMatch[2], 2000);
    const ticket = await env.DB.prepare('SELECT ticket_id, status FROM tickets WHERE ticket_id = ?').bind(ticketId).first();
    if (!ticket) await telegram(env, 'sendMessage', { chat_id: chatId, text: `Заявку ${ticketId} не знайдено.` });
    else if (ticket.status === 'closed') await telegram(env, 'sendMessage', { chat_id: chatId, text: `Заявка ${ticketId} закрита. Спочатку відкрий її командою /open ${ticketId}.` });
    else {
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare('INSERT INTO messages (ticket_id, actor, body, created_at) VALUES (?, \'admin\', ?, ?)').bind(ticketId, reply, now).run();
      await env.DB.prepare('UPDATE tickets SET updated_at = ? WHERE ticket_id = ?').bind(now, ticketId).run();
      await telegram(env, 'sendMessage', { chat_id: chatId, text: `✅ Відповідь додано до ${ticketId}. Користувач побачить її в розділі «Підтримка» на сайті.` });
    }
    return new Response('OK');
  }
  const closeMatch = content.match(/^\/close(?:@\w+)?\s+(RZ-[A-Z0-9]{6})$/i);
  if (closeMatch) {
    const id = closeMatch[1].toUpperCase();
    const result = await env.DB.prepare("UPDATE tickets SET status = 'closed', updated_at = ? WHERE ticket_id = ?").bind(Math.floor(Date.now() / 1000), id).run();
    await telegram(env, 'sendMessage', { chat_id: chatId, text: result.meta?.changes ? `Заявку ${id} закрито.` : `Заявку ${id} не знайдено.` });
    return new Response('OK');
  }
  const openMatch = content.match(/^\/open(?:@\w+)?\s+(RZ-[A-Z0-9]{6})$/i);
  if (openMatch) {
    const id = openMatch[1].toUpperCase();
    const result = await env.DB.prepare("UPDATE tickets SET status = 'open', updated_at = ? WHERE ticket_id = ?").bind(Math.floor(Date.now() / 1000), id).run();
    await telegram(env, 'sendMessage', { chat_id: chatId, text: result.meta?.changes ? `Заявку ${id} знову відкрито.` : `Заявку ${id} не знайдено.` });
    return new Response('OK');
  }
  await telegram(env, 'sendMessage', { chat_id: chatId, text: 'Команди:\n/reply RZ-XXXXXX Текст відповіді\n/close RZ-XXXXXX\n/open RZ-XXXXXX' });
  return new Response('OK');
}

async function submitPayment(request, env, origin) {
  if (!requireConfigured(env)) return json({ ok: false, error: 'Telegram-бот не налаштовано адміністратором.' }, 503, origin);
  if (await hitRateLimit(request, env, 'payment-proof', 5, 3600)) return json({ ok: false, error: 'Забагато спроб надсилання за годину. Спробуй пізніше.' }, 429, origin);
  if (!request.headers.get('content-type')?.toLowerCase().includes('multipart/form-data')) return json({ ok: false, error: 'Очікується форма з файлом.' }, 415, origin);
  const size = Number(request.headers.get('content-length') || 0);
  if (size > MAX_UPLOAD_BYTES + 120000) return json({ ok: false, error: 'Файл перевищує 20 МБ.' }, 413, origin);
  let form;
  try { form = await request.formData(); } catch { return json({ ok: false, error: 'Форма пошкоджена.' }, 400, origin); }
  if (text(form.get('website'), 100)) return json({ ok: true }, 200, origin);
  const orderId = text(form.get('orderId'), 24).toUpperCase();
  const nickname = text(form.get('nickname'), 24);
  const email = text(form.get('email'), 120);
  const telegramName = text(form.get('telegram'), 40);
  const plan = text(form.get('plan'), 40);
  const price = text(form.get('price'), 24);
  const createdAt = text(form.get('createdAt'), 40);
  const comment = text(form.get('comment'), 400);
  const prices = { 'Професійний': '199 UAH', 'Безлімітний': '399 UAH', 'Безкоштовний': '0 UAH' };
  if (!/^RZ-[A-Z0-9]{6,12}$/.test(orderId) || nickname.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || prices[plan] !== price) return json({ ok: false, error: 'Перевір дані заявки або тариф.' }, 400, origin);
  const file = form.get('attachment');
  const free = plan === 'Безкоштовний';
  if (!free && (!(file instanceof File) || file.size < 1)) return json({ ok: false, error: 'Додай файл підтвердження.' }, 400, origin);
  const allowedExtension = file instanceof File && /\.(jpe?g|png|webp|mp4|webm|mov|pdf|txt)$/i.test(file.name);
  if (file instanceof File && (file.size > MAX_UPLOAD_BYTES || (!ALLOWED_MIME.has(file.type) && !allowedExtension))) return json({ ok: false, error: 'Файл завеликий або має непідтримуваний формат.' }, 415, origin);
  const details = [
    'RYZOR — ЗАЯВКА НА ПІДПИСКУ', `Номер: ${orderId}`, `Нікнейм: ${nickname}`, `Email: ${email}`,
    `Telegram: ${telegramName || 'Не вказано'}`, `Тариф: ${plan}`, `Сума: ${price}`, `Створено: ${createdAt || 'Не вказано'}`,
    file instanceof File ? `Файл: ${text(file.name, 90)} (${(file.size / 1048576).toFixed(2)} MB)` : 'Безкоштовний тариф — без переказу',
    `Коментар: ${comment || 'Немає'}`
  ].join('\n');
  try {
    if (file instanceof File) {
      const method = file.type.startsWith('image/') && file.size <= 10 * 1048576 ? 'sendPhoto' : file.type.startsWith('video/') ? 'sendVideo' : 'sendDocument';
      const field = method === 'sendPhoto' ? 'photo' : method === 'sendVideo' ? 'video' : 'document';
      const telegramForm = new FormData();
      telegramForm.set('chat_id', String(adminTelegramId(env)));
      telegramForm.set('caption', details.slice(0, 1000));
      telegramForm.set(field, file, text(file.name, 90) || 'ryzor-proof');
      await telegram(env, method, telegramForm);
    } else {
      await sendAdmin(env, details);
    }
  } catch {
    return json({ ok: false, error: 'Telegram не прийняв заявку. Дані не підтверджено — спробуй пізніше.' }, 502, origin);
  }
  return json({ ok: true, orderId }, 200, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/telegram/webhook' && request.method === 'POST') return handleTelegramWebhook(request, env);
    const origin = getOrigin(request, env);
    if (request.method === 'OPTIONS') {
      if (!origin) return new Response('Origin not allowed', { status: 403 });
      return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400', 'Vary': 'Origin'
      }});
    }
    if (!origin) return json({ ok: false, error: 'Origin not allowed' }, 403);
    if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, service: 'ryzor-api' }, 200, origin);
    if (request.method === 'POST' && url.pathname === '/api/auth/google/verify') return verifyGoogleForRegistration(request, env, origin);
    if (request.method === 'POST' && url.pathname === '/api/auth/register') return registerAccount(request, env, origin);
    if (request.method === 'POST' && url.pathname === '/api/auth/salt') return getLoginSalt(request, env, origin);
    if (request.method === 'POST' && url.pathname === '/api/auth/login') return loginAccount(request, env, origin);
    if (request.method === 'POST' && url.pathname === '/api/auth/me') return getCurrentAccount(request, env, origin);
    if (request.method === 'POST' && url.pathname === '/api/auth/logout') return logoutAccount(request, env, origin);
    if (request.method === 'POST' && url.pathname === '/payment') return submitPayment(request, env, origin);
    if (request.method === 'POST' && url.pathname === '/api/support/create') return createSupportTicket(request, env, origin);
    if (request.method === 'POST' && url.pathname === '/api/support/message') return addSupportMessage(request, env, origin);
    if (request.method === 'POST' && url.pathname === '/api/support/messages') return getSupportMessages(request, env, origin);
    if (request.method === 'POST' && url.pathname === '/api/launch/create') return createLaunch(request, env, origin);
    if (request.method === 'POST' && url.pathname === '/api/launch/status') return getLaunchStatus(request, env, origin);
    return json({ ok: false, error: 'Not found' }, 404, origin);
  }
};
