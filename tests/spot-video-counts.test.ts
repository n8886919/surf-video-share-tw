import { afterEach, expect, it } from "vitest";
import { api } from "../src/worker/api";
import { forecastFixture } from "./helpers/forecast-fixture";

const fixtures: ReturnType<typeof forecastFixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.sqlite.close(); });

it("counts all public videos at each active spot without counting private, unfinished, unlicensed or delisted records", async () => {
  const f = forecastFixture(); fixtures.push(f);
  f.sqlite.exec("INSERT INTO users(id,line_subject,created_at,updated_at) VALUES('owner','fixture-private','2026-09-09','2026-09-09')");
  const insert = f.sqlite.prepare(`INSERT INTO videos(id,user_id,spot_id,video_provider,provider_video_id,status,metadata_status,public_at,terms_version,moderation_status,created_at,updated_at,show_uploader)
    VALUES(?,'owner','spot_double-lions','mock',?,'ready','complete','2026-09-09','cc0','visible','2026-09-09','2026-09-09',0)`);
  insert.run("public1", "p1"); insert.run("public2", "p2");
  for (const [i, change] of ["public_at = NULL", "metadata_status = 'pending'", "metadata_status = 'deleting'", "status = 'awaiting_upload'", "status = 'processing'", "status = 'error'", "status = 'expired'", "terms_version = NULL", "moderation_status = 'delisted'"].entries()) {
    insert.run(`excluded${i}`, `e${i}`);
    f.sqlite.prepare(`UPDATE videos SET ${change} WHERE id = ?`).run(`excluded${i}`);
  }
  const response = await api.fetch(new Request("https://example.com/api/v1/spots"), f.env);
  const body = await response.json() as { spots: Array<{ id: string; publicVideoCount: number }> };
  expect(response.status).toBe(200);
  expect(body.spots.find(spot => spot.id === "spot_double-lions")?.publicVideoCount).toBe(2);
  expect(body.spots.filter(spot => spot.id !== "spot_double-lions").every(spot => spot.publicVideoCount === 0)).toBe(true);
});
