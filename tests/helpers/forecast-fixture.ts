import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { AppEnv } from "../../src/worker/db";

export function forecastFixture() {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = new URL("../../drizzle/", import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  const queries: string[] = [];
  let failure: string | null = null;
  function prepare(sql: string) {
    let values: SQLInputValue[] = [];
    function execute() {
      queries.push(sql);
      if (failure && sql.includes(failure)) { failure = null; throw new Error("Simulated D1 write failure"); }
      return sqlite.prepare(sql);
    }
    const statement = {
      bind(...bindings: SQLInputValue[]) { values = bindings; return statement; },
      async first() { return execute().get(...values) ?? null; },
      async all() { return { results: execute().all(...values), success: true }; },
      execute() { return { meta: execute().run(...values), success: true }; },
      async run() { return statement.execute(); },
    };
    return statement;
  }
  const db = { prepare, async batch(statements: Array<ReturnType<typeof prepare>>) {
    sqlite.exec("BEGIN");
    try {
      const results = statements.map(statement => statement.execute());
      sqlite.exec("COMMIT");
      return results;
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } } as unknown as D1Database;
  const env = {
    DB: db, FORECAST_INGESTION_SECRET: "forecast-ingestion-test-secret-32-bytes",
    LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: "fixture-token", OPS_LINE_USER_ID: `U${"a".repeat(32)}`,
  } as AppEnv;
  function seedCwaRun(run = "2026-08-30T00:00:00.000Z") {
    const spots = sqlite.prepare("SELECT id FROM spots WHERE active = 1").all();
    const insert = sqlite.prepare(`INSERT INTO forecast_snapshots
      (id, spot_id, provider, model, issued_at, model_run_at, valid_at, lead_hours,
       retrieved_at, schema_version, created_at)
      VALUES (?, ?, 'cwa', 'cwa-wave-f-a0020-001', ?, ?, ?, ?, ?, 1, ?)`);
    for (const spot of spots) for (let lead = 0; lead <= 72; lead += 3) {
      insert.run(`${spot.id}:${run}:${lead}`, String(spot.id), run, run,
        new Date(Date.parse(run) + lead * 3_600_000).toISOString(), lead, run, run);
    }
  }
  return { sqlite, db, env, queries, seedCwaRun, failNext(sql: string) { failure = sql; } };
}
