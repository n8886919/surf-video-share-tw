import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/worker/api";
import { forecastFixture } from "./helpers/forecast-fixture";
import type { AppEnv } from "../src/worker/db";

const fixtures: ReturnType<typeof forecastFixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.sqlite.close(); vi.restoreAllMocks(); });
function fixture() {
  const f = forecastFixture(); fixtures.push(f);
  const env = { ...f.env, APP_ENV: "development", ENABLE_DEV_AUTH: "true", ADMIN_USER_ID: "user_dev_local", VIDEO_PROVIDER: "mock" } as AppEnv;
  f.sqlite.exec(`INSERT INTO users(id,line_subject,created_at,updated_at) VALUES('uploader','private-subject','2026-09-08','2026-09-08');
    INSERT INTO videos(id,user_id,video_provider,provider_video_id,status,metadata_status,spot_id,captured_at,public_at,terms_version,show_uploader,created_at,updated_at)
    VALUES('video_test','uploader','mock','provider-private','ready','complete','spot_double-lions','2026-09-07T05:00:00Z','2026-09-07T05:00:00Z','cc0',0,'2026-09-07','2026-09-07');
    INSERT INTO video_reports(id,video_id,reason,created_at) VALUES('report_test','video_test','minor','2026-09-08T00:00:00Z');
    INSERT INTO video_reports(id,video_id,reason,created_at) VALUES('report_other','video_test','privacy','2026-09-08T01:00:00Z');`);
  const call = (path: string, body?: unknown, headers: Record<string,string> = {}) => api.fetch(new Request('https://example.com/api/v1/admin'+path, {
    ...(body === undefined ? {} : { method: 'POST', headers: { origin: 'https://example.com', 'content-type':'application/json', ...headers }, body:JSON.stringify(body) }),
  }), env);
  return { ...f, env, call };
}
describe('private admin moderation', () => {
  it('requires login; non-admin and spoofed user headers cannot read or mutate any admin surface', async () => {
    const f=fixture(); f.env.ADMIN_USER_ID='different-admin';
    for (const [path,body] of [['/reports',undefined],['/history',undefined],['/diagnostics',undefined],['/videos/video_test/thumbnail',undefined],
      ['/videos/video_test/playback',{}],['/reports/report_test/resolve',{reason:'test'}],['/reports/report_test/delist',{reason:'minor'}],
      ['/videos/video_test/restore',{}],['/problem-reports',undefined],['/problem-reports/x/resolve',{}]] as const) {
      expect((await f.call(path,body,{'x-admin':'true'})).status).toBe(403);
    }
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM moderation_actions').get()?.count).toBe(0);
    f.env.APP_ENV='production'; f.env.LINE_CHANNEL_ID='123'; f.env.LINE_CHANNEL_SECRET='test';
    f.env.LINE_CALLBACK_URL='https://example.com/api/v1/auth/line/callback'; f.env.SESSION_SECRET='test';
    expect((await f.call('/reports')).status).toBe(401);
  });
  it('shows the reported video and closes all its test reports without removing public access', async () => {
    const f=fixture();
    const list=await f.call('/reports'); expect(list.headers.get('cache-control')).toBe('no-store');
    const text=await list.text(); expect(text).toContain('video_test'); expect(text).not.toContain('private-subject'); expect(text).not.toContain('provider-private');
    expect((await f.call('/reports/report_test/resolve',{reason:'test'})).status).toBe(200);
    expect(f.sqlite.prepare("SELECT COUNT(*) AS count FROM video_reports WHERE status='resolved' AND resolution_reason='test'").get()?.count).toBe(2);
    expect(f.sqlite.prepare('SELECT moderation_status, public_at FROM videos WHERE id=?').get('video_test')).toMatchObject({moderation_status:'visible',public_at:'2026-09-07T05:00:00Z'});
    expect(f.sqlite.prepare('SELECT actor_user_id,action,reason FROM moderation_actions').get()).toMatchObject({actor_user_id:'user_dev_local',action:'resolve',reason:'test'});
    expect((await f.call('/reports/report_test/delist',{reason:'minor'})).status).toBe(404);
  });
  it('delists, privately previews and restores with durable history while public playback remains blocked', async () => {
    const f=fixture();
    expect((await f.call('/reports/report_test/delist',{reason:'minor'})).status).toBe(200);
    expect(f.sqlite.prepare('SELECT moderation_status,public_at FROM videos').get()).toMatchObject({moderation_status:'delisted',public_at:null});
    expect((await api.fetch(new Request('https://example.com/api/v1/public-videos/video_test'),f.env)).status).toBe(404);
    const preview=await f.call('/videos/video_test/playback',{}); expect(preview.status).toBe(200); expect(preview.headers.get('cache-control')).toBe('no-store');
    expect((await f.call('/videos/video_test/restore',{})).status).toBe(200);
    expect((await f.call('/videos/video_test/restore',{})).status).toBe(409);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM moderation_actions').get()?.count).toBe(2);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM video_playback_events').get()?.count).toBe(0);
  });
  it('rejects CSRF and inconsistent reasons, and rolls back all mutations if audit persistence fails', async () => {
    const f=fixture();
    expect((await f.call('/reports/report_test/delist',{reason:'minor'},{origin:'https://evil.example'})).status).toBe(403);
    expect((await f.call('/reports/report_test/delist',{reason:'test'})).status).toBe(422);
    f.failNext('INSERT INTO moderation_actions'); vi.spyOn(console,'error').mockImplementation(() => undefined);
    expect((await f.call('/reports/report_test/delist',{reason:'minor'})).status).toBe(500);
    expect(f.sqlite.prepare('SELECT status FROM video_reports WHERE id=?').get('report_test')?.status).toBe('open');
    expect(f.sqlite.prepare('SELECT moderation_status FROM videos').get()?.moderation_status).toBe('visible');
  });
  it('commits only one decision under racing requests', async () => {
    const f=fixture();
    const result=await Promise.all([f.call('/reports/report_test/resolve',{reason:'test'}),f.call('/reports/report_test/delist',{reason:'minor'})]);
    expect(result.filter(r=>r.status===200)).toHaveLength(1);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM moderation_actions').get()?.count).toBe(1);
  });
});
