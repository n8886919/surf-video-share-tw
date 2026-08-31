"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type {
  CombinedMatchResponse as CombinedMatch,
  ForecastResponse as Forecast,
  ObservationResponse as Observation,
  PlaybackResponse,
  PublicMatchesResponse,
  VideoDownloadResponse,
  VideoShareLinkResponse,
} from "../packages/api-contract/src";
import {
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  MIN_VIDEO_DURATION_SECONDS,
} from "../packages/api-contract/src";
import {
  COMPOSITE_FORECAST_DAY_OFFSET_MAX,
  firstSelectableForecastHour,
  FORECAST_DAY_OFFSET_MAX,
  FORECAST_HOUR_MAX,
  FORECAST_HOUR_MIN,
  isWithinUploadWindow,
  taipeiForecastTarget,
} from "../packages/domain/src/time-policy";
import { PROJECT_POSITION, PROJECT_PURPOSE, PROJECT_VERSION } from "../packages/domain/src/project-purpose";
import {
  PUBLIC_MEDIA_NOTICE,
  PUBLIC_MEDIA_THIRD_PARTY_RIGHTS_NOTICE,
} from "../packages/domain/src/public-terms";
import { loadStreamPlayerSdk, type StreamPlayer } from "./stream-player";
import { mergeSpotOrder, moveSpotId, spotReorderTarget } from "./spot-order";
import {
  inspectQuickTimeMetadata,
  resolveUploadPrefill,
} from "./video-metadata";

type View = "find" | "upload" | "mine";

const SPOT_ORDER_STORAGE_KEY = "surf-video-share:find-spot-order:v1";

interface Me {
  id: string;
  suggestedDisplayName: string | null;
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
  latitude: number | null;
  longitude: number | null;
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

export type LoginStatus = "capacity" | "cancelled" | "config" | "expired" | "failed" | "invalid";

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

export interface FindQueryState<T> {
  requestId: number;
  queryKey: string | null;
  results: T;
  loading: boolean;
  error: string | null;
}

export type FindQueryAction<T> =
  | { type: "start"; requestId: number; queryKey: string; emptyResults: T }
  | { type: "success"; requestId: number; queryKey: string; results: T }
  | { type: "failure"; requestId: number; queryKey: string; error: string };

export function reduceFindQuery<T>(state: FindQueryState<T>, action: FindQueryAction<T>): FindQueryState<T> {
  if (action.type === "start") {
    return {
      requestId: action.requestId,
      queryKey: action.queryKey,
      results: action.emptyResults,
      loading: true,
      error: null,
    };
  }
  if (state.requestId !== action.requestId || state.queryKey !== action.queryKey) return state;
  if (action.type === "success") return { ...state, results: action.results, loading: false, error: null };
  return { ...state, loading: false, error: action.error };
}

export function visibleFindQuery<T>(
  state: FindQueryState<T>,
  currentQueryKey: string | null,
  emptyResults: T,
): Pick<FindQueryState<T>, "results" | "loading" | "error"> {
  if (currentQueryKey === null) return { results: emptyResults, loading: false, error: null };
  if (state.queryKey !== currentQueryKey) return { results: emptyResults, loading: true, error: null };
  return { results: state.results, loading: state.loading, error: state.error };
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
    hourCycle: "h23",
  }).format(new Date(iso));
}

function formatDirection(value: number | null): string {
  return value == null ? "—" : `${Math.round(value)}°`;
}

function Icon({ name }: { name: "search" | "upload" | "camera" | "user" | "heart" | "wave" | "help" | "more" | "share" | "download" }) {
  const paths = {
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
    upload: <><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M5 14v5h14v-5"/></>,
    camera: <><path d="M4 8.5h3l1.4-2h7.2l1.4 2h3v10H4z"/><circle cx="12" cy="13.5" r="3.2"/></>,
    user: <><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.6-4 3-6 7-6s6.4 2 7 6"/></>,
    heart: <path d="M20.8 8.4c0 5-8.8 10.2-8.8 10.2S3.2 13.4 3.2 8.4C3.2 5.8 5 4 7.4 4c1.9 0 3.3 1 4.6 2.6C13.3 5 14.7 4 16.6 4c2.4 0 4.2 1.8 4.2 4.4Z"/>,
    wave: <><path d="M3 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 3 2"/><path d="M5 10c2.2-4.8 7.3-6.2 11-3.2 1.7 1.4 2.2 3.2 2 5.2"/></>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 0 1 4.6.9c0 1.7-2.4 2-2.4 3.7"/><path d="M12 17.2h.01"/></>,
    more: <><path d="M5 12h.01"/><path d="M12 12h.01"/><path d="M19 12h.01"/></>,
    share: <><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"/></>,
    download: <><path d="M12 4v11m0 0-4-4m4 4 4-4"/><path d="M5 19h14"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">{paths[name]}</svg>;
}

function Brand() {
  return (
    <div className="brand">
      {/* The supplied logo is a checked-in static brand asset. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand-logo.png" alt="" width="38" height="38" className="brand-logo" />
      <span>彼日浪影</span>
    </div>
  );
}

function LoginRequired({ setupError, loginStatus }: {
  setupError?: string | null;
  loginStatus?: LoginStatus;
}) {
  const capacityReached = loginStatus === "capacity";
  const needsManualRetry = loginStatus === "expired" || loginStatus === "failed";
  const loginCancelled = loginStatus === "cancelled";
  const invalidLogin = loginStatus === "invalid";
  const title = capacityReached
    ? "內部測試名額已滿"
    : setupError
      ? "登入尚未就緒"
      : needsManualRetry
        ? "LINE 登入未完成"
        : loginCancelled
          ? "已取消 LINE 登入"
          : invalidLogin
            ? "登入連結已失效"
            : "這裡需要登入";
  const message = capacityReached
    ? "目前先開放 100 位使用者；既有使用者仍可正常登入。"
    : setupError
      || (needsManualRetry
        ? "LINE 自動登入可能未完成。若使用 iPhone，請關閉 Safari 私密瀏覽後，改用 LINE 登入畫面重試。"
        : loginCancelled
          ? "你尚未授權登入，可以隨時重新嘗試。"
          : invalidLogin
            ? "這次登入已過期或無法驗證，請重新開始。"
            : "使用 LINE 登入後即可上傳與管理自己的影片。");
  const loginHref = needsManualRetry ? "/api/v1/auth/line?manual=1" : "/api/v1/auth/line";
  return (
    <section className="auth-card">
      <Icon name="user" />
      <h2>{title}</h2>
      <p>{message}</p>
      {!setupError && !capacityReached && <a className="line-login-button" href={loginHref}>{needsManualRetry ? "改用 LINE 登入畫面" : "使用 LINE 登入"}</a>}
    </section>
  );
}

async function exportVideoShareLink(observation: Observation): Promise<string | null> {
  const result = await api<VideoShareLinkResponse>(`/videos/${observation.id}/share-link`, {
    method: "POST",
  });
  const url = new URL(result.path, window.location.origin).toString();
  const quotaMessage = `連結 24 小時有效；透過你本月分享連結的匿名播放額度還剩 ${result.remainingAnonymousPlays} 次。`;
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: `${observation.spot?.name || "浪點"}實拍｜彼日浪影`,
        text: "看看相似浪況下的公開實拍",
        url,
      });
      return quotaMessage;
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return null;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return `分享連結已複製。${quotaMessage}`;
  } catch {
    return `請複製分享連結：${url}（${quotaMessage}）`;
  }
}

function ProjectHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return <div className="help-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="project-help-title">
      <div className="help-heading"><div><h2 id="project-help-title">操作與專案說明</h2><p>{PROJECT_PURPOSE}</p><small className="project-version">版本 {PROJECT_VERSION}</small></div><button type="button" aria-label="關閉說明" onClick={onClose}>×</button></div>
      <section><h3>怎麼使用</h3><ol><li>在找浪頁選浪點、日期與時間，查看相似條件下的歷史實拍。</li><li>上傳 10–60 秒影片並選好浪點；拍攝時間不得晚於現在，缺時間可在七天內補齊。</li><li>在「我的」管理公開名稱、自己的影片、問題回報，以及管理者的檢舉處理。</li></ol></section>
      <section><h3>Purpose and position</h3><ul>{PROJECT_POSITION.map((item) => <li key={item}>{item}</li>)}</ul></section>
    </section>
  </div>;
}

function Topbar({ initialHelpOpen = false }: { initialHelpOpen?: boolean }) {
  const [helpOpen, setHelpOpen] = useState(initialHelpOpen);
  useEffect(() => {
    if (!initialHelpOpen) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("help");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [initialHelpOpen]);
  return <><header className="topbar"><Brand/><button className="help-button" type="button" aria-label="操作與專案說明" onClick={() => setHelpOpen(true)}><Icon name="help"/></button></header>{helpOpen && <ProjectHelp onClose={() => setHelpOpen(false)}/>}</>;
}

function BottomNav({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  return (
    <nav className="bottom-nav" aria-label="主要分頁">
      <button aria-label="找浪" className={view === "find" ? "active" : ""} onClick={() => onChange("find")}><Icon name="search"/></button>
      <button aria-label="上傳" className={view === "upload" ? "active" : ""} onClick={() => onChange("upload")}><Icon name="upload"/></button>
      <button aria-label="我的" className={view === "mine" ? "active" : ""} onClick={() => onChange("mine")}><Icon name="user"/></button>
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

type DownloadStatus = "idle" | "preparing" | "ready";

function compactForecastGroup(group: Forecast["primarySwell"]): string {
  const height = group.height == null ? "—" : `${group.height.toFixed(1)}m`;
  const direction = formatDirection(group.direction);
  const period = group.period == null ? "—" : `${group.period.toFixed(1)}s`;
  return `${height} / ${direction} / ${period}`;
}

function HistoricalForecastTable({ forecasts }: { forecasts: Forecast[] }) {
  if (!forecasts.length) return <p className="owner-forecast-empty">拍攝當時沒有可用的預報快照。</p>;
  return <div className="owner-forecast-scroll">
    <div className="owner-forecast-table">
      <div className="owner-forecast-header"><span>預報</span><span>主浪<br/>浪高／浪向／週期</span><span>次浪<br/>浪高／浪向／週期</span><span>風<br/>風速／風向</span></div>
      {forecasts.map((forecast) => <div className="owner-forecast-row" key={forecast.id}>
        <span><strong>{forecast.provider}</strong><small>{forecast.model}</small></span>
        <span>{compactForecastGroup(forecast.primarySwell)}</span>
        <span>{compactForecastGroup(forecast.secondarySwell)}</span>
        <span>{forecast.wind.speed == null ? "—" : `${forecast.wind.speed.toFixed(1)}m/s`} / {formatDirection(forecast.wind.direction)}</span>
      </div>)}
    </div>
  </div>;
}

function ObservationCard({ observation, ownerActions }: {
  observation: Observation;
  ownerActions?: {
    spots: Spot[];
    onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>;
  };
}) {
  const [note, setNote] = useState(observation.uploaderNote || "");
  const [capturedAt, setCapturedAt] = useState(observation.capturedAt ? toLocalDateTime(new Date(observation.capturedAt)) : "");
  const [error, setError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportStatus, setReportStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>("idle");
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(observation.metadataStatus === "pending");
  const [ownerPlaybackOpen, setOwnerPlaybackOpen] = useState(false);
  const c = observation.conditions;
  const pending = observation.metadataStatus === "pending";
  const canShareOwnerVideo = Boolean(
    ownerActions
    && observation.metadataStatus === "complete"
    && observation.status === "ready"
    && observation.publicAt
    && observation.termsVersion
    && observation.moderationStatus !== "delisted"
  );
  const remainingDays = observation.metadataExpiresAt
    ? Math.max(0, Math.ceil((new Date(observation.metadataExpiresAt).getTime() - new Date().getTime()) / 86_400_000))
    : null;
  const ownerStatus = observation.moderationStatus === "delisted"
    ? "已下架"
    : pending
      ? `待補 · ${remainingDays ?? 7} 天`
      : !observation.termsVersion
        ? "舊版不公開"
        : observation.status === "ready" && observation.publicAt
          ? null
          : "處理中";

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

  async function completePendingMetadata() {
    const parsed = new Date(capturedAt);
    const now = new Date();
    if (!isWithinUploadWindow(parsed, now)) {
      setError("拍攝時間不可晚於現在、必須在 168 小時內，且台北時間須介於 05:00–19:59");
      return;
    }
    await patch({ capturedAt: parsed.toISOString() });
  }

  async function prepareDownload() {
    setError(null);
    setShareNotice(null);
    setDownloadProgress(null);
    setDownloadUrl(null);
    setDownloadStatus("preparing");

    try {
      let result: VideoDownloadResponse | null = null;
      for (let attempt = 0; attempt < 13; attempt += 1) {
        result = await api<VideoDownloadResponse>(`/videos/${observation.id}/download`, {
          method: "POST",
        });
        if (result.type === "mock") {
          throw new Error("Mock 開發模式不會產生實際 MP4。");
        }
        if (result.state === "ready") break;
        setDownloadProgress(result.percentComplete);
        if (attempt === 12) {
          throw new Error("影片仍在準備中，請稍後再試。");
        }
        await new Promise((resolve) => window.setTimeout(resolve, 5_000));
      }

      if (!result || result.type !== "download" || result.state !== "ready") {
        throw new Error("影片下載目前無法使用。");
      }
      setDownloadUrl(result.downloadUrl);
      setDownloadStatus("ready");
      setShareNotice("MP4 已準備好；短效下載連結約 15 分鐘有效。");
    } catch (caught) {
      setDownloadStatus("idle");
      setError(caught instanceof Error ? caught.message : "影片下載目前無法使用");
    }
  }

  async function sharePublicLink() {
    setError(null);
    setShareNotice(null);
    try {
      setShareNotice(await exportVideoShareLink(observation));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "分享連結暫時無法建立");
    }
  }

  if (ownerActions) {
    return <article className={`owner-observation-card ${pending ? "pending-card" : ""}`}>
      <div className="owner-card-visual">
        {observation.video.thumbnailUrl && !thumbnailFailed
          ? <>
              {/* Runtime provider thumbnails use a first-party lifecycle-checking endpoint. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="observation-thumbnail" src={observation.video.thumbnailUrl} alt={`${observation.spot?.name || "浪點"}實拍縮圖`} loading="lazy" decoding="async" onError={() => setThumbnailFailed(true)} />
            </>
          : <div className="wave-lines"><span/><span/><span/></div>}
        <div className="owner-card-shade"/>
        <div className="owner-card-meta"><strong>{observation.spot?.name || "待補浪點"}</strong><span>{formatTime(observation.capturedAt)}</span></div>
        {ownerStatus && <span className="owner-card-status">{ownerStatus}</span>}
        <span className="owner-playback-badge">近 90 天播放 · {observation.playbackCount90d ?? 0} 次</span>
        <button className="owner-details-button" type="button" aria-label={detailsOpen ? "收起更多資訊" : "更多資訊"} aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}><Icon name="more"/></button>
        <button className={`owner-favorite-button ${observation.isFavorite ? "selected" : ""}`} type="button" aria-label={observation.isFavorite ? "取消收藏" : "收藏"} onClick={() => void patch({ isFavorite: !observation.isFavorite })}><Icon name="heart"/></button>
        {canShareOwnerVideo && <button className="owner-play-button" type="button" aria-label="播放影片" onClick={() => setOwnerPlaybackOpen(true)}><span aria-hidden="true">▶</span></button>}
      </div>
      {detailsOpen && <div className="owner-card-details">
        {pending && <div className="metadata-editor">
          <strong>補拍攝時間</strong>
          {observation.spot ? <><small>浪點：{observation.spot.name}（上傳後不可補選或變更）</small><input type="datetime-local" value={capturedAt} min={toLocalDateTime(new Date(new Date().getTime() - 7 * 86_400_000))} max={toLocalDateTime(new Date())} onChange={(event) => setCapturedAt(event.target.value)} /><button className="small-primary" type="button" disabled={!capturedAt} onClick={() => void completePendingMetadata()}>完成補資料</button></> : <small>這支既有影片沒有浪點，無法再補資料；到期後會自動刪除。</small>}
        </div>}
        <div className="owner-controls">
          <label className="switch-row"><span><strong>這段影片顯示公開名稱</strong></span><input type="checkbox" checked={Boolean(observation.showUploader)} onChange={(event) => void patch({ showUploader: event.target.checked })}/></label>
          <div className="fun-field"><span>那天玩得如何？（公開、選填）</span><div><button type="button" className={observation.funReaction === "fun" ? "selected" : ""} onClick={() => void patch({ funReaction: observation.funReaction === "fun" ? null : "fun" })}>👍 開心</button><button type="button" className={observation.funReaction === "not_fun" ? "selected" : ""} onClick={() => void patch({ funReaction: observation.funReaction === "not_fun" ? null : "not_fun" })}>👎 不開心</button></div></div>
          <label className="note-field"><span>上傳者補充（公開、CC0、選填，最多 100 字）</span><input value={note} maxLength={100} placeholder="那天想補充什麼？" onChange={(event) => setNote(event.target.value)} onBlur={() => { if (note !== (observation.uploaderNote || "")) void patch({ uploaderNote: note.trim() || null }); }}/></label>
        </div>
        <section className="owner-forecast-section"><h4>當時預報</h4><HistoricalForecastTable forecasts={observation.historicalForecasts ?? []}/></section>
        {canShareOwnerVideo && <div className="owner-share-panel">
          <div className="owner-share-actions">
            <button className="owner-action-icon" type="button" aria-label="分享連結" title="分享連結" onClick={() => void sharePublicLink()}><Icon name="share"/></button>
            {downloadStatus === "idle" && <button className="owner-action-icon secondary" type="button" aria-label="準備下載 MP4" title="準備下載 MP4" onClick={() => void prepareDownload()}><Icon name="download"/></button>}
            {downloadStatus === "preparing" && <button className="owner-action-icon secondary preparing" type="button" aria-label={downloadProgress == null ? "正在準備 MP4" : `正在準備 MP4，${downloadProgress}%`} title="正在準備 MP4" disabled><Icon name="download"/></button>}
            {downloadStatus === "ready" && downloadUrl && <a className="owner-action-icon secondary" href={downloadUrl} download="surf-video.mp4" aria-label="下載 MP4（非原始檔）" title="下載 MP4（非原始檔）"><Icon name="download"/></a>}
          </div>
          {shareNotice && <p aria-live="polite">{shareNotice}</p>}
          <small>連結固定 24 小時有效；透過分享連結的匿名播放會扣你的每月分享額度，登入者不計。下載的是 Stream 轉出的檔案。</small>
        </div>}
        {error && <p className="inline-error">{error}</p>}
      </div>}
      {ownerPlaybackOpen && <PlaybackModal observation={observation} onClose={() => setOwnerPlaybackOpen(false)}/>}
    </article>;
  }

  return (
    <article className={`observation-card ${pending ? "pending-card" : ""}`}>
      <div className="observation-visual">
        {observation.video.thumbnailUrl && !thumbnailFailed
          ? <>
              {/* Runtime provider thumbnails use a first-party lifecycle-checking endpoint. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="observation-thumbnail" src={observation.video.thumbnailUrl} alt={`${observation.spot?.name || "浪點"}實拍縮圖`} loading="lazy" decoding="async" onError={() => setThumbnailFailed(true)} />
            </>
          : <div className="wave-lines"><span/><span/><span/></div>}
        <span className="status-pill">{observation.moderationStatus === "delisted" ? "已下架" : pending ? `待補 · ${remainingDays ?? 7} 天` : !observation.termsVersion ? "舊版不公開" : observation.status === "ready" ? "公開" : "處理中"}</span>
        <span className="duration-pill">{observation.durationSeconds ? `${Math.round(observation.durationSeconds)} 秒` : "—"}</span>
      </div>
      <div className="observation-body">
        <div className="observation-heading">
          <div><h3>{observation.spot?.name || "待補浪點"}</h3><p>{formatTime(observation.capturedAt)} · {observation.uploaderDisplayId || "匿名上傳"}</p></div>
        </div>

        <div className="condition-grid">
          <ConditionValue label="總浪" value={c.waveHeight} unit="m" />
          <ConditionValue label="主湧浪" value={c.swellHeight} unit="m" />
          <ConditionValue label="週期" value={c.swellPeriod} unit="s" />
          <ConditionValue label="風速" value={c.windSpeed} unit="m/s" />
        </div>
        {observation.funReaction && <p className={`fun-reaction ${observation.funReaction}`}>{observation.funReaction === "fun" ? "👍 上傳者那天玩得開心" : "👎 上傳者那天玩得不開心"}</p>}
        {observation.uploaderNote && <p className="uploader-note">{observation.uploaderNote}</p>}
        {observation.publicAt && <div className="report-area">{reportStatus === "sent" ? <span>已收到檢舉</span> : <><button className="report-toggle" onClick={() => setReportOpen((open) => !open)} disabled={reportStatus === "sending"}>{reportStatus === "sending" ? "送出中…" : "檢舉"}</button>{reportOpen && <div className="report-reasons" aria-label="檢舉原因">{REPORT_REASONS.map(([reason, label]) => <button key={reason} onClick={() => void report(reason)}>{label}</button>)}</div>}</>}</div>}
        {error && <p className="inline-error">{error}</p>}
      </div>
    </article>
  );
}

function ProblemReport({ view }: { view: View }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && status !== "sending") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, status]);

  function close() {
    if (status === "sending") return;
    setOpen(false);
    setMessage("");
    setStatus("idle");
    setError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setError(null);
    try {
      await api("/problem-reports", {
        method: "POST",
        body: JSON.stringify({ message, view }),
      });
      setStatus("sent");
      setMessage("");
    } catch (caught) {
      setStatus("idle");
      setError(caught instanceof Error ? caught.message : "問題回報送出失敗");
    }
  }

  return <>
    <button className="problem-report-trigger" type="button" onClick={() => setOpen(true)}>問題回報</button>
    {open && <div className="problem-report-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="problem-report-dialog" role="dialog" aria-modal="true" aria-labelledby="problem-report-title">
        {status === "sent" ? <div className="problem-report-success" aria-live="polite">
          <strong id="problem-report-title">已收到，謝謝你</strong>
          <p>我們會查看這則問題回報。</p>
          <button className="small-primary" type="button" onClick={close}>完成</button>
        </div> : <form onSubmit={(event) => void submit(event)}>
          <div className="problem-report-heading">
            <div><h2 id="problem-report-title">問題回報</h2><p>簡短描述發生什麼事即可，不需留下個資。</p></div>
            <button type="button" aria-label="關閉問題回報" onClick={close}>×</button>
          </div>
          <label htmlFor="problem-report-message">遇到什麼問題？</label>
          <textarea
            id="problem-report-message"
            autoFocus
            required
            minLength={5}
            maxLength={300}
            value={message}
            placeholder="例如：按下播放後沒有反應"
            onChange={(event) => setMessage(event.target.value)}
          />
          <div className="problem-report-meta"><span>{message.length}/300</span>{error && <span className="inline-error">{error}</span>}</div>
          <button className="small-primary" type="submit" disabled={status === "sending" || message.trim().length < 5}>{status === "sending" ? "送出中…" : "送出"}</button>
        </form>}
      </section>
    </div>}
  </>;
}

function compactMetric(value: number | null, unit: string): string {
  return value == null ? "—" : `${value.toFixed(1)}${unit}`;
}

function formatTideState(value: string | null): string {
  return ({ rising: "漲潮", falling: "退潮", high: "滿潮", low: "乾潮", unknown: "未知" } as Record<string, string>)[value || ""] || "—";
}

type SwellPairing = CombinedMatch["sources"][number]["swellPairing"];

interface ForecastComparisonRow {
  label: string;
  targetValue: string;
  candidateValue: string;
  pairing?: string;
}

function swellName(label: "primary" | "secondary"): string {
  return label === "primary" ? "主湧浪" : "次湧浪";
}

function swellGroup(forecast: Forecast, label: "primary" | "secondary") {
  return label === "primary" ? forecast.primarySwell : forecast.secondarySwell;
}

function compactForecastMetricGroup(group: Forecast["totalWave"]): string {
  return `${compactMetric(group.height, "m")} · ${formatDirection(group.direction)} · ${compactMetric(group.period, "s")}`;
}

function forecastComparisonRows(
  target: Forecast,
  candidate: Forecast,
  pairing: SwellPairing,
): ForecastComparisonRow[] {
  const pairingByTarget = new Map(pairing.map((item) => [item.target, item.candidate]));
  const swellRows = (["primary", "secondary"] as const).map((targetLabel): ForecastComparisonRow => {
    const candidateLabel = pairingByTarget.get(targetLabel) ?? null;
    return {
      label: swellName(targetLabel),
      targetValue: compactForecastMetricGroup(swellGroup(target, targetLabel)),
      candidateValue: candidateLabel
        ? `${swellName(candidateLabel)} · ${compactForecastMetricGroup(swellGroup(candidate, candidateLabel))}`
        : "未配對",
      pairing: `${targetLabel}:${candidateLabel ?? "none"}`,
    };
  });
  return [
    { label: "總浪", targetValue: compactForecastMetricGroup(target.totalWave), candidateValue: compactForecastMetricGroup(candidate.totalWave) },
    ...swellRows,
    { label: "風浪", targetValue: compactForecastMetricGroup(target.windWave), candidateValue: compactForecastMetricGroup(candidate.windWave) },
    { label: "風", targetValue: `${compactMetric(target.wind.speed, "m/s")} · ${formatDirection(target.wind.direction)} · 陣風 ${compactMetric(target.wind.gust, "m/s")}`, candidateValue: `${compactMetric(candidate.wind.speed, "m/s")} · ${formatDirection(candidate.wind.direction)} · 陣風 ${compactMetric(candidate.wind.gust, "m/s")}` },
    { label: "潮位", targetValue: `${compactMetric(target.tide.height, "m")} · ${formatTideState(target.tide.state)} · ${compactMetric(target.tide.slope, "m/h")}`, candidateValue: `${compactMetric(candidate.tide.height, "m")} · ${formatTideState(candidate.tide.state)} · ${compactMetric(candidate.tide.slope, "m/h")}` },
  ];
}

function sourceName(provider: string): string {
  return provider === "cwa" ? "CWA" : provider === "open-meteo" ? "ECMWF" : provider;
}

function CombinedForecastDetails({ match }: { match: CombinedMatch }) {
  return <div className="combined-forecast-details">
    {match.sources.map((source) => {
      const rows = forecastComparisonRows(
        source.targetForecast,
        source.candidateForecast,
        source.swellPairing,
      );
      return <section key={`${source.provider}:${source.model}`} className="combined-source-comparison">
        <div className="combined-source-heading"><strong>{sourceName(source.provider)}</strong><small>來源相似度 {Math.round(source.score * 100)}%</small></div>
        <div className="combined-metric-header"><span>特徵</span><span>目標</span><span>實拍當時（配對）</span></div>
        {rows.map((row) => <div className="combined-metric-row" data-swell-pairing={row.pairing} key={row.label}>
          <strong>{row.label}</strong><span>{row.targetValue}</span><span>{row.candidateValue}</span>
        </div>)}
      </section>;
    })}
  </div>;
}

function CandidateThumbnail({ observation }: { observation: Observation }) {
  const [failed, setFailed] = useState(false);
  if (!observation.video.thumbnailUrl || failed) {
    return <div className="candidate-thumbnail candidate-thumbnail-fallback"><Icon name="wave"/><span>縮圖準備中</span></div>;
  }
  return (
    <div className="candidate-thumbnail">
      {/* Runtime provider thumbnails use a first-party lifecycle-checking endpoint. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={observation.video.thumbnailUrl}
        alt={`${observation.spot?.name || "浪點"} ${formatTime(observation.capturedAt)} 實拍縮圖`}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function PlaybackModal({ observation, onClose }: { observation: Observation; onClose: () => void }) {
  const [playback, setPlayback] = useState<PlaybackResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportStatus, setReportStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playbackRecorded = useRef(false);

  useEffect(() => {
    let active = true;
    void api<PlaybackResponse>(`/videos/${observation.id}/playback`, { method: "POST" })
      .then((result) => { if (active) setPlayback(result); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "影片播放失敗"); });
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      active = false;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [observation.id, onClose]);

  useEffect(() => {
    if (playback?.type !== "iframe" || !iframeRef.current) return;
    let active = true;
    let player: StreamPlayer | null = null;
    const recordStartedPlayback = () => {
      if (!active || playbackRecorded.current) return;
      playbackRecorded.current = true;
      void api(`/videos/${observation.id}/playback-start`, {
        method: "POST",
        body: JSON.stringify({ trackingToken: playback.trackingToken }),
      }).catch(() => undefined);
    };
    void loadStreamPlayerSdk().then((stream) => {
      if (!active || !iframeRef.current) return;
      player = stream(iframeRef.current);
      player.addEventListener("playing", recordStartedPlayback);
    }).catch(() => undefined);
    return () => {
      active = false;
      player?.removeEventListener?.("playing", recordStartedPlayback);
    };
  }, [observation.id, playback]);

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

  async function share() {
    setError(null);
    setShareNotice(null);
    try {
      setShareNotice(await exportVideoShareLink(observation));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "分享連結暫時無法建立");
    }
  }

  const portrait = playback?.width != null
    && playback.height != null
    && playback.height > playback.width;
  const playerStyle = playback?.width != null && playback.height != null
    ? {
        aspectRatio: `${playback.width} / ${playback.height}`,
        ...(portrait
          ? {
              width: `min(100%, calc(60svh * ${playback.width / playback.height}))`,
              maxHeight: "60svh",
              marginInline: "auto",
            }
          : {}),
      }
    : undefined;

  return <div className="playback-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="playback-modal" role="dialog" aria-modal="true" aria-labelledby={`playback-title-${observation.id}`}>
      <div className="playback-modal-heading">
        <div><strong id={`playback-title-${observation.id}`}>{observation.spot?.name || "浪點"}實拍</strong><small>{formatTime(observation.capturedAt)}</small></div>
        <button type="button" aria-label="關閉影片" onClick={onClose}>×</button>
      </div>
      <div className="playback-modal-player" style={playerStyle}>
        {playback?.type === "iframe"
          ? <iframe
              ref={iframeRef}
              src={playback.iframeUrl}
              title={`${observation.spot?.name || "浪點"}實拍影片`}
              allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          : playback?.type === "mock"
            ? <div className="mock-player"><Icon name="wave"/><strong>Mock 播放已啟動</strong><span>正式環境會在此載入受保護的 Stream 播放器。</span></div>
            : error
              ? <div className="playback-modal-state inline-error">{error}</div>
              : <div className="playback-modal-state"><span className="spinner"/>建立安全播放連結…</div>}
      </div>
      <div className="playback-modal-footer">
        {observation.uploaderDisplayId && <span>{`id: ${observation.uploaderDisplayId}`}</span>}
        <div><button type="button" onClick={() => void share()}>分享</button>{reportStatus === "sent" ? <strong>已收到檢舉</strong> : <button type="button" disabled={reportStatus === "sending"} onClick={() => setReportOpen((open) => !open)}>{reportStatus === "sending" ? "送出中…" : "檢舉影片"}</button>}</div>
      </div>
      {reportOpen && <div className="playback-report-reasons" aria-label="檢舉原因">{REPORT_REASONS.map(([reason, label]) => <button type="button" key={reason} onClick={() => void report(reason)}>{label}</button>)}</div>}
      {shareNotice && <p className="playback-share-notice" aria-live="polite">{shareNotice}</p>}
      {error && <p className="playback-error">{error}</p>}
    </section>
  </div>;
}

function CombinedMatchList({ matches }: { matches: CombinedMatch[] }) {
  const [activeObservation, setActiveObservation] = useState<Observation | null>(null);
  return (
    <section className="combined-match-area">
      <div className="candidate-forecast-strip" aria-label="CWA 與 ECMWF 綜合相似實拍">
        {matches.map((match) => <article className="candidate-forecast-card" key={match.observation.id}>
          <button
            type="button"
            className="candidate-play-button"
            aria-label={`播放 ${match.observation.spot?.name || "浪點"} ${formatTime(match.observation.capturedAt)} 實拍，相似度 ${Math.round(match.score * 100)}%`}
            onClick={() => setActiveObservation(match.observation)}
          >
            <CandidateThumbnail observation={match.observation}/>
            <span className="candidate-thumbnail-date">{formatTime(match.observation.capturedAt)}</span>
            <span className="candidate-thumbnail-score">相似度 {Math.round(match.score * 100)}%</span>
            <span className="candidate-play-icon" aria-hidden="true">▶</span>
          </button>
          <CombinedForecastDetails match={match}/>
        </article>)}
      </div>
      {activeObservation && <PlaybackModal observation={activeObservation} onClose={() => setActiveObservation(null)}/>}
    </section>
  );
}

function RecentObservationList({ observations }: { observations: Observation[] }) {
  const [activeObservation, setActiveObservation] = useState<Observation | null>(null);
  return (
    <section className="time-window-observation-area" aria-label="近兩小時的即時影片">
      <div className="time-window-observation-strip">
        {observations.map((observation) => <button
          type="button"
          className="time-window-observation-card"
          key={observation.id}
          aria-label={`播放 ${observation.spot?.name || "浪點"} ${formatTime(observation.capturedAt)} 實拍`}
          onClick={() => setActiveObservation(observation)}
        >
          <CandidateThumbnail observation={observation}/>
          <span className="candidate-thumbnail-date">{formatTime(observation.capturedAt)}</span>
          <span className="candidate-play-icon" aria-hidden="true">▶</span>
        </button>)}
      </div>
      {activeObservation && <PlaybackModal observation={activeObservation} onClose={() => setActiveObservation(null)}/>}
    </section>
  );
}

export function SurfApp({ loginStatus, initialHelpOpen = false }: { loginStatus?: LoginStatus; initialHelpOpen?: boolean }) {
  const [view, setView] = useState<View>(loginStatus ? "mine" : "find");
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
      <Topbar initialHelpOpen={initialHelpOpen}/>
      {view === "find" && <FindView spots={spots}/>}
      {view === "upload" && (me ? <UploadView spots={spots} me={me} onComplete={(observation) => { setObservations((current) => [observation, ...current]); setView("mine"); }}/> : authChecked && <div className="screen"><LoginRequired setupError={authSetupError} loginStatus={loginStatus}/></div>)}
      {view === "mine" && (me ? <MineView me={me} spots={spots} observations={observations} onPatch={patchObservation} onMeChange={setMe}/> : authChecked && <div className="screen"><LoginRequired setupError={authSetupError} loginStatus={loginStatus}/></div>)}
      <BottomNav view={view} onChange={setView}/>
    </main>
  );
}

function FindSpotStrip({ spots, selectedSpotId, onSelect }: {
  spots: Spot[];
  selectedSpotId: string;
  onSelect: (spotId: string) => void;
}) {
  const choices = useMemo(
    () => spots.map((spot) => ({ id: spot.id, name: spot.name, selectable: true })),
    [spots],
  );
  const defaultIds = useMemo(() => choices.map((choice) => choice.id), [choices]);
  const [order, setOrder] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const pressTimer = useRef<number | null>(null);
  const drag = useRef<{
    id: string;
    startX: number;
    startY: number;
    startScrollLeft: number;
    lastPointerX: number;
    direction: -1 | 0 | 1;
    swapLockedUntil: number;
    active: boolean;
    scrolling: boolean;
  } | null>(null);
  const previousPositions = useRef(new Map<string, DOMRect>());
  const suppressClick = useRef(false);

  useEffect(() => {
    let saved: string[] = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(SPOT_ORDER_STORAGE_KEY) || "[]") as unknown;
      if (Array.isArray(parsed) && parsed.every((id) => typeof id === "string")) saved = parsed;
    } catch {
      saved = [];
    }
    const frame = window.requestAnimationFrame(() => {
      setOrder((current) => mergeSpotOrder(defaultIds, current.length ? current : saved));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [defaultIds]);

  useEffect(() => {
    if (order.length) localStorage.setItem(SPOT_ORDER_STORAGE_KEY, JSON.stringify(order));
  }, [order]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const scrollWheelHorizontally = (event: WheelEvent) => {
      if (strip.scrollWidth <= strip.clientWidth) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (delta === 0) return;
      strip.scrollLeft += delta;
      event.preventDefault();
    };
    strip.addEventListener("wheel", scrollWheelHorizontally, { passive: false });
    return () => strip.removeEventListener("wheel", scrollWheelHorizontally);
  }, []);

  useLayoutEffect(() => {
    const strip = stripRef.current;
    const previous = previousPositions.current;
    if (!strip || previous.size === 0) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const shell of strip.querySelectorAll<HTMLElement>("[data-spot-order-id]")) {
      const before = previous.get(shell.dataset.spotOrderId || "");
      if (!before || shell.dataset.spotOrderId === draggingId) continue;
      const after = shell.getBoundingClientRect();
      const deltaX = before.left - after.left;
      if (!reduceMotion && Math.abs(deltaX) > 1) {
        shell.animate(
          [{ transform: `translateX(${deltaX}px)` }, { transform: "translateX(0)" }],
          { duration: 180, easing: "cubic-bezier(.2,.75,.25,1)" },
        );
      }
    }
    previous.clear();
  }, [draggingId, order]);

  function clearTimer() {
    if (pressTimer.current != null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }

  function beginPress(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    clearTimer();
    suppressClick.current = false;
    drag.current = {
      id,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: stripRef.current?.scrollLeft ?? 0,
      lastPointerX: event.clientX,
      direction: 0,
      swapLockedUntil: 0,
      active: false,
      scrolling: false,
    };
    const button = event.currentTarget;
    const pointerId = event.pointerId;
    pressTimer.current = window.setTimeout(() => {
      if (!drag.current || drag.current.id !== id) return;
      drag.current.active = true;
      suppressClick.current = true;
      setDraggingId(id);
      button.setPointerCapture?.(pointerId);
    }, 450);
  }

  function capturePositions() {
    const strip = stripRef.current;
    if (!strip) return;
    previousPositions.current = new Map(
      [...strip.querySelectorAll<HTMLElement>("[data-spot-order-id]")]
        .map((shell) => [shell.dataset.spotOrderId || "", shell.getBoundingClientRect()]),
    );
  }

  function movePress(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current) return;
    const deltaX = event.clientX - current.startX;
    const deltaY = event.clientY - current.startY;
    if (!current.active) {
      if (!current.scrolling && Math.abs(deltaY) > 9 && Math.abs(deltaY) >= Math.abs(deltaX)) {
        clearTimer();
        drag.current = null;
        return;
      }
      if (current.scrolling || (Math.abs(deltaX) > 6 && Math.abs(deltaX) > Math.abs(deltaY))) {
        clearTimer();
        current.scrolling = true;
        suppressClick.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        if (stripRef.current) stripRef.current.scrollLeft = current.startScrollLeft - deltaX;
        event.preventDefault();
      }
      return;
    }
    event.preventDefault();
    const pointerMotionX = event.clientX - current.lastPointerX;
    if (Math.abs(pointerMotionX) >= 1) {
      current.direction = pointerMotionX > 0 ? 1 : -1;
      current.lastPointerX = event.clientX;
    }
    const strip = stripRef.current;
    if (strip) {
      const bounds = strip.getBoundingClientRect();
      if (event.clientX < bounds.left + 36) strip.scrollLeft -= 12;
      else if (event.clientX > bounds.right - 36) strip.scrollLeft += 12;
    }
    if (!strip || event.timeStamp < current.swapLockedUntil) return;
    const stripBounds = strip.getBoundingClientRect();
    const positions = [...strip.querySelectorAll<HTMLElement>("[data-spot-order-id]")].map((shell) => ({
      id: shell.dataset.spotOrderId || "",
      centerX: stripBounds.left + shell.offsetLeft - strip.scrollLeft + shell.offsetWidth / 2,
    }));
    const target = spotReorderTarget(
      positions.map((position) => position.id),
      current.id,
      event.clientX,
      current.direction,
      positions,
    );
    if (target && target !== current.id) {
      capturePositions();
      current.swapLockedUntil = event.timeStamp + 90;
      setOrder((existing) => moveSpotId(mergeSpotOrder(defaultIds, existing), current.id, target));
    }
  }

  function endPress() {
    clearTimer();
    if (drag.current?.active) suppressClick.current = true;
    drag.current = null;
    setDraggingId(null);
  }

  const byId = new Map(choices.map((choice) => [choice.id, choice]));
  const orderedChoices = mergeSpotOrder(defaultIds, order).flatMap((id) => {
    const choice = byId.get(id);
    return choice ? [choice] : [];
  });

  return <div
    ref={stripRef}
    className={`spot-strip ${draggingId ? "reordering" : ""}`}
    aria-label="選擇浪點；左右拖曳可滑動，長按按鈕可拖曳排序"
    onContextMenu={(event) => event.preventDefault()}
  >
    {orderedChoices.map((choice) => <span
      className={`spot-choice-shell ${draggingId === choice.id ? "dragging" : ""}`}
      key={choice.id}
      data-spot-order-id={choice.id}
    ><button
        type="button"
        draggable={false}
        className={`${choice.id === selectedSpotId ? "selected" : ""} ${draggingId === choice.id ? "dragging" : ""}`}
        aria-pressed={choice.selectable ? choice.id === selectedSpotId : undefined}
        aria-disabled={!choice.selectable}
        onDragStart={(event) => event.preventDefault()}
        onPointerDown={(event) => beginPress(event, choice.id)}
        onPointerMove={movePress}
        onPointerUp={endPress}
        onPointerCancel={endPress}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          if (choice.selectable) onSelect(choice.id);
        }}
      >{choice.name}</button></span>)}
  </div>;
}

function FindView({ spots }: { spots: Spot[] }) {
  const [now, setNow] = useState(() => new Date());
  const [dayOffset, setDayOffset] = useState(() => firstSelectableForecastHour(0) == null ? 1 : 0);
  const [hour, setHour] = useState(() => firstSelectableForecastHour(0) ?? 8);
  const [spotId, setSpotId] = useState("");
  const emptyResults = useMemo(() => ({ matches: [], timeWindowObservations: [] }), []);
  const [queryState, setQueryState] = useState<FindQueryState<{
    matches: CombinedMatch[];
    timeWindowObservations: Observation[];
  }>>({
    requestId: 0,
    queryKey: null,
    results: emptyResults,
    loading: false,
    error: null,
  });
  const requestIdRef = useRef(0);
  const selectedSpotId = spotId || spots[0]?.id || "";
  const minimumDayOffset = firstSelectableForecastHour(0, now) == null ? 1 : 0;
  const effectiveDayOffset = Math.max(dayOffset, minimumDayOffset);
  const minimumHour = firstSelectableForecastHour(effectiveDayOffset, now) ?? FORECAST_HOUR_MIN;
  const effectiveHour = Math.max(hour, minimumHour);
  const targetTime = taipeiForecastTarget(effectiveDayOffset, effectiveHour, now).toISOString();
  const requestPath = selectedSpotId
    ? `/matches?spotId=${encodeURIComponent(selectedSpotId)}&targetTime=${encodeURIComponent(targetTime)}`
    : null;
  const { results, loading, error } = visibleFindQuery(queryState, requestPath, emptyResults);
  const { matches, timeWindowObservations } = results;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!requestPath) return;
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    const controller = new AbortController();
    setQueryState((current) => reduceFindQuery(current, {
      type: "start",
      requestId,
      queryKey: requestPath,
      emptyResults,
    }));
    const timer = window.setTimeout(() => {
      void api<PublicMatchesResponse>(requestPath, { signal: controller.signal })
        .then((result) => setQueryState((current) => reduceFindQuery(current, {
          type: "success",
          requestId,
          queryKey: requestPath,
          results: {
            matches: result.matches,
            timeWindowObservations: result.timeWindowObservations,
          },
        })))
        .catch((caught) => {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          setQueryState((current) => reduceFindQuery(current, {
            type: "failure",
            requestId,
            queryKey: requestPath,
            error: caught instanceof Error ? caught.message : "比對失敗",
          }));
        });
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [emptyResults, requestPath]);

  const dayCells = Array.from({ length: FORECAST_DAY_OFFSET_MAX + 1 }, (_, offset) => {
    const target = taipeiForecastTarget(offset, 12, now);
    return {
      date: new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric" }).format(target),
      weekday: new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", weekday: "short" }).format(target),
    };
  });
  return <div className="screen find-screen">
    <div className="search-panel">
      <FindSpotStrip spots={spots} selectedSpotId={selectedSpotId} onSelect={setSpotId}/>
      <label className="range-field day-range-field"><div className="day-discrete-slider"><div className="day-segment-track" aria-hidden="true">{dayCells.map((cell, offset) => <span key={offset} className={`${offset <= COMPOSITE_FORECAST_DAY_OFFSET_MAX ? "multi-source" : "ecmwf-only"} ${offset === effectiveDayOffset ? "selected" : ""} ${offset < minimumDayOffset ? "unavailable" : ""}`}><strong>{cell.date}</strong><small>{cell.weekday}</small></span>)}</div><input aria-label="預報日期，離散五日" aria-valuetext={`${dayCells[effectiveDayOffset]?.date} ${dayCells[effectiveDayOffset]?.weekday}`} type="range" min="0" max={FORECAST_DAY_OFFSET_MAX} step="1" value={effectiveDayOffset} onChange={(event) => { const nextDay = Math.max(Number(event.target.value), minimumDayOffset); setDayOffset(nextDay); setHour((current) => Math.max(current, firstSelectableForecastHour(nextDay, now) ?? FORECAST_HOUR_MIN)); }}/></div><div className="forecast-window-legend"><span className="multi-source"><i/>第 1–3 天：CWA＋ECMWF</span><span className="ecmwf-only"><i/>第 4–5 天：ECMWF-only</span></div></label>
      <label className="range-field"><span>時間 <output>{String(effectiveHour).padStart(2, "0")}:00</output></span><input type="range" min={minimumHour} max={FORECAST_HOUR_MAX} step="1" value={effectiveHour} onChange={(event) => setHour(Number(event.target.value))}/></label>
    </div>
    {loading && <div className="progress-message"><span className="spinner"/>比對中</div>}
    {error && <div className="error-message">{error}</div>}
    <section className="result-section"><div className="section-heading"><h2>相似歷史實拍</h2><small>{loading ? "查詢中" : matches.length ? `${matches.length} 段` : "累積中"}</small></div>
      {matches.length
        ? <CombinedMatchList matches={matches}/>
        : !loading && !error && <div className="info-state"><Icon name="wave"/><p>{effectiveDayOffset <= COMPOSITE_FORECAST_DAY_OFFSET_MAX ? "尚未累積同時具備 CWA 與 ECMWF 歷史預報的實拍；資料完整後會以一個綜合相似度排序。" : "尚未累積具備 ECMWF 歷史預報的實拍；第 4–5 天會使用 ECMWF-only 相似度排序。"}</p></div>}
      <div className="time-window-observation-section">
        <div className="section-heading"><h3>即時影片（近 2 小時）</h3><small>{loading ? "查詢中" : `${timeWindowObservations.length} 段`}</small></div>
        {timeWindowObservations.length
          ? <RecentObservationList observations={timeWindowObservations}/>
          : !loading && !error && <div className="time-window-empty">近兩小時還沒有實拍。</div>}
      </div>
    </section>
  </div>;
}

function UploadView({ spots, me, onComplete }: { spots: Spot[]; me: Me; onComplete: (observation: Observation) => void }) {
  const initialSpot = typeof window !== "undefined" ? localStorage.getItem("lastSpotId") || "" : "";
  const [spotId, setSpotId] = useState(initialSpot || spots[0]?.id || "");
  const [capturedAt, setCapturedAt] = useState("");
  const [captureTimeHint, setCaptureTimeHint] = useState("選擇影片後會顯示時間提示來源，送出前請確認");
  const [spotHint, setSpotHint] = useState(initialSpot ? "上次使用的浪點，請確認" : "預設浪點，請確認");
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [showUploader, setShowUploader] = useState(false);
  const [uploadGuideOpen, setUploadGuideOpen] = useState(false);
  const [rightsHelpOpen, setRightsHelpOpen] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function inspectVideo(selected: File) {
    if (selected.size > MAX_UPLOAD_BYTES) throw new Error("影片不可超過 200 MB");
    if (!selected.type.startsWith("video/")) throw new Error("請選擇影片檔案");
    setError(null);
    setFile(null);
    setDuration(null);
    const metadataPromise = inspectQuickTimeMetadata(selected).catch(() => ({
      recordedAt: null,
      containerCreatedAt: null,
      location: null,
      bytesRead: 0,
    }));
    const url = URL.createObjectURL(selected);
    try {
      const durationPromise = new Promise<number>((resolve, reject) => {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () => resolve(video.duration);
        video.onerror = () => reject(new Error("無法讀取影片長度"));
        video.src = url;
      });
      const [seconds, metadata] = await Promise.all([durationPromise, metadataPromise]);
      if (!Number.isFinite(seconds) || seconds < MIN_VIDEO_DURATION_SECONDS || seconds > MAX_VIDEO_DURATION_SECONDS) throw new Error("影片長度必須為 10–60 秒");
      const prefill = resolveUploadPrefill(metadata, selected.lastModified, spotId, spots);
      setCapturedAt(prefill.capturedAt ? toLocalDateTime(prefill.capturedAt) : "");
      setCaptureTimeHint(prefill.captureTimeLabel);
      setSpotId(prefill.spotId);
      setSpotHint(prefill.spotLabel);
      setFile(selected);
      setDuration(seconds);
    } finally { URL.revokeObjectURL(url); }
  }

  function chooseVideo(selected: File | undefined) {
    if (!selected) return;
    void inspectVideo(selected).catch((caught) => setError(caught instanceof Error ? caught.message : "無法讀取影片"));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file || duration == null) return setError("請先選擇影片");
    if (!spotId) return setError("請先選擇浪點");
    if (capturedAt) {
      const parsed = new Date(capturedAt);
      const now = new Date();
      if (!isWithinUploadWindow(parsed, now)) return setError("拍攝時間不可晚於現在、必須在 168 小時內，且台北時間須介於 05:00–19:59");
    }
    setError(null); setProgress("建立上傳連結…");
    try {
      const ticket = await api<UploadTicket>("/videos/upload-request", { method: "POST", body: JSON.stringify({ spotId, capturedAt: capturedAt ? new Date(capturedAt).toISOString() : null, durationSeconds: duration, sizeBytes: file.size, fileName: file.name, contentType: file.type, showUploader }) });
      localStorage.setItem("lastSpotId", spotId);
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

  return <div className="screen upload-screen">
    <form onSubmit={submit} className="upload-form">
      <section className="upload-source-card" aria-labelledby="upload-source-title">
        <div className="upload-source-heading">
          <h1 id="upload-source-title">上傳影片</h1>
          <p>10–60 秒，拍攝時間 05:00–19:59</p>
        </div>
        <div className="upload-confidence-prompt">
          <span>上傳你也希望在找浪時看到的影片</span>
          <button
            className="upload-confidence-help"
            type="button"
            aria-label="了解上傳影片如何成為浪況參考"
            aria-expanded={uploadGuideOpen}
            aria-controls="upload-confidence-guide"
            onClick={() => setUploadGuideOpen((open) => !open)}
          >?</button>
        </div>
        {uploadGuideOpen && <p className="upload-confidence-guide" id="upload-confidence-guide">
          系統會以影片的拍攝時間與浪點，比對當時可得的 CWA 與 ECMWF 浪況。之後有人搜尋到相似預報時，這段實拍就可能成為他的浪況參考。每一段真實畫面，都能讓下一位浪人更有把握出發。
        </p>}
        <div className="upload-source-picker" role="group" aria-label="影片來源">
          <label title="選擇影片"><input aria-label="選擇影片" type="file" accept="video/*" onChange={(event) => chooseVideo(event.target.files?.[0])}/><Icon name="upload"/></label>
          <label title="錄影"><input aria-label="錄影" type="file" accept="video/*" capture="environment" onChange={(event) => chooseVideo(event.target.files?.[0])}/><Icon name="camera"/></label>
        </div>
        {file && duration != null
          ? <div className="selected-video-summary"><strong>{file.name}</strong><small>{duration.toFixed(1)} 秒 · {(file.size / 1_000_000).toFixed(1)} MB</small></div>
          : <p className="upload-source-help">可從相簿選擇，或使用裝置相機錄影</p>}
      </section>
      <div className="two-fields"><label><span>浪點</span><select required value={spotId} onChange={(event) => { setSpotId(event.target.value); setSpotHint("已手動選擇；上傳後不可變更"); }}>{spots.map((spot) => <option key={spot.id} value={spot.id}>{spot.name}</option>)}</select><small className="field-hint">{spotHint}</small></label><label><span>拍攝時間</span><input type="datetime-local" min={toLocalDateTime(new Date(new Date().getTime() - 7 * 86_400_000))} max={toLocalDateTime(new Date())} value={capturedAt} onChange={(event) => { setCapturedAt(event.target.value); setCaptureTimeHint("已手動調整，送出前請確認"); }}/><small className="field-hint">{captureTimeHint}</small></label></div>
      <p className="pending-help">浪點上傳後不可補選或變更；拍攝時間可在 7 天內補齊，補齊前影片不公開。</p>
      <label className="switch-row"><span><strong>顯示公開名稱</strong><small>{me.displayId || "先到「我的」確認公開名稱"}</small></span><input type="checkbox" disabled={!me.displayId} checked={showUploader} onChange={(event) => setShowUploader(event.target.checked)}/></label>
      <div className="public-notice">
        <div className="public-notice-heading">
          <strong>公開提醒</strong>
        </div>
        <p>{PUBLIC_MEDIA_NOTICE}{" "}<button
            className="rights-help-inline"
            type="button"
            aria-label="查看人物入鏡與權利說明"
            aria-expanded={rightsHelpOpen}
            aria-controls="upload-people-rights-help"
            onClick={() => setRightsHelpOpen((open) => !open)}
          >{rightsHelpOpen ? "收合" : "更多"}</button></p>
        {rightsHelpOpen && <section className="rights-help-panel" id="upload-people-rights-help" aria-labelledby="upload-people-rights-title">
          <h2 id="upload-people-rights-title">人物入鏡怎麼判斷？</h2>
          <ul>
            <li>海灘或海面的廣角浪況畫面中，人物只是附帶入鏡時，本服務不要求逐一取得每個人的同意。</li>
            <li>若人物可辨識且是主要拍攝對象，請先取得本人同意；若是未成年人，請取得家長或監護人同意。</li>
            <li>無法取得同意時，請裁切或模糊；不要上傳敏感、持續跟追或可能傷害當事人的內容。</li>
            <li>公開場所不代表完全放棄肖像與隱私權；實際判斷仍會依個別情況不同。</li>
            <li>{PUBLIC_MEDIA_THIRD_PARTY_RIGHTS_NOTICE}</li>
            <li>當事人可使用檢舉功能提出下架要求，平台會依個案審查。</li>
          </ul>
          <div className="rights-help-sources">
            <strong>官方資料</strong>
            <ul>
              <li><a href="https://mojlaw.moj.gov.tw/NewsContentE.aspx?id=29&lan=C" target="_blank" rel="noopener noreferrer">法務部：個人資料保護法第 51 條</a><span>說明公開場所影音在個資法中的例外範圍；不等於排除肖像或隱私等其他權利。</span></li>
              <li><a href="https://www.tipo.gov.tw/tw/copyright/774-5048.html" target="_blank" rel="noopener noreferrer">智慧財產局：公共場合人物與肖像權</a><span>說明人物是照片主要元素時，建議先取得被拍攝者同意。</span></li>
              <li><a href="https://cons.judicial.gov.tw/docdata.aspx?fid=100&id=310870&rn=6185" target="_blank" rel="noopener noreferrer">憲法法庭：釋字第 689 號</a><span>說明人在公共場域仍可能合理期待不受侵擾，持續跟追也有界線。</span></li>
              <li><a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener noreferrer">Creative Commons：CC0 1.0</a><span>說明 CC0 不影響第三人可能擁有的肖像、隱私及其他權利。</span></li>
            </ul>
          </div>
          <p className="rights-help-disclaimer">這是上傳判斷提示與官方資料整理，不是對個案的法律保證或法律意見。</p>
        </section>}
      </div>
      {error && <div className="error-message">{error}</div>}{progress && <div className="progress-message"><span className="spinner"/>{progress}</div>}
      <button className="submit-button" disabled={!file || !spotId || Boolean(progress)}>{progress ? "處理中" : "上傳影片"}</button>
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
  const [editingDisplayId, setEditingDisplayId] = useState(false);
  const [displayId, setDisplayId] = useState(me.displayId || me.suggestedDisplayName || "");
  const [profileBusy, setProfileBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filtered = useMemo(() => observations.filter((item) => filter === "all" || filter === "pending" && item.metadataStatus === "pending" || item.spot?.id === filter), [filter, observations]);
  async function saveProfile(nextDisplayId: string | null) {
    setError(null);
    setProfileBusy(true);
    try {
      const updated = await api<Pick<Me, "displayId" | "showIdentityDefault">>("/me", {
        method: "PATCH",
        body: JSON.stringify({ displayId: nextDisplayId, showIdentityDefault: false }),
      });
      setDisplayId(updated.displayId || "");
      onMeChange({ ...me, ...updated });
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "儲存失敗");
      return false;
    } finally {
      setProfileBusy(false);
    }
  }

  return <div className="screen mine-screen"><div className="page-title mine-title"><div><h1>我的</h1><p>{observations.length} 段影片</p></div></div>
    <section className="profile-panel">
      <button className="public-id-edit" type="button" aria-label="編輯公開名稱" onClick={() => setEditingDisplayId((open) => !open)}><span>公開名稱: {me.displayId || "未設定"}</span><b aria-hidden="true">✎</b></button>
      {editingDisplayId && <div className="display-id-editor"><label htmlFor="display-id-input"><span>公開名稱</span></label><div><input id="display-id-input" value={displayId} minLength={2} maxLength={24} onChange={(event) => setDisplayId(event.target.value)} placeholder="例如 浪人小明"/><button className="small-primary" type="button" disabled={profileBusy} onClick={() => { const nextId = displayId.trim() || null; void saveProfile(nextId).then((saved) => { if (saved) setEditingDisplayId(false); }); }}>儲存</button></div>{!me.displayId && me.suggestedDisplayName && <p>已從 LINE 私下預填；只有儲存後才會成為本站公開名稱。</p>}</div>}
      {me.authMode === "line" && <form action="/api/v1/auth/logout" method="post"><button className="logout-button">登出 LINE</button></form>}
      <ProblemReport view="mine"/>
      {error && <p className="inline-error">{error}</p>}
    </section>
    {me.isAdmin && <AdminReports/>}
    <div className="filter-row"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部</button><button className={filter === "pending" ? "active" : ""} onClick={() => setFilter("pending")}>待補</button>{spots.map((spot) => <button key={spot.id} className={filter === spot.id ? "active" : ""} onClick={() => setFilter(spot.id)}>{spot.name}</button>)}</div>
    {filtered.length ? <div className="record-list">{filtered.map((item) => <ObservationCard key={item.id} observation={item} ownerActions={{ spots, onPatch }}/>)}</div> : <div className="info-state"><Icon name="wave"/><p>這個篩選還沒有影片。</p></div>}
  </div>;
}
