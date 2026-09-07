import { lineCompletionSchema, type LineCompletion } from "../packages/api-contract/src";

export type LoginRecovery = LineCompletion["status"] | "waiting" | "cookie-unavailable" | "unavailable";

/** One bounded run per mount/foreground/manual check. No credential is available to JS. */
export async function recoverLineLogin(options: {
  signal: AbortSignal;
  onProgress: (status: LoginRecovery, traceId?: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<LoginRecovery> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const deadline = Date.now() + 30_000;
  for (let attempt = 0; attempt < 10; attempt++) {
    options.signal.throwIfAborted();
    const requestController = new AbortController();
    const abort = () => requestController.abort();
    options.signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, 8_000);
    let result: LineCompletion;
    try {
      const response = await fetchImpl("/api/v1/auth/line/complete", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" }, body: "{}", signal: requestController.signal,
      });
      if (!response.ok) throw new Error("暫時無法確認登入，請稍後再試");
      result = lineCompletionSchema.parse(await response.json());
    } finally { clearTimeout(timeout); options.signal.removeEventListener("abort", abort); }
    if (options.signal.aborted) throw options.signal.reason;
    options.onProgress(result.status, result.traceId);
    if (result.status !== "pending") return result.status;
    if (Date.now() >= deadline) break;
    if (attempt < 9) await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(options.signal.reason); };
      const timer = setTimeout(() => { options.signal.removeEventListener("abort", abort); resolve(); }, 3_000);
      options.signal.addEventListener("abort", abort, { once: true });
      if (options.signal.aborted) abort();
    });
  }
  options.onProgress("waiting");
  return "waiting";
}
