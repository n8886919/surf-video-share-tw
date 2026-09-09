import logoUrl from "../../public/brand-logo.png?url";
import { ease, mix, SEA } from "./drawing";
import { drawWave } from "./wave";
import { drawPeople } from "./people";

const DURATION = 17;
function element<T extends HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`Missing preview element: ${selector}`);
  return result;
}
const canvas = element<HTMLCanvasElement>("#ocean");
const context = canvas.getContext("2d");
if (!context) throw new Error("Canvas 2D is required for this motion study");
const ctx: CanvasRenderingContext2D = context;
element<HTMLImageElement>("#brand-logo").src = logoUrl;
const timeline = element<HTMLInputElement>("#timeline");
const play = element<HTMLButtonElement>("#play");
const status = element<HTMLSpanElement>("#status");
const percentage = element<HTMLSpanElement>("#percentage");
const fill = element<HTMLDivElement>("#upload-fill");
const timeLabel = element<HTMLOutputElement>("#time");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let time = reducedMotion.matches ? 5.8 : 0;
let playing = !reducedMotion.matches;
let speed = 1;
let previous = 0;
let frameId = 0;
let dirty = true;
let dpr = 1;

function draw(t: number) {
  const w = canvas.clientWidth; const h = canvas.clientHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  const unit = w / 800;
  ctx.translate(w / 2, h / 2 + 6 * unit); ctx.scale(unit * .96, unit * .96); ctx.translate(-256, -256);
  const reveal = ease(8.8, 11.7, t); const exit = ease(16, 17, t);
  ctx.save(); ctx.beginPath(); ctx.ellipse(256, 256, mix(256, 375, reveal), mix(256, 282, reveal), 0, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = SEA; ctx.fillRect(-300, -300, 1200, 1200);
  drawWave(ctx, t); drawPeople(ctx, t);
  if (exit) { ctx.globalAlpha = exit; ctx.fillStyle = SEA; ctx.fillRect(-300, -300, 1200, 1200); }
  ctx.restore();
  if (exit) {
    ctx.save(); ctx.globalCompositeOperation = "destination-in";
    ctx.beginPath(); ctx.ellipse(256, 256, mix(375, 256, exit), mix(282, 256, exit), 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  const progress = t < 8.8 ? ease(0, 8.8, t) * 83 : t < 15.8 ? 83 + ease(8.8, 15.8, t) * 16 : 100;
  percentage.innerHTML = `${Math.round(progress)}<span>%</span>`; fill.style.transform = `scaleX(${progress / 100})`;
  const label = t < .7 ? "等待湧浪" : t < 3.55 ? "浪從左邊來了" : t < 6.5 ? "影片上傳中" : t < 8.8 ? "浪向右轉" : t < 11.7 ? "鏡頭拉遠" : t < 15.8 ? "即將完成" : "上傳完成";
  if (status.textContent !== label) status.textContent = label;
  timeline.value = String(t); timeLabel.textContent = `${t.toFixed(1).padStart(4, "0")} / 17.0s`;
  const chapter = t < .7 ? 0 : t < 3.55 ? 1 : t < 6.5 ? 2 : t < 8.8 ? 3 : t < 11.7 ? 4 : 5;
  document.querySelectorAll<HTMLButtonElement>("[data-time]").forEach((button, i) => button.setAttribute("aria-current", String(i === chapter)));
}
function syncPlay() { play.textContent = playing ? "Ⅱ" : "▶"; play.setAttribute("aria-label", playing ? "暫停動畫" : "播放動畫"); }
function seek(next: number, run = false) { time = next; playing = run; syncPlay(); draw(time); dirty = false; }
function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientHeight * dpr); dirty = true;
}
function tick(timestamp: number) {
  const delta = previous ? Math.min((timestamp - previous) / 1000, .05) : 0; previous = timestamp;
  if (playing && !document.hidden) { time = (time + delta * speed) % DURATION; dirty = true; }
  if (dirty) { draw(time); dirty = false; }
  frameId = requestAnimationFrame(tick);
}
play.addEventListener("click", () => { playing = !playing; syncPlay(); });
element<HTMLButtonElement>("#replay").addEventListener("click", () => seek(0, true));
timeline.addEventListener("input", () => seek(Number(timeline.value)));
document.querySelectorAll<HTMLButtonElement>("[data-time]").forEach(button => button.addEventListener("click", () => seek(Number(button.dataset.time))));
document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach(button => button.addEventListener("click", () => {
  speed = Number(button.dataset.speed);
  document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach(b => b.setAttribute("aria-pressed", String(b === button)));
}));
const observer = new ResizeObserver(resize); observer.observe(canvas);
document.addEventListener("visibilitychange", () => { previous = 0; });
reducedMotion.addEventListener("change", e => { if (e.matches) { playing = false; syncPlay(); } });
window.addEventListener("pagehide", () => { cancelAnimationFrame(frameId); observer.disconnect(); });
window.addEventListener("pageshow", e => { if (e.persisted) { previous = 0; observer.observe(canvas); frameId = requestAnimationFrame(tick); } });
syncPlay(); resize(); frameId = requestAnimationFrame(tick);
