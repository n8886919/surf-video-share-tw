"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/** Optional upload help and draft protection; never an extra consent step. */
export function UploadDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => { dialog.close(); document.body.style.overflow = overflow; };
  }, []);
  return <dialog ref={ref} className="upload-info-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
    }}>
    <div className="upload-dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" onClick={onClose} aria-label="關閉視窗">×</button></div>
    {children}
  </dialog>;
}
