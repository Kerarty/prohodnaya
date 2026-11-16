import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Бандл-сервер — чистый Node-скрипт вне tsc-проекта
    files: ['server/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
);
