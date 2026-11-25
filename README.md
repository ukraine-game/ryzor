# Ryzor — інструкція перед публікацією

Це статичний сайт для GitHub Pages із окремим serverless API на Cloudflare Workers та базою Cloudflare D1. GitHub Pages публікує лише HTML/CSS/JS і зображення; каталог `cloudflare-worker/` потрібно розгорнути окремо.

## Поточний стан

- Сторінки: головна, акаунт, оплата, політика конфіденційності.
- Реєстрація: Google Identity Services → повне ім'я → пароль і повтор пароля.
- Вхід: email + пароль. Пароль не передається як звичайний текст: браузер обчислює PBKDF2 proof.
- Підтримка: двосторонній чат із персональним ключем доступу; адміністратор відповідає командою `/reply RZ-XXXXXX текст`.
- Telegram: перевірка `/start` для запиту запуску; це підтвердження Telegram, а не запуск віддаленої гри.
- Дані акаунта можна експортувати; акаунт і окрему заявку можна видалити з інтерфейсу.
- Усі платні замовлення вимкнені до фактичного запуску ігрової інфраструктури та перевірки платіжної моделі.
- **Хмарного відеостримінгу та GPU-серверів у цьому репозиторії немає.** Не рекламуйте сайт як уже працюючий cloud gaming і не приймайте оплату за недоступну послугу.

## 1. Підготувати репозиторій GitHub

1. Розпакуйте архів і скопіюйте **вміст цієї папки** в корінь репозиторію, а не саму папку `chat-gpt` як вкладений каталог.
2. Збережіть приховані файли та папки: `.github/workflows/deploy-pages.yml` і `.nojekyll`.
3. Основна гілка у workflow зараз `main`. Якщо використовуєте іншу назву — змініть її у файлі workflow.
4. У GitHub → **Settings → Secrets and variables → Actions → New repository secret** додайте `google_client_id` зі значенням Google OAuth Client ID. Це публічний Client ID, не секрет доступу; workflow лише використовує secret-запис, щоб підставити його в зібраний `config.js`.
5. У GitHub → **Settings → Pages** оберіть **GitHub Actions** як Source. Після push до `main` сайт буде зібрано та опубліковано.

Workflow виключає `cloudflare-worker/`, Markdown-документацію, `.github/` та `dist/` з опублікованих статичних файлів. Код Worker залишається у репозиторії для окремого розгортання, але не віддається відвідувачам GitHub Pages.

## 2. Заповнити публічний конфіг сайту

У `config.js` задайте:

- `apiBase` — адресу розгорнутого Worker, наприклад `https://ryzor-api.<твій-піддомен>.workers.dev`;
- `googleClientId` — workflow підставить із `google_client_id` під час деплою, тож вручну дублювати його не потрібно;
- `paymentsEnabled` залиште `false`;
- реквізити в `payment` не заповнюйте, поки платежі офіційно не відкриті.

У `cloudflare-worker/wrangler.toml` замініть:

- `database_id` на ID створеної D1 бази;
- `ALLOWED_ORIGINS` на точний origin GitHub Pages, наприклад `https://<username>.github.io`. **Без** шляху репозиторію та без кінцевого `/`;
- `PRIVACY_URL` на повну адресу політики, включно зі шляхом репозиторію, якщо сайт розміщено як project page: `https://<username>.github.io/<repo>/privacy.html`.

## 3. Створити Cloudflare D1 та розгорнути Worker

Потрібен Cloudflare account із Workers та D1. Команди виконуйте з локального термінала, у каталозі `cloudflare-worker/`, де лежить `wrangler.toml`:

```bash
npx wrangler login
npx wrangler d1 create ryzor-db
```

Скопіюйте виданий `database_id` у `wrangler.toml`, потім створіть таблиці:

```bash
npx wrangler d1 execute ryzor-db --remote --file=./schema.sql
```

Розгорніть API:

```bash
npx wrangler deploy
```

Після розгортання перевірте `https://<worker-host>/health`. Endpoint не повертає секретів; він показує доступність бази та факт налаштування Telegram/Google/стримінгу.

## 4. Додати змінні та секрети Worker

У Cloudflare → Workers & Pages → `ryzor-api` → Settings → Variables and Secrets задайте:

**Secrets (не публікувати, не додавати в `config.js`, HTML або GitHub Pages):**

- `MY_API_KEY_TG` — токен @ryzor_bot;
- `ADMIN_TG` — числовий Telegram ID адміністратора;
- `AUTH_SALT_PEPPER` — випадковий секрет для захисту login challenge;
- `TELEGRAM_WEBHOOK_SECRET` — випадковий секрет webhook.

**Variables:**

- `GOOGLE_CLIENT_ID` — той самий Client ID, що використовується у GitHub Actions;
- `ALLOWED_ORIGINS` — той самий origin GitHub Pages;
- `PRIVACY_URL` — повна публічна адреса `privacy.html`.
- `PAYMENTS_ENABLED` = `false`;
- `CLOUD_STREAMING_READY` = `false`;
- `DATA_CONTROLLER_CONFIGURED` = `false` до заповнення реальних даних володільця в `privacy.html`; лише після перевірки відповідальним оператором можна змінити на `true`.

Альтернатива — команда `npx wrangler secret put NAME` у каталозі Worker. Вона попросить значення без запису його у файли проєкту. **Не надсилайте Telegram-токен у чат, не комітьте `.env` та не зберігайте його в конфігурації фронтенду.**

## 5. Налаштувати Google OAuth

У Google Cloud Console:

1. Налаштуйте OAuth consent screen та створіть OAuth Client ID типу **Web application**.
2. У **Authorized JavaScript origins** додайте точний origin GitHub Pages, наприклад `https://<username>.github.io`.
3. Не додавайте шлях `/repo/` у поле origin. Для цієї інтеграції використовується Google Identity Services у браузері, окремий callback URL не потрібен.
4. Додайте той самий Client ID в GitHub Actions secret `google_client_id` і Worker variable `GOOGLE_CLIENT_ID`.

Google ID token перевіряється Worker за підписом Google, аудиторією, видавцем і строком дії. Не вимикайте цю перевірку та не довіряйте профілю, отриманому лише з браузера.

## 6. Налаштувати Telegram webhook

Після розгортання Worker встановіть webhook для URL:

`https://<worker-host>/telegram/webhook`

Використайте Telegram Bot API `setWebhook` і передайте `TELEGRAM_WEBHOOK_SECRET` як `secret_token`. Виконуйте це в захищеному середовищі, не публікуйте URL із токеном бота та не додавайте його в репозиторій. У Cloudflare змінна `TELEGRAM_WEBHOOK_SECRET` має дослівно збігатися зі значенням, заданим під час `setWebhook`.

Адміністратор має відкрити приватний чат із @ryzor_bot і натиснути `/start`. Команди:

```text
/reply RZ-XXXXXX Текст відповіді
/close RZ-XXXXXX
/open RZ-XXXXXX
/approve RZ-XXXXXX
/reject RZ-XXXXXX причина
/privacy
```

`/approve` активує підписку лише для замовлення, яке має статус `pending_review`. Платне замовлення не буде активоване, доки серверні прапорці оплати та стримінгу залишаються `false`.

## 7. Політика конфіденційності — обов'язково перед публікацією

Відкрийте `privacy.html` і замініть усі квадратні дужки на фактичні реквізити **реального володільця персональних даних**:

- повне ім'я відповідальної фізичної особи/ФОП або повну назву юридичної особи;
- робочу адресу електронної пошти для запитів щодо персональних даних;
- адресу для офіційної кореспонденції;
- контакт для звернень про реалізацію прав користувача.

Бренд `Ryzor` сам по собі не визначає, хто юридично є володільцем даних. Не публікуйте сторінку з незаповненими полями й не вмикайте збір даних до того, як відповідальна особа перевірить документ. Політика підготовлена за поточним кодом і не замінює юридичну перевірку фактичного оператора.

## 8. Передпублікаційний чекліст

- [ ] Вказані реальні дані володільця у `privacy.html`, контакт перевірено.
- [ ] `DATA_CONTROLLER_CONFIGURED` в Worker змінено на `true` лише після фактичного заповнення й перевірки політики.
- [ ] Google OAuth origin відповідає домену GitHub Pages.
- [ ] D1 schema застосована до **remote** бази.
- [ ] У Worker налаштовані всі Secrets/Variables.
- [ ] `config.js` містить правильний `apiBase`.
- [ ] `ALLOWED_ORIGINS` і `PRIVACY_URL` відповідають фактичній адресі Pages.
- [ ] `/health` повертає `database: true`, `telegramConfigured: true`, `googleConfigured: true`.
- [ ] Перевірені тестова реєстрація, вхід, підтримка, Telegram webhook, експорт і видалення тестового акаунта.
- [ ] Платежі залишаються вимкненими до готовності реального сервісу, правомірного отримувача коштів і процедури повернення.
- [ ] Не заявляється про доступний хмарний запуск, доки не підключені й не протестовані GPU-сервери та відеостримінг.

## Важливо про оплату та хмарний запуск

У цьому репозиторії немає серверів із GPU, системи видачі ігрових сесій чи відеостримінгу. Перевірка `/start` лише підтверджує, що відвідувач взаємодіяв із Telegram-ботом. Вона не запускає гру. Тому `paymentsEnabled`, `PAYMENTS_ENABLED` і `CLOUD_STREAMING_READY` залишаються вимкненими. Не приймайте оплату за функцію, якої ще немає. Будь-який майбутній платний запуск має налаштовувати фактичний дорослий/юридичний оператор із належними платіжними реквізитами, умовами підписки й підтримкою повернень.
