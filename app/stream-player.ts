export type StreamPlayer = {
  addEventListener(event: string, listener: () => void): void;
  removeEventListener?(event: string, listener: () => void): void;
};

type StreamPlayerFactory = (iframe: HTMLIFrameElement) => StreamPlayer;

let streamPlayerSdkPromise: Promise<StreamPlayerFactory> | null = null;

export function loadStreamPlayerSdk(): Promise<StreamPlayerFactory> {
  if (streamPlayerSdkPromise) return streamPlayerSdkPromise;
  const promise = new Promise<StreamPlayerFactory>((resolve, reject) => {
    const streamWindow = window as Window & { Stream?: StreamPlayerFactory };
    if (streamWindow.Stream) {
      resolve(streamWindow.Stream);
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-stream-player-sdk="true"]');
    const script = existing ?? document.createElement("script");
    const finish = () => streamWindow.Stream
      ? resolve(streamWindow.Stream)
      : reject(new Error("Stream Player SDK unavailable"));
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => reject(new Error("Stream Player SDK unavailable")), { once: true });
    if (!existing) {
      script.src = "https://embed.cloudflarestream.com/embed/sdk.latest.js";
      script.async = true;
      script.dataset.streamPlayerSdk = "true";
      document.head.appendChild(script);
    }
  }).catch((error: unknown) => {
    streamPlayerSdkPromise = null;
    throw error;
  });
  streamPlayerSdkPromise = promise;
  return promise;
}
