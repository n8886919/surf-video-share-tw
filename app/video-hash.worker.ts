import { hashVideoBlob } from "./video-hash-core";

self.onmessage = async (event: MessageEvent<unknown>) => {
  const blob = event.data;
  if (!(blob instanceof Blob) || blob.size < 1) {
    self.postMessage(null);
    return;
  }
  try { self.postMessage(await hashVideoBlob(blob)); }
  catch { self.postMessage(null); }
};
