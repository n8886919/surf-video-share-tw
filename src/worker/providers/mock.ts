import {
  CONDITION_SCHEMA_VERSION,
  type MarineConditions,
} from "../../../packages/domain/src";
import type {
  ConditionsQuery,
  MarineConditionsProvider,
  TideProvider,
  UploadTicket,
  VideoProvider,
  VideoStatus,
} from "./types";

export class MockVideoProvider implements VideoProvider {
  async createDirectUpload(): Promise<UploadTicket> {
    return {
      provider: "mock",
      providerVideoId: `mock_${crypto.randomUUID()}`,
      uploadUrl: null,
      uploadMethod: "mock",
    };
  }

  async getStatus(): Promise<VideoStatus> {
    return { state: "ready", durationSeconds: null };
  }

  async deleteVideo(): Promise<void> {}
}

export class MockMarineConditionsProvider implements MarineConditionsProvider {
  async getConditions(input: ConditionsQuery): Promise<MarineConditions> {
    const retrievedAt = new Date().toISOString();
    return {
      waveHeight: 1.1,
      waveDirection: 72,
      wavePeriod: 8.4,
      swellHeight: 0.9,
      swellDirection: 68,
      swellPeriod: 9.1,
      secondarySwellHeight: 0.3,
      secondarySwellDirection: 118,
      secondarySwellPeriod: 5.5,
      windWaveHeight: 0.4,
      windWaveDirection: 48,
      windWavePeriod: 4.2,
      windSpeed: 3.8,
      windDirection: 45,
      windGust: 5.2,
      tideHeight: 0.72,
      tideSlope: 0.11,
      tideState: "rising",
      validTime: input.validTime,
      provider: "mock",
      model: "fixed-development-sample",
      modelRunTime: null,
      retrievedAt,
      schemaVersion: CONDITION_SCHEMA_VERSION,
    };
  }

  async getForecast(input: ConditionsQuery): Promise<MarineConditions[]> {
    return [await this.getConditions(input)];
  }
}

export class MockTideProvider implements TideProvider {
  async getTide(): Promise<Pick<MarineConditions, "tideHeight" | "tideState">> {
    return { tideHeight: 0.72, tideState: "rising" };
  }
}
