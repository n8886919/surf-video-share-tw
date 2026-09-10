import { forecastCollectionStatusSchema, type ForecastCollectionStatus } from "../../../packages/api-contract/src";
import { latestDueMfwamSlot } from "./schedule";
import { readCompletedForecastSlots } from "./update-runs";

export async function readForecastCollectionStatus(db: D1Database, now: Date): Promise<ForecastCollectionStatus> {
  const slots = await Promise.all(([false, true] as const).map(async far => {
    const slotAt = latestDueMfwamSlot(now, far);
    const completed = await readCompletedForecastSlots(db, far ? "mfwam_far" : "mfwam", [slotAt]);
    const value = completed.get(slotAt);
    // A corrupt/future completion must not turn an unconfirmed run green.
    const completedAt = value && Date.parse(value) >= Date.parse(slotAt) && Date.parse(value) <= now.getTime()
      ? value : null;
    return { slotAt, completedAt };
  }));
  return forecastCollectionStatusSchema.parse({ checkedAt: now.toISOString(), near: slots[0], far: slots[1] });
}
