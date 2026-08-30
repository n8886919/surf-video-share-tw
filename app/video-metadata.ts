import { isWithinUploadWindow } from "../packages/domain/src/time-policy";

const QUICKTIME_EPOCH_OFFSET_SECONDS = 2_082_844_800;
const MAX_TOP_LEVEL_ATOMS = 128;
export const MAX_VIDEO_METADATA_ATOM_BYTES = 4 * 1024 * 1024;
export const MAX_VIDEO_METADATA_READ_BYTES = MAX_VIDEO_METADATA_ATOM_BYTES + MAX_TOP_LEVEL_ATOMS * 16;
export const GPS_SPOT_MAX_DISTANCE_METERS = 750;
export const GPS_SPOT_MIN_MARGIN_METERS = 500;
export const GPS_MAX_COORDINATE_UNCERTAINTY_METERS = 100;

interface Atom {
  type: string;
  start: number;
  headerSize: number;
  payloadStart: number;
  end: number;
}

export interface EmbeddedVideoLocation {
  latitude: number;
  longitude: number;
  coordinateUncertaintyMeters: number;
}

export interface ParsedVideoMetadata {
  recordedAt: Date | null;
  containerCreatedAt: Date | null;
  location: EmbeddedVideoLocation | null;
  bytesRead: number;
}

export type CaptureTimeHintSource = "recording-metadata" | "container-created" | "file-last-modified";

export interface CaptureTimeHint {
  date: Date;
  source: CaptureTimeHintSource;
  label: string;
}

export interface MetadataSpot {
  id: string;
  latitude?: number | null;
  longitude?: number | null;
}

export interface UploadPrefill {
  capturedAt: Date | null;
  captureTimeLabel: string;
  spotId: string;
  spotLabel: string;
}

function uint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

function uint64(bytes: Uint8Array, offset: number): number | null {
  const high = uint32(bytes, offset);
  const low = uint32(bytes, offset + 4);
  const value = high * 4_294_967_296 + low;
  return Number.isSafeInteger(value) ? value : null;
}

function atomType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function atomAt(bytes: Uint8Array, offset: number, limit: number): Atom | null {
  if (offset < 0 || offset + 8 > limit || limit > bytes.byteLength) return null;
  const shortSize = uint32(bytes, offset);
  let headerSize = 8;
  let size = shortSize;
  if (shortSize === 1) {
    if (offset + 16 > limit) return null;
    headerSize = 16;
    size = uint64(bytes, offset + 8) ?? 0;
  } else if (shortSize === 0) {
    size = limit - offset;
  }
  if (!Number.isSafeInteger(size) || size < headerSize || offset + size > limit) return null;
  return {
    type: atomType(bytes, offset + 4),
    start: offset,
    headerSize,
    payloadStart: offset + headerSize,
    end: offset + size,
  };
}

function childAtoms(bytes: Uint8Array, start: number, end: number, maximum = 4_096): Atom[] {
  const atoms: Atom[] = [];
  let offset = start;
  while (offset + 8 <= end && atoms.length < maximum) {
    const atom = atomAt(bytes, offset, end);
    if (!atom) break;
    atoms.push(atom);
    offset = atom.end;
  }
  return atoms;
}

function metadataChildren(bytes: Uint8Array, meta: Atom): Atom[] {
  if (meta.payloadStart + 4 > meta.end) return [];
  return childAtoms(bytes, meta.payloadStart + 4, meta.end);
}

function findMetadataAtoms(bytes: Uint8Array, parent: Atom, depth = 0): Atom[] {
  if (depth > 3) return [];
  const start = parent.type === "meta" ? parent.payloadStart + 4 : parent.payloadStart;
  const children = childAtoms(bytes, start, parent.end);
  const result: Atom[] = [];
  for (const child of children) {
    if (child.type === "meta") result.push(child);
    if (child.type === "udta") result.push(...findMetadataAtoms(bytes, child, depth + 1));
  }
  return result;
}

function parseMetadataKeys(bytes: Uint8Array, keys: Atom): string[] {
  const start = keys.payloadStart + 4;
  if (start + 4 > keys.end) return [];
  const count = Math.min(uint32(bytes, start), 1_024);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const result: string[] = [];
  let offset = start + 4;
  for (let index = 0; index < count && offset + 8 <= keys.end; index += 1) {
    const size = uint32(bytes, offset);
    if (size < 8 || offset + size > keys.end) break;
    result.push(decoder.decode(bytes.subarray(offset + 8, offset + size)).replace(/\0+$/g, ""));
    offset += size;
  }
  return result;
}

function parseMetadataValues(bytes: Uint8Array, meta: Atom): Map<string, string> {
  const children = metadataChildren(bytes, meta);
  const keysAtom = children.find((atom) => atom.type === "keys");
  const itemList = children.find((atom) => atom.type === "ilst");
  if (!keysAtom || !itemList) return new Map();
  const keys = parseMetadataKeys(bytes, keysAtom);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const values = new Map<string, string>();
  for (const entry of childAtoms(bytes, itemList.payloadStart, itemList.end, 1_024)) {
    const keyIndex = uint32(bytes, entry.start + 4) - 1;
    const key = keys[keyIndex];
    if (!key) continue;
    const data = childAtoms(bytes, entry.payloadStart, entry.end, 32).find((atom) => atom.type === "data");
    if (!data || data.payloadStart + 8 > data.end) continue;
    const value = decoder.decode(bytes.subarray(data.payloadStart + 8, data.end)).replace(/\0+$/g, "").trim();
    if (value) values.set(key, value);
  }
  return values;
}

export function parseOffsetRecordingTime(value: string): Date | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed)) return null;
  const normalized = trimmed
    .replace(" ", "T")
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseIso6709Location(value: string): EmbeddedVideoLocation | null {
  const trimmed = value.trim().replace(/\0+$/g, "");
  const match = /^([+-]\d{2}(?:\.\d+)?)([+-]\d{3}(?:\.\d+)?)(?:[+-]\d+(?:\.\d+)?)?\/?$/.exec(trimmed);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const latitudeDecimals = match[1].split(".")[1]?.length ?? 0;
  const longitudeDecimals = match[2].split(".")[1]?.length ?? 0;
  const latitudeResolution = 111_320 * 0.5 * 10 ** -latitudeDecimals;
  const longitudeResolution = 111_320 * Math.cos(latitude * Math.PI / 180) * 0.5 * 10 ** -longitudeDecimals;
  return {
    latitude,
    longitude,
    coordinateUncertaintyMeters: Math.max(50, latitudeResolution, longitudeResolution),
  };
}

function parseContainerCreationTime(bytes: Uint8Array, moov: Atom): Date | null {
  const movieHeader = childAtoms(bytes, moov.payloadStart, moov.end).find((atom) => atom.type === "mvhd");
  if (!movieHeader || movieHeader.payloadStart + 8 > movieHeader.end) return null;
  const version = bytes[movieHeader.payloadStart];
  const seconds = version === 1
    ? uint64(bytes, movieHeader.payloadStart + 4)
    : version === 0
      ? uint32(bytes, movieHeader.payloadStart + 4)
      : null;
  if (seconds == null) return null;
  const milliseconds = (seconds - QUICKTIME_EPOCH_OFFSET_SECONDS) * 1_000;
  const parsed = new Date(milliseconds);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseQuickTimeMetadata(bytes: Uint8Array): Omit<ParsedVideoMetadata, "bytesRead"> {
  const moov = atomAt(bytes, 0, bytes.byteLength);
  if (!moov || moov.type !== "moov") return { recordedAt: null, containerCreatedAt: null, location: null };
  let recordingValue: string | null = null;
  let locationValue: string | null = null;
  for (const meta of findMetadataAtoms(bytes, moov)) {
    const values = parseMetadataValues(bytes, meta);
    recordingValue ??= values.get("com.apple.quicktime.creationdate") ?? null;
    locationValue ??= values.get("com.apple.quicktime.location.ISO6709") ?? null;
  }
  return {
    recordedAt: recordingValue ? parseOffsetRecordingTime(recordingValue) : null,
    containerCreatedAt: parseContainerCreationTime(bytes, moov),
    location: locationValue ? parseIso6709Location(locationValue) : null,
  };
}

export async function inspectQuickTimeMetadata(file: Blob): Promise<ParsedVideoMetadata> {
  let offset = 0;
  let bytesRead = 0;
  for (let atomIndex = 0; atomIndex < MAX_TOP_LEVEL_ATOMS && offset + 8 <= file.size; atomIndex += 1) {
    const headerLength = Math.min(16, file.size - offset);
    if (bytesRead + headerLength > MAX_VIDEO_METADATA_READ_BYTES) break;
    const header = new Uint8Array(await file.slice(offset, offset + headerLength).arrayBuffer());
    bytesRead += header.byteLength;
    const shortSize = header.byteLength >= 4 ? uint32(header, 0) : 0;
    const type = header.byteLength >= 8 ? atomType(header, 4) : "";
    const headerSize = shortSize === 1 ? 16 : 8;
    const size = shortSize === 1
      ? header.byteLength >= 16 ? uint64(header, 8) : null
      : shortSize === 0 ? file.size - offset : shortSize;
    if (size == null || !Number.isSafeInteger(size) || size < headerSize || offset + size > file.size) break;
    if (type === "moov") {
      if (size > MAX_VIDEO_METADATA_ATOM_BYTES || bytesRead + size > MAX_VIDEO_METADATA_READ_BYTES) break;
      const moovBytes = new Uint8Array(await file.slice(offset, offset + size).arrayBuffer());
      bytesRead += moovBytes.byteLength;
      return { ...parseQuickTimeMetadata(moovBytes), bytesRead };
    }
    offset += size;
  }
  return { recordedAt: null, containerCreatedAt: null, location: null, bytesRead };
}

function withinUploadWindow(date: Date | null, now: Date, windowHours: number): date is Date {
  return Boolean(date && isWithinUploadWindow(date, now, windowHours));
}

export function selectCaptureTimeHint(
  metadata: Pick<ParsedVideoMetadata, "recordedAt" | "containerCreatedAt">,
  lastModified: number,
  now = new Date(),
  windowHours = 168,
): CaptureTimeHint | null {
  if (withinUploadWindow(metadata.recordedAt, now, windowHours)) {
    return { date: metadata.recordedAt, source: "recording-metadata", label: "影片原始拍攝時間（含時區），請確認" };
  }
  if (withinUploadWindow(metadata.containerCreatedAt, now, windowHours)) {
    return { date: metadata.containerCreatedAt, source: "container-created", label: "影片容器建立時間（較弱提示），請確認" };
  }
  const modified = new Date(lastModified);
  if (Number.isFinite(lastModified) && lastModified > 0 && withinUploadWindow(modified, now, windowHours)) {
    return { date: modified, source: "file-last-modified", label: "檔案最後修改時間（最低可信度），請確認" };
  }
  return null;
}

function distanceMeters(first: { latitude: number; longitude: number }, second: { latitude: number; longitude: number }): number {
  const radius = 6_371_000;
  const latitudeDelta = (second.latitude - first.latitude) * Math.PI / 180;
  const longitudeDelta = (second.longitude - first.longitude) * Math.PI / 180;
  const firstLatitude = first.latitude * Math.PI / 180;
  const secondLatitude = second.latitude * Math.PI / 180;
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function suggestSpotFromLocation(spots: readonly MetadataSpot[], location: EmbeddedVideoLocation | null): string | null {
  if (!location || location.coordinateUncertaintyMeters > GPS_MAX_COORDINATE_UNCERTAINTY_METERS) return null;
  const candidates = spots.flatMap((spot) => {
    if (spot.latitude == null || spot.longitude == null || !Number.isFinite(spot.latitude) || !Number.isFinite(spot.longitude)) return [];
    return [{ id: spot.id, distance: distanceMeters(location, { latitude: spot.latitude, longitude: spot.longitude }) }];
  }).sort((left, right) => left.distance - right.distance);
  const nearest = candidates[0];
  if (!nearest || nearest.distance > GPS_SPOT_MAX_DISTANCE_METERS) return null;
  const second = candidates[1];
  if (second && second.distance - nearest.distance < GPS_SPOT_MIN_MARGIN_METERS) return null;
  return nearest.id;
}

export function resolveUploadPrefill(
  metadata: ParsedVideoMetadata,
  lastModified: number,
  currentSpotId: string,
  spots: readonly MetadataSpot[],
  now = new Date(),
): UploadPrefill {
  const timeHint = selectCaptureTimeHint(metadata, lastModified, now);
  const suggestedSpotId = suggestSpotFromLocation(spots, metadata.location);
  return {
    capturedAt: timeHint?.date ?? null,
    captureTimeLabel: timeHint?.label || "未找到 168 小時內且為台北時間 05:00–19:59 的可信時間，請手動填寫或稍後補齊",
    spotId: suggestedSpotId || currentSpotId,
    spotLabel: suggestedSpotId
      ? "依影片內嵌位置建議浪點，請確認；位置本身不會送出或保存"
      : "未取得足夠精確且明確的位置；保留目前浪點，請確認",
  };
}
