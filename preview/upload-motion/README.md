# Upload motion study 02 — local only

Run `pnpm preview:upload-motion`, then open <http://127.0.0.1:4174>.

The 17-second canvas study follows the checked-in `public/brand-logo.png` and the owner's second-round direction:

- 0–0.7s: plain teal background.
- 0.7–3.55s: wave enters from the left, travels right and curls into the logo wave.
- 3.55–6.5s: two hands join. The right hand's fingertips have a shared, connected palm root.
- 6.5–8.8s: side view turns right through a distinct three-quarter view before settling front-on. Depth-dependent foreshortening supports the drawn key poses; this is a 2D illustration, not a 3D fluid simulation.
- 8.8–11.7s: one shared camera transform pulls back to show the full people and boards, already present outside the close frame. Hands retain their identity and contours, stay connected to wrists/arms, then unclasp and roll edge-on. Arms adjust their pose; they do not turn into bodies or boards.
- 11.7–17s: two athletes trim outward along the open shoulders. The front lip pitches forward; the scene settles and loops.

The second version removes all droplets, particle spray, tube holes, mesh textures and falling foam effects. Only two restrained water contours and two board wakes remain. The figure design uses filled, tapered limbs, profile heads, board shorts and fixed feet/boards. Replay, pause, speed and six chapter controls support review; reduced-motion preference starts at a paused logo.

## Motion skill used

Read and applied [LottieFiles Motion Design Skill](https://github.com/LottieFiles/motion-design-skill/blob/main/skills/motion-design/SKILL.md), specifically its [Disney principles](https://github.com/LottieFiles/motion-design-skill/blob/main/skills/motion-design/director/disney-principles.md), [choreography](https://github.com/LottieFiles/motion-design-skill/blob/main/skills/motion-design/director/choreography.md) and [narrative structure](https://github.com/LottieFiles/motion-design-skill/blob/main/skills/motion-design/director/narrative-structure.md) on 2026-09-09. Applied staging, pose continuity, curved paths, smooth timing, overlap and restrained secondary motion. The owner's explicit minimal style takes priority over the skill's generic ambient-layer suggestions. No third-party skill code or dependencies were installed or executed.

This is an isolated Vite preview without the production Vite configuration, Worker, credentials or API calls. Percentages and completion are explicitly simulated. It is not integrated into the upload screen and does not change navigation/cancellation behavior. No build or deployment is needed. No generated raster assets or new dependencies are used.

Before any future integration, drive the entry/holding/completion phases from actual upload lifecycle events. A timed animation must never claim a successful upload. The successful-logo hold can continue indefinitely until transfer/processing permits the final phase; failure and cancellation need their own states.
