import { afterEach, expect, it, vi } from "vitest";
import { transferVideo } from "../app/upload-progress";

afterEach(() => vi.unstubAllGlobals());

function requestFixture() {
  const request = {
    upload: { onprogress: null as ((event: Pick<ProgressEvent, "loaded" | "total" | "lengthComputable">) => void) | null },
    onload: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onabort: null as (() => void) | null,
    ontimeout: null as (() => void) | null,
    status: 200, timeout: 0,
    open: vi.fn(), send: vi.fn(),
    abort: vi.fn(() => request.onabort?.()),
  };
  vi.stubGlobal("XMLHttpRequest", class { constructor() { return request; } });
  const controller = new AbortController();
  const progress = vi.fn();
  const file = new File([new Uint8Array(100)], "wave.mp4", { type: "video/mp4" });
  const transfer = transferVideo("https://upload.example.test/one-time", file, controller.signal, progress);
  return { request, controller, progress, transfer };
}

it("reports actual sent bytes, submits multipart directly and removes the abort listener after receipt", async () => {
  const f = requestFixture();
  expect(f.request.open).toHaveBeenCalledWith("POST", "https://upload.example.test/one-time");
  const form = f.request.send.mock.calls[0][0] as FormData;
  expect(form.get("file")).toBeInstanceOf(File);
  f.request.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
  expect(f.progress).toHaveBeenLastCalledWith(25);
  f.request.upload.onprogress?.({ lengthComputable: false, loaded: 25, total: 0 });
  expect(f.progress).toHaveBeenLastCalledWith(null);
  f.request.onload?.();
  await f.transfer;
  f.controller.abort();
  expect(f.request.abort).not.toHaveBeenCalled();
});

it("aborts the direct request when its owning upload is unmounted", async () => {
  const f = requestFixture();
  const rejected = expect(f.transfer).rejects.toMatchObject({ name: "AbortError" });
  f.controller.abort();
  await rejected;
  expect(f.request.abort).toHaveBeenCalledTimes(1);
  expect(f.request.upload.onprogress).toBeNull();
});

it.each(["onerror", "ontimeout"] as const)("rejects %s and cleans up rather than pretending to finish", async event => {
  const f = requestFixture();
  const rejected = expect(f.transfer).rejects.toThrow();
  f.request[event]?.();
  await rejected;
  f.controller.abort();
  expect(f.request.abort).not.toHaveBeenCalled();
});
