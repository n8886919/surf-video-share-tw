import { z } from "zod";
import { MAX_REGISTERED_USERS } from "../../packages/domain/src";
import type { AppEnv, UserRow } from "./db";
import { getOrCreateDevUser } from "./db";

const SESSION_COOKIE = "__Host-surf_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const OAUTH_ATTEMPT_TTL_SECONDS = 10 * 60;

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
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

function sessionCookie(value: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
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
  options: { disableAutoLogin?: boolean } = {},
): Promise<Response> {
  const config = getLineConfig(env);
  if (!config) {
    return Response.json(
      { error: "AUTH_NOT_CONFIGURED", message: "LINE Login 尚未完成部署設定" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const state = randomBase64Url();
  const nonce = randomBase64Url();
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const stateHash = await hmacHex(config.sessionSecret, state);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OAUTH_ATTEMPT_TTL_SECONDS * 1000).toISOString();

  await env.DB.prepare("DELETE FROM oauth_attempts WHERE expires_at <= ?")
    .bind(now.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO oauth_attempts
     (state_hash, nonce, code_verifier, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(stateHash, nonce, codeVerifier, expiresAt, now.toISOString()).run();

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

  return new Response(null, {
    status: 302,
    headers: { location: authorize.toString(), "cache-control": "no-store" },
  });
}

async function takeOAuthAttempt(env: AppEnv, stateHash: string): Promise<OAuthAttemptRow | null> {
  return env.DB.prepare(
    `DELETE FROM oauth_attempts WHERE state_hash = ?
     RETURNING nonce, code_verifier, expires_at`,
  ).bind(stateHash).first<OAuthAttemptRow>();
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

export async function finishLineLogin(request: Request, env: AppEnv): Promise<Response> {
  const config = getLineConfig(env);
  if (!config) return redirect("/?login=config");

  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  if (!state) return redirect("/?login=invalid");

  const stateHash = await hmacHex(config.sessionSecret, state);
  const attempt = await takeOAuthAttempt(env, stateHash);
  if (!attempt || new Date(attempt.expires_at).getTime() <= Date.now()) {
    return redirect("/?login=expired");
  }
  if (url.searchParams.has("error")) return redirect("/?login=cancelled");

  const code = url.searchParams.get("code");
  if (!code) return redirect("/?login=invalid");

  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.callbackUrl,
    client_id: config.channelId,
    client_secret: config.channelSecret,
    code_verifier: attempt.code_verifier,
  });
  const tokenResponse = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: tokenBody,
  });
  if (!tokenResponse.ok) return redirect("/?login=failed");
  const token = tokenResponseSchema.safeParse(await tokenResponse.json());
  if (!token.success) return redirect("/?login=failed");

  const verifyBody = new URLSearchParams({
    id_token: token.data.id_token,
    client_id: config.channelId,
    nonce: attempt.nonce,
  });
  const verifyResponse = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: verifyBody,
  });
  if (!verifyResponse.ok) return redirect("/?login=failed");
  const verified = verifiedIdTokenSchema.safeParse(await verifyResponse.json());
  if (
    !verified.success ||
    verified.data.aud !== config.channelId ||
    verified.data.nonce !== attempt.nonce ||
    verified.data.exp * 1000 <= Date.now()
  ) {
    return redirect("/?login=failed");
  }

  let user: UserRow;
  try {
    user = await getOrCreateLineUser(env, verified.data.sub, verified.data.name?.trim() || null);
  } catch (error) {
    if (error instanceof RegistrationCapacityError) return redirect("/?login=capacity");
    throw error;
  }
  const sessionToken = randomBase64Url(48);
  const sessionHash = await hmacHex(config.sessionSecret, sessionToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?")
    .bind(now.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO auth_sessions
     (id_hash, user_id, expires_at, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(sessionHash, user.id, expiresAt, now.toISOString(), now.toISOString()).run();

  return redirect("/", sessionCookie(sessionToken));
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
  return redirect("/", expiredSessionCookie());
}
