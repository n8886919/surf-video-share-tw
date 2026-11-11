import { afterEach, describe, expect, it } from "vitest";
import { cleanupForecastHistory, FORECAST_HISTORY_DELETE_SQL, protectedForecast } from "../src/worker/forecast/retention";
import { forecastFixture } from "./helpers/forecast-fixture";

const now = new Date("2026-09-08T08:05:00.000Z");
const fixtures: ReturnType<typeof forecastFixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.sqlite.close(); });
function fixture() { const f = forecastFixture(); fixtures.push(f); return f; }

describe("bounded forecast retention", () => {
  it("keeps capture neighbours and malformed dates, but releases the retired capture-edit window", () => {
    const row = { rowid: 1, id: "f", spot_id: "spot", valid_at: "2026-08-20T04:00:00.000Z" };
    const video = { spot_id: "spot", captured_at: "2026-08-20T08:00:00.000Z", created_at: "2026-08-21T08:00:00.000Z" };
    expect(protectedForecast(row, [video], now)).toBe(true);
    expect(protectedForecast({ ...row, valid_at: "2026-08-14T04:00:00.000Z" }, [video], now)).toBe(false);
    expect(protectedForecast({ ...row, valid_at: "2026-08-20T12:00:00.000Z" }, [video], now)).toBe(true);
    expect(protectedForecast({ ...row, valid_at: "2026-08-20T12:00:00.002Z" }, [video], now)).toBe(false);
    expect(protectedForecast({ ...row, spot_id: "other" }, [video], now)).toBe(false);
    expect(protectedForecast({ ...row, valid_at: new Date(now.getTime() - 8 * 86_400_000).toISOString() }, [], now)).toBe(true);
    expect(protectedForecast({ ...row, valid_at: "invalid" }, [], now)).toBe(true);
  });

  it("dry-runs without mutations, deletes a bounded JSON batch, preserves delisted/private video history and claims each hour once", async () => {
    const f = fixture();
    f.sqlite.exec(`INSERT INTO users(id,line_subject,created_at,updated_at) VALUES ('u','s','2026-08-20','2026-08-20');
      INSERT INTO videos(id,user_id,spot_id,video_provider,provider_video_id,status,metadata_status,moderation_status,captured_at,created_at,updated_at,show_uploader)
      VALUES ('v','u','spot_double-lions','mock','m','ready','complete','delisted','2026-08-20T08:00:00.000Z','2026-08-20T08:00:00.000Z','2026-08-20',0);`);
    const insert = f.sqlite.prepare(`INSERT INTO forecast_snapshots(id,spot_id,provider,model,issued_at,valid_at,retrieved_at,schema_version,created_at)
      VALUES(?,?,'open-meteo','meteofrance_wave','2026-08-18',?,'2026-08-18',2,'2026-08-18')`);
    insert.run('keep','spot_double-lions','2026-08-20T08:00:00.000Z');
    for(let i=0;i<2105;i++) insert.run('delete-'+i,'spot_wushi-harbor-north',new Date(Date.parse('2026-08-20T08:00:00Z')+i*1000).toISOString());
    expect(await cleanupForecastHistory(f.db, now, true)).toMatchObject({ status: 'dry_run', eligible: 2000, deleted: 0 });
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM forecast_retention_state').get()?.n).toBe(0);
    expect(await cleanupForecastHistory(f.db, now)).toMatchObject({ deleted: 2000, capped: true });
    expect(f.sqlite.prepare("SELECT id FROM forecast_snapshots WHERE id='keep'").get()).toBeTruthy();
    expect(await cleanupForecastHistory(f.db, now)).toMatchObject({ status: 'already_claimed' });
    const later=new Date(now.getTime()+3_600_000);
    expect(await cleanupForecastHistory(f.db,later)).toMatchObject({deleted:105});
    f.sqlite.exec('UPDATE forecast_retention_state SET writes=25000');
    expect(await cleanupForecastHistory(f.db,new Date(later.getTime()+3_600_000))).toMatchObject({status:'budget_paused'});
    const plan=f.sqlite.prepare('EXPLAIN QUERY PLAN SELECT rowid,id,spot_id,valid_at FROM forecast_snapshots WHERE rowid > ? ORDER BY rowid LIMIT ?').all(0,2000);
    expect(JSON.stringify(plan)).toContain('INTEGER PRIMARY KEY');
  });

  it("sizes the final batch to the remaining indexed-write allowance", async () => {
    const f = fixture();
    f.sqlite.exec(`INSERT INTO forecast_retention_state
      (id,cursor,budget_day,writes,lease_token,lease_until,last_hour)
      VALUES ('history',0,'2026-09-08',23500,'old','2026-09-08T07:00:00.000Z','2026-09-08T07')`);
    const insert = f.sqlite.prepare(`INSERT INTO forecast_snapshots
      (id,spot_id,provider,model,issued_at,valid_at,retrieved_at,schema_version,created_at)
      VALUES (?,'spot_double-lions','open-meteo','meteofrance_wave','2026-08-18',?,'2026-08-18',2,'2026-08-18')`);
    for (let i=0;i<100;i++) insert.run('old-'+i,new Date(Date.parse('2026-08-20T08:00:00Z')+i*1000).toISOString());
    expect(await cleanupForecastHistory(f.db,now)).toMatchObject({deleted:49,capped:true});
    expect(f.sqlite.prepare("SELECT writes FROM forecast_retention_state WHERE id='history'").get()?.writes).toBe(23994);
    expect(await cleanupForecastHistory(f.db,new Date(now.getTime()+3_600_000)))
      .toMatchObject({status:'budget_paused',deleted:0});
  });

  it("keeps every model for fixed captures while deleting only the obsolete wider window", async () => {
    const f = fixture();
    f.sqlite.exec(`INSERT INTO users(id,line_subject,created_at,updated_at) VALUES ('u','s','2026-08-20','2026-08-20');
      INSERT INTO videos(id,user_id,spot_id,video_provider,provider_video_id,status,metadata_status,moderation_status,captured_at,created_at,updated_at,show_uploader)
      VALUES ('v','u','spot_double-lions','mock','m','ready','complete','delisted','2026-08-20T08:00:00.000Z','2026-08-21T08:00:00.000Z','2026-08-21',0)`);
    const insert = f.sqlite.prepare(`INSERT INTO forecast_snapshots
      (id,spot_id,provider,model,issued_at,valid_at,retrieved_at,schema_version,created_at)
      VALUES (?,'spot_double-lions',?,?,'2026-08-18',?,'2026-08-18',2,'2026-08-18')`);
    for (const [provider,model] of [['cwa','cwa-wave-f-a0020-001'],['open-meteo','meteofrance_wave'],
      ['open-meteo','ecmwf_wam'],['open-meteo','ncep_gfswave016'],['open-meteo','dwd_gwam']]) {
      insert.run('keep-'+model,provider,model,'2026-08-20T04:00:00.000Z');
      insert.run('obsolete-'+model,provider,model,'2026-08-14T04:00:00.000Z');
    }
    const before=f.sqlite.prepare("SELECT * FROM forecast_snapshots WHERE id LIKE 'keep-%' ORDER BY id").all();
    expect(await cleanupForecastHistory(f.db,now)).toMatchObject({deleted:5});
    expect(f.sqlite.prepare('SELECT * FROM forecast_snapshots ORDER BY id').all()).toEqual(before);
    const plan=f.sqlite.prepare('EXPLAIN QUERY PLAN '+FORECAST_HISTORY_DELETE_SQL)
      .all(JSON.stringify(['missing']),now.toISOString());
    expect(JSON.stringify(plan)).toContain('videos_spot_captured_at_idx');
  });

  it("keeps unknown captures and creation dates conservative and does not use creation time as a substitute", () => {
    const row={rowid:1,id:'old',spot_id:'spot',valid_at:'2026-08-20T04:00:00.000Z'};
    const video={spot_id:'spot',captured_at:null,created_at:'2026-08-21T08:00:00.000Z'};
    expect(protectedForecast(row,[video],now)).toBe(true);
    expect(protectedForecast(row,[{...video,captured_at:'invalid'}],now)).toBe(true);
    expect(protectedForecast(row,[{...video,created_at:'invalid',spot_id:'other'}],now)).toBe(true);
    expect(protectedForecast({...row,spot_id:'other'},[video],now)).toBe(false);
  });

  it("rechecks video protection when an upload arrives after candidate selection", async () => {
    const f = fixture();
    f.sqlite.exec(`INSERT INTO users(id,line_subject,created_at,updated_at) VALUES ('u','s','2026-08-20','2026-08-20');
      INSERT INTO forecast_snapshots
      (id,spot_id,provider,model,issued_at,valid_at,retrieved_at,schema_version,created_at)
      VALUES ('newly-protected','spot_double-lions','open-meteo','meteofrance_wave','2026-08-18','2026-08-20T08:00:00.000Z','2026-08-18',2,'2026-08-18')`);
    const prepare = f.db.prepare.bind(f.db);
    f.db.prepare = (sql: string) => {
      if (sql.startsWith('DELETE FROM forecast_snapshots')) {
        f.sqlite.exec(`INSERT INTO videos
          (id,user_id,spot_id,video_provider,provider_video_id,status,metadata_status,moderation_status,captured_at,created_at,updated_at,show_uploader)
          VALUES ('v','u','spot_double-lions','mock','m','ready','complete','visible','2026-08-20T08:00:00.000Z','2026-08-20T08:00:00.000Z','2026-08-20',0)`);
      }
      return prepare(sql);
    };
    expect(await cleanupForecastHistory(f.db,now)).toMatchObject({eligible:1,deleted:0});
    expect(f.sqlite.prepare("SELECT id FROM forecast_snapshots WHERE id='newly-protected'").get()).toBeTruthy();
  });
});
