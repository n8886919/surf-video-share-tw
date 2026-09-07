import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/worker/api";
import { cleanupJourneys, recordJourney } from "../src/worker/journey-diagnostics";
import { recordOpsEvent, recordOpsRecovery, runHourlyOpsAnalysis } from "../src/worker/ops-observability";
import { forecastFixture } from "./helpers/forecast-fixture";

const fixtures: ReturnType<typeof forecastFixture>[] = [];
function fixture() { const f=forecastFixture(); fixtures.push(f); return f; }
afterEach(() => { for(const f of fixtures.splice(0)) f.sqlite.close(); vi.restoreAllMocks(); });
describe('bounded journey diagnostics', () => {
  it('preserves Taipei daily aggregates after seven-day detail cleanup without double counting a cleanup', async () => {
    const f=fixture(); const trace=crypto.randomUUID();
    await recordJourney(f.env,'search',trace,{outcome:'no_videos',resultCount:0},'server',new Date('2026-09-07T18:00:00Z'));
    expect(f.sqlite.prepare('SELECT day,count FROM journey_daily').get()).toMatchObject({day:'2026-09-08',count:1});
    await cleanupJourneys(f.env,new Date('2026-09-16T00:00:00Z'));
    await cleanupJourneys(f.env,new Date('2026-09-16T00:00:00Z'));
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM journey_events').get()?.count).toBe(0);
    expect(f.sqlite.prepare('SELECT count FROM journey_daily').get()?.count).toBe(1);
  });
  it('caps each source at 2000 stored events per day and keeps the last accepted detail and aggregate atomic', async () => {
    const f=fixture();
    f.sqlite.exec("INSERT INTO journey_daily VALUES('2026-09-08','client','upload_step','started',1999)");
    await recordJourney(f.env,'upload_failed',crypto.randomUUID(),{outcome:'failed'},'client',new Date('2026-09-08T00:00:00Z'));
    await recordJourney(f.env,'upload_failed',crypto.randomUUID(),{outcome:'failed'},'client',new Date('2026-09-08T00:01:00Z'));
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM journey_events').get()?.count).toBe(1);
    expect(f.sqlite.prepare('SELECT SUM(count) AS count FROM journey_daily').get()?.count).toBe(2000);
    f.failNext('INSERT INTO journey_daily');
    await recordJourney(f.env,'search',crypto.randomUUID(),{outcome:'no_videos'},'server',new Date('2026-09-08T00:00:00Z'));
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM journey_events').get()?.count).toBe(1);
  });
  it('rejects extra fields and cross-origin telemetry, limits input before storage, and never retains raw UA/IP', async () => {
    const f=fixture(); f.env.APP_ENV='production'; f.env.SESSION_SECRET='test-secret';
    const limit=vi.fn().mockResolvedValue({success:true}); f.env.PUBLIC_WRITE_RATE_LIMITER={limit} as unknown as RateLimit;
    const event={traceId:crypto.randomUUID(),event:'upload_failed',details:{stage:'transfer',outcome:'failed',durationMs:123,version:'0.29'}};
    async function post(body:unknown,origin='https://example.com') {return api.fetch(new Request('https://example.com/api/v1/diagnostics',{
      method:'POST',headers:{origin,'content-type':'application/json','cf-connecting-ip':'203.0.113.8','user-agent':'private-agent Android Chrome'},body:JSON.stringify(body),
    }),f.env);}
    expect((await post({...event,secret:'never-store'})).status).toBe(400);
    expect((await post(event,'https://evil.example')).status).toBe(403);
    expect((await post({large:'x'.repeat(3000)})).status).toBe(413);
    expect((await post(event)).status).toBe(204);
    const text=JSON.stringify(f.sqlite.prepare('SELECT * FROM journey_events').all());
    expect(text).toContain('android'); expect(text).not.toContain('private-agent'); expect(text).not.toContain('203.0.113.8'); expect(text).not.toContain('never-store');
    limit.mockResolvedValue({success:false}); await post(event);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM journey_events').get()?.count).toBe(1);
  });
  it('emits useful console evidence even when D1 is unavailable; silence does not close incidents', async () => {
    const f=fixture(); const warn=vi.spyOn(console,'warn').mockImplementation(()=>undefined);
    f.failNext('INSERT INTO ops_events');
    await recordOpsEvent(f.env,{code:'test.failure',severity:'error',source:'api',requestId:'request-1',route:'/matches'});
    expect(warn.mock.calls.map(call=>call[0]).join('\n')).toContain('request-1');
    f.sqlite.exec(`INSERT INTO ops_incidents(fingerprint,status,severity,title,first_seen_at,last_seen_at,updated_at)
      VALUES('test','open','error','test','2026-09-07','2026-09-07','2026-09-07')`);
    f.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN=undefined;
    await runHourlyOpsAnalysis(f.env,new Date('2026-09-08T00:05:00Z'));
    expect(f.sqlite.prepare('SELECT status FROM ops_incidents').get()?.status).toBe('open');
    await recordOpsRecovery(f.env,'different'); expect(f.sqlite.prepare('SELECT status FROM ops_incidents').get()?.status).toBe('open');
    await recordOpsRecovery(f.env,'test'); expect(f.sqlite.prepare('SELECT status FROM ops_incidents').get()?.status).toBe('recovered');
  });
});
