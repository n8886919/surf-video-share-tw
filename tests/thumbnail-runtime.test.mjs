import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

// Resolve Wrangler's own runtime, including pnpm's isolated dependency layout.
const wranglerRequire = createRequire(import.meta.resolve('wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(wranglerRequire.resolve('miniflare')).href);
test('thumbnail proxy runs in workerd and rejects redirects without forwarding a signed URL', async () => {
  const source = await readFile(new URL('../src/worker/thumbnail.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mf = new Miniflare(convertV4MiniflareOptions({ cf: false, modules: true, compatibilityDate: '2026-08-24', script: compiled + `
    export default { async fetch(request) {
      const redirected = new URL(request.url).pathname === '/redirect';
      try { return await proxyThumbnail('/og.png', 'https://example.com/', {
        ASSETS: { fetch: async request => redirected
          ? new Response(null, { status: 302, headers: { location: 'https://provider.example/signed-token' } })
          : new Response(request.redirect, { headers: { 'content-type': 'image/jpeg' } }) },
      }, 'no-store'); }
      catch { return new Response(null, { status: 502 }); }
    } }` }));
  try {
    const response = await mf.dispatchFetch('https://example.com/image');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(await response.text(), 'manual');
    const redirect = await mf.dispatchFetch('https://example.com/redirect');
    assert.equal(redirect.status, 502);
    assert.equal(redirect.headers.get('location'), null);
  } finally { await mf.dispose(); }
});
