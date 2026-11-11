import { afterEach, expect, it, vi } from "vitest";
import { transferToStream } from "../src/worker/providers/stream-transfer";

afterEach(() => vi.restoreAllMocks());
it.each(["upload.cloudflarestream.com", "upload.videodelivery.net"])("streams multipart to the exact official host %s", async host => {
  const source = new Blob([new Uint8Array([1, 2, 3])]).stream();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    expect(await new Response(init?.body).text()).toContain('name="file"');
    return new Response(null, { status: 200 });
  });
  await expect(transferToStream(`https://${host}/fixture`, source, new AbortController().signal)).resolves.toBeUndefined();
});
it.each(["https://upload.cloudflarestream.com.attacker.test/a", "https://attacker.test/a", "http://upload.cloudflarestream.com/a", "https://user:secret@upload.cloudflarestream.com/a"])("rejects unsafe destination %s", async url => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  await expect(transferToStream(url, new Blob(["test"]).stream(), new AbortController().signal)).rejects.toThrow("STREAM_UPLOAD_URL_INVALID");
  expect(fetchMock).not.toHaveBeenCalled();
});
