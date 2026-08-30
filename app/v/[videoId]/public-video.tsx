"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type {
  ObservationResponse,
  PlaybackResponse,
  VideoShareLinkResponse,
} from "../../../packages/api-contract/src";
import { loadStreamPlayerSdk, type StreamPlayer } from "../../stream-player";

const REPORT_REASONS = [
  ["privacy", "隱私／本人"],
  ["minor", "未成年人"],
  ["copyright", "著作權"],
  ["irrelevant", "非浪況實拍"],
] as const;

async function publicApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(payload.message || "目前無法載入公開實拍");
  return payload;
}

function formatTime(iso: string | null): string {
  if (!iso) return "拍攝時間未提供";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function PublicVideo({ videoId, shareToken }: { videoId: string; shareToken: string | null }) {
  const [observation, setObservation] = useState<ObservationResponse | null>(null);
  const [playback, setPlayback] = useState<PlaybackResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playbackRecorded = useRef(false);

  useEffect(() => {
    let active = true;
    void publicApi<{ observation: ObservationResponse }>(`/public-videos/${encodeURIComponent(videoId)}`)
      .then((result) => { if (active) setObservation(result.observation); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "目前無法載入公開實拍"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [videoId]);

  useEffect(() => {
    if (playback?.type !== "iframe" || !iframeRef.current) return;
    let active = true;
    let player: StreamPlayer | null = null;
    const recordStartedPlayback = () => {
      if (!active || playbackRecorded.current) return;
      playbackRecorded.current = true;
      void publicApi(`/videos/${encodeURIComponent(videoId)}/playback-start`, {
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
  }, [playback, videoId]);

  async function startPlayback() {
    setError(null);
    playbackRecorded.current = false;
    if (!shareToken) {
      setError("請使用尚未過期的分享連結播放這段影片");
      return;
    }
    try {
      setPlayback(await publicApi<PlaybackResponse>(`/shared-videos/${encodeURIComponent(videoId)}/playback`, {
        method: "POST",
        body: JSON.stringify({ shareToken }),
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "影片播放失敗");
    }
  }

  async function share() {
    setError(null);
    setShareNotice(null);
    try {
      const result = await publicApi<VideoShareLinkResponse>(`/videos/${encodeURIComponent(videoId)}/share-link`, {
        method: "POST",
      });
      const url = new URL(result.path, window.location.origin).toString();
      const quotaMessage = `連結 24 小時有效；透過你本月分享連結的匿名播放額度還剩 ${result.remainingAnonymousPlays} 次。`;
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({
            title: `${observation?.spot?.name || "浪點"}實拍｜彼日浪影`,
            text: "看看相似浪況下的公開實拍",
            url,
          });
          setShareNotice(quotaMessage);
          return;
        } catch (caught) {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        setShareNotice(`分享連結已複製。${quotaMessage}`);
      } catch {
        setShareNotice(`請複製分享連結：${url}（${quotaMessage}）`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "分享連結暫時無法建立");
    }
  }

  async function report(reason: typeof REPORT_REASONS[number][0]) {
    setError(null);
    try {
      await publicApi(`/videos/${encodeURIComponent(videoId)}/reports`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setReportOpen(false);
      setReportSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "檢舉失敗");
    }
  }

  if (loading) return <main className="public-video-shell public-video-state"><strong>載入公開實拍…</strong></main>;
  if (!observation) return <main className="public-video-shell public-video-state"><strong>這段實拍目前無法瀏覽</strong><p>{error}</p><Link href="/">回到彼日浪影</Link></main>;

  const portrait = playback?.width != null
    && playback.height != null
    && playback.height > playback.width;
  const playerStyle = playback?.width != null && playback.height != null
    ? {
        aspectRatio: `${playback.width} / ${playback.height}`,
        ...(portrait
          ? {
              width: `min(100%, calc(72svh * ${playback.width / playback.height}))`,
              maxHeight: "72svh",
              marginInline: "auto",
            }
          : {}),
      }
    : undefined;

  return <main className="public-video-shell">
    <header className="public-video-header"><Link href="/">
      {/* This checked-in brand asset does not benefit from runtime optimization. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand-logo.png" alt="" width="36" height="36"/>彼日浪影
    </Link><span>公開實拍</span></header>
    <article className="public-video-card">
      <div className="public-video-player" style={playerStyle}>
        {playback?.type === "iframe"
          ? <iframe ref={iframeRef} src={playback.iframeUrl} title={`${observation.spot?.name || "浪點"}實拍影片`} allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>
          : playback?.type === "mock"
            ? <div className="public-video-placeholder">Mock 播放已啟動</div>
            : <button type="button" onClick={() => void startPlayback()}>
                {observation.video.thumbnailUrl && <>
                  {/* Runtime thumbnails use the first-party lifecycle-checking endpoint. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={observation.video.thumbnailUrl} alt={`${observation.spot?.name || "浪點"}實拍縮圖`}/>
                </>}
                <span aria-hidden="true">▶</span><strong>播放實拍</strong>
              </button>}
      </div>
      <div className="public-video-body">
        <h1>{observation.spot?.name || "浪點"}實拍</h1>
        <p>{formatTime(observation.capturedAt)}</p>
        {observation.uploaderDisplayId && <p className="public-video-uploader">id: {observation.uploaderDisplayId}</p>}
        {observation.funReaction && <p>{observation.funReaction === "fun" ? "👍 上傳者那天玩得開心" : "👎 上傳者那天玩得不開心"}</p>}
        {observation.uploaderNote && <blockquote>{observation.uploaderNote}</blockquote>}
        <small>公開影片採 CC0 1.0；播放前會再次確認公開狀態。</small>
      </div>
    </article>
    <section className="public-video-actions">
      <button type="button" onClick={() => void share()}>登入後重新分享</button>
      {reportSent ? <span>已收到檢舉</span> : <button type="button" onClick={() => setReportOpen((open) => !open)}>檢舉影片</button>}
      {reportOpen && <div>{REPORT_REASONS.map(([reason, label]) => <button type="button" key={reason} onClick={() => void report(reason)}>{label}</button>)}</div>}
      {shareNotice && <p className="public-video-share-notice">{shareNotice}</p>}
      {error && <p>{error}</p>}
    </section>
    <Link className="public-video-home" href="/">查看相似浪況與更多實拍</Link>
  </main>;
}
