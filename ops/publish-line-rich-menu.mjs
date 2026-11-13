// Explicit operator command only. Tokens and rollback records stay outside Git.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseEnv, isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const localEnv = parseEnv(await readFile(resolve(root, '.env.line-upload-runtime'), 'utf8'));
const token = localEnv.LINE_UPLOAD_CHANNEL_ACCESS_TOKEN;
if (!token) throw new Error('Dedicated LINE upload token missing');
const menu = JSON.parse(await readFile(resolve(root, 'assets/line/rich-menu.json'), 'utf8'));
const image = await readFile(resolve(root, 'assets/line/rich-menu.png'));
if (image.length > 1_000_000 || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
  || image.readUInt32BE(16) !== menu.size.width || image.readUInt32BE(20) !== menu.size.height) {
  throw new Error('Menu image dimensions/format/size do not match');
}
async function request(path, { method = 'GET', json, imageBody } = {}) {
  const response = await fetch(`https://${imageBody ? 'api-data' : 'api'}.line.me/v2/bot/${path}`, {
    method, redirect: 'manual', signal: AbortSignal.timeout(20_000),
    headers: { authorization: `Bearer ${token}`, ...(json ? { 'content-type': 'application/json' } : {}),
      ...(imageBody ? { 'content-type': 'image/png' } : {}) },
    body: imageBody ?? (json ? JSON.stringify(json) : undefined),
  });
  if (response.status === 404 && path === 'user/all/richmenu' && method === 'GET') return null;
  if (!response.ok) { await response.body?.cancel(); throw new Error(`LINE_MENU_REQUEST_FAILED_${response.status}`); }
  return response.json();
}
const bot = await request('info');
if (bot.basicId !== '@792vlmeo') throw new Error('Wrong official account: refusing to change menu');
await request('richmenu/validate', { method: 'POST', json: menu });
const previous = await request('user/all/richmenu');
const privateDir = resolve(root, 'work/line-private');
await mkdir(privateDir, { recursive: true });
const recordPath = resolve(privateDir, `rich-menu-${Date.now()}.json`);
const record = { previousRichMenuId: previous?.richMenuId ?? null, imageSha256: createHash('sha256').update(image).digest('hex'), applied: false };
await writeFile(recordPath, JSON.stringify(record), { mode: 0o600 });
const created = await request('richmenu', { method: 'POST', json: menu });
if (!/^richmenu-[a-f0-9]{32}$/.test(created.richMenuId)) throw new Error('Invalid returned menu ID');
record.createdRichMenuId = created.richMenuId;
await writeFile(recordPath, JSON.stringify(record), { mode: 0o600 });
await request(`richmenu/${created.richMenuId}/content`, { method: 'POST', imageBody: image });
// Existing default remains intact until both object and image exist. Keep old menus for rollback.
await request(`user/all/richmenu/${created.richMenuId}`, { method: 'POST' });
const current = await request('user/all/richmenu');
if (current?.richMenuId !== created.richMenuId) throw new Error('Default menu read-back mismatch');
const stored = await request(`richmenu/${created.richMenuId}`);
if (!isDeepStrictEqual(stored.areas, menu.areas)) throw new Error('Menu actions read-back mismatch');
record.applied = true;
await writeFile(recordPath, JSON.stringify(record), { mode: 0o600 });
console.log(JSON.stringify({ published: true, account: bot.basicId, areas: stored.areas.length, imageBytes: image.length, previousMenuPreserved: true }));
