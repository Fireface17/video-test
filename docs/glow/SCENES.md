# Glowing In The Dark — scene author guide

The video's plan is `docs/glow/TREATMENT.md` (Russian); the engine, its rules and the render commands are `docs/ENGINE.md`. This page covers what is specific to this video: the 3D toolkit, the timeline and the house style.

## Files

- `app/src/glow/timeline.ts` — the edit: entries (`intro`, `highway`, `snap1`, `chorus1`, `drop1`, `ghosts`, `snap2`, `chorus2`, `break2`, `bridge`, `chorus3`, `drop3`, `outro`), anchored to lyric lines and sections.
- `app/src/glow/scenes/<name>.ts` — one module per scene (`ceiling`, `highway`, `snap`, `chorus`, `rave`, `ghosts`, `fall`); helpers for one scene go in `scenes/<name>-*.ts`.
- `app/src/glow/lib/` — the shared 3D toolkit (below).
- Data: `data/glow/lyrics.json` (lines as sung, word times) and `data/glow/audio.json` (beats, which are **not evenly spaced** — the tempo drifts from 150.1 to 152.3 BPM, so always go through `audio.beatAt` / `timeOfBeat` / `downbeats`; sections; envelopes; onsets `kick`, `snare`, `hat`, `vocal`, `chop`).

## Rendering in the cloud (no GPU)

```sh
cd app
export CHROME_PATH=/opt/pw-browsers/chromium   # software WebGL; omit on a Mac with Chrome
bun scripts/render.ts sheet --times 20,22.5,25,28 --cols 2 --only highway --out ../out/wip/highway.png
bun scripts/render.ts stills --t 21.3 --only highway --out ../out/wip/highway
```

`--song glow` is the default. A frame takes 0.5–3 s in software; a contact sheet of 6–8 frames is the cheap way to check a scene, and you look at the PNG with the Read tool. Check the karaoke at word starts (`lyrics.json`). Typecheck: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep glow/`.

## The toolkit (`app/src/glow/lib/`)

- `palette.ts` — `col(key, intensity)` → linear `THREE.Color` (night, dusk, ink, phosphor, pink, cyan, violet, gold, ember, blue, white); `STICKS` = the glow-stick colours; `GLSL_GLOW_PALETTE` for shaders. Light emitters use intensities 1.5–3 (they bloom above ~0.85); lit surfaces stay below ~0.4.
- `stage.ts` — `Stage(fov)`: a `THREE.Scene` + `PerspectiveCamera` that renders into the engine's HDR target (`st.render(renderer, out)` clears to `st.bg`). `aim(cam, pos, target, roll, up)` (robust even looking straight up), `faceCamera(obj, cam)` (billboard), `drift(t, amp)` (handheld wander), `skyDome(top, horizon, bottom)`.
- `neon.ts` — `NeonSign(text, {font, size, radius, color, align})`: single-stroke lettering as glass tubes, one mesh per word, in the XY plane facing +z, origin on the baseline. `sign.sing(line, t)` switches each word on at its sung start with a short neon flicker; `setLevel(i, on)`, `setAll`, `setColor`. Fonts: `script` (cursive, the default voice), `hscript`, `readable` (thin sans), `sans`, `tech`, `serif`, `osmotron`, `felix`. `flickerOn(t, t0)` is the switch-on curve.
- `extrude.ts` — `BlockText(text, {family, size, depth, bevel, align, face, side})`: extruded Archivo (default width 125, weight 900), one mesh per word (`words[i].mesh`, `.face`, `.side` materials) for word-by-word slams. `textGeometry()` for one-offs.
- `shapes.ts` — `starGeometry()` (sticker star), `glowStickGeometry(length, radius)` (groups: 0 = light-filled tube, 1 = plastic caps), `figureGeometry(armsUp)` (a simple standing figure, 1.75 tall, feet at y = 0).
- `points.ts` — `GlowPoints(n, size)`: additive soft points (sparks, dust, star fields); `set(i, x, y, z, color, k, size)` each frame, then `commit()`.

Scenes are classes extending `Scene` (`engine/scene.ts`); see `app/src/glow/scenes/ceiling.ts` for a complete example: init builds everything, render() poses it as a pure function of `f.t`, then `st.render(...)` and returns post overrides.

## Transitions

A timeline entry can carry `transition: { kind, dur, ... }` (`engine/transitions.ts`: `crossfade`, `zoom`, `whip`, `light`, `iris`, `glitch`, `sparks`, `shatter`). The overlap is centred on the cut: the incoming scene starts rendering at `start − dur/2` (`f.win[0]`) and the outgoing one keeps rendering until `end + dur/2` (`f.win[1]`), so anything a scene does on its first or last frame should key off `f.win`, not `ctx.start`/`ctx.end`. With `--only` the neighbour isn't loaded and that lead-in shows the transition against black — that's expected, not a bug in the scene.

## House style

- Dark world, light comes from the glowing things themselves. Background `col('night')`, fog `col('dusk')` (FogExp2 ~0.03–0.08), surfaces dark blue-grey.
- One dominant glow colour per moment; gold only where the lyric says gold/golden/sun and in the finale.
- Karaoke per `TREATMENT.md`: each sung word lights at its `start`, never before; lines readable, in the title-safe area. Words of a line: `const l = lyrics.get('We were running')` → `l.words[i].start/end`; lines inside the scene: `lyrics.linesIn(ctx.start, ctx.end)`.
- Motion on the grid: cuts and hits on beats/downbeats (`audio.downbeats`, `audio.timeOfBeat(Math.round(audio.beatAt(t)))`), eases with character (`ease.outExpo`, `inOutCubic`, `springStep`), something always moving. Pulses from `f.a.kick`, `audio.hit('chop', t)`, envelopes `audio.env('low', t)`.
- Post (return from render): typical `{ bloom: 0.9, bloomThreshold: 0.8, bloomRadius: 0.85, halation: 0.12, vignette: 0.45, grain: 0.05, ca: 0.8 }`; `flash` for white-outs on drops, `shake: [x, y]` for hits.
- Deterministic: no `Math.random()` / `Date.now()`; seeded `mulberry32`, `hash`, `noise1`. Per-frame flicker keyed to `frameIdx(t)`.
- Performance: moderate geometry (instancing for crowds and sticks), at most 3–4 lights, no full-screen raymarching; a frame should render in under ~2 s in the cloud.
