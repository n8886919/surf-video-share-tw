"use client";

import { useEffect, useRef, useState } from "react";
import { forecastFreshnessResponseSchema, type ForecastFreshnessResponse } from "../packages/api-contract/src";

export function ForecastFreshness({ query, active }: { query: string | null; active: boolean }) {
  const cache = useRef(new Map<string, { at: number; data: ForecastFreshnessResponse }>());
  const [result, setResult] = useState<{ query: string; data: ForecastFreshnessResponse | null } | null>(null);
  useEffect(() => {
    if (!query || !active) return;
    const controller = new AbortController();
    async function refresh() {
      const cached = cache.current.get(query!);
      if (cached && Date.now() - cached.at < 60_000) { setResult({ query: query!, data: cached.data }); return; }
      try {
        const response = await fetch(`/api/v1${query!.replace("/matches?", "/forecast-freshness?")}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Freshness unavailable");
        const data = forecastFreshnessResponseSchema.parse(await response.json());
        if (controller.signal.aborted) return;
        if (cache.current.size >= 50) cache.current.delete(cache.current.keys().next().value!);
        cache.current.set(query!, { at: Date.now(), data });
        setResult({ query: query!, data });
      } catch { if (!controller.signal.aborted) setResult({ query: query!, data: null }); }
    }
    const debounce = window.setTimeout(() => void refresh(), 400);
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => { window.clearTimeout(debounce); window.clearInterval(timer); controller.abort(); };
  }, [query, active]);
  const data = result?.query === query ? result.data : undefined;
  return <div className="forecast-freshness" aria-label="所選預報資料更新時間" aria-live="polite">
    {data === undefined ? "確認資料更新時間…" : data === null ? "暫時無法確認資料更新時間" : <>
      <span>所選資料上次收錄（台北時間）</span>
      {data.sources.map(source => <span key={source.name}>{source.name}：{source.retrievedAt
        ? `${new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(source.retrievedAt))}${source.stale ? "（較舊）" : ""}`
        : "尚無資料"}</span>)}
    </>}
  </div>;
}
