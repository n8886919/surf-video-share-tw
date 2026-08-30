import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function readClientBundle(pattern, description) {
  const directories = [
    new URL("../dist/client/assets/", import.meta.url),
    new URL("../dist/client/_next/static/chunks/", import.meta.url),
    new URL("../dist/client/_next/static/css/", import.meta.url),
  ];
  for (const directory of directories) {
    let names;
    try {
      names = await readdir(directory);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const asset = names.find((name) => pattern.test(name));
    if (asset) return readFile(new URL(asset, directory), "utf8");
  }
  assert.fail(`${description} client bundle should exist`);
}

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
  assert.equal(response.headers.get("referrer-policy"), "strict-origin");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const html = await response.text();
  assert.match(html, /<html[^>]+lang=["']zh-Hant-TW["']/i);
  assert.match(html, /彼日浪影/);
  assert.match(html, /不預測浪好不好；只用社群共享的歷史實拍/);

  const clientBundle = await readClientBundle(/^surf-app-.*\.js$/, "surf app");
  assert.match(clientBundle, /彼日浪影/);
  assert.match(clientBundle, /問題回報/);
  assert.match(clientBundle, /分享連結/);
  assert.match(clientBundle, /連結 24 小時有效/);
  assert.match(clientBundle, /透過分享連結的匿名播放會扣/);
  assert.match(clientBundle, /人物入鏡怎麼判斷/);
  assert.match(clientBundle, /若可辨識的人物是主要拍攝對象/);
  assert.match(clientBundle, /CC0 僅適用於上傳者有權釋出的著作權/);
  assert.match(clientBundle, /法務部：個人資料保護法第 51 條/);
  assert.match(clientBundle, /https:\/\/www\.tipo\.gov\.tw\/tw\/copyright\/774-5048\.html/);
  assert.match(clientBundle, /準備下載 MP4/);
  assert.match(clientBundle, /近 90 天播放/);
  assert.match(clientBundle, /近 90 天播放 · /);
  assert.match(clientBundle, /當時預報/);
  assert.doesNotMatch(clientBundle, /拍攝當時預報/);
  assert.doesNotMatch(clientBundle, /每個來源獨立顯示，不與其他模型平均。/);
  assert.match(clientBundle, /owner-action-icon/);
  assert.match(clientBundle, /project-version/);
  assert.match(clientBundle, /版本 /);
  assert.match(clientBundle, /公開名稱:/);
  assert.doesNotMatch(clientBundle, /公開名稱 · id:/);
  assert.doesNotMatch(clientBundle, /新影片預設顯示公開名稱/);
  assert.doesNotMatch(clientBundle, /目前 id:/);
  assert.match(clientBundle, /相似歷史實拍/);
  assert.doesNotMatch(clientBundle, /所選預報/);
  assert.match(clientBundle, /CWA 與 ECMWF 綜合相似實拍/);
  assert.match(clientBundle, /次湧浪/);
  assert.match(clientBundle, /風浪/);
  assert.match(clientBundle, /預報日期，離散五日/);
  assert.match(clientBundle, /第 1–3 天：CWA＋ECMWF/);
  assert.match(clientBundle, /第 4–5 天：ECMWF-only/);
  assert.doesNotMatch(clientBundle, /test-spot-/);
  assert.doesNotMatch(clientBundle, /測試 [1-6]/);
  assert.match(clientBundle, /拍攝時間 05:00–17:59/);
  assert.match(clientBundle, /左右拖曳可滑動，長按按鈕可拖曳排序/);
  assert.match(clientBundle, /setPointerCapture/);
  assert.match(clientBundle, /scrollLeft/);
  assert.match(clientBundle, /offsetLeft/);
  assert.doesNotMatch(clientBundle, /elementFromPoint/);
  assert.match(clientBundle, /candidate-thumbnail-date/);
  const clientCss = await readClientBundle(/^index\..*\.css$/, "app css");
  assert.match(clientCss, /touch-action:pan-y/);
  assert.match(clientCss, /user-select:none/);
  assert.match(clientCss, /grid-template-columns:repeat\(5,1fr\)/);
  assert.match(clientCss, /transform:scale\(1\.1\)/);
  assert.match(clientBundle, /拍攝影片/);
  assert.match(clientBundle, /environment/);
  assert.match(clientBundle, /影片原始拍攝時間（含時區），請確認/);
  assert.match(clientBundle, /檔案最後修改時間（最低可信度），請確認/);
  assert.match(clientBundle, /位置本身不會送出或保存/);
  assert.match(clientBundle, /未取得足夠精確且明確的位置/);
  assert.match(clientBundle, /更多/);
  assert.match(clientCss, /rights-help-inline/);
  assert.doesNotMatch(clientCss, /rights-help-button/);
  assert.match(clientBundle, /更多資訊/);
  assert.match(clientBundle, /待處理檢舉/);
  assert.match(clientBundle, /來源相似度/);
  assert.match(clientBundle, /實拍當時/);
  assert.match(clientBundle, /candidate-play-button/);
  assert.match(clientBundle, /相似度/);
  assert.match(clientBundle, /10–60 秒/);
  assert.match(clientBundle, /Purpose and position/);
  assert.match(clientBundle, /操作與專案說明/);
  assert.match(clientBundle, /initialHelpOpen/);
  assert.match(clientBundle, /replaceState/);
  assert.match(clientBundle, /searchParams\.delete\([`"']help[`"']\)/);
  assert.match(clientBundle, /檢舉影片/);
  assert.doesNotMatch(clientBundle, /開啟管理頁面/);
  assert.doesNotMatch(clientBundle, /相似指數/);
  assert.doesNotMatch(clientBundle, /左側固定基準/);
  assert.doesNotMatch(clientBundle, /資料涵蓋/);
  assert.doesNotMatch(clientBundle, /左側固定為所選時段/);
  assert.doesNotMatch(clientBundle, /已選實拍/);
  assert.match(clientBundle, /目前先開放 100 位使用者/);
  assert.match(clientBundle, /LINE 自動登入可能未完成/);
  assert.match(clientBundle, /\/api\/v1\/auth\/line\?manual=1/);

  const helpResponse = await worker.fetch(
    new Request("http://localhost/?help=1", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(helpResponse.status, 200);
  assert.match(await helpResponse.text(), /initialHelpOpen.{0,40}true/);
});

test("renders a share-gated public-video route and first-party preview", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("public-video-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/v/video_public", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("referrer-policy"), "strict-origin");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const html = await response.text();
  assert.match(html, /公開實拍｜彼日浪影/);
  assert.match(html, /\/api\/v1\/videos\/video_public\/thumbnail/);
  assert.doesNotMatch(html, /cloudflarestream\.com/);

  const clientBundle = await readClientBundle(/^public-video-.*\.js$/, "public video");
  assert.match(clientBundle, /\/public-videos\//);
  assert.match(clientBundle, /\/shared-videos\//);
  assert.match(clientBundle, /尚未過期的分享連結/);
  assert.match(clientBundle, /\/playback-start/);
  assert.match(clientBundle, /載入播放器/);
  assert.match(clientBundle, /載入播放器…/);
  assert.doesNotMatch(clientBundle, /▶/);
  assert.match(clientBundle, /上傳者補充: /);
  assert.match(clientBundle, /public-video-summary/);
  assert.match(clientBundle, /更多浪影．上傳你的浪影/);
  assert.match(clientBundle, /\/\?help=1/);
  assert.doesNotMatch(clientBundle, /公開影片採 CC0 1\.0；播放前會再次確認公開狀態。/);
  assert.match(clientBundle, /檢舉影片/);
});
