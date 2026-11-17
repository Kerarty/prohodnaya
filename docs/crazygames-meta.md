# Мета-пак подачи «Checkpoint» на CrazyGames

Тексты для полей Developer Portal (developer.crazygames.com). Основной язык площадки —
английский: в форму вставляются EN-блоки, RU — справочные (в портале можно задать
локализованные названия, если поле появится).

## Название

- **Primary (EN):** `Checkpoint`
- Локализованные (если поддерживаются): `Проходная` (ru), `El Control` (es),
  `Le Contrôle` (fr), `Kontrolle` (de), `Il Controllo` (it), `O Controle` (pt)

## Категория и теги

- **Category:** Puzzle (альтернатива: Casual)
- **Tags:** `casual`, `puzzle`, `logic`, `arcade`, `single-player`, `portrait`, `mobile-friendly`

## Короткое описание (Short description, EN)

```
You run the checkpoint. Match each guest against the day's rules and decide: approve or turn away. Shape-colored guests, tricky passes, one chance per mistake — how long can you keep the line moving?
```

## Полное описание (Description, EN)

```
Welcome to Checkpoint — the cutest border post in the shape kingdom!

You are the inspector on duty. Every guest walks up with a pass; compare it with today's rulebook and make the call:

✓ APPROVE — if the head, body, eyes and accessory all match the rules
✗ TURN AWAY — if something doesn't fit… or the pass is expired, or unsigned

Each shift brings 10 guests and 3 mistakes end it. Rules change every day, so no two shifts feel the same. Spot the details fast, keep the line moving, and climb the ranks!

HIGHLIGHTS
• Simple one-tap decisions — play with one hand, portrait-friendly
• Fresh rulebook every day: colors, shapes, eyes and accessories rotate
• Use the magnifier to highlight a trait, extend expired passes, double your rating or forgive a mistake
• Duel a friend in real time and compare daily/leaderboard rankings
• Playful geometric art — every guest is a unique combination

The checkpoint is open. Best shift?
```

## Управление (Controls, EN)

```
Mouse or touch. Tap APPROVE (green) to let the guest through, TURN AWAY (red) to reject. Tap a rule on the board to memorize it; tap a pass field to check a trait with the magnifier. Keyboard: ← / → also decide.
```

## Настройки монетизации

- **Ads:** только SDK-реклама CrazyGames (rewarded: детектор, продление пропуска, ×2 рейтинга,
  прощение ошибки; midgame — на выходе с экранов результатов). Своих сетей нет.
- **Progress Save (Data Module):** включить при сабмите — иначе сейвы гостей пойдут
  только в localStorage-фолбэк.
- **Embed:** Responsive + Portrait (фон тянется на любые экраны).

## Ассеты (готовые, docs/promo/)

| Файл | Требование CG | Размер |
|---|---|---|
| `cover-landscape.png` | обложка 16:9 | 1920×1080, 145 КБ |
| `cover-portrait.png` | обложка 2:3 | 800×1200, 95 КБ |
| `cover-square.png` | обложка 1:1 | 800×800, 79 КБ |
| `video-landscape.mp4` | превью 1080p 16:9 | 1920×1080, ~19 с, 6.2 МБ |
| `video-portrait.mp4` | превью 1080p 2:3 | 1080×1620, ~19 с, 6.6 МБ |

Все обложки отрисованы кодом в стиле игры (Balsamiq Sans, тот же арт-язык), единая
композиция на трёх форматах, только название игры. Видео — авторский таймлайн
геймплея: штампы ✓/✗, гости проходят/разворачиваются, без звука, первый кадр = обложка.

Перегенерация: `npm run promo` + `npm run promo:save`, затем
`http://localhost:5190/promo.html?mode=<cover-landscape|cover-portrait|cover-square|video-landscape|video-portrait>`
(браузерная вкладка должна быть активной — таймлайн видео идёт в реальном времени).
