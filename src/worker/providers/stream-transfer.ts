import { limitVideoBytes } from "./line-content";

/** Streaming multipart: bounded memory and byte count; credentials never enter the source URL. */
export async function transferToStream(uploadUrl: string, source: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> {
  const url = new URL(uploadUrl);
  // Stream currently returns cloudflarestream.com; older tickets use videodelivery.net.
  const allowedHosts = new Set(["upload.cloudflarestream.com", "upload.videodelivery.net"]);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname) || url.port || url.username || url.password) {
    await source.cancel();
    throw new Error("STREAM_UPLOAD_URL_INVALID");
  }
  const boundary = `surf-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const reader = limitVideoBytes(source).getReader();
  let started = false;
  let complete = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="video.mp4"\r\nContent-Type: application/octet-stream\r\n\r\n`));
        return;
      }
      const chunk = await reader.read();
      if (chunk.done) {
        complete = true;
        controller.enqueue(encoder.encode(`\r\n--${boundary}--\r\n`));
        controller.close();
      } else controller.enqueue(chunk.value);
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  try {
    const response = await fetch(url, {
      method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body, signal, redirect: "error",
      // Node test runtime requires duplex; Workers ignores this standard fetch extension.
      ...{ duplex: "half" },
    });
    await response.body?.cancel();
    if (!response.ok || !complete) throw new Error("STREAM_TRANSFER_FAILED");
  } finally { await reader.cancel().catch(() => {}); }
}
