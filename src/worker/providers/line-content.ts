import { MAX_UPLOAD_BYTES } from "../../../packages/api-contract/src";

export type LineContentResult =
  | { state: "processing" }
  | { state: "expired" }
  | { state: "ready"; contentType: string; body: ReadableStream<Uint8Array> };

/** Counts actual bytes, including when Content-Length is missing or dishonest. */
export function limitVideoBytes(body: ReadableStream<Uint8Array>, maximum = MAX_UPLOAD_BYTES): ReadableStream<Uint8Array> {
  let total = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > maximum) throw new Error("LINE_VIDEO_TOO_LARGE");
      controller.enqueue(chunk);
    },
  }));
}

/** Only accept message IDs from authenticated LINE events, never user-supplied URLs. */
export async function getLineVideoContent(
  messageId: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<LineContentResult> {
  if (!/^[0-9]{1,100}$/.test(messageId)) throw new Error("LINE_MESSAGE_ID_INVALID");
  if (!accessToken) throw new Error("LINE_CONTENT_NOT_CONFIGURED");
  const response = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { authorization: `Bearer ${accessToken}` },
    redirect: "error",
    signal: signal ?? AbortSignal.timeout(60_000),
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    if (response.status === 202) return { state: "processing" };
    if (response.status === 404 || response.status === 410) return { state: "expired" };
    // Provider bodies may contain identifiers; do not include them in exceptions/logs.
    throw new Error("LINE_CONTENT_UNAVAILABLE");
  }
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  const size = response.headers.get("content-length");
  if (!contentType.startsWith("video/") || !response.body
    || (size !== null && (!/^\d+$/.test(size) || Number(size) > MAX_UPLOAD_BYTES))) {
    await response.body?.cancel();
    throw new Error("LINE_VIDEO_CONTENT_INVALID");
  }
  return { state: "ready", contentType, body: limitVideoBytes(response.body) };
}

export async function verifyLineSignature(body: Uint8Array<ArrayBuffer>, signature: string | null, secret: string): Promise<boolean> {
  if (!secret || !signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(atob(signature), char => char.charCodeAt(0));
  return crypto.subtle.verify("HMAC", key, bytes, body);
}
