"""Procedural sound design for the Glowing In The Dark SFX layer: every sound is synthesized here (numpy/scipy), no
samples, deterministic per cue (seeded from the cue's time and kind).

Each synth takes a cue (see sfx_cues.py) and a numpy Generator and returns (stereo float32 array (N, 2), anchor index):
the anchor is the sample that lands on the cue's time `t` (a whoosh's peak, a riser's last sample, an impact's hit).
Levels are relative: sfx.py measures each sound and sets it against the music.

Toolkit: coloured noise, STFT time-varying filters (sweeps), biquads, envelopes, phase-integrated oscillators for
pitch glides, FM / modal bells, grain clouds, Doppler pass-bys, a synthetic stereo IR for the reverb sends (built in
sfx.py), equal-power panning. Tonal material is in the song's key, G# minor (B major): pentatonic G# B C# D# F#.
"""
from __future__ import annotations

import math

import numpy as np
from scipy import fft as sfft
from scipy import signal

SR = 48000
TAU = 2 * np.pi
A4 = 440.0
_NOTES = {n: i for i, n in enumerate("C C# D D# E F F# G G# A A# B".split())}
PENTA = ["G#", "B", "C#", "D#", "F#"]  # G# minor pentatonic (= B major pentatonic)


def hz(name: str) -> float:
    i = 2 if len(name) > 2 and name[1] == "#" else 1
    midi = _NOTES[name[:i]] + 12 * (int(name[i:]) + 1)
    return A4 * 2 ** ((midi - 69) / 12)


def penta_notes(lo: int, hi: int) -> list[float]:
    """Pentatonic pitches (Hz) from octave lo to hi inclusive."""
    return sorted(hz(f"{n}{o}") for o in range(lo, hi + 1) for n in PENTA)


# ============================================================================================ basics
def ns(sec: float) -> int:
    return max(1, int(round(sec * SR)))


def tv(N: int) -> np.ndarray:
    return np.arange(N) / SR


def white(N, rng):
    return rng.standard_normal(N)


def colored(N, rng, slope=-1.0):
    """Noise with power ~ f^slope (slope -1 pink, -2 brown), unit RMS."""
    M = sfft.next_fast_len(N, real=True)
    X = sfft.rfft(rng.standard_normal(M))
    f = sfft.rfftfreq(M, 1 / SR)
    f[0] = f[1]
    X *= f ** (slope / 2)
    x = sfft.irfft(X, M)[:N]
    return x / (np.sqrt(np.mean(x ** 2)) + 1e-12)


def pink(N, rng):
    return colored(N, rng, -1.0)


def brown(N, rng):
    return colored(N, rng, -2.0)


def stereo_noise(N, rng, corr=0.4, slope=-1.0):
    """Two partially correlated noises (corr 0 = fully decorrelated / widest)."""
    c, l, r = colored(N, rng, slope), colored(N, rng, slope), colored(N, rng, slope)
    a, b = math.sqrt(corr), math.sqrt(1 - corr)
    return np.stack([a * c + b * l, a * c + b * r], 1)


def sos(kind, f, order=2):
    return signal.butter(order, f, btype=kind, fs=SR, output="sos")


def filt(x, kind, f, order=2):
    return signal.sosfilt(sos(kind, f, order), x, axis=0)


def peak_eq(x, f0, gain_db, q=1.0):
    """RBJ peaking biquad."""
    A = 10 ** (gain_db / 40)
    w = TAU * f0 / SR
    al = math.sin(w) / (2 * q)
    b = [1 + al * A, -2 * math.cos(w), 1 - al * A]
    a = [1 + al / A, -2 * math.cos(w), 1 - al / A]
    return signal.lfilter(np.array(b) / a[0], np.array(a) / a[0], x, axis=0)


def tv_filter(x, fc, kind="bp", bw=1.0, order=2, res=0.0):
    """Time-varying filter in the STFT domain. fc: per-sample array (or scalar) of the cutoff / centre in Hz.
    kind: 'bp' (Gaussian in log-frequency, bw = FWHM in octaves), 'lp', 'hp' (Butterworth-shaped magnitude, order).
    res: an extra resonant peak at fc (dB) for lp/hp. Works on mono (N,) or stereo (N, 2)."""
    x = np.asarray(x, float)
    N = x.shape[0]
    nper, hop = 1024, 256
    fc = np.broadcast_to(np.asarray(fc, float), (N,)) if np.ndim(fc) == 0 else np.asarray(fc, float)
    chans = [x] if x.ndim == 1 else [x[:, i] for i in range(x.shape[1])]
    out = []
    for ch in chans:
        f, tt, Z = signal.stft(ch, SR, nperseg=nper, noverlap=nper - hop, boundary="even", padded=True)
        idx = np.clip((tt * SR).astype(int), 0, N - 1)
        c = np.maximum(fc[idx], 1.0)[None, :]
        F = np.maximum(f, 1.0)[:, None]
        if kind == "bp":
            sd = bw / 2.355
            M = np.exp(-0.5 * (np.log2(F / c) / sd) ** 2)
        elif kind == "lp":
            M = 1 / np.sqrt(1 + (F / c) ** (2 * order))
        else:
            M = 1 / np.sqrt(1 + (c / F) ** (2 * order))
        if res and kind != "bp":
            M = M * (1 + (10 ** (res / 20) - 1) * np.exp(-0.5 * (np.log2(F / c) / 0.12) ** 2))
        _, y = signal.istft(Z * M, SR, nperseg=nper, noverlap=nper - hop, boundary=True)
        y = y[:N]
        if len(y) < N:
            y = np.pad(y, (0, N - len(y)))
        out.append(y)
    return out[0] if x.ndim == 1 else np.stack(out, 1)


def curve(N, pts, shape="lin"):
    """Envelope through (time s, value) points; shape 'lin' or 'exp' (interpolates in log for values > 0)."""
    t = tv(N)
    ts = np.array([p[0] for p in pts], float)
    vs = np.array([p[1] for p in pts], float)
    if shape == "exp":
        return np.exp(np.interp(t, ts, np.log(np.maximum(vs, 1e-6))))
    return np.interp(t, ts, vs)


def ramp(N, a, p=1.0):
    """0 -> 1 over the first a seconds with power p (an attack), then 1."""
    t = tv(N)
    return np.clip(t / max(a, 1e-4), 0, 1) ** p


def decay(N, tau, delay=0.0):
    t = tv(N) - delay
    return np.where(t < 0, 1.0, np.exp(-np.maximum(t, 0) / tau))


def fade(x, fin=0.005, fout=0.01):
    N = x.shape[0]
    g = np.ones(N)
    a, b = min(N, ns(fin)), min(N, ns(fout))
    g[:a] *= np.linspace(0, 1, a) ** 2 if a > 1 else 1
    g[N - b:] *= np.linspace(1, 0, b) ** 2 if b > 1 else 1
    return x * (g[:, None] if x.ndim == 2 else g)


def pan(x, p):
    """Equal-power pan of a mono signal; p in [-1, 1] (scalar or per-sample)."""
    a = (np.clip(p, -1, 1) + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], 1)


def width(st, w):
    """Mid/side width (0 mono, 1 unchanged, >1 wider)."""
    m, s = (st[:, 0] + st[:, 1]) / 2, (st[:, 0] - st[:, 1]) / 2
    return np.stack([m + w * s, m - w * s], 1)


def to_st(x):
    return x if x.ndim == 2 else np.stack([x, x], 1)


def phase(f):
    return TAU * np.cumsum(np.asarray(f, float)) / SR


def osc(f, harm=1, rolloff=1.0, odd=False, ph0=0.0):
    """Band-limited additive oscillator (sine for harm=1; saw-ish/square-ish with harmonics), f may glide."""
    f = np.asarray(f, float)
    p = phase(f) + ph0
    y = np.zeros_like(p)
    fmax = float(np.max(f)) if f.ndim else float(f)
    for k in range(1, harm + 1):
        if odd and k % 2 == 0:
            continue
        if k * fmax > SR * 0.45:
            break
        y += np.sin(k * p) / k ** rolloff
    return y


def lfnoise(N, rng, f):
    """Slow random modulation: white noise low-passed at f Hz, unit standard deviation."""
    x = signal.sosfiltfilt(signal.butter(2, f, fs=SR / 100, output="sos"), rng.standard_normal(N // 100 + 8))
    x = x / (np.std(x) + 1e-12)
    return np.interp(np.arange(N) / 100, np.arange(len(x)), x)


def sat(x, drive=1.5):
    return np.tanh(drive * x) / np.tanh(drive)


def norm(x):
    m = np.max(np.abs(x))
    return x / m if m > 0 else x


def mix_into(dst, src, at):
    """Add src into dst starting at sample `at` (clipped to dst)."""
    n = src.shape[0]
    a, b = max(0, at), min(dst.shape[0], at + n)
    if b > a:
        dst[a:b] += src[a - at:b - at]


def bell(f, dur, rng, bright=1.0, partials=None):
    """A modal glass/metal bell: inharmonic partials with their own decays and a soft strike."""
    N = ns(dur)
    t = tv(N)
    parts = partials or [(1.0, 1.0, 1.0), (2.0, 0.35, 0.55), (2.76, 0.25 * bright, 0.38), (5.40, 0.12 * bright, 0.2), (8.93, 0.05 * bright, 0.1)]
    y = np.zeros(N)
    for r, a, d in parts:
        fr = f * r * (1 + rng.uniform(-0.002, 0.002))
        if fr > SR * 0.45:
            continue
        y += a * np.sin(TAU * fr * t + rng.uniform(0, TAU)) * np.exp(-t / (dur * 0.3 * d))
    return y * ramp(N, 0.002)


def fm_bell(f, dur, ratio=3.5, index=2.5, rng=None):
    N = ns(dur)
    t = tv(N)
    e = np.exp(-t / (dur * 0.28))
    ie = index * np.exp(-t / (dur * 0.12))
    return np.sin(TAU * f * t + ie * np.sin(TAU * f * ratio * t)) * e * ramp(N, 0.003)


def click(N_ms=4.0, rng=None, hp=2500, res=(3200, 5100), tau=0.004):
    """A small plastic/mechanical tick."""
    N = ns(N_ms / 1000 + tau * 6)
    t = tv(N)
    y = filt(rng.standard_normal(N) * np.exp(-t / 0.0007), "highpass", hp, 2)
    for f in res:
        y += 0.5 * np.sin(TAU * f * t) * np.exp(-t / tau)
    return y


def grains(N, rng, times, freqs, gdur=(0.02, 0.09), pans=None, amps=None, kind="sine"):
    """A cloud of short pitched grains (glitter, shards)."""
    out = np.zeros((N, 2))
    for i, t0 in enumerate(times):
        d = rng.uniform(*gdur)
        n = ns(d)
        tt = tv(n)
        f = freqs[i] if np.ndim(freqs) else freqs
        if kind == "sine":
            g = np.sin(TAU * f * tt + rng.uniform(0, TAU)) * np.exp(-tt / (d * 0.3)) * ramp(n, 0.001)
        else:  # a shard: two inharmonic modes and a tick
            g = (np.sin(TAU * f * tt) + 0.6 * np.sin(TAU * f * 2.41 * tt) + 0.3 * np.sin(TAU * f * 3.87 * tt)) * np.exp(-tt / (d * 0.25))
            g[: min(n, 30)] += rng.standard_normal(min(n, 30)) * 0.5
        a = amps[i] if amps is not None else 1.0
        p = pans[i] if pans is not None else rng.uniform(-0.9, 0.9)
        mix_into(out, pan(g * a, p), int(t0 * SR))
    return out


def ms_rms(x, win=0.4):
    """Max short-term RMS (dB) over windows of `win` s (stereo summed to power)."""
    p = np.mean(to_st(x) ** 2, 1)
    n = ns(win)
    if len(p) <= n:
        return 10 * np.log10(np.mean(p) + 1e-20)
    c = np.cumsum(np.concatenate([[0], p]))
    m = (c[n:] - c[:-n]) / n
    return 10 * np.log10(np.max(m) + 1e-20)


# ============================================================================================ whooshes and motion
def _whoosh_core(pre, tail, rng, f_lo=250, f_hi=3000, f_end=500, dir=1, bright=0.5, low=0, rise_p=2.6, rot=0.0):
    N = ns(pre + tail)
    A = ns(pre)
    t = tv(N)
    u = np.clip(t / pre, 0, 1)
    v = np.clip((t - pre) / max(tail, 1e-3), 0, 1)
    fc = np.where(t < pre, f_lo * (f_hi / f_lo) ** (u ** 1.6), f_hi * (f_end / f_hi) ** (v ** 0.6))
    if low:
        fc = fc * 0.45
    n = stereo_noise(N, rng, 0.55)
    air = tv_filter(n, fc, "bp", bw=1.4 - 0.4 * bright)
    body = tv_filter(n, fc * 0.35, "lp", order=2)
    whistle = tv_filter(n[:, 0], fc * 1.02, "bp", bw=0.12)
    env = np.where(t < pre, u ** rise_p, np.exp(-v * 4.5))
    env = env * (1 - np.exp(-np.maximum(t, 0) / 0.01))
    m = (air * (0.75 + 0.25 * bright) + body * (0.6 + 0.6 * low)) * env[:, None]
    m += to_st(whistle * env * 0.18 * bright)
    # the motion across the field: a pan that crosses the centre at the peak (or a rotation for swirls)
    if rot:
        ph = TAU * np.cumsum(rot * (0.4 + 1.6 * np.clip(t / (pre + tail), 0, 1))) / SR
        p = 0.75 * np.sin(ph)
    else:
        p = dir * 0.8 * np.tanh((t - pre) / max(0.12, pre * 0.45))
    a = (np.clip(p, -1, 1) + 1) * np.pi / 4
    m = np.stack([m[:, 0] * np.cos(a) * 1.41, m[:, 1] * np.sin(a) * 1.41], 1)
    return fade(m, 0.005, 0.03), A


def s_whoosh(c, rng):
    pre, tail = c.get("dur", 0.45), c.get("tail", 0.5)
    y, A = _whoosh_core(pre, tail, rng, 220, 2400 + 1600 * c.get("bright", 0.5), 450, c.get("dir", 1), c.get("bright", 0.5), c.get("low", 0))
    if c.get("low"):  # weight: a low swell under the bigger moves
        N = y.shape[0]
        t = tv(N)
        f = hz("G#1") * (1 + 0.3 * np.clip(t / pre, 0, 1))
        sub = np.sin(phase(f)) * np.where(t < pre, (t / pre) ** 2, np.exp(-(t - pre) / 0.25))
        y += to_st(sub * 0.5)
    return y, A


def s_swish(c, rng):
    pre = c.get("dur", 0.3) * 0.6
    tail = c.get("dur", 0.3) * 0.4 + 0.12
    b = c.get("bright", 0.6)
    return _whoosh_core(pre, tail, rng, 900, 3500 + 3500 * b, 1500, c.get("dir", 1), b, 0, rise_p=2.0)


def s_whoosh_up(c, rng):
    pre, tail = c.get("dur", 0.6), c.get("tail", 1.6)
    y, A = _whoosh_core(pre, tail, rng, 180, 2200, 4200, 0, 0.6, 0, rise_p=2.2)
    N = y.shape[0]
    t = tv(N)
    # the climb keeps rising after the peak: a second, brighter air band, and a soft sub swell under the lift-off
    up = tv_filter(stereo_noise(N, rng, 0.2), 1500 * 2 ** (2.2 * np.clip(t / (pre + tail), 0, 1)), "bp", 1.0)
    upe = np.clip((t - pre * 0.6) / 0.4, 0, 1) * np.exp(-np.maximum(t - pre, 0) / (tail * 0.5))
    sub = np.sin(phase(hz("G#1") * 2 ** (np.clip(t / (pre + tail), 0, 1)))) * np.exp(-np.abs(t - pre) / 0.4)
    y += up * upe[:, None] * 0.5 + to_st(sub * 0.35)
    return width(y, 1.3), A


def s_whoosh_dive(c, rng):
    pre, tail = c.get("dur", 1.0), c.get("tail", 0.45)
    y, A = _whoosh_core(pre, tail, rng, 160, 3800, 900, -1, 0.9, 0, rise_p=3.0)
    N = y.shape[0]
    t = tv(N)
    # falling at the Earth: a rumble that grows to the cut, a reversed swell of air on top
    rum = filt(brown(N, rng), "lowpass", 140) * np.where(t < pre, (t / pre) ** 3, np.exp(-(t - pre) / 0.15))
    y += to_st(rum * 0.8)
    return width(y, 1.4), A


def s_fall_whoosh(c, rng):
    pre, tail = c.get("dur", 0.55), c.get("tail", 0.4)
    N = ns(pre + tail)
    t = tv(N)
    # falling away: the pitch of the air goes DOWN as it accelerates
    fc = 3200 * (350 / 3200) ** np.clip(t / (pre + tail), 0, 1) ** 0.8
    n = stereo_noise(N, rng, 0.5)
    y = tv_filter(n, fc, "bp", 1.1) + 0.5 * tv_filter(n, fc * 0.4, "lp")
    env = np.where(t < pre, np.clip(t / pre, 0, 1) ** 1.5, np.exp(-(t - pre) / (tail * 0.35)))
    y *= env[:, None]
    y = width(y, 1.2)
    return fade(y, 0.01, 0.05), ns(pre)


def s_swirl(c, rng):
    pre, tail = c.get("dur", 0.6), c.get("tail", 0.4)
    y, A = _whoosh_core(pre, tail, rng, 400, 4500, 1200, 1, 0.8, 0, rise_p=1.8, rot=2.5 / max(pre, 0.3))
    N = y.shape[0]
    n = int(14 * (pre + tail))
    times = np.sort(rng.uniform(0, pre + tail * 0.5, n))
    fs = rng.choice(penta_notes(6, 7), n)
    amps = 0.25 * np.clip(times / pre, 0.2, 1)
    y += grains(N, rng, times, fs, (0.03, 0.09), amps=amps)
    return y, A


# ============================================================================================ builds and hits
def s_riser(c, rng):
    D = c.get("dur", 2.0)
    N = ns(D) + ns(0.012)
    t = tv(N)
    u = np.clip(t / D, 0, 1)
    n = stereo_noise(N, rng, 0.3)
    hp = tv_filter(n, 250 * (5000 / 250) ** (u ** 1.3), "hp", order=2, res=6)
    bp = tv_filter(n, 400 * (7000 / 400) ** (u ** 1.5), "bp", 0.7)
    noise = hp * 0.6 + bp * 0.7
    env = (10 ** ((u - 1) * 30 / 20)) * (u > 0)   # 30 dB of crescendo, exponential (straight in dB)
    y = noise * env[:, None]
    if not c.get("noise_only"):
        # a tuned stack (G# root, fifth, octave) gliding up an octave, the filter opening, a tremolo accelerating
        root = hz(c.get("root", "G#2"))
        glide = 2 ** (u ** 2.2)
        lfo_rate = 4 + 20 * u ** 2
        trem = 1 - 0.35 * (0.5 + 0.5 * np.sin(phase(lfo_rate)))
        tone = np.zeros(N)
        for r, a in [(1, 1.0), (1.4983, 0.6), (2, 0.5), (3, 0.2)]:
            for det in (-0.006, 0.0, 0.006):
                tone += a * osc(root * r * glide * (1 + det), harm=10, rolloff=1.2, ph0=rng.uniform(0, TAU))
        tone = tv_filter(tone, 300 * (6000 / 300) ** (u ** 1.4), "lp", order=2, res=4)
        tone = tone / (np.max(np.abs(tone)) + 1e-9) * trem * env
        y += pan(tone, 0) * 0.55
        # widen the tone with a short Haas offset
        y[:, 1] = np.roll(y[:, 1], 9)
    y[ns(D):] *= np.linspace(1, 0, N - ns(D))[:, None]
    return fade(y, 0.02, 0.0), ns(D) - 1


def _cymbal(N, rng, bright=1.0):
    """A synthetic crash: many inharmonic square-ish partials and high noise, decaying."""
    t = tv(N)
    y = np.zeros(N)
    for _ in range(36):
        f = rng.uniform(2800, 11000)
        y += np.sign(np.sin(TAU * f * t + rng.uniform(0, TAU))) * rng.uniform(0.2, 1.0)
    y = filt(y / 36, "highpass", 3500, 2) + 0.8 * filt(rng.standard_normal(N), "highpass", 5000, 2) * bright
    return y


def s_rev_cymbal(c, rng):
    D = c.get("dur", 1.6)
    N = ns(D)
    t = tv(N)
    st = np.stack([_cymbal(N, rng), _cymbal(N, rng)], 1)
    env = np.exp(-t / (D * 0.33))
    st = st * env[:, None]
    st = st[::-1].copy()
    # the swell is darker at its start (as a real cymbal's tail is)
    st = tv_filter(st, 3000 * (14000 / 3000) ** (t / D), "lp", order=2)
    return fade(st, 0.02, 0.004), N - 1


def s_rev_swell(c, rng):
    """A reversed reverb bloom: a bright burst smeared into a long tail, then reversed, ending on the anchor."""
    D = max(0.3, c.get("dur", 0.8))
    N = ns(D)
    t = tv(N)
    burst = stereo_noise(N, rng, 0.2)
    b = c.get("bright", 0.8)
    burst = tv_filter(burst, 1200 + 6000 * b * np.exp(-t / (D * 0.5)), "lp", order=2)
    tone = sum(np.sin(TAU * f * t + rng.uniform(0, TAU)) * a for f, a in [(hz("G#5"), 1), (hz("D#6"), 0.6), (hz("B6"), 0.35)])
    burst += to_st(tone * 0.3 * b)
    st = burst * np.exp(-t / (D * 0.3))[:, None]
    st = st[::-1].copy()
    return fade(st, 0.02, 0.004), N - 1


def s_swell(c, rng):
    pre, tail = c.get("dur", 0.8), c.get("tail", 1.2)
    N = ns(pre + tail)
    t = tv(N)
    env = np.where(t < pre, np.clip(t / pre, 0, 1) ** 2, np.exp(-(t - pre) / (tail * 0.4)))
    n = tv_filter(stereo_noise(N, rng, 0.2), 900 * (2.5 ** np.clip(t / pre, 0, 1)), "bp", 1.6)
    chord = sum(np.sin(TAU * hz(nm) * t + rng.uniform(0, TAU)) * a for nm, a in [("G#3", 1), ("D#4", 0.7), ("B4", 0.5), ("F#5", 0.25)])
    chord = chord * (1 + 0.004 * np.sin(TAU * 5 * t))
    y = (n * 0.8 + pan(chord * 0.25, 0.0)) * env[:, None]
    return width(fade(y, 0.02, 0.05), 1.3), ns(pre)


def s_impact(c, rng):
    size = c.get("size", 1.0)
    N = ns(1.2 + 1.6 * size)
    t = tv(N)
    # the sub boom: a sine falling onto G#1, saturated a little so small speakers hear its harmonics
    f = hz("G#1") + (120 - hz("G#1")) * np.exp(-t / 0.045)
    sub = np.sin(phase(f)) * np.exp(-t / (0.35 + 0.6 * size)) * ramp(N, 0.0015)
    sub = sat(sub * 1.2, 1.6)
    knock = np.sin(phase(190 * np.exp(-t / 0.05) + 70)) * np.exp(-t / 0.05)
    body = filt(brown(N, rng), "lowpass", 260) * np.exp(-t / 0.09)
    crack = stereo_noise(N, rng, 0.3, 0.0) * np.exp(-t / 0.012)[:, None]
    crack = filt(crack, "highpass", 2200)
    # a short dark noise tail that the hall send extends
    tail = tv_filter(stereo_noise(N, rng, 0.1), 3000 * np.exp(-t / 0.4) + 200, "lp") * np.exp(-t / (0.25 + 0.3 * size))[:, None]
    y = to_st(sub * 1.0 + knock * 0.35 + body * 0.5 * np.max(np.abs(sub)) / (np.max(np.abs(body)) + 1e-9)) + crack * 0.35 + tail * 0.25
    return fade(y, 0.001, 0.05), 0


def s_thump(c, rng):
    deep = c.get("deep", 0)
    N = ns(0.9)
    t = tv(N)
    f0 = 45 if deep else 60
    f = f0 + 70 * np.exp(-t / 0.03)
    s = np.sin(phase(f)) * np.exp(-t / (0.28 if deep else 0.18))
    k = filt(white(N, rng) * np.exp(-t / 0.006), "bandpass", [500, 3000])
    return fade(to_st(sat(s, 1.3) + 0.25 * k), 0.001, 0.05), 0


def s_sub_drop(c, rng):
    D = c.get("dur", 1.6)
    N = ns(D)
    t = tv(N)
    f0, f1 = c.get("f0", hz("G#2")), c.get("f1", hz("G#1"))
    f = f0 * (f1 / f0) ** (np.clip(t / (D * 0.75), 0, 1) ** 0.7)
    y = np.sin(phase(f)) * ramp(N, 0.004) * np.exp(-t / (D * 0.45))
    y = sat(y * 1.1, 1.4)
    return fade(to_st(y), 0.002, 0.08), 0


def s_implode(c, rng):
    """Everything sucked into one point: a reversed boom and an inward-rushing noise, ending on the anchor."""
    D = max(0.3, c.get("dur", 0.6))
    N = ns(D)
    t = tv(N)
    u = t / D
    rush = tv_filter(stereo_noise(N, rng, 0.2), 300 * (6000 / 300) ** (u ** 2), "bp", 1.2) * (u ** 3)[:, None]
    boom = np.sin(phase(hz("G#1") * (1 + 2 * u ** 3))) * u ** 4
    y = rush + to_st(boom * 0.6)
    y = width(y, 1 - 0.8 * 0)  # (stays wide; the narrowing is in the pan law below)
    m, s = (y[:, 0] + y[:, 1]) / 2, (y[:, 0] - y[:, 1]) / 2 * (1 - u)   # collapsing to the centre
    y = np.stack([m + s, m - s], 1)
    return fade(y, 0.02, 0.003), N - 1


def s_shatter(c, rng):
    size = c.get("size", 0.8)
    N = ns(1.4)
    t = tv(N)
    crack = filt(stereo_noise(N, rng, 0.2, 0.0), "highpass", 1800) * np.exp(-t / 0.008)[:, None]
    n = int(60 + 90 * size)
    times = np.sort(np.abs(rng.exponential(0.16, n)))
    times = times[times < 1.1]
    fs = rng.uniform(2500, 9000, len(times))
    amps = np.exp(-times / 0.35) * rng.uniform(0.3, 1.0, len(times))
    shards = grains(N, rng, times, fs, (0.015, 0.07), amps=amps, kind="shard")
    burst = tv_filter(stereo_noise(N, rng, 0.2), 6000 * np.exp(-t / 0.2) + 800, "lp") * np.exp(-t / 0.12)[:, None]
    thud = np.sin(phase(70 + 80 * np.exp(-t / 0.03))) * np.exp(-t / 0.12) * size
    y = crack * 0.9 + shards * 0.5 + burst * 0.4 + to_st(thud * 0.4)
    return fade(y, 0.0005, 0.05), 0


def s_supernova(c, rng):
    y, _ = s_impact({"size": 1.3}, rng)
    N = ns(5.0)
    out = np.zeros((N, 2))
    out[: y.shape[0]] += y
    t = tv(N)
    # the shock front: a bright blast that darkens as it expands
    blast = tv_filter(stereo_noise(N, rng, 0.1), 7000 * np.exp(-t / 0.5) + 250, "lp", order=2) * np.exp(-t / 0.9)[:, None]
    out += width(blast, 1.5) * 0.5
    # the light: a cluster of FM bells in the key, spreading out over 0.4 s
    for i, f in enumerate([hz("G#5"), hz("D#6"), hz("F#6"), hz("B6"), hz("C#7"), hz("D#7")]):
        b = fm_bell(f, 3.5, ratio=3.5, index=1.6) * 0.12
        mix_into(out, pan(b, rng.uniform(-0.8, 0.8)), int(rng.uniform(0, 0.4) * SR))
    return fade(out, 0.001, 0.2), 0


# ============================================================================================ light, stickers, chimes
def s_chime(c, rng):
    notes = c.get("notes", ["G#5", "D#6", "B6"])
    N = ns(3.2)
    out = np.zeros((N, 2))
    for i, nm in enumerate(notes):
        b = bell(hz(nm), 3.0, rng, bright=0.7) * (0.9 - 0.12 * i)
        mix_into(out, pan(b, (i - (len(notes) - 1) / 2) * 0.5), ns(0.035 * i))
    return fade(out, 0.001, 0.2), 0


def s_sticker_tick(c, rng):
    N = ns(0.6)
    t = tv(N)
    out = np.zeros((N, 2))
    p = rng.uniform(-0.6, 0.6)
    if not c.get("soft"):
        k = click(3, rng, 2500, (rng.uniform(2800, 3600), rng.uniform(4800, 5600)), 0.003)
        mix_into(out, pan(k * 0.8, p), 0)
    # the phosphor's glint: a tiny pure tone in the key
    f = rng.choice(penta_notes(6, 7)) if not c.get("soft") else hz("G#5")
    g = np.sin(TAU * f * t) * np.exp(-t / (0.12 if not c.get("soft") else 0.35)) * ramp(N, 0.002) * 0.35
    out += pan(g, p)
    return fade(out, 0.0005, 0.05), 0


def _peel(N, rng, dur):
    """Adhesive letting go: a crackle whose density rises, over a band of torn noise."""
    t = tv(N)
    u = np.clip(t / dur, 0, 1)
    rate = 60 + 900 * u ** 1.5
    prob = rate / SR
    imp = (rng.random(N) < prob) * rng.uniform(0.3, 1.0, N) * np.sign(rng.standard_normal(N))
    imp *= u < 1
    cr = filt(signal.lfilter([1], [1, -0.6], imp), "highpass", 1800)
    tear = filt(white(N, rng), "bandpass", [1800, 6500]) * (np.sin(np.pi * u) ** 1.5) * 0.12
    return (cr + tear) * (u < 1) * (0.4 + 0.6 * u)


def s_sticker_peel(c, rng):
    D = c.get("dur", 0.35)
    N = ns(D + 0.1)
    out = np.zeros((N, 2))
    if c.get("many"):
        for i in range(9):
            d = rng.uniform(0.12, 0.3)
            st = rng.uniform(0, max(0.01, D - d))
            mix_into(out, pan(_peel(ns(d + 0.02), rng, d) * rng.uniform(0.4, 1.0), rng.uniform(-0.9, 0.9)), ns(st))
    else:
        out += pan(_peel(N, rng, D), rng.uniform(-0.3, 0.3))
    return fade(out, 0.002, 0.03), 0


def s_sticker_slap(c, rng):
    N = ns(0.5)
    t = tv(N)
    p = rng.uniform(-0.7, 0.7)
    thud = filt(white(N, rng), "lowpass", 900) * np.exp(-t / 0.018) + 0.6 * np.sin(TAU * 210 * t) * np.exp(-t / 0.03)
    k = click(3, rng, 2000, (2600, 4100), 0.004)
    out = pan(thud * 0.7, p)
    mix_into(out, pan(k * 0.6, p), 0)
    g = np.sin(TAU * rng.choice(penta_notes(5, 6)) * t) * np.exp(-t / 0.2) * ramp(N, 0.004) * 0.18
    out += pan(g, p)
    return fade(out, 0.0005, 0.05), 0


def s_sparkle(c, rng):
    D = c.get("dur", 1.2)
    N = ns(D + 0.3)
    n = int(30 * D)
    times = np.sort(rng.exponential(D * 0.35, n))
    times = times[times < D]
    fs = rng.choice(penta_notes(6, 7), len(times))
    amps = np.exp(-times / (D * 0.5)) * rng.uniform(0.3, 1.0, len(times))
    out = grains(N, rng, times, fs, (0.04, 0.15), amps=amps)
    t = tv(N)
    air = filt(stereo_noise(N, rng, 0.1, 0.0), "highpass", 7000) * (np.exp(-t / (D * 0.4)) * ramp(N, 0.01))[:, None] * 0.05
    return fade(out + air, 0.002, 0.1), 0


def s_shimmer(c, rng):
    D = c.get("dur", 1.5)
    N = ns(D + 0.6)
    t = tv(N)
    env = np.clip(t / (D * 0.3), 0, 1) * np.exp(-np.maximum(t - D, 0) / 0.25)
    n = int(18 * D)
    times = np.sort(rng.uniform(0, D, n))
    out = grains(N, rng, times, rng.choice(penta_notes(6, 7), n), (0.06, 0.2), amps=rng.uniform(0.2, 0.6, n))
    pad = sum(np.sin(TAU * hz(nm) * t * (1 + 0.003 * np.sin(TAU * 4.5 * t + i))) * a for i, (nm, a) in enumerate([("B5", 1), ("F#6", 0.6), ("D#7", 0.3)]))
    out += to_st(pad * 0.15)
    return fade(width(out * env[:, None], 1.2), 0.02, 0.1), 0


def s_star_join(c, rng):
    D = c.get("dur", 1.5)
    N = ns(D + 3.0)
    A = ns(D)
    t = tv(N)
    u = np.clip(t / D, 0, 1)
    out = np.zeros((N, 2))
    # two lights curving in from the sides: soft tones gliding up a fourth into unison, panned to the centre
    for side, nm in [(-1, "G#5"), (1, "D#6")]:
        f = hz(nm) * 2 ** ((-5 / 12) * (1 - u ** 1.5))
        g = np.sin(phase(f * (1 + 0.004 * np.sin(TAU * 6 * t)))) * (u ** 2) * (t < D) * 0.25
        out += pan(g, side * 0.85 * (1 - u ** 1.2))
    out[:A] *= np.linspace(0, 1, A)[:, None] ** 0.5
    ch, _ = s_chime({"notes": ["G#5", "D#6", "G#6"]}, rng)
    mix_into(out, ch * 0.8, A)
    sp, _ = s_sparkle({"dur": 1.0}, rng)
    mix_into(out, sp * 0.5, A)
    return fade(out, 0.02, 0.2), A


def s_gold_sweep(c, rng):
    pre, tail = max(0.2, c.get("dur", 0.5)), c.get("tail", 0.6)
    N = ns(pre + tail + 1.5)
    t = tv(N)
    u = np.clip(t / pre, 0, 1)
    n = tv_filter(stereo_noise(N, rng, 0.3), 2000 * (3.5 ** u), "bp", 1.0)
    env = np.where(t < pre, u ** 1.5, np.exp(-(t - pre) / (tail * 0.5)))
    p = -0.8 + 1.6 * u
    n = np.stack([n[:, 0] * np.cos((p + 1) * np.pi / 4), n[:, 1] * np.sin((p + 1) * np.pi / 4)], 1) * 1.41
    out = n * env[:, None] * 0.6
    k = int(25 * pre)
    times = np.sort(rng.uniform(0, pre, k))
    out += grains(N, rng, times, rng.choice(penta_notes(6, 7), k), (0.03, 0.1), pans=-0.8 + 1.6 * times / pre, amps=0.3 * (times / pre) ** 0.5)
    for i, nm in enumerate(["B5", "D#6", "F#6"]):
        mix_into(out, pan(bell(hz(nm), 1.6, rng, 0.5) * 0.18, (i - 1) * 0.5), ns(pre + 0.02 * i))
    return fade(out, 0.01, 0.1), ns(pre)


def s_charge_front(c, rng):
    D = c.get("dur", 0.9)
    N = ns(D + 0.5)
    t = tv(N)
    u = np.clip(t / D, 0, 1)
    fizz = filt(stereo_noise(N, rng, 0.2, 0.0), "highpass", 3500) * (0.6 + 0.4 * np.sign(np.sin(TAU * 60 * t)))[:, None]
    env = np.sin(np.pi * u) ** 0.7 * (t < D)
    p = -0.7 + 1.4 * u
    fizz = np.stack([fizz[:, 0] * np.cos((p + 1) * np.pi / 4), fizz[:, 1] * np.sin((p + 1) * np.pi / 4)], 1) * 1.41
    out = fizz * env[:, None] * 0.25
    k = int(30 * D)
    times = np.sort(rng.uniform(0, D, k))
    out += grains(N, rng, times, rng.choice(penta_notes(5, 7), k), (0.03, 0.12), pans=-0.7 + 1.4 * times / D, amps=rng.uniform(0.2, 0.6, k))
    return fade(out, 0.01, 0.1), 0


def s_uv_flash(c, rng):
    pre = 0.14
    N = ns(pre + 0.9)
    t = tv(N)
    u = np.clip(t / pre, 0, 1)
    fw = tv_filter(stereo_noise(N, rng, 0.3), 400 * (8 ** u), "bp", 1.2) * np.where(t < pre, u ** 2, np.exp(-(t - pre) / 0.12))[:, None]
    fz = filt(stereo_noise(N, rng, 0.2, 0.0), "highpass", 4000) * (0.5 + 0.5 * np.abs(np.sin(TAU * hz("G#2") * t)))[:, None]
    fz *= (np.exp(-np.maximum(t - pre, 0) / 0.25) * (t >= pre))[:, None]
    hum = np.sin(TAU * hz("G#2") * t) * 0.3 + np.sin(TAU * hz("G#3") * t) * 0.2
    hum *= np.exp(-np.maximum(t - pre, 0) / 0.3) * u
    return fade(fw * 0.8 + fz * 0.25 + to_st(hum * 0.4), 0.01, 0.05), ns(pre)


def s_neon_on(c, rng):
    D = c.get("dur", 0.7)
    N = ns(D + 0.8)
    t = tv(N)
    # flickerOn: a few short strikes, then on (the steady hum fades back under the music)
    gate = np.zeros(N)
    strikes = [(0.0, 0.04), (0.11, 0.05), (0.27, 0.03), (0.38, 0.09), (0.55, D + 0.8)]
    for a, d in strikes:
        gate[ns(a):ns(a + d)] = 1
    gate = signal.lfilter([0.05], [1, -0.95], gate)
    buzz = osc(hz("G#2") * 2, harm=30, rolloff=0.7)
    buzz = filt(buzz, "bandpass", [700, 5000]) + 0.4 * filt(white(N, rng), "highpass", 5000)
    buzz *= gate * (1 - 0.7 * np.clip((t - 0.7) / 0.6, 0, 1))
    out = to_st(buzz * 0.3)
    for a, _ in strikes:
        mix_into(out, pan(click(2, rng, 3000, (4200, 6100), 0.002) * 0.5, 0.2), ns(a))
    return fade(width(out, 0.6), 0.002, 0.2), 0


def s_bulb_on(c, rng):
    N = ns(0.6)
    t = tv(N)
    p = (-0.6, -0.2, 0.2, 0.6)[c.get("seed", 0) % 4]
    k = click(2, rng, 2500, (rng.uniform(3800, 4400), rng.uniform(6000, 6600)), 0.006)
    hum = (np.sin(TAU * hz("G#3") * t) + 0.5 * np.sin(TAU * hz("G#4") * t)) * np.exp(-t / 0.18) * ramp(N, 0.01) * 0.2
    ping = np.sin(TAU * rng.choice(penta_notes(6, 6)) * t) * np.exp(-t / 0.08) * 0.2
    out = pan(hum + ping, p)
    mix_into(out, pan(k * 0.6, p), 0)
    return fade(out, 0.0005, 0.05), 0


def s_switch_click(c, rng):
    N = ns(0.25)
    t = tv(N)
    k = click(2, rng, 1500, (2300, 3700), 0.006)
    thock = np.sin(TAU * 180 * t) * np.exp(-t / 0.012) * 0.5
    out = to_st(thock)
    mix_into(out, to_st(k), 0)
    return fade(out, 0.0003, 0.03), 0


def s_odometer(c, rng):
    D = max(0.2, c.get("dur", 0.4))
    N = ns(D + 0.3)
    out = np.zeros((N, 2))
    # four wheels (P->G, A->O, I->L, N->D), each a burst of detent clicks that slows and stops, left to right
    for w in range(4):
        st = w * D * 0.12
        n = 10 + w * 2
        ts = st + (D * 0.75) * (np.linspace(0, 1, n) ** 1.8)
        for i, x in enumerate(ts):
            k = click(1.5, rng, 2500, (2400 + 300 * w, 4100), 0.003) * (0.4 + 0.6 * (i == n - 1))
            mix_into(out, pan(k, -0.6 + 0.4 * w), ns(x))
    return fade(out, 0.0005, 0.03), 0


def s_phos_hum(c, rng):
    D = max(0.4, c.get("dur", 1.5))
    N = ns(D + 0.8)
    t = tv(N)
    env = np.clip(t / 0.3, 0, 1) * np.exp(-t / (D * 0.6))
    pad = sum(np.sin(TAU * hz(nm) * t * (1 + 0.0025 * np.sin(TAU * (3 + i) * t))) * a for i, (nm, a) in enumerate([("G#4", 1), ("D#5", 0.6), ("G#5", 0.4), ("B5", 0.2)]))
    air = filt(stereo_noise(N, rng, 0.1), "bandpass", [2500, 7000]) * 0.04
    out = pan(pad * 0.25, -0.2) + pan(pad * 0.25, 0.2) * 0.8 + air
    return fade(width(out * env[:, None], 1.3), 0.05, 0.3), 0


# ============================================================================================ electricity, screens, CRT
def _zap(N, rng, f0=2600, f1=150, dur=0.08, index=4.0):
    t = tv(N)
    u = np.clip(t / dur, 0, 1)
    f = f0 * (f1 / f0) ** u
    y = np.sin(phase(f) + index * np.sin(phase(f * 1.41))) * np.exp(-t / (dur * 0.6))
    return y


def _crackle(N, rng, rate=300, tau=0.0004, hp=2500):
    imp = (rng.random(N) < rate / SR) * rng.uniform(0.2, 1, N) * np.sign(rng.standard_normal(N))
    k = np.exp(-tv(ns(tau * 8)) / tau)
    return filt(np.convolve(imp, k)[:N], "highpass", hp)


def s_elec_zap(c, rng):
    big = c.get("big", 0)
    N = ns(0.45 if big else 0.25)
    t = tv(N)
    z = _zap(N, rng, rng.uniform(2200, 3200), rng.uniform(120, 220), 0.12 if big else 0.07)
    cr = _crackle(N, rng, 900 if big else 600) * np.exp(-t / (0.1 if big else 0.05))
    buzz = osc(hz("G#2") * 2, harm=25, rolloff=0.6, odd=True) * np.exp(-t / 0.08) * 0.3
    p = rng.uniform(-0.5, 0.5)
    out = pan(z * 0.6 + buzz, p) + pan(cr * 0.8, -p)
    return fade(out, 0.0005, 0.04), 0


def s_led_buzz(c, rng):
    D = max(0.2, c.get("dur", 0.5))
    N = ns(D + 0.05)
    t = tv(N)
    # a glitching supply: the buzz stutters in random segments, more and more often
    gate = np.zeros(N)
    x = 0.0
    while x < D:
        d = rng.uniform(0.015, 0.09)
        if rng.random() < 0.45 + 0.5 * x / D:
            gate[ns(x):ns(x + d)] = rng.uniform(0.4, 1.0)
        x += d
    gate = signal.lfilter([0.15], [1, -0.85], gate)
    buzz = filt(osc(hz("G#2"), harm=40, rolloff=0.5, odd=True), "bandpass", [400, 4500])
    cr = _crackle(N, rng, 250 + 900 * (t / D))
    out = pan(buzz * gate * 0.5, 0.15) + pan(cr * 0.5, -0.15)
    return fade(out, 0.005, 0.03), 0


def s_power_down(c, rng):
    D = c.get("dur", 1.3)
    small = c.get("small", 0)
    N = ns(D + 0.3)
    t = tv(N)
    u = np.clip(t / D, 0, 1)
    # the whine of the supply winding down, and the mains hum sinking under it
    f = hz("G#5") * (40 / hz("G#5")) ** (u ** 0.7)
    whine = np.sin(phase(f)) * (1 - u) ** 1.2 * 0.5
    root = hz(c.get("root", "G#2"))
    hum = osc(root * (1 - 0.6 * u ** 1.5), harm=8, rolloff=1.0) * (1 - u) ** 2
    disc = _crackle(N, rng, 400) * np.exp(-t / 0.12) * 0.5
    out = to_st(whine * (0.5 if small else 1) + hum * 0.4) + pan(disc, 0.3) * (0.4 if small else 1)
    return fade(width(out, 0.8), 0.002, 0.1), 0


def s_blackout(c, rng):
    N = ns(c.get("dur", 1.6) + 0.5)
    t = tv(N)
    out = np.zeros((N, 2))
    t0 = c["t"]
    # the mains going down: a deep thoom, the hum's last breath
    thoom = sat(np.sin(phase(35 + 45 * np.exp(-t / 0.08))) * np.exp(-t / 0.7), 1.4)
    out += to_st(thoom * 0.8)
    hum = osc(hz("G#2") * (1 - 0.5 * np.clip(t / 0.6, 0, 1)), harm=6) * np.exp(-t / 0.15) * 0.25
    out += to_st(hum)
    # the breakers: one clunk per light that flicks out (station LEDs, box, canopy, pumps, shop), scattered
    for i, tap in enumerate(c.get("taps", [t0])):
        n = ns(0.3)
        tt = tv(n)
        k = 0.6 * np.sin(TAU * rng.uniform(120, 170) * tt) * np.exp(-tt / 0.04)
        k += 0.25 * np.sin(TAU * rng.uniform(800, 1100) * tt) * np.exp(-tt / 0.03)
        k += filt(white(n, rng) * np.exp(-tt / 0.002), "highpass", 2000) * 0.4
        mix_into(out, pan(k * (0.9 - 0.1 * i), (-0.6, 0.5, -0.2, 0.7, 0.1)[i % 5]), ns(tap - t0))
    pw, _ = s_power_down({"dur": 1.2, "root": "G#2"}, rng)
    mix_into(out, pw * 0.6, 0)
    return fade(out, 0.001, 0.2), 0


def s_crt_on(c, rng):
    N = ns(1.4)
    t = tv(N)
    # the degauss: a low wobbling thunk; the flyback whine and static come up behind it
    thunk = np.sin(phase(hz("G#1") * (1 + 0.15 * np.sin(TAU * 11 * t)))) * np.exp(-t / 0.35) * ramp(N, 0.003)
    buzz = filt(osc(hz("G#2"), harm=30, rolloff=0.7, odd=True), "bandpass", [300, 3000]) * np.exp(-t / 0.25) * 0.3
    stat = filt(stereo_noise(N, rng, 0.2, 0.0), "highpass", 5000) * (np.exp(-t / 0.3) * 0.15)[:, None]
    whine = np.sin(TAU * 7800 * t) * np.clip(t / 0.4, 0, 1) * np.exp(-t / 0.9) * 0.02
    k = click(2, rng, 1500, (1900, 2900), 0.008)
    out = to_st(sat(thunk, 1.3) * 0.8 + buzz + whine) + stat
    mix_into(out, to_st(k * 0.5), 0)
    return fade(out, 0.0005, 0.1), 0


def s_crt_hum(c, rng):
    D = c.get("dur", 20.0)
    N = ns(D)
    t = tv(N)
    root = hz(c.get("root", "G#2"))
    hum = sum(a * np.sin(TAU * root * k * t + rng.uniform(0, TAU)) for k, a in [(1, 0.5), (2, 1.0), (3, 0.6), (4, 0.35), (6, 0.15)])
    hum = filt(hum, "lowpass", 1400)
    stat = filt(stereo_noise(N, rng, 0.0, 0.0), "highpass", 4500) * 0.08
    out = to_st(hum * 0.3) + stat
    env = np.clip(t / c.get("fade_in", 0.4), 0, 1) * np.clip((D - t) / c.get("fade_out", 0.4), 0, 1)
    return out * env[:, None], 0


def s_crt_zap(c, rng):
    short = c.get("short", 0)
    N = ns(0.2 if short else 0.3)
    t = tv(N)
    z = _zap(N, rng, rng.uniform(1800, 2600), rng.uniform(250, 400), 0.035 if short else 0.06, 2.5)
    st = _crackle(N, rng, 1200) * np.exp(-t / (0.03 if short else 0.06))
    p = rng.uniform(-0.4, 0.4)
    return fade(pan(z * 0.5, p) + pan(st * 0.5, -p), 0.0005, 0.03), 0


def s_crt_off(c, rng):
    D = c.get("dur", 0.8)
    N = ns(D + 1.0)
    t = tv(N)
    # to the line (0..0.34 of the collapse), to the dot (..0.74): two falling 'pew's and a discharge crackle
    e1 = (t < 0.4 * D)
    f1 = 3200 * (180 / 3200) ** np.clip(t / (0.34 * D), 0, 1)
    p1 = np.sin(phase(f1)) * np.exp(-t / (0.2 * D)) * e1
    t2 = t - 0.34 * D
    f2 = 1400 * (90 / 1400) ** np.clip(t2 / (0.4 * D), 0, 1)
    p2 = np.sin(phase(f2)) * np.exp(-np.maximum(t2, 0) / (0.25 * D)) * (t2 > 0)
    thunk = np.sin(phase(hz("G#1") + 40 * np.exp(-t / 0.02))) * np.exp(-t / 0.15)
    cr = _crackle(N, rng, 500) * np.exp(-t / 0.5) * 0.4
    hum = osc(hz("G#2") * (1 - 0.6 * np.clip(t / D, 0, 1)), harm=6) * np.exp(-t / (0.3 * D)) * 0.2
    out = to_st(p1 * 0.5 + p2 * 0.35 + thunk * 0.6 + hum) + pan(cr, 0.2)
    return fade(out, 0.001, 0.2), 0


# ============================================================================================ the car and the street
def _engine(N, rng, f, amp):
    """A four-cylinder hum: the firing harmonic series of f (per-sample), with combustion roughness."""
    rough = 1 + 0.12 * lfnoise(N, rng, 30) + 0.06 * filt(white(N, rng), "lowpass", 120) / 0.07
    y = np.zeros(N)
    for k, a in [(0.5, 0.5), (1, 1.0), (1.5, 0.35), (2, 0.6), (3, 0.3), (4, 0.2), (6, 0.08)]:
        y += a * np.sin(phase(f * k) + rng.uniform(0, TAU))
    y *= np.clip(rough, 0.3, 2)
    return filt(y, "lowpass", 700) * amp


def _rain(N, rng, inside):
    """Rain: a hiss and a patter of drops; inside the car, on the glass and roof (duller, closer, fewer)."""
    hiss = filt(stereo_noise(N, rng, 0.1, -0.5), "bandpass", [1500, 9000]) * (0.05 if inside else 0.12)
    rate = 140 if inside else 420
    out = np.zeros((N, 2))
    for ch in range(2):
        imp = (rng.random(N) < rate / SR) * rng.uniform(0.1, 1, N) ** 2
        k = np.exp(-tv(ns(0.006)) / (0.0018 if inside else 0.0008))
        d = np.convolve(imp * np.sign(rng.standard_normal(N)), k)[:N]
        out[:, ch] = filt(d, "bandpass", [600, 3500] if inside else [1500, 8000]) * (1.1 if inside else 0.5)
    return hiss + out


def s_car_bed(c, rng):
    D = c["dur"]
    t0 = c["t"]
    N = ns(D)
    t = tv(N) + t0
    inside = np.zeros(N)
    for a, b in c.get("inside", []) + [c.get("gauge", [0, 0])]:
        inside[(t >= a) & (t < b)] = 1
    inside = signal.lfilter([0.002], [1, -0.998], inside)  # smooth the switch (the cut is still quick: ~10 ms)
    stall = c.get("stall", t0 + D)
    # speed (m/s) as highway.ts keys it, roughly: the drone chase, cruising, braking for the services, coasting
    run = np.clip(1 - (t - stall) / 0.08, 0, 1)                     # the engine: on until the stall
    rpm = np.where(t < stall, 1.0, 0.0)
    f = hz("G#1") * (0.95 + 0.1 * rpm)
    eng = _engine(N, rng, f, 1.0) * run
    road = filt(stereo_noise(N, rng, 0.3, -1.0), "bandpass", [60, 1400])
    spray = filt(stereo_noise(N, rng, 0.1, 0.0), "bandpass", [2000, 7000]) * 0.25
    speed = np.clip(1 - np.clip(t - stall, 0, None) / 1.4, 0.35, 1)  # coasting after the stall
    road_in = filt(road, "lowpass", 380) * 1.4
    road_mix = road * (1 - inside)[:, None] + road_in * inside[:, None]
    spray_mix = spray * (1 - 0.8 * inside)[:, None]
    rain_out = _rain(N, rng, False)
    rain_in = _rain(N, rng, True)
    rain = rain_out * (1 - inside)[:, None] + rain_in * inside[:, None]
    eng_mix = to_st(eng * (0.25 + 0.5 * inside))
    y = (road_mix * 0.55 + spray_mix) * speed[:, None] + rain * 0.7 + eng_mix * 0.45
    env = np.clip((t - t0) / 0.35, 0, 1)                             # in under the whip
    end = t0 + D
    env *= np.clip((end - t) / 0.03, 0, 1)                           # the hard cut into the dashboard star
    # after the blackout the world goes quiet: only the rain on the glass, and it recedes into the push-in
    env *= np.where(t > stall, np.clip(1 - 0.5 * (t - stall) / max(0.1, end - stall), 0.4, 1), 1)
    return y * env[:, None], 0


def _doppler(src, dist, x, c=343.0):
    """Delay a mono source by distance/c (per sample), with 1/r gain; x = lateral position for the pan."""
    N = len(src)
    tt = np.arange(N) / SR
    te = tt - dist / c
    y = np.interp(te * SR, np.arange(N), src, left=0, right=0)
    g = 1 / np.maximum(dist, 2.0)
    p = np.clip(x / np.maximum(dist, 1e-3), -1, 1)
    return pan(y * g, p * 0.9)


def s_car_pass(c, rng, far=False):
    D = c.get("dur", 2.2)
    N = ns(D)
    A = N // 2
    t = tv(N) - D / 2
    big = c.get("big", 0)
    v = 28.0 if not far else 13.0
    d0 = 3.5 if not far else 25.0
    x = c.get("dir", 1) * v * t
    dist = np.sqrt(d0 ** 2 + x ** 2)
    f = (hz("G#1") * 0.85 if big else hz("C#2")) * np.ones(N)
    src = _engine(N, rng, f, 0.5 if big else 0.3) + filt(brown(N, rng) * 0.5 + pink(N, rng) * 0.6, "bandpass", [80, 2500])
    src += filt(white(N, rng), "bandpass", [2000, 6000]) * 0.12   # wet tyres
    y = _doppler(src, dist, x)
    if far:
        y = filt(y, "lowpass", 600)
    y = tv_filter(y, 900 + 5000 * np.exp(-np.abs(t) / 0.35), "lp", order=1)   # brighter as it's nearest
    return fade(y / (np.max(np.abs(y)) + 1e-9), 0.2, 0.3), A


def s_car_pass_far(c, rng):
    return s_car_pass(c, rng, far=True)


def s_dash_chime(c, rng):
    f = c.get("note_hz", hz("D#5"))
    N = ns(1.4)
    y = bell(f, 1.3, rng, bright=0.3, partials=[(1, 1, 1), (2, 0.2, 0.6), (3, 0.06, 0.4)])
    y2 = np.zeros(N)
    y2[: len(y)] = y
    return fade(pan(y2 * 0.8, 0.25), 0.002, 0.1), 0


def s_wiper(c, rng):
    D = c.get("dur", 0.66)
    N = ns(D + 0.2)
    t = tv(N)
    u = np.clip(t / D, 0, 1)
    rub = filt(white(N, rng), "bandpass", [1200, 4200]) * np.sin(np.pi * u) ** 0.8 * (t < D)
    rub *= 1 + 0.3 * np.sin(TAU * 31 * t)  # the rubber chatter on the wet glass
    motor = osc(140, harm=6) * np.sin(np.pi * u) * 0.05
    thunk = np.sin(TAU * 110 * (t - D)) * np.exp(-np.maximum(t - D, 0) / 0.02) * (t >= D) * 0.3
    out = pan(rub * 0.35, -0.6 + 1.2 * u) + to_st(motor + thunk)
    return fade(out, 0.01, 0.05), ns(D / 2)


def s_engine_stall(c, rng):
    D = c.get("dur", 1.1)
    N = ns(D + 0.4)
    t = tv(N)
    u = np.clip(t / 0.8, 0, 1)
    f = hz("G#1") * (1 - 0.7 * u ** 1.3)
    # misfires: the combustion cycles drop out more and more
    cyc = np.floor(phase(f) / TAU * 2)
    keep = (np.sin(cyc * 12.9898) * 43758.5453 % 1) > (0.15 + 0.7 * u)
    eng = _engine(N, rng, f, 1.0) * np.where(keep, 1.0, 0.25) * (1 - u) ** 0.6
    last = np.sin(phase(70 * np.exp(-np.maximum(t - 0.8, 0) / 0.05) + 40)) * np.exp(-np.maximum(t - 0.8, 0) / 0.1) * (t >= 0.8)
    out = to_st(eng * 0.7 + last * 0.5)
    k = click(2, rng, 1500, (2100, 3300), 0.006)   # a relay: the dash dies
    mix_into(out, pan(k * 0.5, 0.35), ns(0.06))
    ping = np.sin(TAU * 2900 * t) * np.exp(-np.maximum(t - 0.06, 0) / 0.15) * (t >= 0.06) * 0.06
    out += pan(ping, 0.35)
    return fade(out, 0.003, 0.1), 0


def s_room_tone(c, rng):
    D = c["dur"]
    N = ns(D)
    t = tv(N)
    room = filt(stereo_noise(N, rng, 0.2, -1.0), "bandpass", [40, 380])
    air = filt(stereo_noise(N, rng, 0.0, 0.0), "highpass", 5000) * 0.02
    city = filt(stereo_noise(N, rng, 0.5, -1.5), "bandpass", [70, 240]) * (1 + 0.3 * np.sin(TAU * 0.07 * t))[:, None] * 0.6
    env = np.clip(t / c.get("fade_in", 1.0), 0, 1) * np.clip((D - t) / c.get("fade_out", 1.0), 0, 1)
    return (room + air + city) * env[:, None], 0


def s_window_light(c, rng):
    D = max(0.6, c.get("dur", 1.4))
    N = ns(D)
    t = tv(N)
    # across the street: a far, soft click of a lamp, and the warm light's glow as a low chord in B major
    k = filt(click(3, rng, 1200, (1700, 2600), 0.01), "lowpass", 3500)
    out = np.zeros((N, 2))
    mix_into(out, pan(k * 0.6, 0.45), 0)
    chord = sum(a * np.sin(TAU * hz(nm) * t * (1 + 0.002 * np.sin(TAU * (0.6 + i * 0.3) * t)) + rng.uniform(0, TAU))
                for i, (nm, a) in enumerate([("B2", 1.0), ("F#3", 0.7), ("D#4", 0.45), ("C#5", 0.2)]))
    env = np.clip((t - 0.05) / 0.5, 0, 1) ** 1.5 * np.clip((D - t) / 0.5, 0, 1)
    out += pan(filt(chord, "lowpass", 1500) * env * 0.25, 0.2)
    return fade(out, 0.0005, 0.05), 0


# ============================================================================================ space
def _pad(N, t, notes, rng, cutoff=700, lfo=0.07, det=0.004):
    y = np.zeros((N, 2))
    for i, (nm, a, p) in enumerate(notes):
        v = np.zeros(N)
        for d in (-det, 0, det):
            v += osc(hz(nm) * (1 + d), harm=12, rolloff=1.3, ph0=rng.uniform(0, TAU))
        cf = cutoff * (1 + 0.5 * np.sin(TAU * lfo * t + i * 1.7))
        v = tv_filter(v, cf, "lp", order=2)
        y += pan(v * a, p)
    return y


def s_space_drone(c, rng):
    D = c["dur"]
    N = ns(D)
    t = tv(N) + c.get("t0", 0)
    root = c.get("root", "G#1")
    o = int(root[-1])
    notes = [(f"G#{o}", 1.0, 0.0), (f"D#{o + 1}", 0.55, -0.6), (f"G#{o + 1}", 0.45, 0.6), (f"B{o + 1}", 0.3, -0.3), (f"D#{o + 2}", 0.18, 0.4)]
    pad = _pad(N, t, notes, rng)
    wind = filt(stereo_noise(N, rng, 0.0, -1.0), "bandpass", [250, 2200])
    wind = tv_filter(wind, 600 * 2 ** (1.2 * np.sin(TAU * 0.05 * t) + 0.4 * np.sin(TAU * 0.13 * t)), "bp", 1.2)
    y = pad * 0.6 + wind * 0.5
    env = np.clip((t - t[0]) / c.get("fade_in", 1.0), 0, 1) * np.clip((t[-1] - t) / c.get("fade_out", 1.0), 0, 1)
    return width(y * env[:, None], 1.4), 0


def _kick_surge(t, kicks, tau=0.22):
    s = np.zeros_like(t)
    for k, a in kicks:
        d = t - k
        s += np.where(d >= 0, min(1, a) * np.exp(-np.maximum(d, 0) / tau), 0)
    return np.minimum(s, 1.3)


def s_warp(c, rng):
    D = c["dur"]
    N = ns(D)
    t = tv(N) + c["t"]
    u = np.clip((t - t[0]) / D, 0, 1)
    kick = _kick_surge(t, c.get("kicks", []))
    n = stereo_noise(N, rng, 0.3)
    inside = c.get("inside", 0)
    # the tunnel: a rushing band whose pitch follows the speed (and each kick's surge); a flanger for the walls
    fc = (900 if not inside else 500) * (1 + 0.6 * u) * (1 + 0.5 * kick)
    if inside:
        fc = fc * (1 - 0.6 * u)
    rush = tv_filter(n, fc, "bp", 1.3)
    d = (0.002 + 0.0015 * np.sin(TAU * 0.9 * t)) * SR
    idx = np.arange(N) - d
    fl = np.stack([np.interp(idx, np.arange(N), rush[:, i]) for i in range(2)], 1)
    y = (rush + 0.7 * fl) * (0.7 + 0.5 * kick)[:, None]
    # stars streaking past on the kicks
    for i, (k, a) in enumerate(c.get("kicks", [])):
        if a < 0.6 or k < t[0] or k > t[-1] - 0.1:
            continue
        sw, A = s_swish({"dur": 0.22, "dir": 1 if i % 2 else -1, "bright": 0.9}, rng)
        mix_into(y, sw * 0.35, ns(k - t[0]) - A)
    env = np.clip((t - t[0]) / 0.08, 0, 1) * np.clip((t[-1] - t) / 0.15, 0, 1)
    return width(y * env[:, None], 1.3), 0


def s_nebula(c, rng):
    D = c["dur"]
    N = ns(D)
    t = tv(N) + c["t"]
    kick = _kick_surge(t, c.get("kicks", []), 0.3)
    n = stereo_noise(N, rng, 0.1)
    # gas: three slow formant-like bands (a breath through the clouds), surging forward on the kicks
    y = np.zeros((N, 2))
    for i, (f0, rate) in enumerate([(380, 0.11), (900, 0.17), (2100, 0.23)]):
        y += tv_filter(n, f0 * 2 ** (0.5 * np.sin(TAU * rate * t + i)), "bp", 0.6) * (0.9 - 0.25 * i)
    pad = _pad(N, t, [("G#2", 1.0, -0.4), ("D#3", 0.6, 0.4), ("B3", 0.35, 0.0)], rng, cutoff=900)
    y = (y * (0.6 + 0.6 * kick)[:, None] + pad * 0.3)
    env = np.clip((t - t[0]) / 0.25, 0, 1) * np.clip((t[-1] - t) / 0.25, 0, 1)
    return width(y * env[:, None], 1.4), 0


def s_hole_rumble(c, rng):
    D = c["dur"]
    N = ns(D)
    t = tv(N) + c["t"]
    u = np.clip((t - t[0]) / D, 0, 1)
    fall = c.get("fall", 0)
    kick = _kick_surge(t, c.get("kicks", []), 0.3)
    root = hz(c.get("root", "G#0"))
    pitch = 1 - (0.35 * u ** 2 if fall else 0)
    sub = np.sin(phase(root * 2 * pitch)) + 0.7 * np.sin(phase(root * 2 * 1.006 * pitch)) + 0.5 * np.sin(phase(root * pitch))
    rum = filt(stereo_noise(N, rng, 0.6, -2.0), "lowpass", 150) * (1 + 0.4 * np.sin(TAU * 0.7 * t))[:, None]
    disk = filt(stereo_noise(N, rng, 0.1, 0.0), "bandpass", [2500, 7000]) * (0.05 + 0.25 * kick)[:, None]
    g = 1 + (1.5 * u ** 2 if fall else 0)
    y = (to_st(sat(sub * 0.5, 1.5)) + rum * 0.8 + disk) * np.broadcast_to(np.asarray(g, float), (N,))[:, None]
    env = np.clip((t - t[0]) / 0.2, 0, 1) * np.clip((t[-1] - t) / 0.15, 0, 1)
    return y * env[:, None], 0


def s_fall_in(c, rng):
    D = c.get("dur", 1.58)
    N = ns(D) + ns(0.4)
    t = tv(N)
    u = np.clip(t / D, 0, 1)
    # the stretch toward the horizon: everything bends down in pitch, the roar grows, and then nothing (inside)
    tone = np.zeros(N)
    for nm, a in [("G#2", 1.0), ("D#3", 0.5), ("G#3", 0.4)]:
        tone += a * osc(hz(nm) * 2 ** (-2.5 * u ** 2), harm=8, rolloff=1.2, ph0=rng.uniform(0, TAU))
    tone = tv_filter(tone, 1800 * (1 - 0.8 * u) + 100, "lp")
    roar = tv_filter(stereo_noise(N, rng, 0.3), 2500 * 2 ** (-3 * u), "bp", 1.6)
    env = np.where(t < D, (u ** 1.5), np.exp(-(t - D) / 0.06))
    y = (roar * 0.8 + to_st(tone * 0.25)) * env[:, None]
    return width(fade(y, 0.02, 0.05), 1.3), ns(D)


def s_fall_wind(c, rng):
    D = c["dur"]
    N = ns(D)
    t = tv(N)
    u = np.clip(t / D, 0, 1)
    n = stereo_noise(N, rng, 0.1)
    gust = 1 + 0.3 * lfnoise(N, rng, 0.8)
    gust = np.clip(gust, 0.4, 1.8)
    fc = 300 * (1600 / 300) ** u * (0.85 + 0.15 * gust)
    wind = tv_filter(n, fc, "bp", 1.5) + 0.3 * tv_filter(n, fc * 2.3, "bp", 0.25)   # + a whistle
    env = (0.4 + 0.6 * u ** 1.5) * np.clip(t / 1.5, 0, 1) * np.clip((D - t) / 0.08, 0, 1)
    return width(wind * (env * gust)[:, None], 1.3), 0


def s_earth_dive(c, rng):
    D = c["dur"]
    N = ns(D)
    t = tv(N) + c["t"]
    K = c["keys"]
    ts = np.array([k[0] for k in K])
    la = np.log(np.array([k[1] for k in K]))
    alt = np.interp(t, ts, la)  # log altitude (the dive's own curve)
    close = np.clip((la[0] - alt) / (la[0] - la[-1]), 0, 1)
    # wind and the atmosphere: louder and brighter as the ground comes up; a re-entry roar at the bottom
    n = stereo_noise(N, rng, 0.2)
    gust = np.clip(1 + 0.3 * lfnoise(N, rng, 1.5), 0.5, 1.6)
    wind = tv_filter(n, 250 * 2 ** (3.2 * close) * (0.9 + 0.1 * gust), "bp", 1.4)
    roar = filt(stereo_noise(N, rng, 0.5, -2.0), "lowpass", 220) * close[:, None] ** 2
    y = wind * (0.3 + 0.9 * close ** 1.5)[:, None] * gust[:, None] + roar * 0.8
    env = np.clip((t - t[0]) / 0.3, 0, 1) * np.clip((t[-1] - t) / 0.6, 0, 1)
    return width(y * env[:, None], 1.3), 0


SYNTHS = {k[2:]: v for k, v in globals().items() if k.startswith("s_") and callable(v)}
