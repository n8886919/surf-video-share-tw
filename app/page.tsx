import { SurfApp, type LoginStatus } from "./surf-app";
import { authTraceSchema } from "../packages/api-contract/src";

const LOGIN_STATUSES = new Set<LoginStatus>([
  "capacity",
  "cancelled",
  "config",
  "expired",
  "failed",
  "invalid",
  "completing",
]);

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ help?: string | string[]; login?: string | string[]; auth_trace?: string | string[] }>;
}) {
  const query = await searchParams;
  const rawLogin = query.login;
  const candidate = Array.isArray(rawLogin) ? rawLogin[0] : rawLogin;
  const loginStatus = candidate && LOGIN_STATUSES.has(candidate as LoginStatus)
    ? candidate as LoginStatus
    : undefined;
  const rawHelp = Array.isArray(query.help) ? query.help[0] : query.help;
  const trace = authTraceSchema.safeParse(query.auth_trace);
  return <SurfApp loginStatus={loginStatus} initialHelpOpen={rawHelp === "1"} authTrace={trace.success ? trace.data : undefined} />;
}
