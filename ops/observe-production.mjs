import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseWranglerAuthToken } from './deploy-production.mjs';

// Manual, read-only pilot report. No LINE push, tracking cookies or new runtime secret.
const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
let token=process.env.CLOUDFLARE_API_TOKEN;
if(!token && process.argv.includes('--wrangler-oauth')) {
  try { token=parseWranglerAuthToken(execFileSync(process.execPath,
    ['node_modules/wrangler/bin/wrangler.js','auth','token','--json'],
    {encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false'}}));
  } catch { throw Error('Existing Wrangler OAuth is unavailable'); }
}
if(!token)throw Error('Use CLOUDFLARE_API_TOKEN or --wrangler-oauth');
const now=new Date();const since=new Date(now.getTime()-14*86400000).toISOString();
const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
async function query(sql,params=[]) {
  if(!/^SELECT\b/i.test(sql))throw Error('Read-only SQL required');
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/d1/database/${config.d1_databases[0].database_id}/query`,{
    method:'POST',headers,body:JSON.stringify({sql,params}),signal:AbortSignal.timeout(20000)});
  const body=await response.json();if(!response.ok||!body.success)throw Error('Read-only D1 report failed');
  return body.result[0];
}
const userCounts=await query("SELECT COUNT(*) AS registered FROM users WHERE line_subject IS NOT NULL AND id <> 'user_dev_local'");
const videoCounts=await query(`SELECT COUNT(*) AS video_records,
  SUM(status='ready' AND metadata_status='complete' AND public_at IS NOT NULL AND moderation_status='visible' AND terms_version IS NOT NULL) AS public_videos,
  SUM(status='ready' AND metadata_status='complete') AS completed_videos,
  ROUND(SUM(CASE WHEN status='ready' THEN duration_seconds ELSE 0 END)/60.0,2) AS known_ready_minutes FROM videos`);
const contributors=await query(`SELECT COUNT(*) AS contributors, SUM(uploads>=2) AS repeat_uploaders,
  SUM(days>=2) AS returning_uploaders FROM (
    SELECT user_id,COUNT(*) AS uploads,COUNT(DISTINCT date(uploaded_at,'+8 hours')) AS days FROM videos
    WHERE status='ready' AND metadata_status='complete' AND terms_version IS NOT NULL AND uploaded_at >= ?
    GROUP BY user_id)`,[since]);
const tables=await query("SELECT name FROM sqlite_master WHERE name IN ('journey_daily','forecast_retention_state')");
const names=new Set(tables.results.map(row=>row.name));
const journeys=names.has('journey_daily')?await query('SELECT day,source,event,outcome,count FROM journey_daily WHERE day >= ? ORDER BY day,source,event,outcome LIMIT 1000',[since.slice(0,10)]):null;
const retention=names.has('forecast_retention_state')?await query("SELECT cursor,budget_day,writes,last_hour FROM forecast_retention_state WHERE id='history'"):null;
const lastCompleteDay=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())-86400000).toISOString().slice(0,10);
const firstCompleteDay=new Date(Date.parse(lastCompleteDay+'T00:00:00Z')-2*86400000).toISOString().slice(0,10);
const analyticsResponse=await fetch('https://api.cloudflare.com/client/v4/graphql',{
  method:'POST',headers,signal:AbortSignal.timeout(20000),body:JSON.stringify({query:`{viewer{accounts(filter:{accountTag:"${config.account_id}"}){d1AnalyticsAdaptiveGroups(limit:3,filter:{date_geq:"${firstCompleteDay}",date_leq:"${lastCompleteDay}",databaseId:"${config.d1_databases[0].database_id}"}){dimensions{date}sum{rowsRead rowsWritten}}}}}`})});
const d1FullUtcDays=await analyticsResponse.json();
console.log(JSON.stringify({capturedAt:now.toISOString(),windowStart:since,userCounts,videoCounts,contributors,journeys,retention,d1FullUtcDays,
  notes:['Aggregate counts include owner/test activity unless separately verified. Registrations alone are not pilot acceptance.',
    'Journey events are best effort; no unique-viewer or retention claim follows from them.',
    'Known ready minutes exclude provider-only/pending assets; obtain billed Stream storage/delivery from Cloudflare.',
    'Cost comparison requires at least three complete UTC days after deployment; analytics may lag.']},null,2));
