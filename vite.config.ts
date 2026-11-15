import { defineConfig } from 'vite';

export default defineConfig({
  // Относительные пути — требование хостинга Яндекс Игр (абсолютные запрещены)
  base: './',
  build: {
    target: 'es2017',
    // Ничего не инлайним в HTML/JS — предсказуемая загрузка и отладка веса
    assetsInlineLimit: 0,
  },
});
