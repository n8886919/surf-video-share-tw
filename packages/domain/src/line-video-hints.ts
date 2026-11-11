import { isWithinUploadWindow } from "./time-policy";
import { suggestSpotFromLocation, type MetadataSpot, type ParsedVideoMetadata } from "./video-metadata";

/** LINE may transcode media. Container/export time is not a capture-time hint. */
export function lineVideoHints(metadata: ParsedVideoMetadata, spots: readonly MetadataSpot[], now: Date) {
  return {
    capturedAt: metadata.recordedAt && isWithinUploadWindow(metadata.recordedAt, now)
      ? metadata.recordedAt.toISOString() : null,
    spotId: suggestSpotFromLocation(spots, metadata.location),
  };
}
