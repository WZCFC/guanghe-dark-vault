import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
};
const assets = {};
for (const file of (await readdir('dist', { recursive: true })).sort()) {
  const path = file.replaceAll('\\', '/');
  if (path.startsWith('server/') || !mime[extname(path)]) continue;
  const bytes = await readFile('dist/' + path);
  const etag = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
  assets['/' + path] = [mime[extname(path)], etag, bytes.toString('base64')];
}
const game = await readFile('dist/game.js', 'utf8');
const rooms = await readFile('worker/rooms.mjs', 'utf8');
const discussions = await readFile('worker/discussions.mjs', 'utf8');
const accounts = await readFile('worker/accounts.mjs', 'utf8');
const worker = await readFile('worker/index.mjs', 'utf8');
await mkdir('dist/server', { recursive: true });
await writeFile('dist/server/index.js', [
  'const siteAssets = ' + JSON.stringify(assets) + ';',
  game,
  rooms,
  discussions,
  accounts,
  worker,
].join('\n'));
