const BASIC_SECURITY_HEADERS = {
  "referrer-policy": "strict-origin",
  "x-content-type-options": "nosniff",
} as const;

export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(BASIC_SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
