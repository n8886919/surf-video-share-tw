import { afterEach, describe, expect, it, vi } from "vitest";
import { readMfwamVersion } from "../src/worker/forecast/model-update";
import { isFarForecastSlot, mfwamForecastHours } from "../src/worker/forecast/schedule";
import { parseOpenMeteoMarineModel } from "../src/worker/forecast/open-meteo";
import { insertForecastSnapshots } from "../src/worker/forecast/store";
import { api } from "../src/worker/api";
import { forecastFixture } from "./helpers/forecast-fixture";
import type { AppEnv } from "../src/worker/db";
const fixtures: ReturnType<typeof forecastFixture>[]=[];
afterEach(()=>{for(const f of fixtures.splice(0))f.sqlite.close();vi.useRealTimers();});
const spot={id:'spot_double-lions',slug:'double-lions',latitude:24.9,longitude:121.9};
const payload={latitude:24.9,longitude:121.9,hourly:{time:['2026-09-08T03:00','2026-09-08T04:00'],wave_height:[1,2],wave_direction:[90,90],wave_period:[8,9]}};
describe('forecast collection policy',()=>{
  it('covers tomorrow and five Taipei dates including midnight rollover, with two far slots',()=>{
    const times=[0,6,12,18].map(hour=>new Date(`2026-09-08T${String(hour).padStart(2,'0')}:20:00Z`));
    expect(times.map(isFarForecastSlot)).toEqual([true,false,true,false]);
    expect(times.map(time=>mfwamForecastHours(time))).toEqual([126,34,126,46]);
    for(const time of times){const last=new Date(Math.floor(time.getTime()/3_600_000)*3_600_000+(mfwamForecastHours(time)-1)*3_600_000);
      expect(last.getTime()).toBeGreaterThan(time.getTime()+24*3_600_000);}
  });
  it('uses only validated stable metadata and falls back while replicas catch up or metadata fails',async()=>{
    const now=new Date('2026-09-08T04:20:00Z');
    const stamp=now.getTime()/1000;
    const meta={last_run_initialisation_time:stamp-12*3600,last_run_modification_time:stamp-1200,last_run_availability_time:stamp-600,update_interval_seconds:43200};
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json(meta));
    expect(await readMfwamVersion(now,fetcher)).toMatch(/^metadata:/);
    fetcher.mockResolvedValue(Response.json({...meta,last_run_availability_time:stamp-599}));
    expect(await readMfwamVersion(now,fetcher)).toBeUndefined();
    fetcher.mockRejectedValue(new Error('offline'));
    expect(await readMfwamVersion(now,fetcher)).toBeUndefined();
  });
  it('does not rewrite unchanged overlapping points but preserves new versions, changed metrics and recent-past labels',async()=>{
    const options={sourceVersion:'metadata:one',forecastHours:126};
    const first=await parseOpenMeteoMarineModel(payload,spot,'2026-09-08T02:20:00Z','meteofrance_wave',options);
    const shifted={...payload,hourly:{time:['2026-09-08T04:00'],wave_height:[2],wave_direction:[90],wave_period:[9]}};
    const overlap=await parseOpenMeteoMarineModel(shifted,spot,'2026-09-08T03:20:00Z','meteofrance_wave',options);
    expect(overlap[0].id).toBe(first[1].id);
    const past=await parseOpenMeteoMarineModel(shifted,spot,'2026-09-08T04:20:00Z','meteofrance_wave',options);
    expect(past[0].id).not.toBe(overlap[0].id);expect(past[0].snapshotKind).toBe('historical_forecast');
    const newRun=await parseOpenMeteoMarineModel(shifted,spot,'2026-09-08T03:20:00Z','meteofrance_wave',{...options,sourceVersion:'metadata:two'});
    expect(newRun[0].id).not.toBe(overlap[0].id);expect(newRun[0].modelRunAt).toBeNull();
    const f=forecastFixture();fixtures.push(f);
    expect(await insertForecastSnapshots(f.db,first,true)).toMatchObject({inserted:2});
    const count=f.queries.length;
    expect(await insertForecastSnapshots(f.db,overlap,true)).toMatchObject({inserted:0,duplicates:1});
    expect(f.queries.slice(count).every(sql=>sql.startsWith('SELECT'))).toBe(true);
    expect(f.sqlite.prepare('SELECT retrieved_at FROM forecast_snapshots WHERE id=?').get(overlap[0].id)?.retrieved_at).toBe('2026-09-08T02:20:00.000Z');
  });
  it('freshness uses selected target rows without reading videos or recording search events',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-08T02:20:00Z'));
    const f=forecastFixture();fixtures.push(f);
    await insertForecastSnapshots(f.db,await parseOpenMeteoMarineModel(payload,spot,'2026-09-08T02:00:00Z','meteofrance_wave'));
    const before=f.queries.length;
    const response=await api.fetch(new Request('https://example.com/api/v1/forecast-freshness?spotId=spot_double-lions&targetTime=2026-09-08T04:00:00Z'),{...f.env,APP_ENV:'production'} as AppEnv);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({sources:[{name:'CWA',retrievedAt:null,stale:true},{name:'MFWAM',retrievedAt:'2026-09-08T02:00:00.000Z',stale:false}]});
    expect(f.queries.slice(before).some(sql=>/videos|journey_events|INSERT/i.test(sql))).toBe(false);
  });
});
