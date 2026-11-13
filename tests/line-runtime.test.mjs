import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const wranglerRequire = createRequire(import.meta.resolve('wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(wranglerRequire.resolve('miniflare')).href);

test('LINE metadata inspection stops after an oversized media header in workerd', async () => {
  const paths = ['packages/domain/src/time-policy.ts', 'packages/domain/src/video-metadata.ts', 'src/worker/providers/line-video-metadata.ts'];
  const sources = await Promise.all(paths.map(path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')));
  const compiled = sources.map(source => ts.transpileModule(source.replace(/^import .* from ".*";\r?$/gm, ''),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/^export const /gm, 'const ')).join('\n');
  const mf = new Miniflare(convertV4MiniflareOptions({ cf: false, modules: true, compatibilityDate: '2026-08-24', script: compiled + `
    export default { async fetch() {
      let pulls = 0, cancelled = false;
      const body = new ReadableStream({ pull(controller) {
        pulls++;
        if (pulls > 1) throw new Error('Unnecessary media read');
        const header = new Uint8Array(16);
        new DataView(header.buffer).setUint32(0, 20_000_000);
        header.set(new TextEncoder().encode('mdat'), 4);
        controller.enqueue(header);
      }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
      const metadata = await inspectLineVideoMetadata(body);
      return Response.json({ pulls, cancelled, bytesRead: metadata.bytesRead });
    } }` }));
  try {
    const response = await mf.dispatchFetch('https://example.com/metadata');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { pulls: 1, cancelled: true, bytesRead: 16 });
  } finally { await mf.dispose(); }
});

test('LINE adapters run in workerd and reject redirects without forwarding credentials or video bytes', async () => {
  const sources = await Promise.all(['line-content', 'line-messaging', 'stream-transfer'].map(name =>
    readFile(new URL(`../src/worker/providers/${name}.ts`, import.meta.url), 'utf8')));
  const compiled = sources.map(source => ts.transpileModule(source
    .replace('import { MAX_UPLOAD_BYTES } from "../../../packages/api-contract/src";', 'const MAX_UPLOAD_BYTES = 200_000_000;')
    .replace('import { limitVideoBytes } from "./line-content";', ''),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).join('\n');
  let redirect = false;
  const requests = [];
  const mf = new Miniflare(convertV4MiniflareOptions({ cf: false, modules: true, compatibilityDate: '2026-08-24',
    outboundService: async request => {
      requests.push({ url: request.url, authorization: request.headers.get('authorization'), body: await request.text() });
      if (redirect) return new Response(null, { status: 307, headers: { location: 'https://unexpected.example/private' } });
      return new Response('fixture-video', { headers: { 'content-type': 'video/mp4' } });
    },
    script: compiled + `
      export default { async fetch(request) {
        try {
          const action = new URL(request.url).pathname;
          if (action === '/reply') await replyToLine('fixture-token', 'fixture-reply', [{ type: 'text', text: 'test' }]);
          else if (action === '/content') {
            const result = await getLineVideoContent('123', 'fixture-token');
            if (result.state !== 'ready') throw new Error('not ready');
            await new Response(result.body).arrayBuffer();
          } else await transferToStream('https://upload.cloudflarestream.com/fixture',
            new Blob(['fixture-upload']).stream(), AbortSignal.timeout(5000));
          return new Response('ok');
        } catch (error) { return new Response(error.message, { status: 502 }); }
      } }`,
  }));
  try {
    for (const action of ['reply', 'content', 'upload']) {
      requests.length = 0;
      redirect = false;
      const success = await mf.dispatchFetch(`https://example.com/${action}`);
      assert.equal(success.status, 200, `${action}: ${await success.text()}`);
      assert.equal(requests.length, 1);
      if (action === 'upload') assert.match(requests[0].body, /fixture-upload/);
      else assert.equal(requests[0].authorization, 'Bearer fixture-token');
      requests.length = 0;
      redirect = true;
      const failure = await mf.dispatchFetch(`https://example.com/${action}`);
      assert.equal(failure.status, 502);
      assert.equal(requests.length, 1, `${action} must never follow redirects`);
      assert.equal(new URL(requests[0].url).hostname === 'unexpected.example', false);
    }
  } finally { await mf.dispose(); }
});
