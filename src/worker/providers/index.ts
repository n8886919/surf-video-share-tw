import { CloudflareStreamVideoProvider } from "./cloudflare-stream";
import { MockMarineConditionsProvider, MockTideProvider, MockVideoProvider } from "./mock";
import type { MarineConditionsProvider, TideProvider, VideoProvider } from "./types";

export interface ProviderEnv {
  APP_ENV?: string;
  VIDEO_PROVIDER?: string;
  CONDITIONS_PROVIDER?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_STREAM_API_TOKEN?: string;
  PUBLIC_SITE_ORIGIN?: string;
}

function isDevelopment(env: ProviderEnv): boolean {
  return env.APP_ENV === "development";
}

export function createVideoProvider(env: ProviderEnv): VideoProvider {
  if (env.VIDEO_PROVIDER === "mock") {
    if (!isDevelopment(env)) throw new Error("Production cannot use mock video provider");
    return new MockVideoProvider();
  }
  if (env.VIDEO_PROVIDER === "cloudflare-stream") {
    if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_STREAM_API_TOKEN) {
      throw new Error("Cloudflare Stream credentials are missing");
    }
    return new CloudflareStreamVideoProvider({
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: env.CLOUDFLARE_STREAM_API_TOKEN,
      publicSiteOrigin: env.PUBLIC_SITE_ORIGIN,
    });
  }
  throw new Error("VIDEO_PROVIDER must be explicitly configured");
}

export function createConditionsProvider(env: ProviderEnv): MarineConditionsProvider {
  if (env.CONDITIONS_PROVIDER === "mock") {
    if (!isDevelopment(env)) throw new Error("Production cannot use mock conditions provider");
    return new MockMarineConditionsProvider();
  }
  throw new Error("A real marine conditions provider is not configured yet");
}

export function createTideProvider(env: ProviderEnv): TideProvider {
  if (env.CONDITIONS_PROVIDER === "mock" && isDevelopment(env)) {
    return new MockTideProvider();
  }
  throw new Error("A real tide provider is not configured yet");
}

export * from "./types";
