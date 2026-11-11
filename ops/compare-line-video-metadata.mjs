// Local-only original/received comparison. No credentials, upload, GPS or filename in output.
import { open, readFile } from "node:fs/promises";
import ts from "typescript";

const paths = process.argv.slice(2);
if (paths.length < 1 || paths.length > 2) {
  console.error('Usage: node ops/compare-line-video-metadata.mjs ["original.mp4"] "line-received.mp4"');
  process.exit(1);
}
const asModule = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText).toString("base64")}`;
const timeSource = await readFile(new URL("../packages/domain/src/time-policy.ts", import.meta.url), "utf8");
const metadataSource = (await readFile(new URL("../packages/domain/src/video-metadata.ts", import.meta.url), "utf8"))
  .replace('"./time-policy"', JSON.stringify(asModule(timeSource)));
const { inspectQuickTimeMetadata } = await import(asModule(metadataSource));

async function inspect(path) {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    if (size > 200_000_000) throw new Error("VIDEO_TOO_LARGE");
    const metadata = await inspectQuickTimeMetadata({ size, slice(start, end) {
      return { async arrayBuffer() {
        const buffer = Buffer.alloc(end - start);
        let offset = 0;
        while (offset < buffer.length) {
          const result = await handle.read(buffer, offset, buffer.length - offset, start + offset);
          if (!result.bytesRead) throw new Error("FILE_TRUNCATED");
          offset += result.bytesRead;
        }
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      } };
    } });
    return { size, metadata };
  } finally { await handle.close(); }
}
try {
  const results = await Promise.all(paths.map(inspect));
  const summary = value => ({ sizeBytes: value.size, metadataBytesRead: value.metadata.bytesRead,
    recordingTimePresent: value.metadata.recordedAt !== null,
    containerTimePresent: value.metadata.containerCreatedAt !== null,
    gpsPresent: value.metadata.location !== null });
  if (results.length === 1) {
    console.log(JSON.stringify({ received: summary(results[0]),
      note: "Received file only; metadata loss and correctness cannot be determined without the original.",
    }, null, 2));
    process.exit(0);
  }
  const [original, received] = results;
  console.log(JSON.stringify({ original: summary(original), received: summary(received),
    recordingTimePreserved: original.metadata.recordedAt && received.metadata.recordedAt
      ? original.metadata.recordedAt.getTime() === received.metadata.recordedAt.getTime() : null,
    coordinatesPreserved: original.metadata.location && received.metadata.location
      ? original.metadata.location.latitude === received.metadata.location.latitude
        && original.metadata.location.longitude === received.metadata.location.longitude : null,
    note: "One pair is not a success-rate measurement. No capture time or coordinates are printed.",
  }, null, 2));
} catch {
  console.error("Comparison failed. Check both local files and their size; private paths are omitted.");
  process.exitCode = 1;
}
