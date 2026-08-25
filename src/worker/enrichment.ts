import { insertConditionSnapshot, type AppEnv } from "./db";
import { createConditionsProvider } from "./providers";

export async function attachConditionsBestEffort(
  env: AppEnv,
  input: { latitude: number; longitude: number; validTime: string; videoId: string },
  onError: (message: string, error: unknown) => void = (message, error) => console.warn(message, error),
): Promise<string | null> {
  try {
    const conditionsProvider = createConditionsProvider(env);
    const conditions = await conditionsProvider.getConditions({
      latitude: input.latitude,
      longitude: input.longitude,
      validTime: input.validTime,
    });
    const snapshotId = crypto.randomUUID();
    await insertConditionSnapshot(env.DB, snapshotId, conditions);
    return snapshotId;
  } catch (error) {
    onError(`Condition enrichment skipped for ${input.videoId}`, error);
    return null;
  }
}
