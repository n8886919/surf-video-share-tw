import type { LineUploadDraft } from "../../packages/domain/src/line-upload-draft";
import { PUBLIC_MEDIA_NOTICE } from "../../packages/domain/src/public-terms";

export function lineUploadCard(draft: LineUploadDraft, spotName: string | null, origin?: string) {
  const data = (action: string) => new URLSearchParams({ draft: draft.id, revision: String(draft.revision), action }).toString();
  const time = draft.capturedAt ? new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(draft.capturedAt)) : "請選擇";
  return {
    type: "flex", altText: `拍攝時間：${time}，浪點：${spotName ?? "請選擇"}`,
    contents: {
      type: "bubble",
      body: { type: "box", layout: "vertical", spacing: "md", contents: [
        { type: "text", text: `拍攝時間：${time}`, wrap: true },
        { type: "text", text: `浪點：${spotName ?? "請選擇"}`, wrap: true },
        { type: "text", text: PUBLIC_MEDIA_NOTICE, size: "xs", color: "#666666", wrap: true },
        ...(origin ? [{ type: "text", text: "更多上傳說明", size: "xs", color: "#006473", wrap: true,
          action: { type: "uri", label: "更多", uri: `${origin}/?help=1` } }] : []),
      ] },
      footer: { type: "box", layout: "vertical", spacing: "sm", contents: [
        { type: "button", style: "primary", color: "#006473", action: { type: "postback", label: "確認上傳", data: data("confirm") } },
        { type: "button", action: { type: "postback", label: "更改浪點", data: data("spots") } },
        { type: "button", action: { type: "datetimepicker", label: "更改時間", data: data("time"), mode: "datetime" } },
      ] },
    },
  };
}

export function lineSpotCard(draft: LineUploadDraft, spots: readonly { id: string; name_zh: string | null; name_en: string }[], page = 0) {
  const data = (extra: Record<string, string>) => new URLSearchParams({ draft: draft.id, revision: String(draft.revision), ...extra }).toString();
  return { type: "flex", altText: "選擇拍攝浪點", contents: { type: "bubble",
    body: { type: "box", layout: "vertical", contents: [
      { type: "text", text: "選擇拍攝浪點", weight: "bold" },
      ...spots.slice(page * 10, page * 10 + 10).map(spot => ({ type: "button", action: {
        type: "postback", label: spot.name_zh ?? spot.name_en, data: data({ action: "spot", spot: spot.id }),
      } })),
      ...(spots.length > 10 ? [{ type: "button", action: { type: "postback", label: page ? "上一頁" : "下一頁",
        data: data({ action: "spots", page: page ? "0" : "1" }) } }] : []),
    ] },
  } };
}

export function lineProgressCard(draft: LineUploadDraft, state: string, origin: string) {
  const message = state === "ready" ? "影片已完成，可在「我的影片」查看。"
    : state === "failed" ? "這次上傳未完成，請重新傳送影片。"
      : "影片處理中。";
  return { type: "flex", altText: message, contents: { type: "bubble",
    body: { type: "box", layout: "vertical", contents: [{ type: "text", text: message, wrap: true }] },
    footer: { type: "box", layout: "vertical", contents: [
      { type: "button", action: { type: "postback", label: "查看進度", data: new URLSearchParams({
        draft: draft.id, revision: String(draft.revision), action: "status",
      }).toString() } },
      { type: "button", action: { type: "uri", label: "我的影片", uri: `${origin}/?view=mine` } },
    ] },
  } };
}
