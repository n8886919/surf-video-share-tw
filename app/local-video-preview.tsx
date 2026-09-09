"use client";

import { useEffect, useRef, useState } from "react";

export function LocalVideoPreview({ file }: { file: File }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failedFile, setFailedFile] = useState<File | null>(null);
  useEffect(() => {
    const video = ref.current!;
    const url = URL.createObjectURL(file);
    video.src = url;
    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };
  }, [file]);
  return <div className="local-video-preview">
    <video ref={ref} controls playsInline preload="metadata" aria-label="已選影片預覽" onError={() => setFailedFile(file)}/>
    {failedFile === file && <p role="status">此瀏覽器無法預覽這個影片格式，仍可確認資料後上傳。</p>}
    <span className="local-preview-status">尚未上傳</span>
  </div>;
}
