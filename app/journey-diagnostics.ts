import { clientDiagnosticSchema, type ClientDiagnostic } from "../packages/api-contract/src";
import { PROJECT_VERSION } from "../packages/domain/src/project-purpose";

/** Diagnostics never block the user flow, and never serialize arbitrary exceptions. */
export function clientDiagnostic(event: ClientDiagnostic["event"], traceId: string,
  details: Omit<ClientDiagnostic["details"], "version">): void {
  const parsed = clientDiagnosticSchema.safeParse({ event, traceId, details: { ...details, version: PROJECT_VERSION } });
  if (!parsed.success) return;
  void fetch("/api/v1/diagnostics", { method: "POST", credentials: "same-origin", keepalive: true,
    headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data),
  }).catch(() => undefined);
}
