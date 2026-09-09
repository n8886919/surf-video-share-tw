import { between, ease, FOAM, gradient, line, MINT, mix, sample, shape, type Contour } from "./drawing";

const profile = {
  lip: sample("M57 245 C104 219 121 140 182 92 C236 48 310 63 347 102 C378 137 380 174 346 194 C317 210 286 193 284 177 C280 160 291 145 305 147 C314 147 321 153 322 158 C335 114 269 109 238 133 C177 174 176 236 101 267 Z"),
  face: sample("M126 279 C182 263 197 186 247 164 C217 213 267 271 325 247 C370 231 384 239 433 259 L367 289 C334 311 300 266 279 272 L254 279 C228 264 210 282 178 294 Z"),
};
const rising = {
  lip: sample("M24 289 C81 262 110 234 154 207 C201 178 253 172 298 186 C332 196 352 216 345 232 C339 245 318 245 310 233 C306 225 310 221 316 225 C301 204 270 208 244 222 C195 248 149 280 83 305 Z"),
  face: sample("M81 307 C146 292 207 244 263 224 C247 251 280 282 317 274 C358 264 401 283 461 292 L458 344 C380 348 302 323 249 326 C187 327 118 342 81 334 Z"),
};
// Three-quarter pose: near lip sweeps right, far shoulder opens left.
const quarter = {
  lip: sample("M-28 307 C22 285 76 241 125 189 C181 127 244 81 310 100 C369 116 416 160 418 208 C420 237 401 254 380 254 C359 254 350 236 358 222 C364 211 375 211 381 221 C378 185 346 160 305 157 C245 145 196 200 150 241 C83 300 30 319 -8 331 Z"),
  face: sample("M-8 330 C84 303 171 212 231 181 C288 153 340 185 362 221 C332 218 326 262 362 279 C385 291 414 278 434 253 C482 308 524 344 548 361 L571 474 C418 459 318 438 254 438 C138 434 66 453 -54 454 Z"),
};
// Continuous open face; no mirrored tunnel cut-outs, particles or mesh.
const frontal = {
  lip: sample("M-70 350 C-9 333 61 292 111 244 C168 188 210 139 258 139 C312 139 359 185 408 239 C462 297 516 330 580 352 L578 375 C510 357 450 324 394 270 C345 223 303 185 258 183 C212 183 170 223 123 270 C70 323 4 358 -68 374 Z"),
  face: sample("M-68 374 C4 358 70 323 123 270 C170 223 212 183 258 183 C303 185 345 223 394 270 C450 324 510 357 578 375 L612 526 C477 535 367 516 256 523 C131 515 39 539 -106 524 Z"),
};
function fluid(points: Contour, t: number, strength: number) {
  return points.map(p => {
    const phase = p.x * .0105 - t * 1.6;
    const height = Math.max(0, (335 - p.y) / 250);
    return { x: p.x + Math.sin(phase + .8) * strength * height,
      y: p.y + Math.sin(phase) * strength * (.3 + height) };
  });
}
export function drawWave(ctx: CanvasRenderingContext2D, t: number) {
  if (t < .7) return;
  const arrive = ease(.7, 3.5, t); const curl = ease(1.3, 3.6, t);
  const firstTurn = ease(6.5, 8.25, t); const lastTurn = ease(8.15, 9.8, t);
  const pitch = ease(10.2, 14.5, t); const travel = mix(-545, 0, arrive);
  let lip = between(rising.lip, profile.lip, curl);
  let face = between(rising.face, profile.face, curl);
  lip = between(between(lip, quarter.lip, firstTurn), frontal.lip, lastTurn);
  face = between(between(face, quarter.face, firstTurn), frontal.face, lastTurn);
  const motion = mix(3.5, 1.3, firstTurn);
  lip = fluid(lip, t, motion); face = fluid(face, t - .16, motion * .75);
  // Depth-dependent foreshortening between the profile / quarter / front poses.
  const yaw = firstTurn * (1 - lastTurn);
  const perspective = (points: Contour) => points.map(p => {
    const depth = (p.x - 256) / 360; const ratio = 1 + depth * yaw * .16;
    return { x: 256 + (p.x - 256) / ratio + yaw * 16,
      y: 270 + (p.y - 270) / ratio + yaw * depth * 12 };
  });
  lip = perspective(lip); face = perspective(face);
  lip = lip.map(p => ({ x: 256 + (p.x - 256) * (1 + pitch * .13), y: p.y + pitch * (8 + 25 * (1 - ease(195, 315, p.y))) }));
  face = face.map(p => ({ x: 256 + (p.x - 256) * (1 + pitch * .13), y: p.y + pitch * 26 * (1 - ease(195, 325, p.y)) }));
  ctx.save(); ctx.translate(travel, Math.sin(arrive * Math.PI) * -13);
  shape(ctx, face, gradient(ctx, 170, 505, [[0, "#9dd8ca"], [.49, MINT], [1, "#3d9b9f"]]));
  if (firstTurn > 0) {
    ctx.globalAlpha = firstTurn;
    shape(ctx, face, gradient(ctx, 170, 505, [[0, "#48a3a5"], [.55, "#278b95"], [1, "#126a7b"]]));
    ctx.globalAlpha = 1;
  }
  shape(ctx, lip, FOAM);
  if (lastTurn > 0) {
    ctx.globalAlpha = lastTurn * .42;
    line(ctx, `M-30 395 C88 381 150 ${246 + pitch * 22} 257 ${240 + pitch * 26} C363 ${242 + pitch * 26} 433 374 545 398`, "#c4e6d9", 1.15);
    ctx.globalAlpha = lastTurn * .16;
    line(ctx, "M-40 472 Q94 447 245 467 T560 477", "#caeadd", 1.3);
  }
  ctx.restore();
}
