/** Reply-only MVP: no paid push and no automatic bulk messaging. */
export async function replyToLine(token: string, replyToken: string, messages: readonly unknown[]): Promise<void> {
  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(8_000),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (response.ok) {
    await response.body?.cancel();
    console.info("LINE_REPLY_ACCEPTED");
    return;
  }
  const body: unknown = await response.json().catch(() => null);
  // Only this explicit rejection means the token was consumed or expired. Other
  // HTTP 400 errors (including invalid cards) must not silently acknowledge work.
  const invalidToken = response.status === 400 && body !== null && typeof body === "object"
    && "message" in body && body.message === "Invalid reply token";
  console.warn(invalidToken ? "LINE_REPLY_TOKEN_INVALID" : "LINE_REPLY_REJECTED", response.status);
  // Never log provider bodies, tokens, recipients or message contents; no paid push fallback.
  if (!invalidToken) throw new Error("LINE_REPLY_UNAVAILABLE");
}
