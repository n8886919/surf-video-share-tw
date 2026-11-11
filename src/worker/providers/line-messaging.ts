/** Reply-only MVP: no paid push and no automatic bulk messaging. */
export async function replyToLine(token: string, replyToken: string, messages: readonly unknown[]): Promise<void> {
  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(8_000),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ replyToken, messages }),
  });
  await response.body?.cancel();
  // Redelivery may reuse an already consumed/expired reply token. Never retry it as a paid push.
  if (!response.ok && response.status !== 400) throw new Error("LINE_REPLY_UNAVAILABLE");
}
