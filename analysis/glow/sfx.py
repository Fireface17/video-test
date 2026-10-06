"""SFX layer for the finished "Glowing In The Dark" video, added WITHOUT re-encoding the picture.

    cd analysis/glow
    uv run python sfx.py --video ~/Desktop/glow.mp4 --out ~/Desktop/glow_sfx.mp4   # mux: video copied bit for bit
    uv run python sfx.py --stem-only                                                # out/sfx/sfx_stem.wav + mix.wav + preview_mix.mp3
    uv run python sfx.py --video ~/Desktop/glow.mp4 --sfx-db -3                     # the whole SFX layer 3 dB quieter

Pipeline: sfx_cues.py builds the cue sheet from the same data the scenes use (sfx_cues.json) -> sfx_synth.py
synthesizes every sound (no samples) -> each cue is set RELATIVE to the music around it (rel_db: its loudest 400 ms
against the music's RMS over +-1 s; beds: their average against the music's over their span) -> ducked under the
vocal (data/glow/audio.json `vocal` envelope: fx -5 dB, beds -7 dB, impacts -2.5 dB at full vocal) -> room / hall
sends into synthetic stereo IRs -> summed with the song (decoded from audio/glowing-in-the-dark.mp3 by ffmpeg, the
same decode the render muxes) -> trimmed to the original's integrated loudness -> a look-ahead bus limiter at -1 dBTP
-> AAC 320k, muxed with `-map 0:v -c:v copy` (+faststart) and checked: the video stream's MD5 must match the input's.

The stem is rebuilt only when the cue sheet, the synth code or --sfx-db change (out/sfx/.key).

Key: G# minor (B major). Levels: most cues -14..-24 dB under the music, beds -19..-30, drop impacts -7..-10.

Cue sheet (time = the frame the sound belongs to; dB = rel_db; regenerate with `uv run python sfx_cues.py`):
        time  scene    kind             dB  note
     0:00.000  intro    room_tone       -30  bedroom at night: air, a far city (fades out as the ceiling dissolves)
     0:00.026  intro    sticker_tick    -22  sticker 1 lights
     0:00.426  intro    sticker_tick    -24  sticker 2 lights
     0:00.826  intro    sticker_tick    -26  sticker 3 lights
     0:01.226  intro    sticker_tick    -28  sticker 4 lights
     0:04.500  intro    car_pass_far    -24  a car passes in the street below (its headlights sweep the ceiling)
     0:08.826  intro    sticker_peel    -22  a lit sticker comes loose
     0:09.971  intro    swish           -21  ...and falls past the lens
     0:10.550  intro    car_pass_far    -24  a car passes in the street below (its headlights sweep the ceiling)
     0:14.301  intro    chime           -20  the light joins their hands (gold flash)
     0:14.971  intro    shimmer         -24  the light writes the title above us
     0:15.021  intro    whoosh_up       -17  lift-off: the ceiling dissolves, we climb into the sky
     0:16.422  intro    neon_on         -21  FIREFACE17 switches on in neon (flickerOn, 4 flickers)
     0:17.699  intro    space_drone     -26  out in space before the turn
     0:18.419  highway  car_bed         -17  night drive: engine hum (G#), tyres on wet asphalt, rain; stalls with the blackout
     0:18.469  intro    whoosh_dive     -12  the camera swings over and dives at the night Earth into the highway (whip cut)
     0:19.319  highway  car_pass        -19  drone chase: a car in the next lane goes by
     0:20.935  highway  dash_chime      -20  macro on the fuel gauge: the low-fuel lamp
     0:21.519  highway  car_pass        -21  the truck's marker lights pass
     0:24.809  highway  wiper           -24  wiper sweep (inside the car)
     0:26.060  highway  wiper           -24  wiper sweep (inside the car)
     0:27.290  highway  led_buzz        -20  "sank": the LED sun glitches; electric buzz until it dies
     0:27.364  highway  elec_zap        -16  LED screen hit 1: tearing, dead blocks (kick)
     0:27.581  highway  elec_zap        -16  LED screen hit 2: tearing, dead blocks (kick)
     0:27.759  highway  elec_zap        -14  LED screen hit 3: tearing, dead blocks (kick)
     0:27.795  highway  power_down      -16  the screen dies module by module: discharge and power-down whine
     0:30.436  highway  blackout        -12  the blackout catches up: breakers clunk (station LEDs, canopy, pumps, shop), mains die
     0:30.456  highway  engine_stall    -14  the engine stalls and the dash dies
     0:30.806  highway  rev_swell       -20  the push into the dashboard star sticker, the last light in the car (hard cut)
     0:30.975  pre1     sticker_tick    -24  sticker letters land: PUT
     0:31.350  pre1     sticker_tick    -25  sticker letters land: YOUR
     0:31.600  pre1     sticker_tick    -26  sticker letters land: HANDS
     0:31.965  pre1     sticker_tick    -27  sticker letters land: UP
     0:36.535  pre1     sticker_peel    -21  on "let it all go" the stickers peel off the letters and float up
     0:37.285  pre1     sparkle         -25  ...floating up
     0:39.770  pre1     gold_sweep      -19  "into gold": a front sweeps the frame, recharging everything gold
     0:43.604  pre1     riser           -15  HERE WE GO: the slab is crushed into one white-hot point (riser into chorus 1)
     0:43.604  pre1     rev_cymbal      -17  reverse cymbal into the ignition
     0:43.604  chorus1  impact          -10  the pre-chorus's point DETONATES: shrapnel of stickers
     0:43.604  chorus1  sparkle         -22  sticker shrapnel
     0:48.035  chorus1  uv_flash        -21  GLOWING: a UV flash charges everything
     0:49.460  chorus1  swish           -17  TAKE: whip pan to the right
     0:51.195  chorus1  shatter         -16  BROKEN shatters on the downbeat (shards fly, the frame shakes)
     0:52.791  chorus1  swirl           -21  STAR: the shards burst into stickers that fly into the word
     0:59.543  chorus1  whoosh          -17  DOWN: the world rolls 180 degrees
     1:00.525  chorus1  thump           -16  LOUD: full frame, hard shake
     1:01.450  chorus1  charge_front    -22  WAKE: a town of dead stickers wakes, a charge front runs out
     1:10.375  drop1a   switch_click    -14  the light switch
     1:10.379  chorus1  riser           -17  IN THE DARK: everything collapses into the centre point (riser into drop 1)
     1:10.379  chorus1  implode         -16  the last 0.35 s: everything is sucked into the point
     1:10.379  drop1a   impact           -8  DROP 1: the light goes on (the switch, first hit)
     1:10.379  drop1a   sub_drop         -9  drop 1 sub drop
     1:20.173  drop1a   sticker_peel    -19  bar 7: the lamp is gone, the stickers come off the ceiling
     1:23.170  drop1a   swirl           -17  bar 8: they swirl into the two arms of the star-dust spiral
     1:23.170  cosmos1  space_drone     -22  the galaxy: deep space drone (G# minor), wide
     1:24.768  cosmos1  whoosh          -19  cosmos flight: punch into the core
     1:26.367  cosmos1  supernova       -10  the supernova (hardest hit of the drop's first half)
     1:27.967  cosmos1  whoosh          -19  cosmos flight: fly down an arm into a cluster
     1:29.310  cosmos1  star_join       -19  "take my hand" 1: two stars curve in and join
     1:29.568  cosmos1  whoosh          -19  cosmos flight: reframe on the bar
     1:31.168  cosmos1  whoosh          -19  cosmos flight: across a dust lane to the next cluster
     1:32.670  cosmos1  star_join       -19  "take my hand" 2: two stars curve in and join
     1:34.361  cosmos1  whoosh          -19  cosmos flight: dive into the core
     1:35.158  cosmos1  riser           -19  the dive into the white core, white-out for the cut to verse 2
     1:45.650  verse2   bulb_on         -23  marquee of sticker bulbs: LIGHT switches on
     1:46.195  verse2   bulb_on         -23  marquee of sticker bulbs: UP switches on
     1:46.290  verse2   bulb_on         -23  marquee of sticker bulbs: THE switches on
     1:46.550  verse2   bulb_on         -23  marquee of sticker bulbs: SPOT switches on
     1:49.137  pre2     whoosh          -17  UP is thrown out of frame: the camera whips down
     1:51.283  pre2     fall_whoosh     -21  (felt low): the echo falls through the floor, the camera dives after it
     1:56.049  pre2     odometer        -22  PAIN -> GOLD: the letters roll like an odometer
     1:56.489  pre2     gold_sweep      -21  GOLD lands with an inversion
     1:59.210  pre2     whoosh          -18  HERE WE GO: the camera dives through the O
     2:00.316  pre2     riser           -15  the last dive hits the light inside the last O (riser into chorus 2)
     2:00.316  pre2     rev_cymbal      -17  reverse cymbal into chorus 2
     2:00.316  chorus2  impact          -11  chorus 2: violet light cut onto the scope
     2:00.316  chorus2  crt_hum         -27  analog CRT hum under the whole chorus
     2:00.336  chorus2  crt_on          -17  POWER ON: the tube lights from a flat line (degauss thunk, the flyback whine)
     2:04.180  chorus2  crt_zap         -20  a Lissajous burst marks line 2
     2:07.450  chorus2  crt_zap         -20  a Lissajous burst marks line 3
     2:10.350  chorus2  crt_zap         -20  a Lissajous burst marks line 4
     2:13.965  chorus2  crt_zap         -20  a Lissajous burst marks line 5
     2:17.170  chorus2  crt_zap         -20  a Lissajous burst marks line 6
     2:20.185  chorus2  crt_zap         -20  a Lissajous burst marks line 7
     2:23.380  chorus2  crt_zap         -20  a Lissajous burst marks line 8
     2:24.420  chorus2  crt_zap         -22  glo- freeze frame 1
     2:25.040  chorus2  crt_zap         -22  glo- freeze frame 2
     2:25.420  chorus2  crt_zap         -22  glo- freeze frame 3
     2:27.051  break2   crt_off         -15  the scope collapses like a tube (to a line, to a dot): CRT power-off
     2:28.215  break2   sticker_slap    -19  the dot's afterglow becomes the first sticker
     2:29.209  break2   sticker_slap    -22  stickers slapped on around it (hit 1)
     2:29.412  break2   sticker_slap    -23  stickers slapped on around it (hit 2)
     2:29.812  break2   sticker_slap    -24  stickers slapped on around it (hit 3)
     2:36.431  break2   power_down      -21  the band drops out: the whole ceiling goes dead
     2:36.578  break2   rev_swell       -18  ...recharged at once on the hit after it (into the blaze)
     2:36.578  break2   sparkle         -19  the giant star blazes
     2:36.895  break2   sticker_peel    -20  the star sticker shivers and lets go
     2:39.002  bridge   fall_wind       -21  falling through space: wind and air rush, gathering speed toward the gold light
     2:39.202  bridge   space_drone     -27  nebula sheets rushing up past us
     2:39.352  break2   fall_whoosh     -18  ...and falls: the bridge's fall takes over
     2:42.885  bridge   swell           -24  the space turns every colour
     2:44.030  bridge   swell           -24  the space turns deep blue
     2:45.820  bridge   swell           -24  the space turns gold
     2:51.694  bridge   riser           -16  the gold light below takes the frame (riser into chorus 3)
     2:51.694  chorus3  swell           -18  chorus 3 opens on the bridge's gold
     2:52.450  chorus3  impact          -11  BE: the drums come in and the gold SHATTERS
     2:52.450  chorus3  shatter         -14  a carpet of gold stickers blows out from the centre
     2:54.088  chorus3  swish           -22  the survivors fly back in (batch 1, on the snare)
     2:54.264  chorus3  swish           -22  the survivors fly back in (batch 2, on the snare)
     2:55.680  chorus3  whoosh          -21  flight through the line: the camera lands on GLOWING
     2:56.440  chorus3  whoosh          -21  flight through the line: the camera lands on DARK,
     2:57.765  chorus3  whoosh          -21  flight through the line: the camera lands on HAND
     2:58.806  chorus3  shatter         -16  BROKEN (made of stickers) is blown apart on the kick
     3:00.120  chorus3  swirl           -20  the pieces swirl (BECOMES)...
     3:00.120  chorus3  chime           -18  ...and slam together into one GIANT STAR
     3:05.668  chorus3  phos_hum        -23  the band drops out: GLOWING glows on alone, fades to green afterglow
     3:08.322  chorus3  riser           -15  IN THE DARK!: the last kick blows the frame to gold-white (riser into drop 3)
     3:08.322  chorus3  rev_cymbal      -16  reverse cymbal into drop 3
     3:08.322  drop3    impact           -7  DROP 3: the gold finale hits
     3:08.322  drop3    sub_drop         -8  drop 3 sub drop
     3:08.322  drop3    warp            -18  WARP: star tunnel, gold gas rushing past (kicks surge the speed)
     3:11.488  drop3    nebula          -21  NEBULA: a corridor between cloud walls lit from within
     3:11.588  drop3    whoosh          -16  IRIS: the warp's vanishing point opens onto the next world, we fly through
     3:13.111  drop3    swish           -23  downbeat roll whip in the nebula
     3:14.693  drop3    swish           -23  downbeat roll whip in the nebula
     3:16.274  drop3    swish           -23  downbeat roll whip in the nebula
     3:17.815  drop3    hole_rumble     -16  BLACK HOLE: deep rumble, the disk flares on the kicks
     3:17.915  drop3    implode         -15  COLLAPSE: the nebula's light is pulled into one point, the black hole appears
     3:17.915  drop3    thump           -14  ...the hole's flash
     3:19.395  drop3    whoosh          -18  the camera swoops around the hole to the next angle
     3:20.974  drop3    whoosh          -18  the camera swoops around the hole to the next angle
     3:22.552  drop3    warp            -17  WARP: star tunnel, gold gas rushing past (kicks surge the speed)
     3:22.652  drop3    whoosh          -16  LENS: the hole's shadow grows over the frame; the next world is inside it
     3:24.131  drop3    nebula          -21  NEBULA: a corridor between cloud walls lit from within
     3:24.231  drop3    whoosh          -16  IRIS: the warp's vanishing point opens onto the next world, we fly through
     3:25.711  drop3    hole_rumble     -16  BLACK HOLE: deep rumble, the disk flares on the kicks
     3:25.811  drop3    implode         -17  COLLAPSE: the nebula's light is pulled into one point, the black hole appears
     3:25.811  drop3    thump           -14  ...the hole's flash
     3:27.289  drop3    nebula          -21  NEBULA: a corridor between cloud walls lit from within
     3:27.389  drop3    whoosh          -16  LENS: the hole's shadow grows over the frame; the next world is inside it
     3:28.867  drop3    hole_rumble     -16  BLACK HOLE: deep rumble, the disk flares on the kicks
     3:28.967  drop3    implode         -17  COLLAPSE: the nebula's light is pulled into one point, the black hole appears
     3:28.967  drop3    thump           -14  ...the hole's flash
     3:30.446  drop3    warp            -17  WARP: star tunnel, gold gas rushing past (kicks surge the speed)
     3:30.446  drop3    fall_in         -12  we fall into the hole (spaghetti whoosh into the dark inside)
     3:30.546  drop3    whoosh          -16  LENS: the hole's shadow grows over the frame; the next world is inside it
     3:31.346  drop3    whoosh          -15  inside, a warp: its vanishing point opens onto the Earth
     3:31.346  drop3    earth_dive      -15  the dive at New York: wind, atmosphere, re-entry roar (lib/dive.ts altitude curve)
     3:33.099  outro    room_tone       -28  back in bed: the room's air
     3:37.499  outro    car_pass_far    -25  a car passes below (headlights across the ceiling)
     3:39.570  outro    chime           -20  "take my hand": the light joins the two hands again
     3:46.199  outro    sticker_tick    -22  the two last stars merge and go out on the final downbeat
     3:46.319  outro    window_light    -17  in the dark, a warm light comes on across the street: her lantern (click, warm hum)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal

import sfx_cues
import sfx_synth as S

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SONG = ROOT / "audio" / "glowing-in-the-dark.mp3"
OUT = ROOT / "out" / "sfx"
QA = HERE / "qa"
SR = S.SR

DUCK_DB = {"fx": 5.0, "bed": 7.0, "impact": 2.5}
SEND = {"room": 0.20, "hall": 0.32, "none": 0.0}
CEIL_DBTP = -1.0


# ============================================================================================ io
def ffmpeg_bin(name="ffmpeg"):
    p = shutil.which(name)
    if not p:
        sys.exit(f"{name} not found (brew install ffmpeg)")
    return p


def decode(path: Path, stream="0:a:0") -> np.ndarray:
    """Any audio (or a video's audio) -> float32 (N, 2) at 48 kHz, via ffmpeg (gapless, like the render)."""
    cmd = [ffmpeg_bin(), "-v", "error", "-i", str(path), "-map", stream, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)


def probe_duration(path: Path) -> float:
    out = subprocess.run([ffmpeg_bin("ffprobe"), "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=duration:format=duration", "-of", "json", str(path)], check=True, capture_output=True, text=True).stdout
    j = json.loads(out)
    d = (j.get("streams") or [{}])[0].get("duration") or j["format"]["duration"]
    return float(d)


def video_md5(path: Path) -> str:
    out = subprocess.run([ffmpeg_bin(), "-v", "error", "-i", str(path), "-map", "0:v:0", "-c", "copy", "-f", "md5", "-"],
                         check=True, capture_output=True, text=True).stdout
    return out.strip().split("=")[-1]


# ============================================================================================ measurement
def lufs(x: np.ndarray) -> float:
    """Integrated loudness, ITU-R BS.1770-4 (K-weighting, 400 ms blocks, absolute and relative gates)."""
    b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
    b2, a2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
    y = signal.lfilter(b2, a2, signal.lfilter(b1, a1, x, axis=0), axis=0)
    p = np.sum(y ** 2, 1)
    n, hop = int(0.4 * SR), int(0.1 * SR)
    c = np.concatenate([[0], np.cumsum(p)])
    starts = np.arange(0, len(p) - n, hop)
    z = (c[starts + n] - c[starts]) / n
    L = -0.691 + 10 * np.log10(z + 1e-20)
    z = z[L > -70]
    rel = -0.691 + 10 * np.log10(np.mean(z)) - 10
    z = z[-0.691 + 10 * np.log10(z) > rel]
    return float(-0.691 + 10 * np.log10(np.mean(z)))


def true_peak_db(x: np.ndarray) -> float:
    """4x oversampled peak (dBTP estimate), in chunks."""
    m = 0.0
    for i in range(0, len(x), SR * 10):
        seg = x[max(0, i - 64): i + SR * 10 + 64]
        m = max(m, float(np.max(np.abs(signal.resample_poly(seg, 4, 1, axis=0)))))
    return 20 * np.log10(m + 1e-12)


def rms_env(x: np.ndarray, fps=100, win=0.4) -> np.ndarray:
    """Power envelope (mean square of both channels) over `win` s windows, at fps."""
    p = np.mean(S.to_st(x) ** 2, 1)
    c = np.concatenate([[0], np.cumsum(p)])
    hop, n = SR // fps, int(win * SR)
    idx = np.arange(0, len(p), hop)
    a, b = np.clip(idx - n // 2, 0, len(p)), np.clip(idx + n // 2, 0, len(p))
    return (c[b] - c[a]) / np.maximum(b - a, 1)


# ============================================================================================ reverb
def make_ir(rt60: float, length: float, predelay: float, seed: int, bright=1.0) -> np.ndarray:
    """A synthetic stereo IR: early reflections, then a diffuse tail decaying faster in the highs."""
    rng = np.random.default_rng(seed)
    N = S.ns(length)
    t = S.tv(N)
    bands = [(None, 300, 1.25), (300, 1500, 1.0), (1500, 5000, 0.7 * bright), (5000, None, 0.4 * bright)]
    ir = np.zeros((N, 2))
    for ch in range(2):
        n = rng.standard_normal(N)
        y = np.zeros(N)
        for lo, hi, k in bands:
            if lo is None:
                b = S.filt(n, "lowpass", hi, 4)
            elif hi is None:
                b = S.filt(n, "highpass", lo, 4)
            else:
                b = S.filt(n, "bandpass", [lo, hi], 2)
            y += b * np.exp(-6.91 * t / (rt60 * k))
        y *= 1 - np.exp(-t / 0.02)  # the diffuse field builds up
        for _ in range(14):           # early reflections
            d = rng.uniform(0.006, 0.07)
            y[S.ns(d)] += rng.uniform(-1, 1) * 0.6 * np.exp(-d / 0.05) * np.sqrt(np.mean(y[: S.ns(0.1)] ** 2)) * 30
        ir[:, ch] = y
    ir = np.concatenate([np.zeros((S.ns(predelay), 2)), ir])
    return ir / np.sqrt(np.sum(ir ** 2) / 2)


# ============================================================================================ the stem
def cue_rng(c: dict) -> np.random.Generator:
    h = hashlib.sha1(f"{c['kind']}|{c['t']:.4f}|{c.get('seed', 0)}".encode()).hexdigest()
    return np.random.default_rng(int(h[:12], 16))


def vocal_duck(au_json: dict, N: int) -> np.ndarray:
    """0..1 vocal presence per sample (attack 30 ms, release 300 ms) from the analysis' vocal envelope."""
    v = np.asarray(au_json["vocal"], float)
    fps = au_json.get("fps", 100)
    x = np.clip((v - 0.08) / 0.35, 0, 1)
    a, r = 1 - np.exp(-1 / (fps * 0.03)), 1 - np.exp(-1 / (fps * 0.3))
    y = np.zeros_like(x)
    s = 0.0
    for i, xi in enumerate(x):
        s += (xi - s) * (a if xi > s else r)
        y[i] = s
    # look ahead a little: the duck is down when the word starts
    y = np.maximum(y, np.concatenate([y[3:], np.zeros(3)]))
    return np.interp(np.arange(N) / SR, np.arange(len(y)) / fps, y)


def render_stem(sheet: dict, music: np.ndarray, au_json: dict, sfx_db: float, log=print):
    N = len(music)
    menv = rms_env(music)          # music power at 100 fps
    buses = {k: np.zeros((N, 2)) for k in DUCK_DB}
    sends = {k: np.zeros((N, 2)) for k in ("room", "hall")}
    report = []
    for c in sheet["cues"]:
        fn = S.SYNTHS.get(c["kind"])
        if fn is None:
            log(f"  ! no synth for {c['kind']}")
            continue
        y, A = fn(c, cue_rng(c))
        y = np.nan_to_num(np.asarray(y, float))
        start = int(round(c["t"] * SR)) - A
        bus = c.get("bus", "fx")
        p = np.mean(y ** 2, 1)
        if bus == "bed":
            # a bed: its average level over where it actually sounds, against the music's over the same span
            e = rms_env(y)
            act = e > np.max(e) * 0.01
            ref = 10 * np.log10(np.mean(e[act]) + 1e-20)
            a, b = max(0, start // (SR // 100)), min(len(menv), (start + len(y)) // (SR // 100))
            mref = 10 * np.log10(np.mean(menv[a:b]) + 1e-20) if b > a else -40
        else:
            ref = S.ms_rms(y, 0.4)
            pk = start + int(np.argmax(np.convolve(p, np.ones(S.ns(0.1)), "same")))
            a, b = max(0, (pk - SR) // (SR // 100)), min(len(menv), (pk + SR) // (SR // 100))
            mref = 10 * np.log10(np.mean(menv[a:b]) + 1e-20) if b > a else -40
        mref = max(mref, -42.0)
        g_db = mref + c["rel_db"] + sfx_db - ref
        y = y * 10 ** (g_db / 20)
        S.mix_into(buses[bus], y, start)
        snd = SEND.get(c.get("send", "room"), 0)
        if snd:
            S.mix_into(sends[c["send"]], y * snd, start)
        report.append((c["t"], c["kind"], c["rel_db"], round(mref, 1), round(g_db, 1)))
    # reverbs: a small room and a long hall (space) -- the wet goes with the fx bus
    t0 = time.time()
    irs = {"room": make_ir(0.55, 0.9, 0.006, 11, 0.9), "hall": make_ir(3.2, 4.2, 0.025, 12, 1.0)}
    wet = np.zeros((N, 2))
    for k, ir in irs.items():
        for ch in range(2):
            wet[:, ch] += signal.oaconvolve(sends[k][:, ch], ir[:, ch])[:N]
    buses["fx"] += wet
    log(f"  reverb {time.time() - t0:.1f}s")
    voc = vocal_duck(au_json, N)
    stem = np.zeros((N, 2))
    for k, x in buses.items():
        stem += x * (10 ** (-DUCK_DB[k] * voc / 20))[:, None]
    # keep the stem's own infrasonics out of the mix (the song has the low end)
    stem = S.filt(stem, "highpass", 28, 2)
    return stem, report


# ============================================================================================ the bus limiter
def limit(x: np.ndarray, ceil_db=CEIL_DBTP, look=0.004, release=0.15):
    """Look-ahead peak limiter on a 4x-oversampled peak estimate: gain is computed per 1 ms block, ramps down
    over the look-ahead before a peak and recovers with `release`. Returns (y, max gain reduction dB)."""
    ceil = 10 ** (ceil_db / 20)
    blk = SR // 1000
    nb = (len(x) + blk - 1) // blk
    pk = np.zeros(nb)
    for i in range(0, len(x), SR * 10):
        seg = x[i: i + SR * 10]
        up = np.max(np.abs(signal.resample_poly(seg, 4, 1, axis=0)), 1)
        m = up.reshape(-1)[: (len(seg) * 4)]
        m = np.pad(m, (0, (-len(m)) % (blk * 4)))
        pk[i // blk: i // blk + len(m) // (blk * 4)] = m.reshape(-1, blk * 4).max(1)
    need = np.minimum(1.0, ceil / np.maximum(pk, 1e-9))
    L = max(1, int(look * 1000))
    need = _minwin(need, L)
    g = np.empty(nb)
    s = 1.0
    r = 1 - np.exp(-1 / (release * 1000))
    for i in range(nb):
        s = need[i] if need[i] < s else s + (need[i] - s) * r
        g[i] = s
    # smooth the steps (a moving average over the look-ahead never undershoots the window minimum)
    g = np.convolve(np.pad(g, (L, L), mode="edge"), np.ones(2 * L + 1) / (2 * L + 1), "valid")
    g = np.minimum(g, _minwin(need, L // 2 + 1))
    gs = np.interp(np.arange(len(x)) / blk, np.arange(nb) + 0.5, g)
    y = x * gs[:, None]
    return y, float(-20 * np.log10(np.min(g)))


def _minwin(a, L):
    from scipy.ndimage import minimum_filter1d
    return minimum_filter1d(a, 2 * L + 1, mode="nearest")


# ============================================================================================ build
def build(sfx_db: float, music_path: Path, force=False, plots=False, log=print):
    OUT.mkdir(parents=True, exist_ok=True)
    au, ly = sfx_cues.load()
    sheet = sfx_cues.build(au, ly)
    sfx_cues.CUES_JSON.write_text(json.dumps(sheet, indent=1, ensure_ascii=False) + "\n")
    key = hashlib.sha1((json.dumps(sheet, sort_keys=True) + (HERE / "sfx_synth.py").read_text() + Path(__file__).read_text()
                        + f"{sfx_db}|{music_path.stat().st_size if music_path.exists() else 0}").encode()).hexdigest()
    stem_p, mix_p, keyf = OUT / "sfx_stem.wav", OUT / "mix.wav", OUT / ".key"
    if not force and stem_p.exists() and mix_p.exists() and keyf.exists() and keyf.read_text() == key:
        log(f"stem up to date: {stem_p}")
        return mix_p, stem_p
    log(f"decoding the song: {music_path}")
    music = decode(music_path)
    au_json = json.loads((sfx_cues.DATA / "audio.json").read_text())
    log(f"rendering {len(sheet['cues'])} cues...")
    t0 = time.time()
    stem, report = render_stem(sheet, music, au_json, sfx_db, log)
    log(f"  stem rendered in {time.time() - t0:.1f}s")
    L0 = lufs(music)
    # loudness: trim the sum so it lands on the original's integrated loudness, then limit; one correction pass
    mix = music + stem
    g = 10 ** ((L0 - lufs(mix)) / 20)
    for _ in range(2):
        y, gr = limit(mix * g)
        L1 = lufs(y)
        g *= 10 ** ((L0 - L1) / 20)
    y, gr = limit(mix * g)
    L1, tp = lufs(y), true_peak_db(y)
    stem_out = stem * g
    sf.write(stem_p, stem_out.astype(np.float32), SR, subtype="PCM_24")
    sf.write(mix_p, y.astype(np.float32), SR, subtype="PCM_24")
    stats = {
        "music_lufs": round(L0, 2), "mix_lufs": round(L1, 2), "mix_true_peak_db": round(tp, 2), "music_true_peak_db": round(true_peak_db(music), 2),
        "trim_db": round(20 * np.log10(g), 2), "limiter_max_gr_db": round(gr, 2), "stem_lufs": round(lufs(stem_out), 2),
        "stem_peak_db": round(20 * np.log10(np.max(np.abs(stem_out)) + 1e-12), 2), "sfx_db": sfx_db, "cues": len(report),
    }
    (OUT / "levels.json").write_text(json.dumps({"stats": stats, "cues": report}, indent=1) + "\n")
    keyf.write_text(key)
    log(json.dumps(stats))
    if plots:
        qa_plots(music, stem_out, y, sheet)
    return mix_p, stem_p


def write_mp3(wav: Path, mp3: Path):
    subprocess.run([ffmpeg_bin(), "-y", "-v", "error", "-i", str(wav), "-c:a", "libmp3lame", "-b:a", "256k", str(mp3)], check=True)


def mux(video: Path, mix_p: Path, out: Path, offset: float, log=print) -> bool:
    dur = probe_duration(video)
    mix, sr = sf.read(mix_p, dtype="float32")
    a = int(round(offset * SR))
    n = int(round(dur * SR))
    seg = mix[a: a + n]
    if len(seg) < n:
        seg = np.pad(seg, ((0, n - len(seg)), (0, 0)))
    tmp = OUT / "mux_audio.wav"
    sf.write(tmp, seg, SR, subtype="PCM_24")
    log(f"muxing: {video} + SFX mix -> {out}")
    cmd = [ffmpeg_bin(), "-y", "-v", "error", "-i", str(video), "-i", str(tmp), "-map", "0:v:0", "-map", "1:a:0",
           "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-ar", str(SR), "-ac", "2", "-map_metadata", "0",
           "-movflags", "+faststart", str(out)]
    subprocess.run(cmd, check=True)
    tmp.unlink(missing_ok=True)
    h0, h1 = video_md5(video), video_md5(out)
    ok = h0 == h1
    log(f"video stream md5  in: {h0}\n                 out: {h1}  {'IDENTICAL' if ok else 'DIFFERENT!'}")
    return ok


# ============================================================================================ QA plots
def qa_plots(music, stem, mix, sheet):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    QA.mkdir(parents=True, exist_ok=True)
    fps = 10
    t = np.arange(len(rms_env(music, fps))) / fps
    db = lambda e: 10 * np.log10(e + 1e-10)
    fig, ax = plt.subplots(figsize=(22, 6))
    ax.plot(t, db(rms_env(music, fps)), lw=0.7, label="music (400 ms RMS)")
    ax.plot(t, db(rms_env(stem, fps)), lw=0.7, label="SFX stem")
    ax.plot(t, db(rms_env(mix, fps)) , lw=0.5, alpha=0.6, label="mix")
    for c in sheet["cues"]:
        ax.axvline(c["t"], color="k", alpha=0.08, lw=0.5)
    ax.set_ylim(-70, 0)
    ax.set_xlim(0, t[-1])
    ax.set_xlabel("s")
    ax.set_ylabel("dBFS")
    ax.legend(loc="lower right")
    ax.grid(alpha=0.2)
    fig.tight_layout()
    fig.savefig(QA / "sfx_levels.png", dpi=90)
    plt.close(fig)
    picks = [("intro lift-off + dive", 13.5, 19.5), ("highway screen + blackout", 26.5, 31.5), ("drop 1", 68.5, 73.0),
             ("supernova", 85.5, 89.5), ("chorus 2 scope on", 119.0, 123.0), ("break CRT off", 146.0, 150.0),
             ("drop 3", 186.5, 191.5), ("hole + fall + Earth", 216.0 - 20, 216.0 - 2), ("outro end", 222.0, 227.7)]
    fig, axs = plt.subplots(len(picks), 2, figsize=(18, 3.0 * len(picks)))
    for i, (name, a, b) in enumerate(picks):
        for j, (lab, x) in enumerate([("SFX stem", stem), ("mix", mix)]):
            seg = np.mean(x[int(a * SR): int(b * SR)], 1)
            f, tt, Z = signal.spectrogram(seg, SR, nperseg=2048, noverlap=1536)
            axs[i, j].pcolormesh(tt + a, f, 10 * np.log10(Z + 1e-14), shading="auto", vmin=-130, vmax=-40, cmap="magma")
            axs[i, j].set_yscale("symlog", linthresh=200)
            axs[i, j].set_ylim(20, 20000)
            axs[i, j].set_title(f"{name}: {lab}", fontsize=9)
            for c in sheet["cues"]:
                if a <= c["t"] <= b:
                    axs[i, j].axvline(c["t"], color="c", alpha=0.6, lw=0.6)
    fig.tight_layout()
    fig.savefig(QA / "sfx_spectrograms.png", dpi=70)
    plt.close(fig)
    print(f"plots: {QA / 'sfx_levels.png'}, {QA / 'sfx_spectrograms.png'}")


# ============================================================================================ cli
def main():
    ap = argparse.ArgumentParser(description="Add the procedural SFX layer to the rendered video (video stream copied).")
    ap.add_argument("--video", type=Path, help="the rendered video (e.g. ~/Desktop/glow.mp4)")
    ap.add_argument("--out", type=Path, help="output video (default: <video>_sfx.mp4)")
    ap.add_argument("--stem-only", action="store_true", help="only build out/sfx/sfx_stem.wav, mix.wav and preview_mix.mp3")
    ap.add_argument("--sfx-db", type=float, default=0.0, help="scale the whole SFX layer (dB, e.g. -3)")
    ap.add_argument("--from", dest="offset", type=float, default=0.0, help="song time of the video's first frame (a render made with --from)")
    ap.add_argument("--music", type=Path, default=SONG, help="the song (default audio/glowing-in-the-dark.mp3; falls back to the video's own audio)")
    ap.add_argument("--force", action="store_true", help="rebuild the stem even if it is up to date")
    ap.add_argument("--plots", action="store_true", help="QA plots (levels, spectrograms) into analysis/glow/qa/")
    ap.add_argument("--no-mp3", action="store_true", help="skip out/sfx/preview_mix.mp3")
    a = ap.parse_args()
    if not a.stem_only and not a.video:
        ap.error("--video is required (or use --stem-only)")
    music = a.music.expanduser()
    if not music.exists():
        if not a.video:
            sys.exit(f"song not found: {music}")
        print(f"(song not found at {music}: using the video's own audio track)")
        OUT.mkdir(parents=True, exist_ok=True)
        music = OUT / "music_from_video.wav"
        sf.write(music, decode(a.video.expanduser()).astype(np.float32), SR, subtype="FLOAT")
    mix_p, stem_p = build(a.sfx_db, music, a.force, a.plots)
    if not a.no_mp3:
        mp3 = OUT / "preview_mix.mp3"
        write_mp3(mix_p, mp3)
        print(f"preview: {mp3}")
    print(f"stem: {stem_p}\nmix:  {mix_p}")
    if a.stem_only:
        return
    video = a.video.expanduser()
    out = (a.out or video.with_name(video.stem + "_sfx.mp4")).expanduser()
    if out.resolve() == video.resolve():
        sys.exit("--out must differ from --video")
    ok = mux(video, mix_p, out, a.offset)
    print(f"done: {out}" if ok else "WARNING: the video stream changed")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
