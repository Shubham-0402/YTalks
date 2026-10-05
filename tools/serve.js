/**
 * tools/serve.js — zero-dependency static file server for the frontend.
 *
 * Usage:  node tools/serve.js [port]
 *         npm start
 *
 * Milestone 2 replaces this with the Spring Boot backend, which will serve the
 * same files from src/main/resources/static.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../frontend/', import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
};

async function resolveFile(urlPath) {
  // Strip query/hash, decode, and block path traversal outside ROOT.
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const candidate = normalize(join(ROOT, clean));
  if (!candidate.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) return null;

  try {
    const info = await stat(candidate);
    if (info.isDirectory()) {
      const indexPath = join(candidate, 'index.html');
      await stat(indexPath);
      return indexPath;
    }
    return candidate;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const filePath = await resolveFile(req.url || '/');
  if (!filePath) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`500 ${error.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`Ytalks frontend (Milestone 1 prototype) → http://localhost:${PORT}/`);
  console.log('Mock data only. No backend, no AI provider calls.');
});
