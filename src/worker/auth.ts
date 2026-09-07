import { z } from "zod";
import { lineCompletionSchema, type LineCompletion } from "../../packages/api-contract/src";
import { MAX_REGISTERED_USERS } from "../../packages/domain/src";
import type { AppEnv, UserRow } from "./db";
import { getOrCreateDevUser } from "./db";
import { withAuthDiagnostic, type AuthDiagnostic } from "./auth-diagnostics";

const SESSION_COOKIE = "__Host-surf_session";
const LOGIN_COOKIE = "__Host-surf_login";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const OAUTH_ATTEMPT_TTL_SECONDS = 10 * 60;
const DELIVERY_RETRY_SECONDS = 60;

const tokenResponseSchema = z.object({
  id_token: z.string().min(1),
});

const verifiedIdTokenSchema = z.object({
  iss: z.literal("https://access.line.me"),
  sub: z.string().min(1),
  name: z.string().min(1).optional(),
  aud: z.string().min(1),
  exp: z.number().int(),
  nonce: z.string().min(1),
});

interface LineConfig {
  channelId: string;
  channelSecret: string;
  callbackUrl: string;
  sessionSecret: string;
}

interface OAuthAttemptRow {
  nonce: string;
  code_verifier: string;
  expires_at: string;
}

interface OAuthProgressRow {
  status: string;
  expires_at: string;
  failure: string | null;
  trace_id: string | null;
}

class RegistrationCapacityError extends Error {}

export interface AuthenticatedUser {
  user: UserRow;
  authMode: "development" | "line";
}

function getLineConfig(env: AppEnv): LineConfig | null {
  if (
    !env.LINE_CHANNEL_ID ||
    !env.LINE_CHANNEL_SECRET ||
    !env.LINE_CALLBACK_URL ||
    !env.SESSION_SECRET
  ) {
    return null;
  }
  return {
    channelId: env.LINE_CHANNEL_ID,
    channelSecret: env.LINE_CHANNEL_SECRET,
    callbackUrl: env.LINE_CALLBACK_URL,
    sessionSecret: env.SESSION_SECRET,
  };
}

export function isLineAuthConfigured(env: AppEnv): boolean {
  return getLineConfig(env) !== null;
}

function randomBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

function sessionCookie(value: string, maxAge = SESSION_TTL_SECONDS): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function loginCookie(value: string, maxAge = OAUTH_ATTEMPT_TTL_SECONDS): string {
  return `${LOGIN_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

async function browserProofHash(request: Request | undefined, secret: string): Promise<string | null> {
  const proof = request && readCookie(request, LOGIN_COOKIE);
  return proof && /^[A-Za-z0-9_-]{43}$/.test(proof) ? hmacHex(secret, `oauth-browser-v1:${proof}`) : null;
}

function expiredSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function redirect(path: string, cookie?: string): Response {
  const headers = new Headers({ location: path, "cache-control": "no-store" });
  if (cookie) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

export async function beginLineLogin(
  env: AppEnv,
  options: { disableAutoLogin?: boolean; request?: Request; waitUntil?: (promise: Promise<unknown>) => void } = {},
): Promise<Response> {
  return withAuthDiagnostic(env, options.request, "begin",
    diagnostic => beginLineLoginCore(env, options, diagnostic), options.waitUntil);
}

async function beginLineLoginCore(
  env: AppEnv, options: { disableAutoLogin?: boolean; request?: Request }, diagnostic?: AuthDiagnostic,
): Promise<Response> {
  const config = getLineConfig(env);
  if (!config) {
    diagnostic?.step("configuration", "unconfigured");
    return Response.json(
      { error: "AUTH_NOT_CONFIGURED", message: "LINE Login 尚未完成部署設定" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const state = randomBase64Url();
  // Independent of state/diagnostic IDs. Only the initiating first-party browser holds this secret.
  const proof = randomBase64Url();
  const proofHash = await hmacHex(config.sessionSecret, `oauth-browser-v1:${proof}`);
  if (diagnostic) {
    try { await diagnostic.correlateState(state); } catch { /* Diagnostics never gate login. */ }
    diagnostic.step("begin", "received");
  }
  const nonce = randomBase64Url();
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const stateHash = await hmacHex(config.sessionSecret, state);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OAUTH_ATTEMPT_TTL_SECONDS * 1000).toISOString();

  await env.DB.prepare("DELETE FROM oauth_attempts WHERE expires_at <= ?")
    .bind(now.toISOString())
    .run();
  const previousProofHash = await browserProofHash(options.request, config.sessionSecret);
  if (previousProofHash) {
    await env.DB.prepare("DELETE FROM oauth_attempts WHERE browser_proof_hash = ?").bind(previousProofHash).run();
  }
  await env.DB.prepare(
    `INSERT INTO oauth_attempts
     (state_hash, nonce, code_verifier, expires_at, created_at, browser_proof_hash, trace_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(stateHash, nonce, codeVerifier, expiresAt, now.toISOString(), proofHash, diagnostic?.traceId ?? null).run();

  const authorize = new URL("https://access.line.me/oauth2/v2.1/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", config.channelId);
  authorize.searchParams.set("redirect_uri", config.callbackUrl);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("scope", "openid profile");
  authorize.searchParams.set("nonce", nonce);
  authorize.searchParams.set("code_challenge", codeChallenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  if (options.disableAutoLogin) authorize.searchParams.set("disable_auto_login", "true");
  diagnostic?.step("begin", "started");

  return new Response(null, {
    status: 302,
    headers: { location: authorize.toString(), "cache-control": "no-store", "set-cookie": loginCookie(proof) },
  });
}

async function takeOAuthAttempt(env: AppEnv, stateHash: string): Promise<OAuthAttemptRow | null> {
  return env.DB.prepare(
    `UPDATE oauth_attempts SET status = 'processing'
     WHERE state_hash = ? AND status = 'pending' AND browser_proof_hash IS NOT NULL AND expires_at > ?
     RETURNING nonce, code_verifier, expires_at`,
  ).bind(stateHash, new Date().toISOString()).first<OAuthAttemptRow>();
}

async function getOrCreateLineUser(
  env: AppEnv,
  lineSubject: string,
  lineDisplayName: string | null,
): Promise<UserRow> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE users
     SET line_display_name = COALESCE(?, line_display_name), updated_at = ?
     WHERE line_subject = ?`,
  ).bind(lineDisplayName, now, lineSubject).run();
  const existingUser = await env.DB.prepare(
    `SELECT id, line_display_name, display_id, show_identity_default FROM users WHERE line_subject = ?`,
  ).bind(lineSubject).first<UserRow>();
  if (existingUser) return existingUser;

  await env.DB.prepare(
    `INSERT INTO users
     (id, line_subject, line_display_name, display_id, show_identity_default, created_at, updated_at)
     SELECT ?, ?, ?, NULL, 0, ?, ?
     WHERE (SELECT COUNT(*) FROM users) < ?
     ON CONFLICT(line_subject) DO NOTHING`,
  ).bind(
    crypto.randomUUID(),
    lineSubject,
    lineDisplayName,
    now,
    now,
    MAX_REGISTERED_USERS,
  ).run();
  const user = await env.DB.prepare(
    `SELECT id, line_display_name, display_id, show_identity_default FROM users WHERE line_subject = ?`,
  ).bind(lineSubject).first<UserRow>();
  if (!user) throw new RegistrationCapacityError();
  return user;
}

export async function finishLineLogin(
  request: Request, env: AppEnv, waitUntil?: (promise: Promise<unknown>) => void,
): Promise<Response> {
  const work = withAuthDiagnostic(env, request, "callback",
    diagnostic => finishLineLoginCore(request, env, diagnostic), waitUntil);
  // A duplicate navigation can disconnect the winning callback. Keep its single exchange alive.
  if (waitUntil) { try { waitUntil(work.catch(() => {})); } catch { /* Non-Worker test context. */ } }
  return work;
}

async function finishLineLoginCore(request: Request, env: AppEnv, diagnostic?: AuthDiagnostic): Promise<Response> {
  const config = getLineConfig(env);
  if (!config) {
    diagnostic?.step("configuration", "unconfigured");
    return redirect("/?login=config");
  }

  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  if (!state) {
    diagnostic?.step("attempt", "missing_state");
    return redirect("/?login=invalid");
  }

  diagnostic?.step("attempt", "received");
  const stateHash = await hmacHex(config.sessionSecret, state);
  const attempt = await takeOAuthAttempt(env, stateHash);
  if (!attempt) {
    const progress = await env.DB.prepare(
      "SELECT status, expires_at, failure FROM oauth_attempts WHERE state_hash = ? AND browser_proof_hash IS NOT NULL",
    ).bind(stateHash).first<OAuthProgressRow>();
    if (progress && Date.parse(progress.expires_at) > Date.now()) {
      diagnostic?.step("attempt", progress.status === "processing" ? "processing" : "completed");
      // State alone can observe a fixed landing page, never mint or receive a session.
      return redirect("/?login=completing");
    }
    diagnostic?.step("attempt", progress ? "expired" : "missing_or_consumed");
    return redirect("/?login=expired");
  }
  const fail = async (reason: "failed" | "cancelled" | "invalid" | "capacity") => {
    await env.DB.prepare(`UPDATE oauth_attempts SET status = 'failed', failure = ?, nonce = '', code_verifier = ''
      WHERE state_hash = ? AND status = 'processing'`).bind(reason, stateHash).run();
    return redirect(`/?login=${reason}`);
  };
  try {
    diagnostic?.step("attempt", "valid");
    if (url.searchParams.has("error")) {
      diagnostic?.step("attempt", "cancelled");
      return fail("cancelled");
    }

    const code = url.searchParams.get("code");
    if (!code) {
      diagnostic?.step("token", "missing_code");
      return fail("invalid");
    }

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.callbackUrl,
      client_id: config.channelId,
      client_secret: config.channelSecret,
      code_verifier: attempt.code_verifier,
    });
    diagnostic?.step("token", "started");
    const tokenResponse = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: tokenBody,
      signal: AbortSignal.timeout(8_000),
    });
    if (!tokenResponse.ok) {
      diagnostic?.step("token", "http_error", tokenResponse.status);
      return fail("failed");
    }
    const token = tokenResponseSchema.safeParse(await tokenResponse.json());
    if (!token.success) {
      diagnostic?.step("token", "invalid_response", tokenResponse.status);
      return fail("failed");
    }
    diagnostic?.step("token", "valid", tokenResponse.status);

    const verifyBody = new URLSearchParams({
      id_token: token.data.id_token,
      client_id: config.channelId,
      nonce: attempt.nonce,
    });
    diagnostic?.step("verify", "started");
    const verifyResponse = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: verifyBody,
      signal: AbortSignal.timeout(8_000),
    });
    if (!verifyResponse.ok) {
      diagnostic?.step("verify", "http_error", verifyResponse.status);
      return fail("failed");
    }
    const verified = verifiedIdTokenSchema.safeParse(await verifyResponse.json());
    if (
      !verified.success ||
      verified.data.aud !== config.channelId ||
      verified.data.nonce !== attempt.nonce ||
      verified.data.exp * 1000 <= Date.now()
    ) {
      diagnostic?.step("verify", verified.success ? "claims_rejected" : "invalid_response", verifyResponse.status);
      return fail("failed");
    }
    diagnostic?.step("verify", "valid", verifyResponse.status);

    let user: UserRow;
    diagnostic?.step("user", "started");
    try {
      user = await getOrCreateLineUser(env, verified.data.sub, verified.data.name?.trim() || null);
    } catch (error) {
      if (error instanceof RegistrationCapacityError) {
        diagnostic?.step("user", "capacity");
        return fail("capacity");
      }
      throw error;
    }
    await env.DB.prepare(
      `UPDATE oauth_attempts SET status = 'completed', result_user_id = ?, nonce = '', code_verifier = ''
       WHERE state_hash = ? AND status = 'processing' AND expires_at > ?`,
    ).bind(user.id, stateHash, new Date().toISOString()).run();
    diagnostic?.step("attempt", "completed");
    return redirect("/?login=completing");
  } catch (error) {
    try { await fail("failed"); } catch { /* Preserve the original sanitized failure. */ }
    throw error;
  }
}

export async function completeLineLogin(
  request: Request, env: AppEnv, waitUntil?: (promise: Promise<unknown>) => void,
): Promise<Response> {
  const operation = async (diagnostic?: AuthDiagnostic) => {
    const respond = (status: LineCompletion["status"], cookie?: string) => {
      const headers = new Headers({ "cache-control": "no-store" });
      if (cookie) {
        headers.append("set-cookie", cookie);
        headers.append("set-cookie", loginCookie("", 0));
      }
      return Response.json(lineCompletionSchema.parse({ status, traceId: diagnostic?.traceId }), { headers });
    };
    // No CORS/form/URL-based completion. The cookie is never exposed to JavaScript.
    const origin = new URL(request.url).origin;
    if (request.method !== "POST" || request.headers.get("origin") !== origin
      || request.headers.get("content-type")?.split(";")[0].trim() !== "application/json"
      || (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) {
      return Response.json({ error: "FORBIDDEN", message: "請從原本的網站完成登入" }, { status: 403, headers: { "cache-control": "no-store" } });
    }
    const config = getLineConfig(env);
    if (!config) return respond("none");
    const proofHash = await browserProofHash(request, config.sessionSecret);
    if (!proofHash) { diagnostic?.step("attempt", "missing_proof"); return respond("none"); }
    // Reuse the existing 20/minute binding with an isolated key; never consume playback quota.
    const ip = request.headers.get("cf-connecting-ip");
    if (!ip || !env.PLAYBACK_RATE_LIMITER) {
      return Response.json({ error: "AUTH_COMPLETION_UNAVAILABLE", message: "暫時無法確認登入，請稍後再試" }, { status: 503, headers: { "cache-control": "no-store" } });
    }
    const allowed = await env.PLAYBACK_RATE_LIMITER.limit({ key: `line-completion:${await hmacHex(config.sessionSecret, ip)}` });
    if (!allowed.success) return new Response(null, { status: 429, headers: { "cache-control": "no-store", "retry-after": "60" } });
    const progress = await env.DB.prepare(`SELECT status, expires_at, failure, trace_id
      FROM oauth_attempts WHERE browser_proof_hash = ?`).bind(proofHash).first<OAuthProgressRow>();
    if (!progress || Date.parse(progress.expires_at) <= Date.now()) {
      diagnostic?.step("attempt", "expired"); return respond("expired");
    }
    if (diagnostic && progress.trace_id) diagnostic.traceId = progress.trace_id;
    if (progress.status === "failed") {
      const failure = progress.failure === "capacity" || progress.failure === "cancelled" ? progress.failure : "failed";
      return respond(failure);
    }
    if (progress.status === "pending" || progress.status === "processing") {
      diagnostic?.step("attempt", "processing"); return respond("pending");
    }
    // One session per proof. Deterministic, secret-keyed derivation permits 60s redelivery if
    // the first response was lost; neither raw session tokens nor proofs are stored in D1.
    const proof = readCookie(request, LOGIN_COOKIE)!;
    const sessionToken = await hmacHex(config.sessionSecret, `oauth-session-v1:${proof}`);
    const sessionHash = await hmacHex(config.sessionSecret, sessionToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
    const result = await env.DB.batch([
      env.DB.prepare(`INSERT INTO auth_sessions (id_hash, user_id, expires_at, created_at, last_seen_at)
        SELECT ?, result_user_id, ?, ?, ? FROM oauth_attempts
        WHERE browser_proof_hash = ? AND status = 'completed' AND result_user_id IS NOT NULL AND expires_at > ?`)
        .bind(sessionHash, expiresAt, now.toISOString(), now.toISOString(), proofHash, now.toISOString()),
      env.DB.prepare(`UPDATE oauth_attempts SET status = 'delivered', delivered_at = ?
        WHERE browser_proof_hash = ? AND status = 'completed' AND expires_at > ?`)
        .bind(now.toISOString(), proofHash, now.toISOString()),
      env.DB.prepare(`SELECT a.expires_at FROM auth_sessions a JOIN oauth_attempts o ON o.result_user_id = a.user_id
        WHERE a.id_hash = ? AND a.expires_at > ? AND o.browser_proof_hash = ?
        AND o.status = 'delivered' AND o.expires_at > ? AND o.delivered_at > ?`)
        .bind(sessionHash, now.toISOString(), proofHash, now.toISOString(),
          new Date(now.getTime() - DELIVERY_RETRY_SECONDS * 1000).toISOString()),
    ]);
    const session = result[2].results[0] as { expires_at: string } | undefined;
    if (!session) { diagnostic?.step("attempt", "expired"); return respond("expired"); }
    diagnostic?.step("session", "delivered");
    return respond("ready", sessionCookie(sessionToken, Math.max(0, Math.floor((Date.parse(session.expires_at) - Date.now()) / 1000))));
  };
  // Ordinary visitors have no login proof: one cheap response, no D1/diagnostic write.
  return /^[A-Za-z0-9_-]{43}$/.test(readCookie(request, LOGIN_COOKIE) ?? "")
    ? withAuthDiagnostic(env, request, "completion", operation, waitUntil) : operation();
}

export async function getAuthenticatedUser(request: Request, env: AppEnv): Promise<AuthenticatedUser | null> {
  const devUser = await getOrCreateDevUser(env);
  if (devUser) return { user: devUser, authMode: "development" };

  const config = getLineConfig(env);
  const sessionToken = readCookie(request, SESSION_COOKIE);
  if (!config || !sessionToken) return null;
  const sessionHash = await hmacHex(config.sessionSecret, sessionToken);
  const now = new Date().toISOString();
  const user = await env.DB.prepare(
    `SELECT u.id, u.line_display_name, u.display_id, u.show_identity_default
     FROM auth_sessions a
     JOIN users u ON u.id = a.user_id
     WHERE a.id_hash = ? AND a.expires_at > ?`,
  ).bind(sessionHash, now).first<UserRow>();
  return user ? { user, authMode: "line" } : null;
}

export async function logout(request: Request, env: AppEnv): Promise<Response> {
  const config = getLineConfig(env);
  const sessionToken = readCookie(request, SESSION_COOKIE);
  if (config && sessionToken) {
    const sessionHash = await hmacHex(config.sessionSecret, sessionToken);
    await env.DB.prepare("DELETE FROM auth_sessions WHERE id_hash = ?").bind(sessionHash).run();
  }
  const proofHash = config && await browserProofHash(request, config.sessionSecret);
  if (proofHash) await env.DB.prepare("DELETE FROM oauth_attempts WHERE browser_proof_hash = ?").bind(proofHash).run();
  const response = redirect("/", expiredSessionCookie());
  response.headers.append("set-cookie", loginCookie("", 0));
  return response;
}
