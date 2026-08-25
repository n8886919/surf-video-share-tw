"use client";

import { useEffect, useMemo, useState } from "react";
import { PROJECT_PURPOSE } from "../packages/domain/src/project-purpose";
import { PUBLIC_MEDIA_NOTICE } from "../packages/domain/src/public-terms";

type View = "find" | "upload" | "mine";

interface Me {
  id: string;
  displayId: string | null;
  showIdentityDefault: boolean;
  authMode: string;
  isAdmin: boolean;
}

interface Spot {
  id: string;
  slug: string;
  name: string;
  nameEn: string;
  nameZh: string | null;
  region: string;
}

interface Conditions {
  waveHeight: number | null;
  waveDirection: number | null;
  wavePeriod: number | null;
  swellHeight: number | null;
  swellDirection: number | null;
  swellPeriod: number | null;
  secondarySwellHeight: number | null;
  secondarySwellDirection: number | null;
  secondarySwellPeriod: number | null;
  windWaveHeight: number | null;
  windWaveDirection: number | null;
  windWavePeriod: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  windGust: number | null;
  tideHeight: number | null;
  tideSlope: number | null;
  tideState: string | null;
}

interface Observation {
  id: string;
  status: string;
  metadataStatus: "pending" | "complete";
  metadataExpiresAt: string | null;
  publicAt: string | null;
  capturedAt: string | null;
  createdAt: string;
  durationSeconds: number | null;
  uploaderDisplayId: string | null;
  uploaderNote: string | null;
  funReaction: "fun" | "not_fun" | null;
  license: "CC0-1.0" | null;
  termsVersion: string | null;
  moderationStatus?: "visible" | "delisted";
  delistedAt: string | null;
  isFavorite: boolean;
  showUploader?: boolean;
  video: { provider: string };
  spot: { id: string; slug: string; name: string; nameEn: string } | null;
  conditions: Conditions;
}

interface Forecast {
  id: string;
  provider: string;
  model: string;
  issuedAt: string;
  validAt: string;
  totalWave: MetricGroup;
  primarySwell: MetricGroup;
  secondarySwell: MetricGroup;
  windWave: MetricGroup;
  tide: { height: number | null; slope: number | null; state: string | null };
  wind: { speed: number | null; direction: number | null; gust: number | null };
}

interface MetricGroup {
  height: number | null;
  direction: number | null;
  period: number | null;
}

interface MatchGroup {
  provider: string;
  model: string;
  observations: Array<{ score: number; observation: Observation }>;
}

interface UploadTicket {
  videoId: string;
  providerVideoId: string;
  uploadUrl: string | null;
  uploadMethod: "POST" | "mock";
}

interface ModerationReport {
  id: string;
  videoId: string;
  reason: "privacy" | "minor" | "copyright" | "irrelevant";
  createdAt: string;
  capturedAt: string | null;
  spotName: string | null;
  uploaderNote: string | null;
}

class ApiFailure extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = await response.json() as T & { error?: string; message?: string };
  if (!response.ok) throw new ApiFailure(payload.message || "連線失敗，請稍後再試", response.status, payload.error);
  return payload;
}

function toLocalDateTime(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatTime(iso: string | null): string {
  if (!iso) return "待補拍攝時間";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatDirection(value: number | null): string {
  return value == null ? "—" : `${Math.round(value)}°`;
}

function Icon({ name }: { name: "search" | "upload" | "user" | "heart" | "wave" }) {
  const paths = {
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
    upload: <><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M5 14v5h14v-5"/></>,
    user: <><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.6-4 3-6 7-6s6.4 2 7 6"/></>,
    heart: <path d="M20.8 8.4c0 5-8.8 10.2-8.8 10.2S3.2 13.4 3.2 8.4C3.2 5.8 5 4 7.4 4c1.9 0 3.3 1 4.6 2.6C13.3 5 14.7 4 16.6 4c2.4 0 4.2 1.8 4.2 4.4Z"/>,
    wave: <><path d="M3 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 3 2"/><path d="M5 10c2.2-4.8 7.3-6.2 11-3.2 1.7 1.4 2.2 3.2 2 5.2"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">{paths[name]}</svg>;
}

function Brand() {
  return (
    <div className="brand">
      {/* The supplied logo is a checked-in static brand asset. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand-logo.png" alt="" width="38" height="38" className="brand-logo" />
      <span>浪影互助</span>
    </div>
  );
}

function LoginRequired({ setupError }: { setupError?: string | null }) {
  return (
    <section className="auth-card">
      <Icon name="user" />
      <h2>{setupError ? "登入尚未就緒" : "這裡需要登入"}</h2>
      <p>{setupError || "使用 LINE 登入後即可上傳與管理自己的影片。"}</p>
      {!setupError && <a className="line-login-button" href="/api/v1/auth/line">使用 LINE 登入</a>}
    </section>
  );
}

function BottomNav({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  return (
    <nav className="bottom-nav" aria-label="主要分頁">
      <button className={view === "find" ? "active" : ""} onClick={() => onChange("find")}><Icon name="search"/><span>找浪</span></button>
      <button className={`upload-tab ${view === "upload" ? "active" : ""}`} onClick={() => onChange("upload")}><span className="upload-circle"><Icon name="upload"/></span><span>上傳</span></button>
      <button className={view === "mine" ? "active" : ""} onClick={() => onChange("mine")}><Icon name="user"/><span>我的</span></button>
    </nav>
  );
}

function ConditionValue({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return <div><span>{label}</span><strong>{value == null ? "—" : value.toFixed(1)}<small>{value == null ? "" : unit}</small></strong></div>;
}

const REPORT_REASONS = [
  ["privacy", "隱私／肖像"],
  ["minor", "未成年人"],
  ["copyright", "侵權"],
  ["irrelevant", "與浪況無關"],
] as const;

function ObservationCard({ observation, ownerActions }: {
  observation: Observation;
  ownerActions?: {
    spots: Spot[];
    onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>;
  };
}) {
  const [note, setNote] = useState(observation.uploaderNote || "");
  const [editMetadata, setEditMetadata] = useState(observation.metadataStatus === "pending");
  const [spotId, setSpotId] = useState(observation.spot?.id || "");
  const [capturedAt, setCapturedAt] = useState(observation.capturedAt ? toLocalDateTime(new Date(observation.capturedAt)) : "");
  const [error, setError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportStatus, setReportStatus] = useState<"idle" | "sending" | "sent">("idle");
  const c = observation.conditions;
  const pending = observation.metadataStatus === "pending";
  const remainingDays = observation.metadataExpiresAt
    ? Math.max(0, Math.ceil((new Date(observation.metadataExpiresAt).getTime() - new Date().getTime()) / 86_400_000))
    : null;

  async function patch(values: Record<string, unknown>) {
    if (!ownerActions) return;
    setError(null);
    try { await ownerActions.onPatch(observation.id, values); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "更新失敗"); }
  }

  async function report(reason: typeof REPORT_REASONS[number][0]) {
    setError(null);
    setReportStatus("sending");
    try {
      await api(`/videos/${observation.id}/reports`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setReportStatus("sent");
      setReportOpen(false);
    } catch (caught) {
      setReportStatus("idle");
      setError(caught instanceof Error ? caught.message : "檢舉失敗");
    }
  }

  return (
    <article className={`observation-card ${pending ? "pending-card" : ""}`}>
      <div className="observation-visual">
        <div className="wave-lines"><span/><span/><span/></div>
        <span className="status-pill">{observation.moderationStatus === "delisted" ? "已下架" : pending ? `待補 · ${remainingDays ?? 7} 天` : !observation.termsVersion ? "舊版不公開" : observation.status === "ready" ? "公開" : "處理中"}</span>
        <span className="duration-pill">{observation.durationSeconds ? `${Math.round(observation.durationSeconds)} 秒` : "—"}</span>
      </div>
      <div className="observation-body">
        <div className="observation-heading">
          <div><h3>{observation.spot?.name || "待補浪點"}</h3><p>{formatTime(observation.capturedAt)} · {observation.uploaderDisplayId || "匿名上傳"}</p></div>
          {ownerActions && <button className={`favorite-button ${observation.isFavorite ? "selected" : ""}`} aria-label="收藏" onClick={() => void patch({ isFavorite: !observation.isFavorite })}><Icon name="heart"/></button>}
        </div>

        {pending && ownerActions && (
          <div className="metadata-editor">
            <button className="text-button" onClick={() => setEditMetadata((open) => !open)}>{editMetadata ? "收起補資料" : "補浪點與時間"}</button>
            {editMetadata && <>
              <select value={spotId} onChange={(event) => setSpotId(event.target.value)}><option value="">選浪點</option>{ownerActions.spots.map((spot) => <option key={spot.id} value={spot.id}>{spot.name}</option>)}</select>
              <input type="datetime-local" value={capturedAt} min={toLocalDateTime(new Date(new Date().getTime() - 7 * 86_400_000))} max={toLocalDateTime(new Date())} onChange={(event) => setCapturedAt(event.target.value)} />
              <button className="small-primary" disabled={!spotId || !capturedAt} onClick={() => void patch({ spotId, capturedAt: new Date(capturedAt).toISOString() })}>完成補資料</button>
            </>}
          </div>
        )}

        <div className="condition-grid">
          <ConditionValue label="總浪" value={c.waveHeight} unit="m" />
          <ConditionValue label="主湧浪" value={c.swellHeight} unit="m" />
          <ConditionValue label="週期" value={c.swellPeriod} unit="s" />
          <ConditionValue label="風速" value={c.windSpeed} unit="m/s" />
        </div>
        {observation.funReaction && <p className={`fun-reaction ${observation.funReaction}`}>{observation.funReaction === "fun" ? "👍 上傳者那天玩得開心" : "👎 上傳者那天玩得不開心"}</p>}
        {observation.uploaderNote && !ownerActions && <p className="uploader-note">{observation.uploaderNote}</p>}
        {ownerActions && <div className="owner-controls">
          <label className="switch-row"><span><strong>顯示公開 ID</strong></span><input type="checkbox" checked={Boolean(observation.showUploader)} onChange={(event) => void patch({ showUploader: event.target.checked })}/></label>
          <div className="fun-field"><span>那天玩得如何？（公開、選填）</span><div><button className={observation.funReaction === "fun" ? "selected" : ""} onClick={() => void patch({ funReaction: observation.funReaction === "fun" ? null : "fun" })}>👍 開心</button><button className={observation.funReaction === "not_fun" ? "selected" : ""} onClick={() => void patch({ funReaction: observation.funReaction === "not_fun" ? null : "not_fun" })}>👎 不開心</button></div></div>
          <label className="note-field"><span>上傳者補充（公開、CC0、選填，最多 100 字）</span><input value={note} maxLength={100} placeholder="那天想補充什麼？" onChange={(event) => setNote(event.target.value)} onBlur={() => { if (note !== (observation.uploaderNote || "")) void patch({ uploaderNote: note.trim() || null }); }}/></label>
        </div>}
        {!ownerActions && observation.publicAt && <div className="report-area">{reportStatus === "sent" ? <span>已收到檢舉</span> : <><button className="report-toggle" onClick={() => setReportOpen((open) => !open)} disabled={reportStatus === "sending"}>{reportStatus === "sending" ? "送出中…" : "檢舉"}</button>{reportOpen && <div className="report-reasons" aria-label="檢舉原因">{REPORT_REASONS.map(([reason, label]) => <button key={reason} onClick={() => void report(reason)}>{label}</button>)}</div>}</>}</div>}
        {error && <p className="inline-error">{error}</p>}
      </div>
    </article>
  );
}

function ForecastCard({ forecast }: { forecast: Forecast }) {
  return (
    <article className="forecast-card">
      <div className="forecast-heading"><div><strong>{forecast.provider}</strong><span>{forecast.model}</span><small>更新 {formatTime(forecast.issuedAt)}</small></div><small>{formatTime(forecast.validAt)}</small></div>
      <div className="forecast-groups">
        <div><span>總浪</span><strong>{forecast.totalWave.height?.toFixed(1) ?? "—"}m</strong><small>{formatDirection(forecast.totalWave.direction)} · {forecast.totalWave.period?.toFixed(1) ?? "—"}s</small></div>
        <div><span>主湧浪</span><strong>{forecast.primarySwell.height?.toFixed(1) ?? "—"}m</strong><small>{formatDirection(forecast.primarySwell.direction)} · {forecast.primarySwell.period?.toFixed(1) ?? "—"}s</small></div>
        <div><span>風</span><strong>{forecast.wind.speed?.toFixed(1) ?? "—"}m/s</strong><small>{formatDirection(forecast.wind.direction)} · gust {forecast.wind.gust?.toFixed(1) ?? "—"}</small></div>
      </div>
      <p>此來源獨立顯示，未與其他模型平均。</p>
    </article>
  );
}

export function SurfApp() {
  const [view, setView] = useState<View>("find");
  const [spots, setSpots] = useState<Spot[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authSetupError, setAuthSetupError] = useState<string | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const spotResult = await api<{ spots: Spot[] }>("/spots");
        if (active) setSpots(spotResult.spots);
        try {
          const meResult = await api<Me>("/me");
          if (!active) return;
          setMe(meResult);
          const own = await api<{ observations: Observation[] }>("/videos");
          if (active) setObservations(own.observations);
        } catch (error) {
          if (error instanceof ApiFailure && error.code === "AUTH_NOT_CONFIGURED") setAuthSetupError(error.message);
          else if (!(error instanceof ApiFailure) || error.code !== "UNAUTHENTICATED") throw error;
        } finally { if (active) setAuthChecked(true); }
      } catch (error) {
        if (active) setFatalError(error instanceof Error ? error.message : "無法載入");
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  async function patchObservation(id: string, patch: Record<string, unknown>) {
    const result = await api<{ observation: Observation }>(`/videos/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    setObservations((current) => current.map((item) => item.id === id ? result.observation : item));
  }

  if (loading) return <main className="app-shell center-screen"><Brand/><p className="loading-purpose">{PROJECT_PURPOSE}</p><div className="loading-line"><span/></div></main>;
  if (fatalError) return <main className="app-shell center-screen"><Brand/><p>{fatalError}</p></main>;

  return (
    <main className="app-shell">
      <header className="topbar"><Brand/>{me && <span className="public-id">{me.displayId || "匿名"}</span>}</header>
      {view === "find" && <FindView spots={spots}/>}
      {view === "upload" && (me ? <UploadView spots={spots} me={me} onComplete={(observation) => { setObservations((current) => [observation, ...current]); setView("mine"); }}/> : authChecked && <div className="screen"><LoginRequired setupError={authSetupError}/></div>)}
      {view === "mine" && (me ? <MineView me={me} spots={spots} observations={observations} onPatch={patchObservation} onMeChange={setMe}/> : authChecked && <div className="screen"><LoginRequired setupError={authSetupError}/></div>)}
      <BottomNav view={view} onChange={setView}/>
    </main>
  );
}

function FindView({ spots }: { spots: Spot[] }) {
  const [queryBounds] = useState(() => {
    const now = new Date();
    return {
      min: toLocalDateTime(now),
      max: toLocalDateTime(new Date(now.getTime() + 72 * 60 * 60_000)),
    };
  });
  const [spotId, setSpotId] = useState("");
  const [targetTime, setTargetTime] = useState(toLocalDateTime(new Date(new Date().getTime() + 24 * 60 * 60_000)));
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [matchGroups, setMatchGroups] = useState<MatchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedSpotId = spotId || spots[0]?.id || "";
  useEffect(() => {
    if (!selectedSpotId || !targetTime) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true); setError(null);
      void api<{ forecasts: Forecast[]; observations: Observation[]; matchesBySource: MatchGroup[] }>(`/matches?spotId=${encodeURIComponent(selectedSpotId)}&targetTime=${encodeURIComponent(new Date(targetTime).toISOString())}`, { signal: controller.signal })
        .then((result) => { setForecasts(result.forecasts); setObservations(result.observations); setMatchGroups(result.matchesBySource); })
        .catch((caught) => { if (!(caught instanceof DOMException && caught.name === "AbortError")) setError(caught instanceof Error ? caught.message : "比對失敗"); })
        .finally(() => setLoading(false));
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [selectedSpotId, targetTime]);

  return <div className="screen find-screen">
    <div className="page-title"><h1>找浪</h1><p>只選浪點與未來 72 小時內的時間</p></div>
    <div className="search-panel">
      <label><span>浪點</span><select value={selectedSpotId} onChange={(event) => setSpotId(event.target.value)}>{spots.map((spot) => <option key={spot.id} value={spot.id}>{spot.name}</option>)}</select></label>
      <label><span>時間</span><input type="datetime-local" min={queryBounds.min} max={queryBounds.max} value={targetTime} onChange={(event) => setTargetTime(event.target.value)}/></label>
    </div>
    {loading && <div className="progress-message"><span className="spinner"/>比對中</div>}
    {error && <div className="error-message">{error}</div>}
    <section className="result-section"><div className="section-heading"><h2>預報來源</h2><small>{forecasts.length ? `${forecasts.length} 筆獨立資料` : "尚無快照"}</small></div>
      {forecasts.length ? <div className="forecast-list">{forecasts.map((item) => <ForecastCard key={item.id} forecast={item}/>)}</div> : <div className="info-state"><Icon name="wave"/><p>預報歷史抓取尚未啟用。目前不會用未驗證數值假裝完成配對。</p></div>}
    </section>
    <section className="result-section"><div className="section-heading"><h2>{matchGroups.length ? "相似情況實拍" : "同浪點近期實拍（尚未配對）"}</h2><small>{observations.length ? `${observations.length} 段` : "累積中"}</small></div>
      {matchGroups.length ? <div className="match-group-list">{matchGroups.map((group) => <section className="match-group" key={`${group.provider}:${group.model}`}><h3>{group.provider} · {group.model}</h3><p>歷史側使用拍攝時最新可得的同來源預報；不與其他模型平均。</p><div className="record-list">{group.observations.map((item) => <div className="scored-observation" key={item.observation.id}><span className="score-badge">相似 {Math.round(item.score * 100)}%</span><ObservationCard observation={item.observation}/></div>)}</div></section>)}</div> : observations.length ? <div className="record-list">{observations.map((item) => <ObservationCard key={item.id} observation={item}/>)}</div> : <div className="info-state compact"><p>這個浪點還沒有可公開配對的實拍。</p></div>}
    </section>
  </div>;
}

function UploadView({ spots, me, onComplete }: { spots: Spot[]; me: Me; onComplete: (observation: Observation) => void }) {
  const initialSpot = typeof window !== "undefined" ? localStorage.getItem("lastSpotId") || "" : "";
  const [spotId, setSpotId] = useState(initialSpot);
  const [capturedAt, setCapturedAt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [showUploader, setShowUploader] = useState(me.showIdentityDefault && Boolean(me.displayId));
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function inspectVideo(selected: File) {
    if (selected.size > 200 * 1024 * 1024) throw new Error("影片不可超過 200 MB");
    if (!selected.type.startsWith("video/")) throw new Error("請選擇影片檔案");
    const hinted = new Date(selected.lastModified);
    if (!Number.isNaN(hinted.getTime()) && hinted <= new Date() && hinted >= new Date(Date.now() - 7 * 86_400_000)) setCapturedAt(toLocalDateTime(hinted));
    const url = URL.createObjectURL(selected);
    try {
      const seconds = await new Promise<number>((resolve, reject) => {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () => resolve(video.duration);
        video.onerror = () => reject(new Error("無法讀取影片長度"));
        video.src = url;
      });
      if (!Number.isFinite(seconds) || seconds < 5 || seconds > 60) throw new Error("影片長度必須為 5–60 秒");
      setFile(selected); setDuration(seconds);
    } finally { URL.revokeObjectURL(url); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file || duration == null) return setError("請先選擇影片");
    setError(null); setProgress("建立上傳連結…");
    try {
      const ticket = await api<UploadTicket>("/videos/upload-request", { method: "POST", body: JSON.stringify({ spotId: spotId || null, capturedAt: capturedAt ? new Date(capturedAt).toISOString() : null, durationSeconds: duration, sizeBytes: file.size, fileName: file.name, contentType: file.type, showUploader }) });
      if (spotId) localStorage.setItem("lastSpotId", spotId);
      if (ticket.uploadMethod === "POST" && ticket.uploadUrl) {
        setProgress("影片上傳中…");
        const form = new FormData(); form.append("file", file);
        const upload = await fetch(ticket.uploadUrl, { method: "POST", body: form });
        if (!upload.ok) throw new Error("影片上傳失敗，請再試一次");
      }
      setProgress("確認影片狀態…");
      let complete = await api<{ observation: Observation }>(`/videos/${ticket.videoId}/complete`, { method: "POST", body: JSON.stringify({ providerVideoId: ticket.providerVideoId }) });
      for (let attempt = 0; attempt < 4 && (complete.observation.status === "pending" || complete.observation.status === "processing"); attempt += 1) {
        setProgress("影片轉檔中…");
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
        complete = await api<{ observation: Observation }>(`/videos/${ticket.videoId}/complete`, { method: "POST", body: JSON.stringify({ providerVideoId: ticket.providerVideoId }) });
      }
      onComplete(complete.observation);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "上傳失敗"); setProgress(null); }
  }

  return <div className="screen upload-screen"><div className="page-title"><h1>上傳</h1><p>5–60 秒，最多 200 MB</p></div>
    <form onSubmit={submit} className="upload-form">
      <label className={`file-picker ${file ? "has-file" : ""}`}><input type="file" accept="video/*" onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void inspectVideo(selected).catch((caught) => setError(caught instanceof Error ? caught.message : "無法讀取影片")); }}/><span className="file-icon"><Icon name="upload"/></span><strong>{file?.name || "選擇影片"}</strong><small>{file && duration ? `${duration.toFixed(1)} 秒 · ${(file.size / 1024 / 1024).toFixed(1)} MB` : "會優先讀取檔案時間"}</small></label>
      <div className="two-fields"><label><span>浪點</span><select value={spotId} onChange={(event) => setSpotId(event.target.value)}><option value="">稍後補</option>{spots.map((spot) => <option key={spot.id} value={spot.id}>{spot.name}</option>)}</select></label><label><span>拍攝時間</span><input type="datetime-local" min={toLocalDateTime(new Date(new Date().getTime() - 7 * 86_400_000))} max={toLocalDateTime(new Date())} value={capturedAt} onChange={(event) => setCapturedAt(event.target.value)}/></label></div>
      <p className="pending-help">缺浪點或拍攝時間仍可上傳，但不公開，需在 7 天內補齊。</p>
      <label className="switch-row"><span><strong>顯示公開 ID</strong><small>{me.displayId || "先到「我的」設定 ID"}</small></span><input type="checkbox" disabled={!me.displayId} checked={showUploader} onChange={(event) => setShowUploader(event.target.checked)}/></label>
      <div className="public-notice"><strong>公開提醒</strong><span>{PUBLIC_MEDIA_NOTICE}</span></div>
      {error && <div className="error-message">{error}</div>}{progress && <div className="progress-message"><span className="spinner"/>{progress}</div>}
      <button className="submit-button" disabled={!file || Boolean(progress)}>{progress ? "處理中" : "上傳影片"}</button>
    </form>
  </div>;
}

function AdminReports() {
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api<{ reports: ModerationReport[] }>("/admin/reports")
      .then((result) => { if (active) setReports(result.reports); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "無法載入檢舉"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function delist(report: ModerationReport) {
    setBusyId(report.id);
    setError(null);
    try {
      await api(`/admin/reports/${report.id}/delist`, { method: "POST" });
      setReports((current) => current.filter((item) => item.videoId !== report.videoId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "下架失敗");
    } finally {
      setBusyId(null);
    }
  }

  return <section className="admin-reports"><h3>待處理檢舉</h3>{loading ? <p>載入中…</p> : reports.length ? reports.map((report) => <article key={report.id}><div><strong>{report.spotName || "未知浪點"} · {formatTime(report.capturedAt)}</strong><span>{REPORT_REASONS.find(([reason]) => reason === report.reason)?.[1] || report.reason}</span>{report.uploaderNote && <small>{report.uploaderNote}</small>}</div><button disabled={busyId === report.id} onClick={() => void delist(report)}>{busyId === report.id ? "處理中…" : "下架影片"}</button></article>) : <p>目前沒有待處理檢舉。</p>}{error && <p className="inline-error">{error}</p>}</section>;
}

function MineView({ me, spots, observations, onPatch, onMeChange }: { me: Me; spots: Spot[]; observations: Observation[]; onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>; onMeChange: (me: Me) => void }) {
  const [filter, setFilter] = useState("all");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [displayId, setDisplayId] = useState(me.displayId || "");
  const [defaultVisible, setDefaultVisible] = useState(me.showIdentityDefault);
  const [error, setError] = useState<string | null>(null);
  const filtered = useMemo(() => observations.filter((item) => filter === "all" || filter === "pending" && item.metadataStatus === "pending" || item.spot?.id === filter), [filter, observations]);
  return <div className="screen mine-screen"><div className="page-title mine-title"><div><h1>我的</h1><p>{observations.length} 段影片</p></div><button className="settings-button" onClick={() => setSettingsOpen((open) => !open)}>設定</button></div>
    {settingsOpen && <section className="profile-panel"><label><span>公開 ID</span><input value={displayId} maxLength={24} pattern="[A-Za-z0-9._-]+" onChange={(event) => setDisplayId(event.target.value)} placeholder="例如 nolan.surf"/></label><label className="switch-row"><span><strong>新影片預設顯示 ID</strong></span><input type="checkbox" checked={defaultVisible} disabled={!displayId.trim()} onChange={(event) => setDefaultVisible(event.target.checked)}/></label>{error && <p className="inline-error">{error}</p>}<button className="small-primary" onClick={() => { setError(null); void api<Pick<Me, "displayId" | "showIdentityDefault">>("/me", { method: "PATCH", body: JSON.stringify({ displayId: displayId.trim() || null, showIdentityDefault: defaultVisible }) }).then((updated) => onMeChange({ ...me, ...updated })).catch((caught) => setError(caught instanceof Error ? caught.message : "儲存失敗")); }}>儲存設定</button>{me.isAdmin && <AdminReports/>}{me.authMode === "line" && <form action="/api/v1/auth/logout" method="post"><button className="logout-button">登出 LINE</button></form>}</section>}
    <div className="filter-row"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部</button><button className={filter === "pending" ? "active" : ""} onClick={() => setFilter("pending")}>待補</button>{spots.map((spot) => <button key={spot.id} className={filter === spot.id ? "active" : ""} onClick={() => setFilter(spot.id)}>{spot.name}</button>)}</div>
    {filtered.length ? <div className="record-list">{filtered.map((item) => <ObservationCard key={item.id} observation={item} ownerActions={{ spots, onPatch }}/>)}</div> : <div className="info-state"><Icon name="wave"/><p>這個篩選還沒有影片。</p></div>}
  </div>;
}
