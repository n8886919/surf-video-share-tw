import { z } from "zod";

// Official model-updates page uses the marine host for this explicit model.
export const MFWAM_METADATA_URL = "https://marine-api.open-meteo.com/data/meteofrance_wave/static/meta.json";
const metadataSchema = z.object({
  last_run_initialisation_time: z.number().int().positive(),
  last_run_modification_time: z.number().int().positive(),
  last_run_availability_time: z.number().int().positive(),
  update_interval_seconds: z.number().int().positive(),
});

export async function readMfwamVersion(now: Date, fetchImpl: typeof fetch): Promise<string | undefined> {
  try {
    const response = await fetchImpl(MFWAM_METADATA_URL, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return undefined;
    const meta = metadataSchema.parse(await response.json());
    // Metadata is a collection hint, not proof that each returned point belongs to this run.
    // Wait out the official ten-minute replication window; never skip recent-past data.
    if (meta.last_run_availability_time * 1000 > now.getTime() - 600_000
      || meta.last_run_initialisation_time > meta.last_run_modification_time
      || meta.last_run_availability_time * 1000 < now.getTime() - 48 * 3_600_000) return undefined;
    return `metadata:${meta.last_run_initialisation_time}:${meta.last_run_modification_time}:${meta.last_run_availability_time}`;
  } catch { return undefined; }
}
