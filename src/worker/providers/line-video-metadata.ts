import { inspectQuickTimeMetadata, MAX_VIDEO_METADATA_ATOM_BYTES } from "../../../packages/domain/src/video-metadata";

/** Forward-only, bounded prefix view. The shared parser stops after moov or
 * when an atom extends beyond our budget, rather than downloading media bytes. */
export async function inspectLineVideoMetadata(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const bytes = new Uint8Array(MAX_VIDEO_METADATA_ATOM_BYTES);
  let count = 0;
  try {
    return await inspectQuickTimeMetadata({
      size: bytes.length,
      slice(start, end) {
        return { async arrayBuffer() {
          if (start < 0 || end < start || end > bytes.length) throw new Error("LINE_METADATA_LIMIT");
          while (count < end) {
            const chunk = await reader.read();
            if (chunk.done) throw new Error("LINE_METADATA_TRUNCATED");
            const part = chunk.value.subarray(0, bytes.length - count);
            bytes.set(part, count);
            count += part.length;
          }
          return bytes.slice(start, end).buffer;
        } };
      },
    });
  } finally { await reader.cancel().catch(() => {}); }
}
