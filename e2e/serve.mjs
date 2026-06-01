// Static server for the exported web app (dist/), used by the Playwright E2E
// suite. Sets COOP/COEP so the page is cross-origin isolated — expo-sqlite's web
// build (wa-sqlite) needs that for SharedArrayBuffer/OPFS. SPA fallback routes
// unknown paths to index.html (Expo Router web is output: "single").
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const DIST = path.resolve('dist');
const PORT = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = path.normalize(path.join(DIST, urlPath));
  if (!filePath.startsWith(DIST)) filePath = path.join(DIST, 'index.html'); // no traversal
  if (urlPath.endsWith('/')) filePath = path.join(filePath, 'index.html');
  if (!existsSync(filePath) || !path.extname(filePath)) filePath = path.join(DIST, 'index.html'); // SPA fallback

  try {
    const data = await readFile(filePath);
    res.setHeader('Content-Type', MIME[path.extname(filePath)] || 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
});

server.listen(PORT, () => console.log(`[e2e] serving dist/ on http://localhost:${PORT}`));
