import { afterEach, describe, expect, it } from "vitest";
import { cleanupForecastHistory, protectedForecast } from "../src/worker/forecast/retention";
import { forecastFixture } from "./helpers/forecast-fixture";

const now = new Date("2026-09-08T08:05:00.000Z");
const fixtures: ReturnType<typeof forecastFixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.sqlite.close(); });
function fixture() { const f = forecastFixture(); fixtures.push(f); return f; }

describe("bounded forecast retention", () => {
  it("keeps all providers near a video, its permitted correction window, malformed dates and the eight-day boundary", () => {
    const row = { rowid: 1, id: "f", spot_id: "spot", valid_at: "2026-08-20T04:00:00.000Z" };
    const video = { spot_id: "spot", captured_at: "2026-08-20T08:00:00.000Z", created_at: "2026-08-21T08:00:00.000Z" };
    expect(protectedForecast(row, [video], now)).toBe(true);
    expect(protectedForecast({ ...row, valid_at: "2026-08-14T04:00:00.000Z" }, [video], now)).toBe(true);
    expect(protectedForecast({ ...row, spot_id: "other" }, [video], now)).toBe(false);
    expect(protectedForecast({ ...row, valid_at: new Date(now.getTime() - 8 * 86_400_000).toISOString() }, [], now)).toBe(true);
    expect(protectedForecast({ ...row, valid_at: "invalid" }, [], now)).toBe(true);
  });

  it("dry-runs without mutations, deletes at most 100, preserves delisted/private video history and claims each hour once", async () => {
    const f = fixture();
    f.sqlite.exec(`INSERT INTO users(id,line_subject,created_at,updated_at) VALUES ('u','s','2026-08-20','2026-08-20');
      INSERT INTO videos(id,user_id,spot_id,video_provider,provider_video_id,status,metadata_status,moderation_status,captured_at,created_at,updated_at,show_uploader)
      VALUES ('v','u','spot_double-lions','mock','m','ready','complete','delisted','2026-08-20T08:00:00.000Z','2026-08-20T08:00:00.000Z','2026-08-20',0);`);
    const insert = f.sqlite.prepare(`INSERT INTO forecast_snapshots(id,spot_id,provider,model,issued_at,valid_at,retrieved_at,schema_version,created_at)
      VALUES(?,?,'open-meteo','meteofrance_wave','2026-08-18',?,'2026-08-18',2,'2026-08-18')`);
    insert.run('keep','spot_double-lions','2026-08-20T08:00:00.000Z');
    for(let i=0;i<105;i++) insert.run('delete-'+i,'spot_wushi-harbor-north',new Date(Date.parse('2026-08-20T08:00:00Z')+i*3_600_000).toISOString());
    expect(await cleanupForecastHistory(f.db, now, true)).toMatchObject({ status: 'dry_run', eligible: 99, deleted: 0 });
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM forecast_retention_state').get()?.n).toBe(0);
    expect(await cleanupForecastHistory(f.db, now)).toMatchObject({ deleted: 99, capped: true });
    expect(f.sqlite.prepare("SELECT id FROM forecast_snapshots WHERE id='keep'").get()).toBeTruthy();
    expect(await cleanupForecastHistory(f.db, now)).toMatchObject({ status: 'already_claimed' });
    const later=new Date(now.getTime()+3_600_000);
    expect(await cleanupForecastHistory(f.db,later)).toMatchObject({deleted:6});
    f.sqlite.exec('UPDATE forecast_retention_state SET writes=15000');
    expect(await cleanupForecastHistory(f.db,new Date(later.getTime()+3_600_000))).toMatchObject({status:'budget_paused'});
    const plan=f.sqlite.prepare('EXPLAIN QUERY PLAN SELECT rowid,id,spot_id,valid_at FROM forecast_snapshots WHERE rowid > ? ORDER BY rowid LIMIT ?').all(0,2000);
    expect(JSON.stringify(plan)).toContain('INTEGER PRIMARY KEY');
  });
});
