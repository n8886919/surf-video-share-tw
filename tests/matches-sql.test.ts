import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicMatchesResponse } from "../packages/api-contract/src";
import { FORECAST_SOURCES } from "../packages/domain/src/forecast-sources";
import { api } from "../src/worker/api";
import type { AppEnv } from "../src/worker/db";

const spotId = "spot_wushi-harbor-north";
const now = "2026-09-05T00:00:00.000Z";
const dayMs = 86_400_000;

function createFixture(targetTime: string) {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = new URL("../drizzle/", import.meta.url);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  sqlite.prepare(`INSERT INTO users (id, line_subject, created_at, updated_at)
    VALUES ('fixture_owner', 'fixture_private_subject', ?, ?)`).run(now, now);

  const insertVideo = sqlite.prepare(`INSERT INTO videos (
    id, user_id, spot_id, video_provider, provider_video_id, captured_at,
    status, show_uploader, metadata_status, public_at, terms_version, created_at, updated_at
  ) VALUES (?, 'fixture_owner', ?, 'mock', ?, ?, 'ready', 0, 'complete', ?, 'cc0-fixture', ?, ?)`);
  const insertForecast = sqlite.prepare(`INSERT INTO forecast_snapshots (
    id, spot_id, provider, model, snapshot_kind, issued_at, valid_at,
    wave_height, wave_period, wave_direction, tide_height, retrieved_at, schema_version, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 8, 90, ?, ?, 1, ?)`);

  for (let i = 0; i < 25; i++) {
    const capturedAt = new Date(Date.parse(now) - (i + 1) * dayMs).toISOString();
    insertVideo.run(`video_${i}`, spotId, `stream_${i}`, capturedAt, capturedAt, now, now);
    for (const source of FORECAST_SOURCES) {
      insertForecast.run(
        `${source.model}_${i}`, spotId, source.provider, source.model, "forecast",
        capturedAt, capturedAt, i === 24 ? 1 : 3, i === 24 ? 0.5 : 2, now, now,
      );
    }
  }
  for (const source of FORECAST_SOURCES) {
    insertForecast.run(
      `${source.model}_target`, spotId, source.provider, source.model, "forecast",
      now, targetTime, 1, 0.5, now, now,
    );
  }

  // All lifecycle exclusions must still apply after removing the candidate cap.
  for (const [id, patch] of [
    ["pending", "metadata_status = 'pending'"],
    ["processing", "status = 'processing'"],
    ["private", "public_at = NULL"],
    ["unversioned", "terms_version = NULL"],
    ["delisted", "moderation_status = 'delisted'"],
    ["other_spot", "spot_id = 'spot_double-lions'"],
  ]) {
    insertVideo.run(id, spotId, `stream_${id}`, now, now, now, now);
    sqlite.exec(`UPDATE videos SET ${patch} WHERE id = '${id}'`);
  }

  return sqlite;
}

describe("matching SQL with the migrated SQLite schema", () => {
  afterEach(() => vi.useRealTimers());

  it.each([0, 3])("ranks all 25 videos and excludes collect-only history at day offset %i", async (offset) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const targetTime = new Date(Date.parse(now) + offset * dayMs + 3 * 3_600_000).toISOString();
    const sqlite = createFixture(targetTime);
    let history: Record<string, unknown>[] = [];
    let historyPlan = "";
    let targetPlan = "";
    const publicPlans: string[] = [];
    const db = {
      prepare(sql: string) {
        let params: SQLInputValue[] = [];
        const statement = {
          bind(...values: SQLInputValue[]) { params = values; return statement; },
          async first() { return sqlite.prepare(sql).get(...params) ?? null; },
          async all() {
            expect(sql).not.toContain("video_playback_events");
            const results = sqlite.prepare(sql).all(...params);
            if (sql.includes("AS source_rank")) {
              targetPlan = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params)
                .map((row) => row.detail).join("\n");
            }
            if (sql.includes("FROM videos v")) {
              publicPlans.push(sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params)
                .map((row) => row.detail).join("\n"));
            }
            if (sql.includes("WITH candidate_videos")) {
              history = results;
              historyPlan = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params)
                .map((row) => row.detail).join("\n");
            }
            return { results };
          },
        };
        return statement;
      },
    } as unknown as D1Database;

    try {
      const response = await api.fetch(
        new Request(`https://example.com/api/v1/matches?spotId=${spotId}&targetTime=${targetTime}`),
        { APP_ENV: "production", DB: db } as AppEnv,
      );
      const body = await response.json() as PublicMatchesResponse;
      expect(response.status).toBe(200);
      expect(body.observations).toHaveLength(25);
      expect(body.observations.every((item) => item.playbackCount90d === undefined)).toBe(true);
      expect(publicPlans).toHaveLength(2);
      expect(publicPlans.join("\n")).not.toMatch(/playback|CORRELATED SCALAR SUBQUERY/);
      expect(body.observations[0].id).toBe("video_0");
      expect(body.observations.at(-1)?.id).toBe("video_24");
      expect(body.matches).toHaveLength(25);
      expect(body.matches[0].observation.id).toBe("video_24");
      expect(body.matches[0].score).toBe(1);
      expect(body.matches[0].sources).toHaveLength(offset === 0 ? 2 : 1);
      expect(history).toHaveLength(50);
      expect(new Set(history.map((row) => `${row.provider}/${row.model}`))).toEqual(new Set([
        "cwa/cwa-wave-f-a0020-001", "open-meteo/meteofrance_wave",
      ]));
      // The database bounds valid time before ranking, not after a source-wide scan.
      expect(historyPlan).toContain("forecast_source_valid_second_idx (spot_id=? AND provider=? AND model=? AND <expr>>? AND <expr><?)");
      expect(targetPlan).toContain("forecast_spot_valid_second_idx (spot_id=? AND <expr>>? AND <expr><?)");
      expect(publicPlans[1]).toContain("videos_visible_spot_capture_jd_idx (spot_id=? AND <expr>>? AND <expr><?)");
      // Public target context and stored/owner model availability remain unchanged.
      expect(body.forecasts).toHaveLength(5);
      expect(sqlite.prepare("SELECT COUNT(*) AS count FROM forecast_snapshots").get()?.count).toBe(130);
      expect(JSON.stringify(body)).not.toContain("fixture_private_subject");
    } finally {
      sqlite.close();
    }
  });
  it("preserves legacy selection with fractional/offset times and competing immutable runs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const targetTime = "2026-09-05T03:00:00.000Z";
    const sqlite = createFixture(targetTime);
    const comparisons: Array<{ actual: Record<string, unknown>[]; legacy: Record<string, unknown>[] }> = [];
    try {
      // Many out-of-window rows plus multiple runs near each capture/target.
      // IDs, source preference, issued-at precedence and distance tie-breaks stay unchanged.
      sqlite.exec("BEGIN");
      const addForecast = sqlite.prepare(`INSERT INTO forecast_snapshots (
        id, spot_id, provider, model, snapshot_kind, issued_at, valid_at,
        wave_height, wave_period, wave_direction, tide_height, retrieved_at, schema_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 8, 90, 0.5, ?, 1, ?)`);
      const deltas = [-14_401_000, -14_400_001, -14_400_000, -1, 0, 999, 14_400_000, 14_400_999, 14_401_000];
      for (const source of FORECAST_SOURCES) {
        for (let video = 0; video < 25; video++) {
          const capture = Date.parse(now) - (video + 1) * dayMs + 321;
          sqlite.prepare("UPDATE videos SET captured_at = ? WHERE id = ?")
            .run(new Date(capture).toISOString(), `video_${video}`);
          for (const [index, delta] of deltas.entries()) {
            const instant = new Date(capture + delta);
            const valid = index % 2 === 0 ? instant.toISOString()
              : new Date(instant.getTime() + 8 * 3_600_000).toISOString().replace("Z", "+08:00");
            addForecast.run(`${source.model}_${video}_edge_${index}`, spotId, source.provider, source.model,
              index % 3 === 0 ? "historical_forecast" : "forecast",
              new Date(capture + (index - 4) * 100).toISOString(), valid, now, now);
          }
        }
        for (const [index, delta] of deltas.entries()) {
          addForecast.run(`${source.model}_target_edge_${index}`, spotId, source.provider, source.model,
            index === 4 ? "historical_forecast" : "forecast",
            new Date(Date.parse(now) + (index - 4) * 1_000 - 1).toISOString(),
            new Date(Date.parse(targetTime) + delta).toISOString(), now, now);
        }
      }
      // The rolling window preserves Julian-day precision and ISO-offset support.
      for (const [index, delta] of [-7_200_001, -7_200_000, -7_199_999, -1, 0, 1].entries()) {
        const instant = new Date(Date.parse(now) + delta);
        const captured = index % 2 ? instant.toISOString()
          : new Date(instant.getTime() + 8 * 3_600_000).toISOString().replace("Z", "+08:00");
        sqlite.prepare(`INSERT INTO videos (id, user_id, spot_id, video_provider, provider_video_id,
          captured_at, status, show_uploader, metadata_status, public_at, terms_version, created_at, updated_at)
          VALUES (?, 'fixture_owner', ?, 'mock', ?, ?, 'ready', 0, 'complete', ?, 'cc0-fixture', ?, ?)`)
          .run(`recent_${index}`, spotId, `recent_stream_${index}`, captured, now, now, now);
      }
      sqlite.exec("COMMIT");
      const db = {
        prepare(sql: string) {
          let params: SQLInputValue[] = [];
          const statement = {
            bind(...values: SQLInputValue[]) { params = values; return statement; },
            async first() { return sqlite.prepare(sql).get(...params) ?? null; },
            async all() {
              const actual = sqlite.prepare(sql).all(...params);
              const legacySql = sql.replace(
                /CAST\(strftime\('%s', (?:fs\.)?valid_at\) AS INTEGER\)\s+BETWEEN CAST\(strftime\('%s', ([^)]+)\) AS INTEGER\) - 14400\s+AND CAST\(strftime\('%s', \1\) AS INTEGER\) \+ 14400/g,
                "ABS(strftime('%s', fs.valid_at) - strftime('%s', $1)) <= 14400",
              );
              if (legacySql !== sql) {
                const legacyParams = sql.includes("AS source_rank") ? params.slice(0, -1) : params;
                comparisons.push({ actual, legacy: sqlite.prepare(legacySql).all(...legacyParams) });
              }
              return { results: actual };
            },
          };
          return statement;
        },
      } as unknown as D1Database;
      const response = await api.fetch(
        new Request(`https://example.com/api/v1/matches?spotId=${spotId}&targetTime=${targetTime}`),
        { APP_ENV: "production", DB: db } as AppEnv,
      );
      expect(response.status).toBe(200);
      const body = await response.json() as PublicMatchesResponse;
      expect(comparisons).toHaveLength(2);
      const ordered = (rows: Record<string, unknown>[]) => rows.map((row) => JSON.stringify(row)).sort();
      for (const { actual, legacy } of comparisons) expect(ordered(actual)).toEqual(ordered(legacy));
      expect(body.timeWindowObservations.map((item) => item.id)).toEqual(["recent_4", "recent_3", "recent_2", "recent_1"]);
      // Prove the inclusive integer-second bounds, not a newly introduced millisecond rule.
      const edgeRows = sqlite.prepare(`SELECT id FROM forecast_snapshots
        WHERE spot_id = ? AND provider = 'cwa' AND model = 'cwa-wave-f-a0020-001'
          AND CAST(strftime('%s', valid_at) AS INTEGER)
            BETWEEN CAST(strftime('%s', ?) AS INTEGER) - 14400
                AND CAST(strftime('%s', ?) AS INTEGER) + 14400
          AND id LIKE '%target_edge_%' ORDER BY id`).all(spotId, targetTime, targetTime);
      expect(edgeRows.map((row) => row.id)).toEqual([2, 3, 4, 5, 6, 7].map((i) => `cwa-wave-f-a0020-001_target_edge_${i}`));
    } finally {
      sqlite.close();
    }
  });
});
