import { describe, expect, it } from "vitest";
import {
  MAX_VIDEO_METADATA_ATOM_BYTES,
  MAX_VIDEO_METADATA_READ_BYTES,
  inspectQuickTimeMetadata,
  parseIso6709Location,
  parseOffsetRecordingTime,
  parseQuickTimeMetadata,
  resolveUploadPrefill,
  selectCaptureTimeHint,
  suggestSpotFromLocation,
} from "../app/video-metadata";

const encoder = new TextEncoder();
type TestBytes = Uint8Array<ArrayBufferLike>;

function uint32(value: number): TestBytes {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function concat(...parts: TestBytes[]): TestBytes {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function atom(type: string, payload: TestBytes = new Uint8Array()): TestBytes {
  return concat(uint32(payload.byteLength + 8), encoder.encode(type), payload);
}

function indexedAtom(index: number, payload: TestBytes): TestBytes {
  return concat(uint32(payload.byteLength + 8), uint32(index), payload);
}

function metadataEntry(key: string): TestBytes {
  const keyBytes = encoder.encode(key);
  return concat(uint32(keyBytes.byteLength + 8), encoder.encode("mdta"), keyBytes);
}

function quickTimeMoov(recordedAt: string, location: string, containerDate: Date): TestBytes {
  const keys = ["com.apple.quicktime.creationdate", "com.apple.quicktime.location.ISO6709"];
  const keysAtom = atom("keys", concat(
    new Uint8Array(4),
    uint32(keys.length),
    ...keys.map(metadataEntry),
  ));
  const dataAtom = (value: string) => atom("data", concat(uint32(1), uint32(0), encoder.encode(value)));
  const itemList = atom("ilst", concat(
    indexedAtom(1, dataAtom(recordedAt)),
    indexedAtom(2, dataAtom(location)),
  ));
  const meta = atom("meta", concat(new Uint8Array(4), keysAtom, itemList));
  const quickTimeSeconds = Math.floor(containerDate.getTime() / 1_000) + 2_082_844_800;
  const movieHeader = atom("mvhd", concat(new Uint8Array(4), uint32(quickTimeSeconds), new Uint8Array(12)));
  return atom("moov", concat(movieHeader, atom("udta", meta)));
}

function blobPart(bytes: TestBytes): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

describe("bounded client video metadata", () => {
  it("parses QuickTime recording time, container time, and ISO 6709 location", () => {
    const containerDate = new Date("2026-08-29T01:02:03.000Z");
    const parsed = parseQuickTimeMetadata(quickTimeMoov(
      "2026-08-29T09:04:05+08:00",
      "+24.87310+121.84114+004.2/",
      containerDate,
    ));
    expect(parsed.recordedAt?.toISOString()).toBe("2026-08-29T01:04:05.000Z");
    expect(parsed.containerCreatedAt?.toISOString()).toBe(containerDate.toISOString());
    expect(parsed.location).toMatchObject({ latitude: 24.8731, longitude: 121.84114 });
  });

  it("finds a tail moov atom without reading the intervening media payload", async () => {
    const moov = quickTimeMoov("2026-08-29T09:04:05+0800", "+24.87310+121.84114/", new Date("2026-08-29T01:02:03Z"));
    const file = new Blob([
      blobPart(atom("ftyp", encoder.encode("qt  "))),
      blobPart(atom("mdat", new Uint8Array(512 * 1024))),
      blobPart(moov),
    ], { type: "video/quicktime" });
    const parsed = await inspectQuickTimeMetadata(file);
    expect(parsed.recordedAt?.toISOString()).toBe("2026-08-29T01:04:05.000Z");
    expect(parsed.bytesRead).toBeLessThan(8_192);
  });

  it("fails safely when the metadata atom exceeds the bounded-read limit", async () => {
    const oversizedPayload = new Uint8Array(MAX_VIDEO_METADATA_ATOM_BYTES + 1);
    const parsed = await inspectQuickTimeMetadata(new Blob([blobPart(atom("moov", oversizedPayload))]));
    expect(parsed).toMatchObject({ recordedAt: null, containerCreatedAt: null, location: null });
    expect(parsed.bytesRead).toBeLessThanOrEqual(MAX_VIDEO_METADATA_READ_BYTES);
  });

  it("requires an explicit timestamp offset for the strongest hint", () => {
    expect(parseOffsetRecordingTime("2026-08-29T09:04:05")).toBeNull();
    expect(parseOffsetRecordingTime("2026-08-29 09:04:05+0800")?.toISOString()).toBe("2026-08-29T01:04:05.000Z");
  });

  it("prefers recording metadata, then container time, then labelled lastModified", () => {
    const now = new Date("2026-08-30T04:00:00.000Z");
    const recordedAt = new Date("2026-08-30T01:00:00.000Z");
    const containerCreatedAt = new Date("2026-08-30T02:00:00.000Z");
    const modifiedAt = new Date("2026-08-30T03:00:00.000Z");
    expect(selectCaptureTimeHint({ recordedAt, containerCreatedAt }, modifiedAt.getTime(), now)).toMatchObject({ source: "recording-metadata", date: recordedAt });
    expect(selectCaptureTimeHint({ recordedAt: null, containerCreatedAt }, modifiedAt.getTime(), now)).toMatchObject({ source: "container-created", date: containerCreatedAt });
    expect(selectCaptureTimeHint({ recordedAt: null, containerCreatedAt: null }, modifiedAt.getTime(), now)).toMatchObject({
      source: "file-last-modified",
      date: modifiedAt,
      label: expect.stringContaining("最低可信度"),
    });
  });

  it("rejects future, expired, malformed, and metadata-stripped time hints", () => {
    const now = new Date("2026-08-30T04:00:00.000Z");
    expect(selectCaptureTimeHint(
      { recordedAt: new Date("2026-08-30T04:00:01.000Z"), containerCreatedAt: new Date("2026-08-20T00:00:00.000Z") },
      0,
      now,
    )).toBeNull();
    expect(parseIso6709Location("not-a-location")).toBeNull();
    expect(parseQuickTimeMetadata(atom("moov"))).toMatchObject({ recordedAt: null, location: null });
  });

  it("suggests only a close, precise, and unambiguous active spot", () => {
    const spots = [
      { id: "double-lions", latitude: 24.8887597, longitude: 121.8495724 },
      { id: "wushi", latitude: 24.8731036, longitude: 121.8411446 },
    ];
    expect(suggestSpotFromLocation(spots, parseIso6709Location("+24.87310+121.84114/"))).toBe("wushi");
    expect(suggestSpotFromLocation(spots, parseIso6709Location("+24.8809+121.8453/"))).toBeNull();
    expect(suggestSpotFromLocation(spots, parseIso6709Location("+24.87+121.84/"))).toBeNull();
  });

  it("resolves the upload prefill without returning raw location metadata", () => {
    const prefill = resolveUploadPrefill(
      {
        recordedAt: new Date("2026-08-30T01:00:00.000Z"),
        containerCreatedAt: null,
        location: parseIso6709Location("+24.87310+121.84114/"),
        bytesRead: 512,
      },
      new Date("2026-08-30T02:00:00.000Z").getTime(),
      "double-lions",
      [
        { id: "double-lions", latitude: 24.8887597, longitude: 121.8495724 },
        { id: "wushi", latitude: 24.8731036, longitude: 121.8411446 },
      ],
      new Date("2026-08-30T04:00:00.000Z"),
    );
    expect(prefill).toMatchObject({
      capturedAt: new Date("2026-08-30T01:00:00.000Z"),
      spotId: "wushi",
      captureTimeLabel: expect.stringContaining("含時區"),
      spotLabel: expect.stringContaining("位置本身不會送出或保存"),
    });
    expect(Object.keys(prefill)).not.toContain("location");
  });
});
