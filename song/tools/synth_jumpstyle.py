"""Original instrumental jumpstyle phonk, synthesized from scratch with numpy.

150 BPM, E minor, Em-C-G-D. Distorted jumpstyle kick on every beat, offbeat bass,
pitched phonk cowbell playing a syncopated 16th motif, formant "ah" vocal-chop lead,
claps, hats, piano, choir pad. All sounds and the melody are written here.

Run:  python3 song/tools/synth_jumpstyle.py [out.wav]
"""
import sys
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
BPM = 150
BEAT = 60 / BPM
STEP = BEAT / 4          # 16th
BAR = BEAT * 4
rng = np.random.default_rng(7)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def filt(x, kind, f, order=2):
    sos = butter(order, f, btype=kind, fs=SR, output="sos")
    return sosfilt(sos, x)


def saw(f, n, phase=0.0):
    t = np.arange(n) / SR
    return 2 * ((f * t + phase) % 1.0) - 1


# ---------------------------------------------------------------- instruments

def kick():
    n = int(0.36 * SR)
    t = np.arange(n) / SR
    f = 41.2 + (320 - 41.2) * np.exp(-t / 0.028)          # sweep down to E1
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.22)
    click = filt(rng.standard_normal(n), "high", 2000) * np.exp(-t / 0.004) * 0.4
    x = np.tanh(5.0 * (body + click))                       # hard distortion = jumpstyle punch
    x[-200:] *= np.linspace(1, 0, 200)
    return x * 0.9


def clap():
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    noise = filt(rng.standard_normal(n), "band", [900, 3500])
    env = np.zeros(n)
    for d in (0.0, 0.011, 0.022):
        i = int(d * SR)
        env[i:] += np.exp(-(t[: n - i]) / (0.012 if d < 0.02 else 0.11))
    return noise * env * 0.5


def hat(open_=False):
    n = int((0.12 if open_ else 0.04) * SR)
    t = np.arange(n) / SR
    x = filt(rng.standard_normal(n), "high", 7000)
    return x * np.exp(-t / (0.05 if open_ else 0.012)) * 0.22


def cowbell(m, dur=0.22):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = hz(m)
    sq = np.sign(np.sin(2 * np.pi * f * t)) + 0.8 * np.sign(np.sin(2 * np.pi * f * 1.48 * t))
    x = filt(sq, "band", [min(f * 0.7, 3000), 6000])
    return x * np.exp(-t / 0.07) * 0.16


def vox_chop(m, dur=0.16):
    """Formant-filtered saw shaped like a sung 'ah' syllable, cut short."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = hz(m) * (1 + 0.004 * np.sin(2 * np.pi * 5.5 * t))
    src = 2 * ((np.cumsum(f) / SR) % 1.0) - 1
    src += 0.6 * (2 * ((np.cumsum(f * 1.003) / SR) % 1.0) - 1)
    x = (filt(src, "band", [650, 850]) * 1.0 + filt(src, "band", [1000, 1200]) * 0.6
         + filt(src, "band", [2300, 2600]) * 0.25)
    env = np.minimum(1, t / 0.006) * np.exp(-t / 0.09)
    return x * env * 1.4


def piano(m, dur=1.4):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = hz(m)
    x = sum((0.6 ** k) * np.sin(2 * np.pi * f * (k + 1) * (1 + 0.0007 * k) * t) * np.exp(-t * (1.5 + k))
            for k in range(6))
    return x * np.minimum(1, t / 0.003) * 0.35


def pad(chord, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for m in chord:
        for det in (-0.006, 0, 0.006):
            x += saw(hz(m) * (1 + det), n, rng.random())
    x = filt(x, "low", 2200)
    x = filt(x, "band", [500, 1300]) * 0.7 + x * 0.3          # 'aah' choir colour
    env = np.minimum(1, t / 0.35) * np.minimum(1, (dur - t) / 0.2)
    return x * env * 0.05


def offbass(m, dur=0.17):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = saw(hz(m), n) + 0.7 * np.sin(2 * np.pi * hz(m - 12) * t)
    x = filt(x, "low", 520)
    x = np.tanh(2.2 * x)
    return x * np.minimum(1, t / 0.004) * np.exp(-t / 0.09) * 0.55


# ---------------------------------------------------------------- arrangement

CHORDS = [  # Em, C, G, D  (bass note, pad voicing)
    (40, [52, 55, 59, 64]),
    (36, [48, 52, 55, 60]),
    (43, [55, 59, 62, 67]),
    (38, [50, 54, 57, 62]),
]
# Original syncopated motif, 16th-step -> MIDI note (E minor)
MOTIF_A = {0: 76, 3: 79, 6: 83, 8: 81, 10: 79, 12: 78, 14: 76}
MOTIF_B = {0: 76, 3: 79, 6: 83, 8: 86, 10: 83, 12: 81, 14: 79}

SECTIONS = [  # name, bars
    ("intro", 4), ("build", 2), ("drop", 16), ("break", 4), ("build", 2), ("drop2", 16), ("outro", 4),
]
TOTAL_BARS = sum(b for _, b in SECTIONS)
N = int((TOTAL_BARS * BAR + 3) * SR)

bus = {k: np.zeros(N) for k in ("kick", "bass", "perc", "lead", "pad", "keys", "fx")}
kick_times = []


def put(name, x, t, gain=1.0):
    i = int(round(t * SR))
    j = min(N, i + len(x))
    bus[name][i:j] += x[: j - i] * gain


K, CL, HC, HO = kick(), clap(), hat(), hat(True)
bar_i = 0
for name, nbars in SECTIONS:
    for b in range(nbars):
        t0 = bar_i * BAR
        root, voicing = CHORDS[bar_i % 4]
        motif = MOTIF_A if bar_i % 2 == 0 else MOTIF_B
        last = b == nbars - 1
        if name in ("intro", "break", "outro", "build"):
            put("pad", pad(voicing, BAR), t0, 0.55 if name != "build" else 0.5)
        if name in ("intro", "break", "outro"):
            for s, m in motif.items():
                put("keys", piano(m - 12), t0 + s * STEP, 0.5)
        if name == "build":
            # snare roll speeding up, then one beat of silence before the drop
            rate = 2 if b == 0 else 4
            hits = int(4 * rate * (0.75 if last else 1))
            for k in range(hits):
                put("perc", CL, t0 + k * BEAT / rate, 0.25 + 0.6 * (k / hits) * (b + 1) / 2)
            noise = filt(rng.standard_normal(int(BAR * SR)), "high", 1500 + 3000 * b)
            ramp = np.linspace(0, 1, len(noise)) ** 2 * 0.08
            if last:
                ramp[int(0.75 * len(ramp)):] = 0
            put("fx", noise * ramp, t0)
        if name in ("drop", "drop2"):
            put("pad", pad(voicing, BAR), t0, 0.9)
            for beat in range(4):
                tb = t0 + beat * BEAT
                put("kick", K, tb)
                kick_times.append(tb)
                put("bass", offbass(root), tb + BEAT / 2)
                put("perc", HO, tb + BEAT / 2, 0.8)
                if beat in (1, 3):
                    put("perc", CL, tb)
                for s in (1, 3):
                    put("perc", HC, tb + s * STEP, 0.6)
            for s, m in motif.items():
                put("lead", cowbell(m - 12), t0 + s * STEP)
                put("lead", vox_chop(m - 12), t0 + s * STEP, 0.9)
                if name == "drop2" and b >= 8:
                    put("lead", vox_chop(m), t0 + s * STEP, 0.45)   # octave up in the last 8 bars
        bar_i += 1

# sidechain pump on pad and bass from the kick
pump = np.ones(N)
tt = np.arange(N) / SR
for tk in kick_times:
    i = int(tk * SR)
    j = min(N, i + int(0.3 * SR))
    pump[i:j] = np.minimum(pump[i:j], 1 - 0.65 * np.exp(-(tt[i:j] - tk) / 0.07))
bus["pad"] *= pump
bus["bass"] *= 0.5 + 0.5 * pump

# shared reverb for heavenly space
ir_t = np.arange(int(2.4 * SR)) / SR
ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t / 0.55)
ir = filt(ir, "low", 6000)
ir /= np.sqrt(np.sum(ir ** 2))
send = bus["pad"] * 0.6 + bus["keys"] * 0.5 + bus["lead"] * 0.25
verb = fftconvolve(send, ir)[:N] * 0.6

mix = (bus["kick"] * 0.75 + bus["bass"] * 0.6 + bus["perc"] * 1.6 + bus["lead"] * 3.2
       + bus["pad"] * 1.3 + bus["keys"] * 1.4 + bus["fx"] * 1.0 + verb)
mix = filt(mix, "high", 28)
end = int((TOTAL_BARS * BAR + 2.5) * SR)
mix = mix[:end]
mix[-int(2.0 * SR):] *= np.linspace(1, 0, int(2.0 * SR))
mix /= np.max(np.abs(mix)) + 1e-9
mix = np.tanh(1.6 * mix) / np.tanh(1.6)                    # glue / soft clip

# light stereo: pad and verb wider via Haas offset
d = int(0.012 * SR)
side = np.zeros_like(mix)
side[d:] = (bus["pad"][:end] + verb[:end])[:-d] * 0.15
left, right = mix + side, mix - side
st = np.stack([left, right], axis=1)
st /= np.max(np.abs(st)) + 1e-9
st *= 0.95

out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "renders" / "angels_fall_instrumental_raw.wav"
out.parent.mkdir(parents=True, exist_ok=True)
import wave
with wave.open(str(out), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((st * 32767).astype("<i2").tobytes())
print(out, f"{len(st) / SR:.1f} s")
