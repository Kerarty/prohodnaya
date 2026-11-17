/**
 * Приёмник промо-ассетов: POST /save?name=<файл> → docs/promo/<файл>.
 * Запуск: `npm run promo:save` (порт 5191). Без зависимостей.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'promo');
fs.mkdirSync(ROOT, { recursive: true });
const PORT = 5191;

http
  .createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    if (req.method === 'GET' && url.pathname === '/ping') {
      res.writeHead(200).end('ok');
      return;
    }

    if (req.method === 'POST' && url.pathname === '/save') {
      const name = url.searchParams.get('name') ?? '';
      if (!/^[A-Za-z0-9._-]{1,120}$/.test(name)) {
        res.writeHead(400).end('bad name');
        return;
      }
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const buf = Buffer.concat(chunks);
        fs.writeFileSync(path.join(ROOT, name), buf);
        console.log(`[promo-save] ${name} — ${Math.round(buf.length / 1024)} КБ`);
        res.writeHead(200).end(`saved ${name}`);
      });
      return;
    }

    res.writeHead(404).end('not found');
  })
  .listen(PORT, () => console.log(`[promo-save] слушаю :${PORT} → ${ROOT}`));
