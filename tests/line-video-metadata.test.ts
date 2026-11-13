import { expect, it, vi } from "vitest";
import { inspectLineVideoMetadata } from "../src/worker/providers/line-video-metadata";
import { MAX_VIDEO_METADATA_ATOM_BYTES } from "../packages/domain/src/video-metadata";

function join(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
const encode = (s: string) => new TextEncoder().encode(s);
const number = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
const atom = (name: string, payload = new Uint8Array()) => join(number(payload.length + 8), encode(name), payload);
function recordingAtom() {
  const key = encode("com.apple.quicktime.creationdate");
  const keys = atom("keys", join(number(0), number(1), number(key.length + 8), encode("mdta"), key));
  const data = atom("data", join(number(1), number(0), encode("2026-11-13T08:00:00+08:00")));
  const ilst = atom("ilst", join(number(data.length + 8), number(1), data));
  return atom("moov", atom("udta", atom("meta", join(number(0), keys, ilst))));
}

it("reads a complete front moov after ftyp without waiting for the video body", async () => {
  const bytes = join(atom("ftyp", encode("qt  ")), recordingAtom());
  let offset = 0;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return new Promise(() => {});
      const end = Math.min(offset + 7, bytes.length);
      controller.enqueue(bytes.slice(offset, end)); offset = end;
    }, cancel,
  }, { highWaterMark: 0 });
  const result = await inspectLineVideoMetadata(body);
  expect(result.recordedAt?.toISOString()).toBe("2026-11-13T00:00:00.000Z");
  expect(cancel).toHaveBeenCalledOnce();
}, 1000);

it("rejects a media atom beyond the prefix budget after its header, without reading megabytes", async () => {
  const pull = vi.fn(controller => controller.enqueue(join(number(20_000_000), encode("mdat"), number(0), number(0))));
  const cancel = vi.fn();
  const result = await inspectLineVideoMetadata(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }));
  expect(result.recordedAt).toBeNull();
  expect(result.bytesRead).toBe(16);
  expect(pull).toHaveBeenCalledOnce();
  expect(cancel).toHaveBeenCalledOnce();
});

it("still finds metadata after a small media atom within the prefix budget", async () => {
  const bytes = join(atom("ftyp", encode("qt  ")), atom("mdat", new Uint8Array(1024)), recordingAtom());
  const result = await inspectLineVideoMetadata(new Blob([bytes]).stream());
  expect(result.recordedAt?.toISOString()).toBe("2026-11-13T00:00:00.000Z");
});

it("rejects an oversized extended-size atom without reading its payload", async () => {
  const header = join(number(1), encode("moov"), number(0), number(MAX_VIDEO_METADATA_ATOM_BYTES + 1));
  const result = await inspectLineVideoMetadata(new Blob([header]).stream());
  expect(result.recordedAt).toBeNull();
});

it("releases a truncated or failed stream instead of holding up subsequent work", async () => {
  await expect(inspectLineVideoMetadata(new Blob([new Uint8Array(3)]).stream())).rejects.toThrow("LINE_METADATA_TRUNCATED");
});
