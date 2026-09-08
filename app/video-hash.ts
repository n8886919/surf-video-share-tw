import { MAX_UPLOAD_BYTES } from "../packages/api-contract/src";

export function hashVideoFile(file: File, signal: AbortSignal): Promise<string | null> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL("./video-hash.worker.ts", import.meta.url), { type: "module" }); }
    catch { resolve(null); return; }
    const finish = (hash: string | null, aborted = false) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (aborted) reject(new DOMException("Aborted", "AbortError"));
      else resolve(hash);
    };
    const abort = () => finish(null, true);
    const timer = setTimeout(() => finish(null), 30_000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<unknown>) => finish(
      typeof event.data === "string" && /^[a-f0-9]{64}$/.test(event.data) ? event.data : null,
    );
    worker.onerror = (event) => { event.preventDefault(); finish(null); };
    try { worker.postMessage(file); }
    catch { finish(null); }
  });
}
