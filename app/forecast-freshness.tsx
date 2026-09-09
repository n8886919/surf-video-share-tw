"use client";

import { useEffect, useRef, useState } from "react";
import { forecastFreshnessResponseSchema, type ForecastFreshnessResponse } from "../packages/api-contract/src";

export function freshnessAge(iso: string | null, now = Date.now()): string {
  if (!iso) return "尚無資料";
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "剛剛";
  if (minutes < 60) return `${minutes}分鐘前`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}小時前`;
  return `${Math.floor(minutes / (24 * 60))}天前`;
}

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
      資料更新：{data.sources.map(source => `${source.name}（${freshnessAge(source.retrievedAt)}）`).join("、")}
    </>}
  </div>;
}
