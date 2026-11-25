# RYZOR — сайт і serverless API

Це статичний сайт для GitHub Pages та окремий Cloudflare Worker з D1. У репозиторії немає токена Telegram, ID адміністратора, паролів чи інших приватних секретів.

## Що є у проєкті

- Головна сторінка в дизайні з наданого `chat-gpt.zip`: світла графітово-біла основа, червоні акценти, округлі картки, мобільна навігація.
- Каталог із пошуком і фільтрами. Trackmania винесена в рекомендацію та головний банер. Натискання на гру відкриває внутрішнє вікно, а не Steam.
- Одноразове підтвердження Telegram через `@ryzor_bot` і команду `/start`. Код прив’язаний до одного запуску та має строк дії 5 хвилин.
- Три тарифи, сторінка оформлення, 10-хвилинний дедлайн на підтвердження платного замовлення, завантаження вкладення до 20 МБ.
- Реєстрація: спочатку Google Identity, потім повне ім’я, пароль і повтор пароля. Вхід — пошта та пароль.
- Особистий профіль зі статусом підписки. Підписка активується після `/approve RZ-XXXXXX` від адміністратора.
- Двостороння підтримка: повідомлення з сайту надходить адміністратору в Telegram, `/reply RZ-XXXXXX текст` показує відповідь у веб-чаті.
- FAQ, статус API та окремий чесний статус ігрової інфраструктури.
- Автопідказки назв ігор у формі підтримки. Пошук працює з локальним безпечним списком назв та Steam-картинок; текст звернення не передається зовнішньому пошуковому проксі.

> **Важливо:** сам сайт ще не є хмарною ігровою інфраструктурою. Підтвердження Telegram — це перевірка Telegram-акаунта, а не запуск гри. Для реального стримінгу потрібні окремі GPU-машини, серверний оркестратор, передавання відео/аудіо та канал введення з низькою затримкою. Не рекламувати тарифи як уже доступний стримінг, поки ця частина не побудована.

## 1. Публікація на GitHub Pages

1. Розпакуй ZIP і завантаж **вміст папки `ryzor-final` у корінь репозиторію**. Файл `index.html` має бути в корені репозиторію, а не всередині додаткової вкладеної папки.
2. Переконайся, що основна гілка називається `main` (або зміни назву гілки в `.github/workflows/deploy-pages.yml`).
3. У GitHub → **Settings → Pages → Build and deployment → Source** вибери **GitHub Actions**.
4. У GitHub → **Settings → Secrets and variables → Actions → Secrets** створи `google_client_id`. Це значення використовується workflow для підстановки публічного Google OAuth Client ID у `config.js`.
5. Push у `main` запускає workflow і публікує сторінку.

`google_client_id` — публічний OAuth Client ID, а не секрет доступу до бота. У налаштуваннях Google Cloud Console додай точний origin GitHub Pages у **Authorized JavaScript origins** (наприклад, `https://USERNAME.github.io`) та обмеж правильним доменом.

## 2. Cloudflare D1 та Worker

Потрібні Cloudflare акаунт і `wrangler` CLI. У терміналі:

```bash
cd cloudflare-worker
npx wrangler login
npx wrangler d1 create ryzor-db
```

Скопіюй `database_id` з відповіді `wrangler d1 create` у `cloudflare-worker/wrangler.toml` замість `REPLACE_WITH_D1_DATABASE_ID`.

Створи таблиці (для нової бази):

```bash
npx wrangler d1 execute ryzor-db --remote --file=schema.sql
```

Опублікуй Worker:

```bash
npx wrangler deploy
```

У `wrangler.toml` заміни `ALLOWED_ORIGINS` на свій точний origin GitHub Pages. Якщо використовуєш власний домен, додай його через кому. Не вказуй шлях сторінки — тільки origin, наприклад `https://USERNAME.github.io`.

Після deploy адреса буде приблизно такою: `https://ryzor-api.SUBDOMAIN.workers.dev`. Встав її в `apiBase` у `config.js` перед публікацією. Якщо `config.js` потрапляє в репозиторій, ця адреса не є секретом.

## 3. Worker Secrets та змінні

**GitHub Secrets не копіюються автоматично в Cloudflare.** Додай секрети окремо в Cloudflare Dashboard → Workers & Pages → `ryzor-api` → Settings → Variables and Secrets або через `wrangler secret put`.

Потрібні секрети:

```bash
npx wrangler secret put MY_API_KEY_TG
npx wrangler secret put ADMIN_TG
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put AUTH_SALT_PEPPER
```

Під час кожної команди CLI попросить ввести значення безпосередньо в терміналі. Не вставляй токен у код, чат, README, GitHub commit або `config.js`.

Додай звичайні Worker variables:

- `GOOGLE_CLIENT_ID` — той самий Google Web Client ID, який задано в GitHub Secret `google_client_id`.
- `ALLOWED_ORIGINS` — точний origin GitHub Pages та/або власного домену.

`ADMIN_TG` — це числовий Telegram ID адміністратора. Команди адміністратора приймаються лише в приватному чаті з цим ID.

`AUTH_SALT_PEPPER` — згенеруй окремий випадковий секрет (не використовуй пароль від Google чи Telegram). Не змінюй його після запуску реєстрацій, інакше буде порушено однаковість фіктивної солі для невідомих email під час входу.

## 4. Telegram webhook

Спочатку переконайся, що Worker вже розгорнутий і секрет `TELEGRAM_WEBHOOK_SECRET` створений. Потім виконай запит до Telegram Bot API, підставивши свій токен, Worker URL і webhook secret. Не зберігай ці значення в репозиторії.

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -d "url=https://ryzor-api.<YOUR_SUBDOMAIN>.workers.dev/telegram/webhook" \
  -d "secret_token=<YOUR_WEBHOOK_SECRET>"
```

Бот має бути доступний як `@ryzor_bot`. Спочатку відкрий приватний чат із ботом і натисни **Start**. Після налаштування webhook сайт зможе перевіряти `/start` з одноразовим параметром.

### Команди адміністратора

- `/reply RZ-XXXXXX Текст відповіді` — відповісти у веб-чат заявки.
- `/close RZ-XXXXXX` — закрити заявку.
- `/open RZ-XXXXXX` — знову відкрити заявку.
- `/orders` — показати останні замовлення, що очікують перевірки.
- `/approve RZ-XXXXXX` — підтвердити замовлення й активувати план в акаунті.
- `/reject RZ-XXXXXX Причина` — відхилити замовлення.

Номер заявки можна скопіювати з повідомлення, яке бот надсилає адміністратору. Команди `/approve` та `/reject` стосуються платіжних замовлень, `/reply`, `/close` та `/open` — звернень підтримки.

## 5. Налаштування Google та `config.js`

`config.js` має містити тільки публічні налаштування:

```js
window.RYZOR_CONFIG = {
  apiBase: "https://ryzor-api.YOUR-SUBDOMAIN.workers.dev",
  googleClientId: "",
  payment: {
    bank: "",
    recipient: "",
    cardNumber: "",
    iban: ""
  }
};
```

Workflow автоматично підставляє `googleClientId` з GitHub Secret `google_client_id` під час деплою. У Worker окремо задай variable `GOOGLE_CLIENT_ID`, інакше сервер не зможе перевірити Google ID token.

У Google Cloud Console створи **OAuth Client ID → Web application**, додай точні авторизовані JavaScript origins та перевір, що Client ID однаковий у двох місцях. Client ID можна показувати у браузері; приватний OAuth Client Secret для цієї реалізації не потрібен і не має додаватися у фронтенд.

## 6. Реквізити та підтвердження платежу

У `config.js` можна вказати лише перевірені публічні реквізити отримувача. Додавати їх і відкривати оплату має власник рахунку або відповідальна доросла особа. Не вставляй у сайт PIN, CVV, пароль банку чи дані картки платника.

Сума тарифу перевіряється ще раз на Worker — значення з браузера не є джерелом ціни. Платне замовлення має серверний ID і час завершення через 10 хвилин. Після прийняття файла бот надсилає його лише `ADMIN_TG`; D1 зберігає метадані, а не вміст файла. Максимальний розмір — 20 МБ.

Після надходження підтвердження адміністратор перевіряє платіж і виконує `/approve RZ-XXXXXX`. Профіль отримає активний план на 30 днів. Для безкоштовного плану також створюється замовлення, яке адміністратор може підтвердити.

## 7. Межі реалізації та безпека

- Не зберігай `MY_API_KEY_TG`, `ADMIN_TG`, `TELEGRAM_WEBHOOK_SECRET` або `AUTH_SALT_PEPPER` у будь-якому файлі, що віддається GitHub Pages.
- `google_client_id` у GitHub Actions потрібен для автоматичної підстановки публічного Client ID. Окремий `GOOGLE_CLIENT_ID` у Worker потрібен для перевірки токенів.
- Усі приватні операції Worker обмежені CORS allowlist та перевіркою Bearer session token або webhook secret.
- Пароль користувача не зберігається відкритим текстом; браузер обчислює PBKDF2 proof, а Worker зберігає хеш proof.
- Підтримка має персональний випадковий ключ доступу; він зберігається в цьому браузері. Не очищай дані сайту, поки потрібна історія заявки.
- Каталожні картинки та шрифт завантажуються зі Steam CDN та Google Fonts відповідно. Це означає, що браузер відвідувача звертається до цих зовнішніх доменів.
- До публічного приймання реальних платежів додай політику приватності, умови користування та перевір реальні банківські реквізити.
- Worker і D1 мають бути налаштовані до активації функцій реєстрації, підтримки, Telegram, оплати й підтвердження тарифу.

## Перевірки перед публікацією

1. `GET <apiBase>/health` повертає `{"ok":true,"service":"ryzor-api"}`.
2. Перевір Google sign-in на домені, який внесений до Authorized JavaScript origins.
3. Перевір створення заявки підтримки й `/reply` тестовим зверненням.
4. Перевір Telegram `/start` тестовим одноразовим посиланням.
5. Перевір створення тестового замовлення, отримання файла ботом і `/approve` лише після тестової перевірки.
6. Не оголошуй хмарні ігри доступними, доки не підключено реальну GPU/streaming інфраструктуру.
