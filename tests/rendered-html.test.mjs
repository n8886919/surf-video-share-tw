import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

test("renders the product title and language", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, /<html[^>]+lang=["']zh-Hant-TW["']/i);
  assert.match(html, /彼日浪影/);
  assert.match(html, /不預測浪好不好；只用社群共享的歷史實拍/);

  const assetsDirectory = new URL("../dist/client/assets/", import.meta.url);
  const clientAsset = (await readdir(assetsDirectory)).find((name) => /^surf-app-.*\.js$/.test(name));
  assert.ok(clientAsset, "surf app client bundle should exist");
  const clientBundle = await readFile(new URL(clientAsset, assetsDirectory), "utf8");
  assert.match(clientBundle, /彼日浪影/);
  assert.match(clientBundle, /問題回報/);
  assert.match(clientBundle, /分享我的影片/);
  assert.match(clientBundle, /目前先開放 100 位使用者/);
});
