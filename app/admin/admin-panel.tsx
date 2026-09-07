"use client";

/* Admin thumbnails are authenticated first-party responses; image optimization must not cache them publicly. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState } from "react";

interface Report {
  id: string; videoId: string; reason: string; status: string; createdAt: string;
  resolvedAt: string | null; resolutionAction: string | null; resolutionReason: string | null;
  capturedAt: string | null; uploaderNote: string | null; spotName: string | null;
  moderationStatus: string; durationSeconds: number | null;
}
interface Problem { id: string; message: string; view: string; createdAt: string; resolvedAt: string | null }
interface Action { id: string; targetId: string; targetType: string; action: string; reason: string; occurredAt: string }
interface Daily { day: string; source: string; event: string; outcome: string; count: number }
const labels: Record<string, string> = { privacy: "隱私", minor: "未成年人", copyright: "著作權", irrelevant: "非浪況內容",
  test: "測試", no_violation: "檢舉不成立", reviewed: "管理員確認", resolve: "保留並結案", delist: "下架", restore: "恢復公開",
  search: "搜尋", playback_started: "開始播放", upload_step: "上傳步驟", upload_failed: "上傳失敗", playback_failed: "播放失敗",
  none: "有搜尋結果", no_videos: "無公開實拍", missing_target: "缺目標預報", insufficient_history: "歷史資料不足",
  success: "成功", started: "開始", failed: "失敗", server: "伺服器", client: "用戶端回報",
  ticket: "建立上傳連結", transfer: "傳送檔案", completion: "確認上傳", selection: "讀取選取影片", player: "播放器", sdk: "播放器程式", tracking: "播放回報" };
const label = (value: string | null) => value ? value.split(":").map(part => labels[part] || part).join("／") : "舊紀錄未保存";
function time(value: string | null) {
  return value ? new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "未填";
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1/admin${path}`, { cache: "no-store", credentials: "same-origin",
    ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result && typeof result === "object" && "message" in result && typeof result.message === "string"
    ? result.message : "管理資料暫時無法載入，請重新登入或稍後再試");
  return result as T;
}
function ReviewCard({ reports, busy, decide }: { reports: Report[]; busy: boolean;
  decide: (path: string, body: unknown) => Promise<void> }) {
  const report = reports[0];
  const [resolution, setResolution] = useState("no_violation");
  const [playback, setPlayback] = useState<{ type: string; iframeUrl: string | null } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  async function preview() {
    setPreviewBusy(true); setPreviewError(null);
    try { setPlayback(await request(`/videos/${encodeURIComponent(report.videoId)}/playback`, {})); }
    catch (error) { setPreviewError(error instanceof Error ? error.message : "無法預覽影片"); }
    finally { setPreviewBusy(false); }
  }
  return <article className="admin-review-card">
    <h3>{report.spotName || "未知浪點"} · {time(report.capturedAt)}</h3>
    <p>{report.durationSeconds ?? "—"} 秒 · {reports.length} 筆檢舉 · {report.moderationStatus === "delisted" ? "已下架" : "公開中"}</p>
    <small>影片編號：{report.videoId}</small>
    {playback ? <div className="admin-preview">{playback.iframeUrl
      ? <iframe title="管理員影片預覽" src={playback.iframeUrl} allow="fullscreen" allowFullScreen/>
      : <p>測試影片預覽</p>}<button type="button" onClick={() => setPlayback(null)}>關閉預覽</button></div>
      : <button className="admin-preview-button" type="button" disabled={previewBusy} onClick={() => void preview()}>
        {!imageFailed && <img src={`/api/v1/admin/videos/${encodeURIComponent(report.videoId)}/thumbnail`}
          alt="被檢舉影片縮圖" loading="lazy" onError={() => setImageFailed(true)}/>}
        <span>{previewBusy ? "載入中…" : "播放影片"}</span>
      </button>}
    {previewError && <p role="alert">{previewError}</p>}
    {report.uploaderNote && <p>影片補充：{report.uploaderNote}</p>}
    <ul>{reports.map(item => <li key={item.id}>{label(item.reason)} · 檢舉時間 {time(item.createdAt)}
      {item.status === "resolved" && <> · {label(item.resolutionAction)}／{label(item.resolutionReason)} · {time(item.resolvedAt)}</>}</li>)}</ul>
    {report.status === "open" ? <div className="admin-decision">
      <label>保留影片的原因<select value={resolution} onChange={event => setResolution(event.target.value)}>
        <option value="no_violation">檢舉不成立</option><option value="test">測試檢舉</option></select></label>
      <button disabled={busy} onClick={() => { setPlayback(null); void decide(`/reports/${report.id}/resolve`, { reason: resolution }); }}>保留影片並結案</button>
      <button className="admin-danger" disabled={busy} onClick={() => {
        if (window.confirm(`確認下架這部「${report.spotName || "未知浪點"}」影片？同部影片的待處理檢舉會一併結案。`)) {
          setPlayback(null); void decide(`/reports/${report.id}/delist`, { reason: report.reason });
        }
      }}>下架影片（{label(report.reason)}）</button>
    </div> : report.moderationStatus === "delisted" && <button disabled={busy} onClick={() => {
      if (window.confirm("確認已複查影片，並恢復公開？")) void decide(`/videos/${report.videoId}/restore`, {});
    }}>恢復公開</button>}
  </article>;
}

export function AdminPanel() {
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const [reports, setReports] = useState<Report[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [days, setDays] = useState<Daily[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const [videos, feedback, history, diagnostics] = await Promise.all([
      request<{ reports: Report[] }>(`/reports?status=${status}`),
      request<{ reports: Problem[] }>(`/problem-reports?status=${status}`),
      request<{ actions: Action[] }>("/history"), request<{ days: Daily[] }>("/diagnostics"),
    ]);
    return { videos, feedback, history, diagnostics };
  }, [status]);
  const apply = useCallback((value: Awaited<ReturnType<typeof load>>) => {
    setReports(value.videos.reports); setProblems(value.feedback.reports);
    setActions(value.history.actions); setDays(value.diagnostics.days);
  }, []);
  useEffect(() => {
    let active = true;
    void load().then(value => { if (active) apply(value); })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : "載入失敗"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load, apply]);
  async function decide(path: string, body: unknown) {
    setBusy(true); setError(null);
    try { await request(path, body); apply(await load()); }
    catch (error) { setError(error instanceof Error ? error.message : "操作失敗"); }
    finally { setBusy(false); }
  }
  const grouped = new Map<string, Report[]>();
  for (const report of reports) grouped.set(report.videoId, [...grouped.get(report.videoId) ?? [], report]);
  return <div className="admin-panel">
    <div className="admin-tabs" aria-label="檢舉狀態"><button aria-pressed={status === "open"} disabled={busy || loading} onClick={() => { if (status !== "open") { setLoading(true); setError(null); setStatus("open"); } }}>待處理</button>
      <button aria-pressed={status === "resolved"} disabled={busy || loading} onClick={() => { if (status !== "resolved") { setLoading(true); setError(null); setStatus("resolved"); } }}>已處理</button></div>
    {error && <p role="alert">{error}</p>}
    {loading ? <p role="status">載入管理資料…</p> : <>
      <section><h2>全站影片檢舉</h2><p>每次顯示最新 100 筆檢舉。下架會停止公開，檔案仍保留。</p>
        {grouped.size ? Array.from(grouped, ([id, group]) => <ReviewCard key={`${status}:${id}`} reports={group} busy={busy} decide={decide}/>) : <p>目前沒有{status === "open" ? "待處理" : "已處理"}影片檢舉。</p>}</section>
      <section><h2>網站問題回報</h2>{problems.length ? problems.map(problem => <article className="admin-review-card" key={problem.id}>
        <p>{problem.message}</p><small>{problem.view} · {time(problem.createdAt)}</small>
        {status === "open" && <button disabled={busy} onClick={() => void decide(`/problem-reports/${problem.id}/resolve`, {})}>標記已處理</button>}
      </article>) : <p>目前沒有{status === "open" ? "待處理" : "已處理"}問題回報。</p>}</section>
      <details><summary>管理操作紀錄（最新 100 筆）</summary>{actions.length ? <ul>{actions.map(action => <li key={action.id}>
        {time(action.occurredAt)} · {label(action.action)} · {action.targetId} · {label(action.reason)}</li>)}</ul> : <p>尚無新版操作紀錄。</p>}</details>
      <details><summary>最近 30 天流程紀錄</summary><p>只包含部署後收到的事件，用戶端回報可能遺漏。每天每來源最多保存 2,000 個事件；不是使用人數或帳單。</p>
        {days.length ? <div className="admin-table-wrap"><table><thead><tr><th>日期</th><th>來源</th><th>事件</th><th>結果</th><th>次數</th></tr></thead>
          <tbody>{days.map(day => <tr key={`${day.day}:${day.source}:${day.event}:${day.outcome}`}><td>{day.day}</td><td>{label(day.source)}</td><td>{label(day.event)}</td><td>{label(day.outcome)}</td><td>{day.count}</td></tr>)}</tbody></table></div> : <p>尚無流程紀錄；不回填過去資料。</p>}</details>
    </>}
  </div>;
}
