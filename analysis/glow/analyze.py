"""Music analysis -> data/glow/audio.json (same schema as data/audio.json)

* Beats: the track is not on a constant grid.  It holds ~150.1 BPM to about
  110 s, then speeds up smoothly to ~152.2 BPM at the end (the accumulated
  drift is ~0.75 s, almost two beats, by 220 s).  So the beats are librosa's
  dynamic-programming tracker on the instrumental's onset envelope (tight
  tempo), unwrapped against a 150.12 BPM reference grid (every step is exactly
  one beat: no skipped or doubled beats), with the residual smoothed over ~12 s
  (Savitzky-Golay) to remove tracker jitter but keep the drift; extrapolated
  to cover 0 .. duration.
* Bars: 4/4.  Section changes (energy novelty over 4 beats) land on beats
  0 mod 4 of the extended grid: the drop at 70.38 s, the chorus steps at 51.2 /
  57.6 / 127.9 / 134.3 s, the final chorus at 172.5 s.  First downbeat at the
  first beat (0.03 s).
* Sections on downbeats (bar numbers in SECTION_BARS), from the vocal
  transcription and the energy curve.
* Envelopes (100 fps): rms / low / mid / high of the mix; vocal = vocal stem;
  drums / other = percussive / harmonic part (HPSS) of the instrumental (mix
  minus vocal stem), bass = instrumental below 150 Hz.
* Onsets [time, strength]: kick / snare(clap) / hat from band attacks of the
  instrumental's percussive part; vocal = note onsets of the vocal stem; chop =
  the vocal onsets inside the drops (the pitched vocal-chop hook).

Run:  uv run python analyze.py [--plots]
"""
import json
import math
import sys

import librosa
import numpy as np
import soundfile as sf
from scipy.ndimage import median_filter, uniform_filter1d
from scipy.signal import butter, find_peaks, savgol_filter, sosfiltfilt

from common import DATA, QA, WORK

SR = 44100
FPS = 100
REF_BPM = 150.12  # reference grid for unwrapping the tracked beats

# (name, first bar, end bar); bar k starts at beat 4k
SECTION_BARS = [
    ("intro", 0, 12),      # bell plucks, airy vocal pads; "We were" pickup in bar 11
    ("verse1", 12, 20),    # 4 lines, 2 bars each
    ("pre1", 20, 28),      # "Put your hands up ..." -> "Here we go, here we go"
    ("chorus1", 28, 44),   # builds in steps at bars 32 and 36, riser into the drop
    ("drop1", 44, 60),     # vocal-chop drop; "take my hand" x2 near its end
    ("verse2", 60, 68),
    ("build2", 68, 76),    # instrumental build, "Oh, here we go, here we go" (no hands-up pre-chorus)
    ("chorus2", 76, 92),
    ("break2", 92, 100),   # short post-chorus after "glo-glo-glo-glowing in the dark"
    ("bridge", 100, 108),  # stripped: "And if you fall ..." / "We'll be golden"
    ("chorus3", 108, 118), # final chorus over the big drop's beat
    ("drop3", 118, 132),   # the big drop: chops
    ("outro", 132, None),  # fading chops, "take my hand", decay
]


def band(x, lo, hi, sr=SR):
    if lo and hi:
        sos = butter(4, [lo, hi], btype="band", fs=sr, output="sos")
    elif hi:
        sos = butter(4, hi, btype="low", fs=sr, output="sos")
    else:
        sos = butter(4, lo, btype="high", fs=sr, output="sos")
    return sosfiltfilt(sos, x)


def frame_rms(x, n, win=2048):
    hop = SR / FPS
    pad = np.pad(x, (win // 2, win // 2 + int(hop) + 2))
    idx = (np.arange(n) * hop).astype(int)
    c = np.concatenate([[0.0], np.cumsum(pad.astype(np.float64) ** 2)])
    return np.sqrt(np.maximum((c[idx + win] - c[idx]) / win, 0))


def smooth_env(x, attack=0.010, release=0.090):
    aa, ar = math.exp(-1 / (attack * FPS)), math.exp(-1 / (release * FPS))
    y, s = np.empty_like(x), 0.0
    for i, v in enumerate(x):
        a = aa if v > s else ar
        s = a * s + (1 - a) * v
        y[i] = s
    return y


def norm01(x, pct=99.0):
    return np.clip(x / (np.percentile(x, pct) + 1e-12), 0, 1)


def track_beats(inst, duration):
    y = librosa.resample(inst, orig_sr=SR, target_sr=22050)
    hop = 128
    oenv = librosa.onset.onset_strength(y=y, sr=22050, hop_length=hop)
    _, bt = librosa.beat.beat_track(onset_envelope=oenv, sr=22050, hop_length=hop, start_bpm=150,
                                    tightness=400, units="time")
    P = 60 / REF_BPM
    off = float(np.median((bt - bt[0]) % P)) + bt[0] % P
    n = np.round((bt - off) / P).astype(int)
    r = bt - (off + n * P)
    for i in range(1, len(r)):  # unwrap: the drift crosses half a beat twice
        d = r[i] - r[i - 1]
        if d < -P / 2:
            n[i:] -= 1
            r[i:] += P
        elif d > P / 2:
            n[i:] += 1
            r[i:] -= P
    assert (np.diff(n) == 1).all(), "tracked beats are not one per grid step"
    beats = off + n * P + savgol_filter(r, 31, 2)
    # extend to cover 0 .. duration at the local period
    p0, p1 = beats[1] - beats[0], beats[-1] - beats[-2]
    head = beats[0] - p0 * np.arange(int(beats[0] / p0), 0, -1)
    tail = beats[-1] + p1 * np.arange(1, int((duration - beats[-1]) / p1) + 1)
    return np.concatenate([head, beats, tail])


def band_onsets(x, lo, hi, win=0.010, hop_s=0.002, min_gap=0.08, rel_db=10.0):
    xb = band(x, lo, hi)
    h, w = int(hop_s * SR), int(win * SR)
    e = np.convolve(xb.astype(np.float64) ** 2, np.ones(w) / w, mode="same")[::h]
    db = 10 * np.log10(e + 1e-10)
    fps = SR / h
    d = uniform_filter1d(np.diff(db, prepend=db[0]), 3)
    lag = int(0.02 * fps)
    rise = db - np.concatenate([np.full(lag, db[0]), db[:-lag]])
    floor = median_filter(db, int(1.0 * fps) | 1)
    pk, _ = find_peaks(rise, height=rel_db, distance=int(min_gap * fps))
    times, strength = [], []
    for p in pk:
        a = max(0, p - lag)
        q = a + int(np.argmax(d[a:p + 1]))
        peak = db[p:p + int(0.03 * fps)].max()
        if peak < floor[p] + 3:
            continue
        times.append(q / fps)
        strength.append(peak)
    return np.array(times), np.array(strength)


def strength01(v):
    if len(v) == 0:
        return v
    lo, hi = np.percentile(v, 5), np.percentile(v, 95)
    return np.clip((v - lo) / (hi - lo + 1e-9) * 0.8 + 0.2, 0, 1)


def vocal_onsets(voc):
    y = librosa.resample(voc, orig_sr=SR, target_sr=22050)
    hop = 110  # 5 ms
    S = librosa.power_to_db(librosa.feature.melspectrogram(y=y, sr=22050, n_fft=1024, hop_length=hop, n_mels=64,
                                                           fmin=80, fmax=8000))
    flux = uniform_filter1d(np.maximum(0, np.diff(S, axis=1, prepend=S[:, :1])).mean(0), 3)
    rms = librosa.feature.rms(y=y, frame_length=4 * hop, hop_length=hop)[0]
    db = 20 * np.log10(rms + 1e-9)
    loc = median_filter(db, int(2.0 / 0.005) | 1)
    active = (db > -45) & (db > loc - 20)
    thr = uniform_filter1d(flux, int(0.4 / 0.005)) * 1.5 + 0.15 * np.percentile(flux, 99)
    pk, _ = find_peaks(flux, distance=int(0.09 / 0.005))
    pk = [p for p in pk if flux[p] > thr[p] and active[min(len(active) - 1, p + 6)]]
    s = np.array([flux[p] for p in pk])
    s = np.clip(s / (np.percentile(s, 95) + 1e-9), 0.1, 1.0)
    return [(round(p * hop / 22050, 3), round(float(v), 3)) for p, v in zip(pk, s)]


def main(plots=False):
    mix, _ = sf.read(WORK / "mix.wav", dtype="float32", always_2d=True)
    voc, _ = sf.read(WORK / "vocals.wav", dtype="float32", always_2d=True)
    mix, voc = mix.mean(1), voc.mean(1)
    inst = mix - voc
    duration = len(mix) / SR
    beats = track_beats(inst, duration)
    downbeats = beats[::4]
    bar_t = lambda k: float(downbeats[k]) if k < len(downbeats) else duration
    periods = np.diff(beats)
    print(f"{len(beats)} beats, {len(downbeats)} bars; tempo {60 / periods[:200].mean():.2f} BPM at the start, "
          f"{60 / periods[-40:].mean():.2f} BPM at the end")

    n = int(math.ceil(duration * FPS))
    harm, perc = librosa.effects.hpss(inst, margin=2.0)
    env = {"rms": frame_rms(mix, n)}
    for name, (lo, hi) in {"low": (None, 150), "mid": (150, 2000), "high": (4000, None)}.items():
        env[name] = frame_rms(band(mix, lo, hi), n)
    env["vocal"] = frame_rms(voc, n)
    env["drums"] = frame_rms(perc, n)
    env["other"] = frame_rms(harm, n)
    env["bass"] = frame_rms(band(inst, None, 150), n)
    for k in env:
        env[k] = [round(float(x), 3) for x in norm01(smooth_env(env[k]))]

    kt, kdb = band_onsets(perc, None, 110, win=0.012, min_gap=0.15, rel_db=10)
    st, sdb = band_onsets(perc, 1500, 6000, win=0.010, min_gap=0.15, rel_db=9)
    ht, hdb = band_onsets(perc, 7000, None, win=0.006, min_gap=0.06, rel_db=9)
    for other, gap in ((st, 0.04), (kt, 0.03)):
        if len(other) and len(ht):
            keep = np.min(np.abs(ht[:, None] - other[None, :]), axis=1) > gap
            ht, hdb = ht[keep], hdb[keep]
    vo = vocal_onsets(voc)
    sections = [dict(name=nm, start=round(0.0 if a == 0 else bar_t(a), 3), end=round(duration if b is None else bar_t(b), 3))
                for nm, a, b in SECTION_BARS]
    drops = [(s["start"], s["end"]) for s in sections if s["name"].startswith("drop") or s["name"] in ("break2", "outro")]
    chops = [o for o in vo if any(a <= o[0] < b for a, b in drops)]
    onsets = {
        "kick": [[round(float(t), 3), round(float(s), 3)] for t, s in zip(kt, strength01(kdb))],
        "snare": [[round(float(t), 3), round(float(s), 3)] for t, s in zip(st, strength01(sdb))],
        "hat": [[round(float(t), 3), round(float(s), 3)] for t, s in zip(ht, strength01(hdb))],
        "vocal": [list(o) for o in vo],
        "chop": [list(o) for o in chops],
    }
    for k, v in onsets.items():
        print(f"  {k:6s} {len(v)} onsets")
    for s in sections:
        print(f"  {s['name']:8s} {s['start']:7.2f} - {s['end']:7.2f}")
    doc = dict(duration=round(duration, 3), bpm=round(60 / float(np.median(periods)), 3),
               beat_period=round(float(np.median(periods)), 5), time_signature=4,
               beats=[round(float(t), 3) for t in beats], downbeats=[round(float(t), 3) for t in downbeats],
               sections=sections, fps=FPS, **env, onsets=onsets, notes=NOTES)
    (DATA / "audio.json").write_text(json.dumps(doc, separators=(",", ":")))
    print("wrote", DATA / "audio.json")
    if plots:
        make_plots(doc)


NOTES = ("Timeline = gapless mp3 decode (ffmpeg). Beats: dynamic beat tracking on the instrumental, unwrapped "
         "against a 150.12 BPM grid and smoothed; the tempo is ~150.1 BPM up to ~110 s and then accelerates "
         "smoothly to ~152.2 BPM, so beats are NOT evenly spaced (use beatAt/timeOfBeat). 4/4, downbeat = "
         "every 4th beat from the first. Sections on downbeats (see analysis/glow/analyze.py). Envelopes: "
         "100 fps, each normalized to its 99th percentile; drums/other = percussive/harmonic HPSS of the "
         "instrumental (mix minus vocal stem), bass = instrumental < 150 Hz. Onsets [time, strength]: "
         "kick/snare/hat = band attacks of the instrumental's percussive part; vocal = vocal-stem note "
         "onsets; chop = vocal onsets inside the drops, break and outro (the vocal-chop hook).")


def make_plots(doc):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    t = np.arange(len(doc["rms"])) / FPS
    fig, ax = plt.subplots(3, 1, figsize=(28, 9), sharex=True)
    for k, c in [("rms", "k"), ("low", "tab:red"), ("high", "tab:blue")]:
        ax[0].plot(t, doc[k], color=c, lw=0.6, label=k)
    for k, c in [("vocal", "tab:purple"), ("drums", "tab:orange"), ("bass", "tab:brown"), ("other", "tab:olive")]:
        ax[1].plot(t, doc[k], color=c, lw=0.6, label=k)
    for name, y, c in [("kick", 0.9, "tab:red"), ("snare", 0.7, "k"), ("hat", 0.5, "tab:blue"), ("vocal", 0.3, "tab:purple"), ("chop", 0.15, "tab:pink")]:
        ts = [o[0] for o in doc["onsets"][name]]
        ax[2].plot(ts, [y] * len(ts), "|", color=c, ms=8, label=name)
    for d in doc["downbeats"]:
        ax[2].axvline(d, color="gray", lw=0.4)
    for s in doc["sections"]:
        for a_ in ax:
            a_.axvline(s["start"], color="tab:red", lw=1.5)
        ax[0].text(s["start"] + 0.3, 1.02, s["name"], fontsize=11, color="tab:red")
    for a_ in ax:
        a_.legend(loc="upper right", fontsize=8)
    ax[2].set_xticks(np.arange(0, doc["duration"], 5))
    ax[2].set_xlim(0, doc["duration"])
    fig.tight_layout()
    fig.savefig(QA / "audio_overview.png", dpi=45)
    plt.close(fig)


if __name__ == "__main__":
    main(plots="--plots" in sys.argv)
