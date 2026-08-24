"use client";

import { useEffect, useMemo, useState } from "react";

type View = "home" | "upload" | "records" | "profile";

interface Me {
  id: string;
  displayId: string | null;
  showIdentityDefault: boolean;
  authMode: string;
}

interface Spot {
  id: string;
  slug: string;
  name: string;
  nameEn: string;
  nameZh: string | null;
  region: string;
}

interface Observation {
  id: string;
  status: string;
  capturedAt: string;
  durationSeconds: number | null;
  uploaderDisplayId: string | null;
  video: { provider: string; providerVideoId: string };
  spot: { id: string; slug: string; name: string; nameEn: string };
  conditions: {
    waveHeight: number | null;
    swellHeight: number | null;
    swellPeriod: number | null;
    windSpeed: number | null;
    tideHeight: number | null;
    tideState: string | null;
  };
}

interface UploadTicket {
  videoId: string;
  provider: string;
  providerVideoId: string;
  uploadUrl: string | null;
  uploadMethod: "POST" | "mock";
}

const regionNames: Record<string, string> = {
  North: "北部",
  Northeast: "東北角",
  East: "東部",
  South: "南部",
  West: "西部",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(payload.message || "連線失敗，請稍後再試");
  return payload;
}

function toLocalDateTime(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function Icon({ name }: { name: "upload" | "history" | "wave" | "user" | "arrow" }) {
  const paths = {
    upload: <><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M5 14v5h14v-5"/></>,
    history: <><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8"/><path d="M4 4v4h4M12 8v5l3 2"/></>,
    wave: <><path d="M3 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 3 2"/><path d="M5 10c2.2-4.8 7.3-6.2 11-3.2 1.7 1.4 2.2 3.2 2 5.2"/></>,
    user: <><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.6-4 3-6 7-6s6.4 2 7 6"/></>,
    arrow: <path d="m9 6 6 6-6 6"/>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">{paths[name]}</svg>;
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark"><Icon name="wave" /></span>
      <span>台灣浪況實錄</span>
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="app-shell center-screen">
      <Brand />
      <div className="loading-line" aria-label="載入中"><span /></div>
      <p>正在讀取今天的海</p>
    </main>
  );
}

function SetupScreen({ message }: { message: string }) {
  return (
    <main className="app-shell center-screen setup-screen">
      <Brand />
      <div className="setup-icon"><Icon name="user" /></div>
      <h1>還差登入設定</h1>
      <p>{message}</p>
      <small>正式環境不會自動啟用開發用假帳號。</small>
    </main>
  );
}

function Condition({ label, value, suffix }: { label: string; value: number | null; suffix: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value == null ? "—" : value.toFixed(1)}<small>{value == null ? "" : suffix}</small></strong>
    </div>
  );
}

function ObservationCard({
  observation,
  onVisibilityChange,
}: {
  observation: Observation;
  onVisibilityChange?: (id: string, visible: boolean) => void;
}) {
  const c = observation.conditions;
  const statusLabel = observation.status === "ready" ? "已完成" : observation.status === "processing" ? "處理中" : "等待上傳";
  const visible = Boolean(observation.uploaderDisplayId);
  return (
    <article className="observation-card">
      <div className="observation-visual" aria-label="影片預覽位置">
        <div className="wave-lines"><span /><span /><span /></div>
        <span className={`status-pill status-${observation.status}`}>{statusLabel}</span>
        <span className="duration-pill">{observation.durationSeconds ? `${Math.round(observation.durationSeconds)} 秒` : "—"}</span>
      </div>
      <div className="observation-body">
        <div className="observation-heading">
          <div>
            <h3>{observation.spot.name}</h3>
            <p>{formatTime(observation.capturedAt)} · {observation.uploaderDisplayId || "匿名上傳"}</p>
          </div>
          <span className="provider-badge">{observation.video.provider === "mock" ? "DEV" : "STREAM"}</span>
        </div>
        <div className="condition-grid">
          <Condition label="浪高" value={c.waveHeight} suffix="m" />
          <Condition label="湧浪" value={c.swellHeight} suffix="m" />
          <Condition label="週期" value={c.swellPeriod} suffix="s" />
          <Condition label="風速" value={c.windSpeed} suffix="m/s" />
        </div>
        {onVisibilityChange && (
          <button className="text-button" onClick={() => onVisibilityChange(observation.id, !visible)}>
            {visible ? "改為匿名" : "顯示上傳者 ID"}
          </button>
        )}
      </div>
    </article>
  );
}

export function SurfApp() {
  const [view, setView] = useState<View>("home");
  const [me, setMe] = useState<Me | null>(null);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      api<Me>("/me"),
      api<{ spots: Spot[] }>("/spots"),
      api<{ observations: Observation[] }>("/videos"),
    ]).then(([meResult, spotsResult, videoResult]) => {
      if (!active) return;
      setMe(meResult);
      setSpots(spotsResult.spots);
      setObservations(videoResult.observations);
    }).catch((error: unknown) => {
      if (!active) return;
      setSetupError(error instanceof Error ? error.message : "無法啟動應用程式");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  if (loading) return <LoadingScreen />;
  if (setupError || !me) return <SetupScreen message={setupError || "找不到使用者"} />;

  return (
    <main className="app-shell">
      <header className="topbar">
        <Brand />
        <button className="avatar-button" aria-label="個人設定" onClick={() => setView("profile")}>
          {me.displayId?.slice(0, 1).toUpperCase() || <Icon name="user" />}
        </button>
      </header>

      {view === "home" && <HomeView observations={observations} onNavigate={setView} />}
      {view === "upload" && (
        <UploadView
          spots={spots}
          me={me}
          onCancel={() => setView("home")}
          onComplete={(observation) => {
            setObservations((current) => [observation, ...current.filter((item) => item.id !== observation.id)]);
            setView("records");
          }}
        />
      )}
      {view === "records" && (
        <RecordsView
          observations={observations}
          onBack={() => setView("home")}
          onUpload={() => setView("upload")}
          onVisibilityChange={async (id, visible) => {
            const result = await api<{ observation: Observation }>(`/videos/${id}`, {
              method: "PATCH",
              body: JSON.stringify({ showUploader: visible }),
            });
            setObservations((current) => current.map((item) => item.id === id ? result.observation : item));
          }}
        />
      )}
      {view === "profile" && (
        <ProfileView
          me={me}
          onBack={() => setView("home")}
          onSave={(updated) => { setMe({ ...me, ...updated }); setView("home"); }}
        />
      )}
    </main>
  );
}

function HomeView({ observations, onNavigate }: { observations: Observation[]; onNavigate: (view: View) => void }) {
  const latest = observations[0];
  return (
    <div className="screen home-screen">
      <section className="greeting">
        <p>今天的海，讓現場說話</p>
        <h1>你現在看到的浪，<br />會幫上下一次出發。</h1>
      </section>

      <section className="primary-actions" aria-label="主要功能">
        <button className="action-card action-primary" onClick={() => onNavigate("upload")}>
          <span className="action-icon"><Icon name="upload" /></span>
          <span><strong>上傳浪況</strong><small>5–60 秒，今天拍的影片</small></span>
          <Icon name="arrow" />
        </button>
        <button className="action-card" disabled title="Milestone 2">
          <span className="action-icon"><Icon name="wave" /></span>
          <span><strong>今天浪況</strong><small>預報比對將在下一階段開放</small></span>
          <span className="soon">稍後</span>
        </button>
        <button className="action-card" onClick={() => onNavigate("records")}>
          <span className="action-icon"><Icon name="history" /></span>
          <span><strong>我的紀錄</strong><small>{observations.length ? `${observations.length} 筆實拍浪況` : "還沒有紀錄"}</small></span>
          <Icon name="arrow" />
        </button>
      </section>

      <section className="latest-section">
        <div className="section-heading">
          <h2>最近一次</h2>
          {latest && <button onClick={() => onNavigate("records")}>查看全部</button>}
        </div>
        {latest ? <ObservationCard observation={latest} /> : (
          <div className="empty-state compact">
            <span><Icon name="wave" /></span>
            <div><strong>今天還沒有你的實拍</strong><p>到海邊時，順手留下 5 秒就夠了。</p></div>
          </div>
        )}
      </section>
    </div>
  );
}

function UploadView({ spots, me, onCancel, onComplete }: {
  spots: Spot[];
  me: Me;
  onCancel: () => void;
  onComplete: (observation: Observation) => void;
}) {
  const initialSpot = typeof window !== "undefined" ? localStorage.getItem("lastSpotId") || "" : "";
  const [spotId, setSpotId] = useState(initialSpot);
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [capturedAt, setCapturedAt] = useState(toLocalDateTime(new Date()));
  const [showUploader, setShowUploader] = useState(me.showIdentityDefault);
  const [moreOpen, setMoreOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const grouped = useMemo(() => Object.entries(spots.reduce<Record<string, Spot[]>>((all, spot) => {
    (all[spot.region] ||= []).push(spot);
    return all;
  }, {})), [spots]);

  async function inspectVideo(selected: File) {
    setError(null);
    if (selected.size > 200 * 1024 * 1024) throw new Error("影片不可超過 200 MB");
    if (!selected.type.startsWith("video/")) throw new Error("請選擇影片檔案");
    const hinted = new Date(selected.lastModified);
    if (!Number.isNaN(hinted.getTime())) setCapturedAt(toLocalDateTime(hinted));
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
      setFile(selected);
      setDuration(seconds);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file || duration == null || !spotId) {
      setError("請選浪點與影片");
      return;
    }
    setError(null);
    setProgress("正在建立安全上傳連結…");
    try {
      const ticket = await api<UploadTicket>("/videos/upload-request", {
        method: "POST",
        body: JSON.stringify({
          spotId,
          capturedAt: new Date(capturedAt).toISOString(),
          durationSeconds: duration,
          sizeBytes: file.size,
          fileName: file.name,
          contentType: file.type,
          showUploader,
        }),
      });
      localStorage.setItem("lastSpotId", spotId);
      if (ticket.uploadMethod === "POST" && ticket.uploadUrl) {
        setProgress("影片正直接傳到影音服務…");
        const form = new FormData();
        form.append("file", file);
        const upload = await fetch(ticket.uploadUrl, { method: "POST", body: form });
        if (!upload.ok) throw new Error("影片上傳失敗，請再試一次");
      }
      setProgress("正在附上海況資料…");
      const complete = await api<{ observation: Observation }>(`/videos/${ticket.videoId}/complete`, {
        method: "POST",
        body: JSON.stringify({ providerVideoId: ticket.providerVideoId }),
      });
      onComplete(complete.observation);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "上傳失敗");
      setProgress(null);
    }
  }

  return (
    <div className="screen form-screen">
      <div className="page-heading">
        <button className="back-button" onClick={onCancel} aria-label="返回">←</button>
        <div><p>今天的現場</p><h1>上傳浪況</h1></div>
      </div>
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="spot">浪點</label>
        <select id="spot" value={spotId} onChange={(event) => setSpotId(event.target.value)} required>
          <option value="">選擇浪點</option>
          {grouped.map(([region, regionSpots]) => (
            <optgroup key={region} label={regionNames[region] || region}>
              {regionSpots.map((spot) => <option key={spot.id} value={spot.id}>{spot.name}</option>)}
            </optgroup>
          ))}
        </select>

        <label className={`file-picker ${file ? "has-file" : ""}`}>
          <input type="file" accept="video/*" onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) void inspectVideo(selected).catch((caught) => setError(caught instanceof Error ? caught.message : "無法讀取影片"));
          }} />
          <span className="file-icon"><Icon name="upload" /></span>
          <strong>{file ? file.name : "選擇影片"}</strong>
          <small>{file && duration ? `${duration.toFixed(1)} 秒 · ${(file.size / 1024 / 1024).toFixed(1)} MB` : "今天拍攝 · 5–60 秒 · 最多 200 MB"}</small>
        </label>

        <div className="time-field">
          <label className="field-label" htmlFor="capture-time">拍攝時間 <span>請確認</span></label>
          <input id="capture-time" type="datetime-local" value={capturedAt} max={toLocalDateTime(new Date())} onChange={(event) => setCapturedAt(event.target.value)} required />
          <p>已用檔案時間預填；伺服器仍會檢查是否為台北時區的今天。</p>
        </div>

        <button className="more-toggle" type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>
          更多選項 <span>{moreOpen ? "−" : "+"}</span>
        </button>
        {moreOpen && (
          <label className="switch-row">
            <span><strong>顯示上傳者 ID</strong><small>{me.displayId || "尚未設定 ID"}</small></span>
            <input type="checkbox" checked={showUploader} disabled={!me.displayId} onChange={(event) => setShowUploader(event.target.checked)} />
          </label>
        )}

        {error && <div className="error-message" role="alert">{error}</div>}
        {progress && <div className="progress-message" aria-live="polite"><span className="spinner" />{progress}</div>}
        <button className="submit-button" type="submit" disabled={Boolean(progress) || !spotId || !file}>
          {progress ? "處理中" : "上傳這段浪況"}
        </button>
      </form>
    </div>
  );
}

function RecordsView({ observations, onBack, onUpload, onVisibilityChange }: {
  observations: Observation[];
  onBack: () => void;
  onUpload: () => void;
  onVisibilityChange: (id: string, visible: boolean) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="screen records-screen">
      <div className="page-heading">
        <button className="back-button" onClick={onBack} aria-label="返回">←</button>
        <div><p>你的海邊時間軸</p><h1>我的紀錄</h1></div>
      </div>
      {error && <div className="error-message" role="alert">{error}</div>}
      {observations.length ? (
        <div className="record-list">
          {observations.map((observation) => (
            <ObservationCard
              key={observation.id}
              observation={observation}
              onVisibilityChange={(id, visible) => void onVisibilityChange(id, visible).catch((caught) => setError(caught instanceof Error ? caught.message : "更新失敗"))}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state large">
          <span><Icon name="wave" /></span>
          <h2>第一段浪況還在海邊</h2>
          <p>不用標題、不用評分，選浪點和影片就完成。</p>
          <button className="submit-button" onClick={onUpload}>上傳浪況</button>
        </div>
      )}
    </div>
  );
}

function ProfileView({ me, onBack, onSave }: {
  me: Me;
  onBack: () => void;
  onSave: (me: Pick<Me, "displayId" | "showIdentityDefault">) => void;
}) {
  const [displayId, setDisplayId] = useState(me.displayId || "");
  const [visible, setVisible] = useState(me.showIdentityDefault);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <div className="screen form-screen">
      <div className="page-heading">
        <button className="back-button" onClick={onBack} aria-label="返回">←</button>
        <div><p>公開顯示方式</p><h1>個人設定</h1></div>
      </div>
      <form onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setError(null);
        try {
          const updated = await api<Pick<Me, "displayId" | "showIdentityDefault">>("/me", {
            method: "PATCH",
            body: JSON.stringify({ displayId: displayId.trim() || null, showIdentityDefault: visible }),
          });
          onSave(updated);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "儲存失敗");
          setSaving(false);
        }
      }}>
        <label className="field-label" htmlFor="display-id">公開 ID</label>
        <input id="display-id" value={displayId} minLength={2} maxLength={24} pattern="[A-Za-z0-9._-]+" onChange={(event) => setDisplayId(event.target.value)} placeholder="例如 nolan.surf" />
        <p className="field-help">只允許英文、數字、句點、底線與連字號。不會顯示 LINE 識別碼。</p>
        <label className="switch-row profile-switch">
          <span><strong>新上傳預設顯示 ID</strong><small>每段影片仍可個別調整</small></span>
          <input type="checkbox" checked={visible} disabled={!displayId.trim()} onChange={(event) => setVisible(event.target.checked)} />
        </label>
        {error && <div className="error-message" role="alert">{error}</div>}
        <button className="submit-button" disabled={saving}>{saving ? "儲存中" : "儲存設定"}</button>
      </form>
      <div className="dev-note">開發模式使用假的本機使用者；正式環境必須設定 LINE Login。</div>
    </div>
  );
}
