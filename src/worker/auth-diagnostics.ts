import { authDisplayModeSchema, authTraceSchema } from "../../packages/api-contract/src";
import type { AppEnv } from "./db";

type Kind = "begin" | "callback" | "me";
type Stage = "configuration" | "begin" | "attempt" | "token" | "verify" | "user" | "session";
type Outcome = "started" | "received" | "valid" | "missing_or_consumed" | "expired"
  | "missing_state" | "missing_code" | "cancelled" | "http_error" | "invalid_response"
  | "claims_rejected" | "capacity" | "created" | "authenticated" | "unauthenticated"
  | "unconfigured" | "exception";
type WaitUntil = (promise: Promise<unknown>) => void;

export async function diagnosticDigest(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`auth-diagnostic-v1:${value}`));
  return Array.from(new Uint8Array(digest).slice(0, 16), byte => byte.toString(16).padStart(2, "0")).join("");
}

export class AuthDiagnostic {
  traceId = crypto.randomUUID().replaceAll("-", "");
  readonly requestId = crypto.randomUUID();
  readonly steps: Array<{ stage: Stage; outcome: Outcome; httpStatus?: number }> = [];
  stage: Stage = "configuration";
  traceSource: "server" | "untrusted_client" = "server";

  constructor(readonly env: AppEnv, readonly request: Request | undefined, readonly kind: Kind) {}

  async correlateState(state: string) {
    // Separate HMAC namespace from OAuth lookup/session hashes; never log those hashes.
    if (this.env.SESSION_SECRET) this.traceId = await diagnosticDigest(this.env.SESSION_SECRET, `state:${state}`);
  }

  step(stage: Stage, outcome: Outcome, httpStatus?: number) {
    this.stage = stage;
    this.steps.push({ stage, outcome, ...(httpStatus === undefined ? {} : { httpStatus }) });
  }

  async persist(response?: Response) {
    const request = this.request;
    const ua = request?.headers.get("user-agent") ?? "";
    const os = /Android/i.test(ua) ? "android" : /iPhone|iPad|iPod/i.test(ua) ? "ios"
      : /Windows/i.test(ua) ? "windows" : /Macintosh/i.test(ua) ? "macos" : "other";
    const browser = /Line\//i.test(ua) ? "line" : /Edg(?:A|iOS)?\//i.test(ua) ? "edge"
      : /Chrome|CriOS/i.test(ua) ? "chrome" : /Firefox|FxiOS/i.test(ua) ? "firefox"
        : /Safari/i.test(ua) ? "safari" : "other";
    const display = authDisplayModeSchema.safeParse(request?.headers.get("x-surf-display-mode"));
    const details = {
      kind: this.kind, steps: this.steps.slice(0, 12), os, browser,
      displayMode: display.success ? display.data : "unknown",
      // Presence is observational only. No cookie values, URL, UA, IP or upstream body is retained.
      sessionCookiePresent: /(?:^|;\s*)__Host-surf_session=/.test(request?.headers.get("cookie") ?? ""),
      sessionCookieSet: Boolean(response?.headers.get("set-cookie")?.includes("__Host-surf_session=")),
      responseStatus: response?.status ?? null,
      manual: this.kind === "begin" && request ? new URL(request.url).searchParams.get("manual") === "1" : null,
      traceSource: this.traceSource,
    };
    const now = new Date().toISOString();
    // Console output remains available when D1 itself is the failing dependency.
    console.info(JSON.stringify({ event: "auth_diagnostic", traceId: this.traceId, requestId: this.requestId, occurredAt: now, ...details }));
    try {
      if (!this.env.SESSION_SECRET || !this.env.PUBLIC_WRITE_RATE_LIMITER) return;
      const clientKey = await diagnosticDigest(this.env.SESSION_SECRET,
        `client:${request?.headers.get("cf-connecting-ip") ?? "unknown"}`);
      // Separate keys from business rate limits. Exhaustion skips only diagnostics, never login.
      const allowed = await this.env.PUBLIC_WRITE_RATE_LIMITER.limit({ key: `auth-diagnostic:${this.kind}:${clientKey}` });
      if (!allowed.success) return;
      await this.env.DB.prepare(`INSERT INTO auth_diagnostic_events
        (id, trace_id, kind, details_json, occurred_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(this.requestId, this.traceId, this.kind, JSON.stringify(details), now).run();
    } catch {
      // Deliberately do not log arbitrary exception messages that could contain secrets.
      console.warn(JSON.stringify({ event: "auth_diagnostic_storage_unavailable", requestId: this.requestId }));
    }
  }
}

export async function withAuthDiagnostic<T>(
  env: AppEnv, request: Request | undefined, kind: Kind,
  operation: (diagnostic?: AuthDiagnostic) => Promise<T>, waitUntil?: WaitUntil,
): Promise<T> {
  const until = Date.parse(env.AUTH_DIAGNOSTICS_UNTIL ?? "");
  if (!Number.isFinite(until) || Date.now() >= until) return operation();
  let diagnostic: AuthDiagnostic;
  try {
    diagnostic = new AuthDiagnostic(env, request, kind);
    if (kind === "callback") {
      const state = request && new URL(request.url).searchParams.get("state");
      if (state) await diagnostic.correlateState(state);
    } else if (kind === "me") {
      const trace = authTraceSchema.safeParse(request?.headers.get("x-surf-auth-trace"));
      if (trace.success) {
        diagnostic.traceId = trace.data;
        diagnostic.traceSource = "untrusted_client";
      }
    }
  } catch { return operation(); }
  let response: Response | undefined;
  try {
    const value = await operation(diagnostic);
    if (value instanceof Response) {
      response = value;
      try {
        const location = response.headers.get("location");
        if (kind === "callback" && location?.startsWith("/") && !location.startsWith("//")) {
          const target = new URL(location, "https://diagnostic.invalid");
          target.searchParams.set("auth_trace", diagnostic.traceId);
          response.headers.set("location", target.pathname + target.search);
        }
        response.headers.set("x-surf-auth-trace", diagnostic.traceId);
      } catch { /* Even immutable response headers must not turn diagnostics into an auth failure. */ }
    }
    return value;
  } catch (error) {
    diagnostic.step(diagnostic.stage, "exception");
    throw error;
  } finally {
    const pending = diagnostic.persist(response).catch(() => {});
    if (waitUntil) {
      try { waitUntil(pending); } catch { await pending; }
    } else await pending;
  }
}
