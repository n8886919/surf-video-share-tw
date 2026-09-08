export function marineResponse(url: URL, now = new Date()) {
  const count = Number(url.searchParams.get("forecast_hours")) + 6;
  const start = Math.floor(now.getTime() / 3_600_000) * 3_600_000 - 6 * 3_600_000;
  return { latitude: 24.9, longitude: 121.9, hourly: {
    time: Array.from({ length: count }, (_, index) => new Date(start + index * 3_600_000).toISOString()),
    wave_height: Array(count).fill(1), wave_direction: Array(count).fill(90), wave_period: Array(count).fill(8),
  } };
}
