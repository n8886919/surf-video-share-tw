"use client";

import { useEffect, useRef } from "react";

export function UploadProgress({ step, percent }: { step: string; percent: number | null }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousOverflow = document.body.style.overflow;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    dialog.showModal();
    document.body.style.overflow = "hidden";
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeLeaving);
      document.body.style.overflow = previousOverflow;
      dialog.close();
    };
  }, []);

  return <dialog ref={dialogRef} className="upload-progress-dialog" aria-labelledby="upload-progress-title" aria-describedby="upload-progress-reminder" onCancel={event => event.preventDefault()}>
    <h2 id="upload-progress-title" tabIndex={-1} autoFocus>影片上傳中</h2>
    <div className="upload-progress-step" role="status"><span>{step}</span>{percent !== null && <strong>{percent}%</strong>}</div>
    <progress aria-label="影片傳送進度" max={100} value={percent ?? undefined}/>
    <p id="upload-progress-reminder">請保持在此頁面，勿切換分頁、關閉或重新整理，以免上傳中斷。</p>
  </dialog>;
}

/** Direct multipart upload. Progress represents bytes sent, not transcoding. */
export function transferVideo(url: string, file: File, signal: AbortSignal, onProgress: (percent: number | null) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Upload aborted", "AbortError")); return; }
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const settle = (error?: Error) => {
      signal.removeEventListener("abort", abort);
      request.upload.onprogress = null;
      request.onload = request.onerror = request.onabort = request.ontimeout = null;
      if (error) reject(error); else resolve();
    };
    request.upload.onprogress = event => onProgress(event.lengthComputable ? Math.min(100, Math.floor(event.loaded / event.total * 100)) : null);
    request.onload = () => settle(request.status >= 200 && request.status < 300 ? undefined : new Error("影片上傳失敗，請再試一次"));
    request.onerror = () => settle(new Error("影片傳送中斷，請確認網路後重新上傳"));
    request.onabort = () => settle(new DOMException("Upload aborted", "AbortError"));
    request.ontimeout = () => settle(new Error("影片上傳逾時，請確認網路後重新上傳"));
    try {
      request.open("POST", url);
      request.timeout = 30 * 60_000;
      signal.addEventListener("abort", abort, { once: true });
      const form = new FormData(); form.append("file", file);
      request.send(form);
    } catch (error) { settle(error instanceof Error ? error : new Error("影片上傳失敗")); }
  });
}
