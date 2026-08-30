import { SurfApp, type LoginStatus } from "./surf-app";

const LOGIN_STATUSES = new Set<LoginStatus>([
  "capacity",
  "cancelled",
  "config",
  "expired",
  "failed",
  "invalid",
]);

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ help?: string | string[]; login?: string | string[] }>;
}) {
  const query = await searchParams;
  const rawLogin = query.login;
  const candidate = Array.isArray(rawLogin) ? rawLogin[0] : rawLogin;
  const loginStatus = candidate && LOGIN_STATUSES.has(candidate as LoginStatus)
    ? candidate as LoginStatus
    : undefined;
  const rawHelp = Array.isArray(query.help) ? query.help[0] : query.help;
  return <SurfApp loginStatus={loginStatus} initialHelpOpen={rawHelp === "1"} />;
}
