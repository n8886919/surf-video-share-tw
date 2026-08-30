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
  searchParams: Promise<{ login?: string | string[] }>;
}) {
  const rawLogin = (await searchParams).login;
  const candidate = Array.isArray(rawLogin) ? rawLogin[0] : rawLogin;
  const loginStatus = candidate && LOGIN_STATUSES.has(candidate as LoginStatus)
    ? candidate as LoginStatus
    : undefined;
  return <SurfApp loginStatus={loginStatus} />;
}
