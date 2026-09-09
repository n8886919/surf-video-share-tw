import { between, DARK, ease, FOAM, line, MINT, mix, path, sample, shape, type Point } from "./drawing";

// These remain hands for the entire shot. Their full bodies already exist
// outside the close-up frame; one camera transform reveals them later.
const leftPalm = "M143 292 C169 305 177 297 199 287 L231 271 Q244 265 258 277 L299 327 L350 390 Q361 402 349 412 Q342 419 333 412 L289 381 L325 413 Q337 425 325 434 Q317 439 308 431 L274 404 L301 429 Q312 441 299 449 Q292 453 283 445 L257 423 L276 442 Q284 451 274 458 Q268 462 258 454 L149 381 Q136 371 115 366 Z";
const rightPalm = "M367 292 L395 368 Q374 376 355 390 L272 322 Q263 319 244 330 Q222 357 205 352 Q187 348 198 330 L212 306 Q217 299 231 293 L261 277 Q278 268 290 276 L329 295 Q347 305 367 292 Z";
// All four fingers share a palm root, concealed by the other hand when held.
const rightFingers = "M201 320 L246 303 L280 318 L267 350 L244 434 L232 451 Q225 462 215 455 Q204 449 211 438 L223 421 L208 439 Q200 448 191 441 Q181 434 188 424 L201 407 L186 425 Q178 434 168 426 Q159 419 166 409 L180 391 L165 408 Q157 417 147 409 Q137 401 145 390 L157 374 Q166 363 177 371 L190 354 Z";
const leftWrist = { x: 132, y: 327 };
const rightWrist = { x: 381, y: 330 };
const leftForearm = sample("M35 245 L142 291 L102 385 L69 372 Q32 313 35 245 Z", 64);
const rightForearm = sample("M367 290 L477 245 Q481 311 444 373 L410 387 Z", 64);
const relaxedLeftForearm = sample("M64 302 L143 300 L143 354 L64 352 Z", 64);
const relaxedRightForearm = sample("M367 301 L448 304 L448 354 L367 356 Z", 64);

function limb(ctx: CanvasRenderingContext2D, a: Point, b: Point, r1: number, r2: number, color: string) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x); const nx = -Math.sin(angle); const ny = Math.cos(angle);
  const ax = a.x + nx * r1; const ay = a.y + ny * r1;
  const bx = b.x + nx * r2; const by = b.y + ny * r2;
  path(ctx, `M${ax} ${ay} Q${mix(ax, bx, .56)} ${mix(ay, by, .44)} ${bx} ${by} A${r2} ${r2} 0 0 0 ${b.x - nx * r2} ${b.y - ny * r2} Q${mix(a.x - nx * r1, b.x - nx * r2, .56)} ${mix(a.y - ny * r1, b.y - ny * r2, .44)} ${a.x - nx * r1} ${a.y - ny * r1} A${r1} ${r1} 0 0 0 ${ax} ${ay} Z`, color);
}
function wristPosition(side: number, t: number): Point {
  const entry = ease(side < 0 ? 3.55 : 3.72, side < 0 ? 5.15 : 5.32, t);
  const release = ease(9.65, 11.6, t); const p = side < 0 ? leftWrist : rightWrist;
  return { x: p.x + side * (1 - entry) * 570 + side * release * 405,
    y: p.y - Math.sin(entry * Math.PI) * 23 - release * 112 };
}
function handTransform(ctx: CanvasRenderingContext2D, side: number, t: number) {
  const release = ease(9.65, 11.6, t); const p = side < 0 ? leftWrist : rightWrist;
  const wrist = wristPosition(side, t);
  ctx.translate(wrist.x, wrist.y); ctx.rotate(side * release * .29);
  // The same palm rolls edge-on as the grip releases; the wrist stays fixed.
  ctx.scale(mix(1, .57, release), mix(1, .78, release)); ctx.translate(-p.x, -p.y);
}
function board(ctx: CanvasRenderingContext2D, mint: boolean) {
  path(ctx, "M-1280 1093 C-1035 1029 -566 1007 -244 1059 Q-213 1064 -239 1086 C-527 1154 -1078 1157 -1280 1093 Z", mint ? MINT : FOAM);
  line(ctx, "M-1210 1091 Q-742 1070 -285 1072", mint ? "#cdeade" : "#64aa9f", 3.5);
}
function person(ctx: CanvasRenderingContext2D, side: number, t: number) {
  const mint = side > 0; const color = mint ? MINT : FOAM;
  ctx.save(); if (mint) { ctx.translate(512, 0); ctx.scale(-1, 1); }
  const stance = ease(9.7, 12.1, t);
  const knee = Math.sin((t - 11.7) * .95) * 13 * ease(11.7, 12.7, t);
  const hip = { x: -640 + stance * 24, y: 415 + stance * 74 + knee };
  const shoulder = { x: -728 - stance * 28, y: 100 + stance * 99 + knee };
  const neck = { x: shoulder.x - 36, y: shoulder.y - 42 };
  board(ctx, mint);
  const rearKnee = { x: -408 + stance * 45, y: 730 + stance * 17 };
  const rearAnkle = { x: -465, y: 1032 };
  limb(ctx, hip, rearKnee, 82, 49, color); limb(ctx, rearKnee, rearAnkle, 49, 25, color);
  path(ctx, "M-489 1019 Q-453 1010 -440 1039 L-372 1060 Q-350 1077 -379 1081 L-517 1076 Q-532 1062 -506 1048 Z", color);
  const frontKnee = { x: -858 - stance * 65, y: 697 + stance * 9 };
  const frontAnkle = { x: -1038, y: 1055 };
  limb(ctx, { x: hip.x - 43, y: hip.y + 11 }, frontKnee, 87, 54, color);
  limb(ctx, frontKnee, frontAnkle, 54, 25, color);
  path(ctx, "M-1056 1034 Q-1025 1037 -1021 1061 L-959 1076 Q-940 1091 -968 1096 L-1097 1092 Q-1117 1085 -1098 1072 Z", color);
  path(ctx, `M${shoulder.x - 54} ${shoulder.y - 29} Q${shoulder.x + 48} ${shoulder.y - 51} ${shoulder.x + 99} ${shoulder.y + 42} C${shoulder.x + 120} ${shoulder.y + 121} ${hip.x + 58} ${hip.y - 101} ${hip.x + 75} ${hip.y + 35} Q${hip.x + 3} ${hip.y + 86} ${hip.x - 84} ${hip.y + 36} C${hip.x - 97} ${hip.y - 98} ${shoulder.x - 41} ${shoulder.y + 129} ${shoulder.x - 54} ${shoulder.y - 29} Z`, color);
  path(ctx, `M${hip.x - 82} ${hip.y - 8} Q${hip.x + 5} ${hip.y + 9} ${hip.x + 70} ${hip.y - 11} L${hip.x + 105} ${hip.y + 125} L${hip.x + 23} ${hip.y + 155} L${hip.x - 3} ${hip.y + 92} L${hip.x - 66} ${hip.y + 159} L${hip.x - 143} ${hip.y + 111} Z`, mint ? "#306f76" : "#226572");
  // Head silhouette with a continuous neck, jaw and understated hair shape.
  ctx.save(); ctx.translate(neck.x, neck.y); ctx.rotate(-.15 - stance * .06);
  path(ctx, "M-18 38 L43 35 L34 -10 Q68 -38 55 -94 Q44 -151 -5 -155 Q-61 -159 -73 -109 L-71 -70 L-89 -40 Q-90 -31 -74 -29 L-65 -3 Q-59 13 -27 9 Z", color);
  path(ctx, "M-73 -88 Q-92 -142 -42 -163 Q4 -184 42 -154 Q67 -134 60 -98 L29 -110 Q-18 -112 -34 -83 L-52 -67 L-57 -92 Z", mint ? "#377f80" : "#c1dfd4"); ctx.restore();
  const leadElbow = { x: shoulder.x - 205, y: shoulder.y + 108 };
  const leadHand = { x: shoulder.x - 381, y: shoulder.y + 53 + stance * 26 };
  limb(ctx, { x: shoulder.x - 31, y: shoulder.y + 42 }, leadElbow, 52, 34, color);
  limb(ctx, leadElbow, leadHand, 34, 20, color);
  path(ctx, `M${leadHand.x + 12} ${leadHand.y - 21} l-52 -11 q-26 -1 -28 12 q-1 13 24 15 l34 15 q23 8 32 -7 Z`, color);
  const actualWrist = wristPosition(side, t);
  const wrist = mint ? { x: 512 - actualWrist.x, y: actualWrist.y } : actualWrist;
  const elbow = { x: mix(-352, -409, stance), y: mix(277, 383, stance) };
  limb(ctx, { x: shoulder.x + 52, y: shoulder.y + 31 }, elbow, 61, 46, color);
  limb(ctx, elbow, wrist, 46, mix(43, 27, stance), color);
  ctx.restore();
}
function rideTransform(ctx: CanvasRenderingContext2D, side: number, t: number) {
  const ride = ease(11.55, 15.3, t); const carve = Math.sin(ride * Math.PI);
  ctx.translate(side * ride * 325, carve * 130 - ride * 40);
  const foot = side < 0 ? { x: -750, y: 1070 } : { x: 1262, y: 1070 };
  ctx.translate(foot.x, foot.y); ctx.rotate(side * (.075 * carve - .06 * ride)); ctx.translate(-foot.x, -foot.y);
}
export function drawPeople(ctx: CanvasRenderingContext2D, t: number) {
  if (t < 3.55) return;
  const pull = ease(8.75, 11.7, t);
  const relax = ease(9.15, 11.25, t);
  const zoom = Math.exp(mix(0, Math.log(.145), pull));
  ctx.save(); ctx.translate(256, mix(327, 271, pull)); ctx.scale(zoom, zoom); ctx.translate(-256, -327);
  for (const side of [-1, 1]) { ctx.save(); rideTransform(ctx, side, t); person(ctx, side, t); ctx.restore(); }
  ctx.save(); rideTransform(ctx, 1, t); handTransform(ctx, 1, t); path(ctx, rightFingers, FOAM, DARK, 7); ctx.restore();
  ctx.save(); rideTransform(ctx, -1, t); handTransform(ctx, -1, t);
  shape(ctx, between(leftForearm, relaxedLeftForearm, relax), FOAM);
  path(ctx, leftPalm, FOAM, DARK, 7); ctx.restore();
  ctx.save(); rideTransform(ctx, 1, t); handTransform(ctx, 1, t);
  shape(ctx, between(rightForearm, relaxedRightForearm, relax), MINT);
  path(ctx, rightPalm, MINT, DARK, 7); ctx.restore();
  ctx.restore();
  const wake = ease(12, 13.4, t);
  if (wake) {
    const ride = ease(11.55, 15.3, t); ctx.save(); ctx.globalAlpha = wake * .58;
    line(ctx, `M179 407 Q138 421 ${117 - ride * 47} ${395 + Math.sin(ride * Math.PI) * 19}`, "#d9eee1", 1.4);
    line(ctx, `M333 408 Q374 421 ${395 + ride * 47} ${395 + Math.sin(ride * Math.PI) * 19}`, "#b6ded0", 1.4); ctx.restore();
  }
}
