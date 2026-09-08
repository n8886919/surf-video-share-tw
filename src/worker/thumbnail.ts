import type { AppEnv } from "./db";

/** Return image bytes only: a Stream thumbnail token can also authorize playback. */
export async function proxyThumbnail(url: string, requestUrl: string, env: AppEnv, cacheControl: string): Promise<Response> {
  try {
    const target = new URL(url, requestUrl);
    const local = target.origin === new URL(requestUrl).origin;
    if (!local && target.protocol !== "https:") throw new Error("Invalid thumbnail protocol");
    // workerd rejects redirect:"error". Manual mode exposes no redirect to the client:
    // the !ok check below rejects 3xx responses before constructing the image response.
    const request = new Request(target, { redirect: "manual", signal: AbortSignal.timeout(8000) });
    const upstream = local ? await env.ASSETS.fetch(request) : await fetch(request);
    const type = upstream.headers.get("content-type")?.split(";")[0].trim();
    if (!upstream.ok || !type || !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(type)) {
      throw new Error("Invalid thumbnail response");
    }
    return new Response(upstream.body, { headers: {
      "content-type": type, "cache-control": cacheControl, "x-content-type-options": "nosniff",
    } });
  } catch {
    // Fetch errors can include the signed URL; never propagate them to logs or responses.
    throw new Error("Thumbnail image fetch failed");
  }
}
