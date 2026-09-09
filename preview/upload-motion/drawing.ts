export type Point = { x: number; y: number };
export type Contour = Point[];
export const SEA = "#075b69";
export const DARK = "#064c59";
export const FOAM = "#e8f5ef";
export const MINT = "#88cfc4";
export const clamp = (p: number) => Math.min(1, Math.max(0, p));
export const mix = (a: number, b: number, p: number) => a + (b - a) * p;
export function ease(a: number, b: number, t: number) {
  const p = clamp((t - a) / (b - a));
  return p * p * p * (p * (p * 6 - 15) + 10);
}
export function sample(d: string, count = 160): Contour {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  const length = path.getTotalLength();
  return Array.from({ length: count }, (_, i) => {
    const p = path.getPointAtLength(i * length / count);
    return { x: p.x, y: p.y };
  });
}
export const between = (a: Contour, b: Contour, p: number): Contour => a.map((v, i) => ({ x: mix(v.x, b[i].x, p), y: mix(v.y, b[i].y, p) }));
export function shape(ctx: CanvasRenderingContext2D, points: Contour, fill: string | CanvasGradient) {
  ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
}
export function path(ctx: CanvasRenderingContext2D, d: string, fill: string | CanvasGradient, outline?: string, width = 1) {
  const p = new Path2D(d); ctx.fillStyle = fill; ctx.fill(p);
  if (outline) { ctx.strokeStyle = outline; ctx.lineWidth = width; ctx.lineJoin = "round"; ctx.stroke(p); }
}
export function line(ctx: CanvasRenderingContext2D, d: string, color: string, width = 1) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke(new Path2D(d));
}
export function gradient(ctx: CanvasRenderingContext2D, y1: number, y2: number, stops: [number, string][]) {
  const value = ctx.createLinearGradient(0, y1, 0, y2);
  stops.forEach(([position, color]) => value.addColorStop(position, color)); return value;
}
