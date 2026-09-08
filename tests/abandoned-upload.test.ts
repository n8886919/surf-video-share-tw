import { describe, expect, it, vi } from "vitest";
import { forecastFixture } from "./helpers/forecast-fixture";
import { cleanupExpiredPendingVideos } from "../src/worker/video-lifecycle";
import type { VideoProvider } from "../src/worker/providers";
import type { AppEnv } from "../src/worker/db";
import { api } from "../src/worker/api";

describe('abandoned complete-metadata uploads',()=>{
  it('cannot resurrect a cleanup claim through metadata editing when a legacy expiry is null',async()=>{
    const f=forecastFixture();
    try{
      f.sqlite.exec(`INSERT INTO users(id,line_subject,created_at,updated_at) VALUES('user_dev_local','s','2026-08-20','2026-08-20');
        INSERT INTO videos(id,user_id,video_provider,provider_video_id,status,metadata_status,duration_seconds,terms_version,created_at,updated_at,show_uploader)
        VALUES('v','user_dev_local','mock','m','awaiting_upload','deleting',20,'cc0','2026-08-20T00:00:00.000Z','2026-08-20T00:00:00.000Z',0)`);
      const response=await api.fetch(new Request('https://example.com/api/v1/videos/v',{
        method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({showUploader:true}),
      }),{...f.env,APP_ENV:'development',ENABLE_DEV_AUTH:'true',VIDEO_PROVIDER:'mock'} as AppEnv);
      expect(response.status).toBe(410);
      expect(f.sqlite.prepare("SELECT metadata_status FROM videos WHERE id='v'").get()?.metadata_status).toBe('deleting');
    }finally{f.sqlite.close();}
  });
  it.each(['ready','pending','unavailable'] as const)('verifies Stream before cleanup: %s',async state=>{
    const f=forecastFixture();
    try{
      f.sqlite.exec(`INSERT INTO users(id,line_subject,created_at,updated_at) VALUES('u','s','2026-08-20','2026-08-20');
        INSERT INTO videos(id,user_id,video_provider,provider_video_id,status,metadata_status,duration_seconds,terms_version,created_at,updated_at,show_uploader)
        VALUES('v','u','mock','m','awaiting_upload','complete',20,'cc0','2026-08-20T00:00:00.000Z','2026-08-20T00:00:00.000Z',0)`);
      const provider={provider:'mock',getStatus:state==='unavailable'?vi.fn().mockRejectedValue(new Error('offline')):vi.fn().mockResolvedValue({state,durationSeconds:20}),deleteVideo:vi.fn().mockResolvedValue(undefined)} as unknown as VideoProvider;
      const result=await cleanupExpiredPendingVideos({...f.env,VIDEO_PROVIDER:'mock'} as AppEnv,new Date('2026-09-08T08:00:00Z'),{},()=>provider);
      if(state==='ready'){
        expect(result).toMatchObject({deleted:0,failed:0});
        expect(f.sqlite.prepare('SELECT status,public_at FROM videos WHERE id=?').get('v')).toMatchObject({status:'ready',public_at:expect.any(String)});
        expect(provider.deleteVideo).not.toHaveBeenCalled();
      }else if(state==='pending')expect(result.deleted).toBe(1);
      else {expect(result.failed).toBe(1);expect(provider.deleteVideo).not.toHaveBeenCalled();}
    }finally{f.sqlite.close();}
  });
});
