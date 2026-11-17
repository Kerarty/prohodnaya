# Подача «Проходной» на CrazyGames

Одна и та же сборка (`npm run dist` → `prohodnaya-yandex.zip`) подходит и Яндексе,
и CrazyGames — платформа выбирается в рантайме (см. `src/platform/index.ts`).

## Что уже сделано в коде (интеграция SDK v3)

| Требование CrazyGames | Реализация |
|---|---|
| `SDK.init()` до старта игры | `CrazyPlatform.init()` — до шрифтов и создания Phaser |
| `game.loadingStart()` при начале загрузки | сразу после `SDK.init()` (дальше грузятся шрифты/сессия) |
| `game.loadingStop()` при готовности игры | `ready()` → `game.loadingStop()` (фолбэк на легаси `loadingComplete`) |
| `gameplayStart()` / `gameplayStop()` | те же точки, что для Яндекса: вход заявки/старт забега — панели результатов/прерывание/меню |
| `happytime()` на достижениях, РЕДКО | новый личный рекорд блица, победа в дуэли, новое звание (по одному, не за каждую смену) |
| Rewarded через `ad.requestAd('rewarded')` | награда ТОЛЬКО в `adFinished`; звук глушится в `adStarted` (не на запросе — требование CG), возврат в `finally` |
| Midgame через `ad.requestAd('midgame')` | только на выходе с экранов результатов (та же политика, что interstitial Яндекса); unfilled/adCooldown не блокируют |
| Ad break: игра на паузе, UI заблокирован | оверлей + спиннер на всё время запроса/показа (rewarded и midgame), кнопки сцены недоступны до `adFinished`/`adError` |
| Adblock/unfilled: кнопки не «пустышки» | при `adError` — тост «Реклама недоступна» на всех rewarded-точках (детектор, ×2, прощение), игра продолжается |
| Data Module (прогресс) | `SDK.data.setItem/getItem` + localStorage-фолбэк `prohodnaya.cloud` |
| Язык игрока | `SDK.user.systemInfo.locale` (v3: environment — строка-режим!) → i18n на 7 локалей |
| Username в игре | `user.getUser()` при init → ник CG становится именем игрока (дуэли/топ-50), guests — сгенерированное имя |
| Room Data (Join/Invite) | хост комнаты: `updateRoom({roomId, isJoinable:true, inviteParams:{duel:код}})`; матч начался/отмена — `leftRoom()` (invite button в SDK deprecated) |
| Зацикленность на их домене | SDK подгружается динамически только на `*.crazygames.com` в production (или `?platform=crazy`) |
| До геймплея ≤ 20 с | билд ~1.4 МБ, boot < 2 с даже на слабых устройствах |
| Только относительные пути | vite `base: './'` ✓ |
| Кнопка звука | Настройки → Звук вкл/выкл ✓ |
| `user-select: none` (мобильные) | в index.html с вендорными префиксами ✓ |
| Внешние ссылки/кросс-промо | нет ✓; свой fullscreen-кнопки нет ✓ (Escape/фуллскрин — на платформе) |

## Локальная проверка (без подачи)

```bash
npm run dev          # затем открыть http://localhost:5173|5180/?platform=crazy
```

На localhost SDK v3 сам включает local-режим: демо-реклама (оверлей с текстом
вместо видео), консольный лог вызовов, демо-пользователь. Параметр
`?useLocalSdk=true` форсирует этот режим на любом домене.

Консоль должна показать: `[platform] активна: Crazy`, `SDK окружение: <locale>`.

## Шаги подачи в Developer Portal (developer.crazygames.com)

1. **Upload build**: zip из `npm run dist` (архив уже правильно уложен: `index.html` в корне).
   Тип: HTML5 game.
2. **Data Module**: при сабмите включить Progress Save (иначе SDK вернёт
   `dataModuleDisabled` и сейвы гостей пойдут только в localStorage).
3. **Embed settings**: Responsive + Portrait (адаптация под все экраны сделана
   коммитом 30c01b1 — колонка 720×1280 по центру, фон тянется).
4. **QA Tool**: портал прогоняет чек-лист SDK (loading/gameplay/ads/data) —
   все вызовы уже на местах; проверять зелёные статусы по каждой фазе.
5. **Мета**: описание, теги, скриншоты (можно снять через `?canvas=1` риг),
   иконка/обложка НЕ из скриншотов (рендер кодом — как для Яндекса, Фаза B).
6. Категория: Puzzle/Casual; монетизация: только реклама SDK (своих сетей нет).

## Что НЕ трогать

- Не добавлять рекламные SDK, внешние ссылки, редиректы — мгновенный отказ QA.
- Не звать `happytime()` чаще (за смену/покупку — спам, требование «sparingly»).
- Не выключать локальный фолбэк сейвов: гости CrazyGames хранят прогресс
  в localStorage, залогиненные — в облаке Data Module.
