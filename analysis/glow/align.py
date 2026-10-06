"""Word-level lyric alignment -> data/glow/lyrics.json

1. emissions.py : CTC log-probs of the vocal stem (NeMo Conformer-CTC large,
                  40 ms frames), mono and L/R channels, fused here as a
                  probability mixture.
2. this script  : the lyrics AS SUNG (the sheet's sections in the order and
                  shape the track actually has: transcribe.py showed that the
                  drops are vocal chops; the second pre-chorus's first lines
                  are sung but too buried for it, see TEMPLATE), each line constrained to a window
                  around where the free transcription heard it, aligned in one
                  Viterbi pass with a "star" garbage token between lines that
                  absorbs chops, echoes and ad-libs.  Then word starts are
                  snapped to vocal onsets and word ends set from the voice
                  (legato -> next word, else where the voice drops).

Run:  uv run python align.py [--plots]
"""
import json
import sys
from difflib import SequenceMatcher

import librosa
import numpy as np
import soundfile as sf
from scipy.ndimage import maximum_filter1d, uniform_filter1d
from scipy.signal import find_peaks

from common import DATA, MODELS, QA, WORK

FRAME = 0.04
TOKENS = MODELS / "sherpa-onnx-nemo-ctc-en-conformer-large" / "tokens.txt"

# (section, display text, where the free transcription hears the line start).
# Display text keeps the sheet's punctuation; the aligned text is derived from it.
LINES = [
    ("verse1", "We were running on an empty tank", 18.70),
    ("verse1", "Painting smiles on the days that we lost", 21.82),
    ("verse1", "Now the sun's coming up where it sank", 25.15),
    ("verse1", "And I'd pay any cost", 28.19),
    ("pre1", "Put your hands up if you've ever felt low", 31.15),
    ("pre1", "Tonight we let it all go", 34.75),
    ("pre1", "Turn the pain into gold, oh", 37.79),
    ("pre1", "Here we go, here we go", 41.23),
    ("chorus1", "We don't gotta be okay to dance", 44.03),
    ("chorus1", "We'll be glowing in the dark, take my hand", 47.47),
    ("chorus1", "Every broken piece becomes a star", 50.81),
    ("chorus1", "Look how beautiful we are", 53.77),
    ("chorus1", "So sing it like we're never coming down", 57.21),
    ("chorus1", "Loud enough to wake the whole town", 60.57),
    ("chorus1", "We don't gotta be okay to dance", 63.61),
    ("chorus1", "We'll be glowing in the dark", 66.65),
    ("drop1", "Take my hand", 88.64),
    ("drop1", "Take my hand", 91.84),
    ("verse2", "We've been ghosts in a crowded room", 95.49),
    ("verse2", "Holding on to the friends that we've got", 98.69),
    ("verse2", "If the night's gonna swallow the moon", 101.89),
    ("verse2", "Then we'll light up the spot", 104.93),
    ("pre2", "Put your hands up if you've ever felt low", 107.69),
    ("pre2", "Tonight we let it all go", 111.46),
    ("pre2", "Turn the pain into gold, oh", 114.44),
    ("pre2", "Here we go, here we go", 117.9),
    ("chorus2", "We don't gotta be okay to dance", 120.74),
    ("chorus2", "We'll be glowing in the dark, take my hand", 124.18),
    ("chorus2", "Every broken piece becomes a star", 127.54),
    ("chorus2", "Look how beautiful we are", 130.42),
    ("chorus2", "So sing it like we're never coming down", 133.91),
    ("chorus2", "Loud enough to wake the whole town", 137.19),
    ("chorus2", "We don't gotta be okay to dance", 140.31),
    ("chorus2", "We'll be glo-glo-glo-glowing in the dark", 143.27),
    ("bridge", "And if you fall, I'll fall with you", 159.14),
    ("bridge", "Through the colors and the blue", 162.47),
    ("bridge", "We'll be golden, me and you", 165.65),
    ("bridge", "We'll be golden, me and you", 167.89),
    ("chorus3", "We don't gotta be okay to dance", 171.73),
    ("chorus3", "We'll be glowing in the dark, take my hand", 175.25),
    ("chorus3", "Every broken piece becomes a star", 178.45),
    ("chorus3", "Look how beautiful we are", 181.33),
    ("chorus3", "We'll be glowing in the dark!", 184.9),
    ("outro", "Take my hand", 218.97),
]
# Each line must lie in [start - 0.6 s, end of its window]: the window ends at the
# next line's start, or after MAXLEN s for a line followed by a gap (chops, solos).
MAXLEN = 6.0
# Words the free transcription heard (text matches) anchor the start of the
# lyric word to +-ANCHOR s around the transcription's time.
ANCHOR = 0.18
# below this mean CTC probability a word's start comes from the transcription
LOW_CONF = 0.12
# Lines the models cannot hear (the final "We'll be glowing in the dark!" is
# buried under the big drop's build; the second pre-chorus's first three lines
# are sung behind the build's filter, too quiet in the stem for the models): sung like the same line of an earlier
# chorus, so they take its word times in beats, counted back from the drop
# that follows each of them ("in the dark" lands just before the drop).
# target line -> (template line, section after the template, section after
# the target).
TEMPLATE = {42: (15, "drop1", "drop3"), 22: (4, "chorus1", "chorus2"), 23: (5, "chorus1", "chorus2"), 24: (6, "chorus1", "chorus2")}


# Chop / echo lines: the drops' vocal chops and the backing echoes are not in the
# aligned sheet (the star garbage token absorbs them), so they are placed by hand
# against the chop/vocal onsets of audio.json and merged into the output with a
# `kind` field ('chop' | 'echo').  Texts avoid the sheet's wording so that
# lyrics.get('We\u2019ll be glowing') etc. keep their nth indices.
# (section, kind, text, [(word, start, end[, [syllable onsets]]), ...])
#
# What the chops sing was worked out from the vocal stem (the lyric sheet's "Glo-o-owing in the dark" for every
# chop was wrong): the ASR models hear nothing in the filtered chops, so each chop was matched against the singer's
# own sung words (MFCC templates of the aligned words, 3.8 kHz low-passed like the chops, DTW; plus a vowel-class
# track and the pyin melody). Drop 1 and drop 3 share their phrases (drop 3 = drop 1 + 117.94 s for phrase 1):
#   1  (removed: the artist says there is no "dance" in the drops — only the chorus sings it)
#   2  "Glo-o-o-o" (a held o, G#4-A#4)                                                           [go/glo: 0.37]
#   3  drop 1: "We'll be glo-o-owing in the dark" (EE, then O, IH, ER, AH)       [we'll be glowing in the dark: 0.30]
#      drop 3: "Glo-o-o-owing in the dark" (no "We'll be": the O starts at once) [dark: 0.30]
#   4  drop 3 only: "Glo-o-o" again, quieter
# The outro: a stutter "da da da ..." (the ASR also hears "duh, da"), the sung "Take my hand", then "Go-o-old"
# (from the pre-chorus's "into gold"; gold: 0.27 against glowing 0.53), the second one pitched down two octaves.
DROP1 = [
    ("drop1", "chop", "Glo-o-o-o",
     [("Glo-o-o-o", 75.94, 78.4, [75.94, 76.34, 76.78, 77.38])]),
    ("drop1", "chop", "We\u2019ll be glo-o-owing in the dark",
     [("We\u2019ll", 79.16, 79.53), ("be", 79.53, 79.92), ("glo-o-owing", 79.92, 82.3, [79.92, 80.34, 80.83, 81.18, 81.56, 81.74]),
      ("in", 82.32, 82.62), ("the", 82.62, 82.93), ("dark", 82.93, 83.4)]),
]
DROP3 = [
    ("drop3", "chop", "Glo-o-o-o",
     [("Glo-o-o-o", 194.72, 197.5, [194.72, 195.39, 196.18, 196.46])]),
    ("drop3", "chop", "Glo-o-o-owing in the dark",
     [("Glo-o-o-owing", 197.82, 200.15, [197.82, 198.19, 199.01, 199.38]), ("in", 200.22, 200.48), ("the", 200.48, 200.73), ("dark", 200.73, 201.9)]),
    ("drop3", "chop", "Glo-o-o",
     [("Glo-o-o", 207.29, 209.3, [207.29, 207.87, 208.88])]),
]
ECHO1 = [
    ("pre1", "echo", "(felt low)", [("(felt", 34.0, 34.3), ("low)", 34.3, 34.72)]),
    ("pre1", "echo", "(all go)", [("(all", 37.1, 37.35), ("go)", 37.35, 37.72)]),
]
PRE2_SHIFT = 107.708 - 30.975  # pre-chorus 2 repeats pre-chorus 1 at the same tempo
ECHO2 = [(("pre2",) + e[1:3] + ([(w, round(a + PRE2_SHIFT, 3), round(b + PRE2_SHIFT, 3)) for w, a, b in e[3]],)) for e in ECHO1]
OUTRO = [
    ("outro", "chop", "Da da da da da da da da",
     [("Da", 213.38, 213.7), ("da", 213.76, 214.1), ("da", 214.16, 214.5), ("da", 214.58, 214.9), ("da", 214.96, 215.3), ("da", 215.34, 215.75), ("da", 215.83, 216.1), ("da", 216.17, 216.45)]),
    ("outro", "chop", "Go-o-old",
     [("Go-o-old", 222.66, 225.4, [222.66, 223.01, 224.12])]),
    ("outro", "chop", "go-o-old",
     [("go-o-old", 225.5, 227.7, [225.5, 226.56, 226.96, 227.16])]),
]
EXTRA = DROP1 + DROP3 + ECHO1 + ECHO2 + OUTRO


def chop_syl(x):
    """A chop word's syllables ([start, end] pairs) from its onset list, if it has one."""
    if len(x) < 4:
        return {}
    on = list(x[3]) + [x[2]]
    return dict(syl=[[on[i], on[i + 1]] for i in range(len(on) - 1)])


def load_vocab():
    v = {}
    for line in TOKENS.read_text(encoding="utf-8").splitlines():
        s, i = line.rsplit(" ", 1)
        v[s] = int(i)
    return v


def words_of(text):
    """Display words (punctuation attached) and their spoken forms."""
    disp = text.split()
    spoken = []
    for w in disp:
        s = "".join(c for c in w.lower() if c.isalpha() or c in "'-")
        spoken.append([p for p in s.split("-") if p])  # glo-glo-glowing -> 3 spoken parts
    return disp, spoken


def tokenize(word, vocab):
    """Greedy longest match over the BPE pieces, '▁' marks the word start."""
    s, out, i = "▁" + word, [], 0
    while i < len(s):
        for j in range(len(s), i, -1):
            if s[i:j] in vocab:
                out.append(vocab[s[i:j]])
                i = j
                break
        else:
            raise ValueError(f"cannot tokenize {word!r} at {s[i:]!r}")
    return out


def viterbi(E, tgt, lo, hi, ent_lo, ent_hi):
    """CTC Viterbi over targets with blanks (column 0 = blank in E after remap).
    lo/hi: allowed frame range per target token; ent_lo/ent_hi: frames in which
    the path may enter the token (its first frame). Returns the state path."""
    T, L = E.shape[0], len(tgt)
    S = 2 * L + 1
    NEG = -1e18
    is_tok = np.arange(S) % 2 == 1
    tok_of = np.where(is_tok, (np.arange(S) - 1) // 2, 0)
    lab = np.where(is_tok, np.asarray(tgt)[tok_of], 0)
    skip_ok = np.zeros(S, bool)
    skip_ok[3::2] = np.asarray(tgt)[1:] != np.asarray(tgt)[:-1]
    lo_s = np.where(is_tok, np.asarray(lo)[tok_of], 0)
    hi_s = np.where(is_tok, np.asarray(hi)[tok_of], T)
    elo_s = np.where(is_tok, np.asarray(ent_lo)[tok_of], 0)
    ehi_s = np.where(is_tok, np.asarray(ent_hi)[tok_of], T)
    bp = np.zeros((T, S), np.int8)
    prev = np.full(S, NEG)
    prev[0] = E[0, 0]
    if lo[0] <= 0:
        prev[1] = E[0, tgt[0]]
    for t in range(1, T):
        stay = prev
        enter = ~is_tok | ((t >= elo_s) & (t <= ehi_s))
        step = np.where(enter, np.concatenate([[NEG], prev[:-1]]), NEG)
        skip = np.where(skip_ok & enter, np.concatenate([[NEG, NEG], prev[:-2]]), NEG)
        cand = np.stack([stay, step, skip])
        arg = cand.argmax(0)
        best = cand[arg, np.arange(S)]
        allowed = ~is_tok | ((t >= lo_s) & (t <= hi_s))
        cur = np.where(allowed, best + E[t, lab], NEG)
        bp[t] = arg
        prev = cur
    s = S - 1 if prev[S - 1] >= prev[S - 2] else S - 2
    path = np.zeros(T, np.int64)
    for t in range(T - 1, -1, -1):
        path[t] = s
        s -= int(bp[t, s])
    return path


def vocal_features(hop=0.005):
    v, sr = sf.read(WORK / "vocals.wav", dtype="float32", always_2d=True)
    y = librosa.resample(v.mean(1), orig_sr=sr, target_sr=22050)
    h = int(hop * 22050)
    rms = librosa.feature.rms(y=y, frame_length=4 * h, hop_length=h)[0]
    db = 20 * np.log10(rms + 1e-9)
    S = librosa.power_to_db(librosa.feature.melspectrogram(y=y, sr=22050, n_fft=1024, hop_length=h, n_mels=64, fmin=80, fmax=8000))
    flux = np.maximum(0, np.diff(S, axis=1, prepend=S[:, :1])).mean(0)
    flux = uniform_filter1d(flux, 3)
    return dict(hop=hop, db=db, flux=flux, mel=S)


def refine(words, f):
    """Snap starts to the strongest vocal onset just before/at the CTC start;
    ends: legato -> next start, else where the voice falls 15 dB below the word."""
    hop, db, flux = f["hop"], f["db"], f["flux"]
    thr = 0.25 * np.percentile(flux, 99)
    pk, _ = find_peaks(flux, height=thr, distance=int(0.05 / hop))
    pkt = pk * hop
    for k, w in enumerate(words):
        w["ctc_start"], w["ctc_end"] = w["start"], w["end"]
        prev_end = words[k - 1]["ctc_end"] if k else 0.0
        lo = max(w["start"] - (0.06 if w.get("rule") == "heard" else 0.14), prev_end - 0.02, (words[k - 1]["start"] + 0.08) if k else 0)
        cand = [(p, flux[i]) for p, i in zip(pkt, pk) if lo <= p <= w["start"] + 0.04]
        if cand:
            p, _ = max(cand, key=lambda c: c[1] * (1.0 if w["start"] - c[0] < 0.06 else 0.7))
            if abs(p - w["start"]) > 0.015:
                w["start"], w["rule"] = round(p - 0.005, 3), "onset"
    for k in range(1, len(words)):  # monotonic starts
        words[k]["start"] = max(words[k]["start"], words[k - 1]["start"] + 0.04)
    for k, w in enumerate(words):
        nxt = words[k + 1]["start"] if k + 1 < len(words) else w["ctc_end"] + 1.0
        j0, j1 = int(w["start"] / hop), int(max(w["ctc_end"], w["start"] + 0.1) / hop)
        level = np.percentile(db[j0:max(j1, j0 + 1)], 90)
        low = db < level - 15
        need = int(0.06 / hop)
        end = None
        for j in range(j1, min(int(nxt / hop), len(db) - need)):
            if low[j:j + need].all():
                end = j * hop
                break
        end = nxt if end is None or nxt - end < 0.04 else end
        w["end"] = round(max(end, w["start"] + 0.05), 3)
    return words


def main(plots=False):
    vocab = load_vocab()
    blank = vocab["<blk>"]
    em = [np.load(WORK / f"emission_large_{s}.npy").astype(np.float64) for s in ("mono", "L", "R")
          if (WORK / f"emission_large_{s}.npy").exists()]
    E = np.logaddexp.reduce(np.stack(em), axis=0) - np.log(len(em))
    T, V = E.shape
    # remap: column 0 = blank, columns 1..V-1 = pieces (ids shifted), last = star
    order = [blank] + [i for i in range(V) if i != blank]
    Ex = E[:, order]
    star_col = Ex[:, 1:].max(1, keepdims=True) - 1.0
    Ex = np.concatenate([Ex, star_col], 1)
    star = Ex.shape[1] - 1
    remap = {old: new for new, old in enumerate(order)}

    asr = json.loads((WORK / "asr.json").read_text())["words"]
    norm = lambda w: "".join(c for c in w.lower() if c.isalpha())
    tgt, lo, hi, elo, ehi, index = [star], [0], [T - 1], [0], [T - 1], []
    lines, n_anch = [], 0
    for li, (sec, text, t0) in enumerate(LINES):
        nxt = LINES[li + 1][2] if li + 1 < len(LINES) else T * FRAME
        t_end = min(nxt - 0.05, t0 + MAXLEN)
        wlo, whi = int((t0 - 0.6) / FRAME), int(t_end / FRAME)
        disp, spoken = words_of(text)
        # anchors: lyric words matched to transcribed words inside the window
        heard = [w for w in asr if t0 - 0.6 <= w["start"] <= t_end]
        sm = SequenceMatcher(a=[norm("".join(p)) for p in spoken], b=[norm(w["w"]) for w in heard], autojunk=False)
        anchor = {}
        for blk in sm.get_matching_blocks():
            for k in range(blk.size):
                anchor[blk.a + k] = heard[blk.b + k]["start"]
        for wi, parts in enumerate(spoken):
            a = len(tgt)
            for pi, part in enumerate(parts):
                ids = [remap[i] for i in tokenize(part, vocab)]
                tgt += ids
                lo += [wlo] * len(ids)
                hi += [whi] * len(ids)
                elo += [wlo] * len(ids)
                ehi += [whi] * len(ids)
                if pi == 0 and wi in anchor:
                    elo[a] = max(wlo, int((anchor[wi] - ANCHOR) / FRAME))
                    ehi[a] = min(whi, int((anchor[wi] + ANCHOR) / FRAME))
                    n_anch += 1
            index.append((li, wi, a, len(tgt), anchor.get(wi)))
        tgt.append(star)
        lo.append(0)
        hi.append(T - 1)
        elo.append(0)
        ehi.append(T - 1)
        lines.append(dict(section=sec, text=text, words=disp))
    print(f"{n_anch} of {len(index)} words anchored to the transcription")
    path = viterbi(Ex, tgt, lo, hi, elo, ehi)
    tokpos = np.where(path % 2 == 1, (path - 1) // 2, -1)
    P = np.exp(Ex[np.arange(T), np.where(tokpos >= 0, np.asarray(tgt)[np.maximum(tokpos, 0)], 0)])
    words = []
    for (li, wi, a, b, heard_at) in index:
        fr = np.where((tokpos >= a) & (tokpos < b))[0]
        w = dict(li=li, wi=wi, w=lines[li]["words"][wi], start=round(fr.min() * FRAME, 3),
                 end=round((fr.max() + 1) * FRAME, 3), conf=round(float(P[fr].mean()), 2))
        # where the CTC path is a guess (legato, reverb) but the transcription heard the word,
        # its timestamp is the better start (they agree within ~30 ms on clear words)
        if heard_at is not None and w["conf"] < LOW_CONF:
            w["start"], w["rule"] = round(heard_at, 3), "heard"
        words.append(w)
    f = vocal_features()
    words = refine(words, f)
    # template lines, in beats (the tempo drifts between choruses)
    au = json.loads((DATA / "audio.json").read_text())
    beats = np.array(au["beats"])
    sec = {x["name"]: x["start"] for x in au["sections"]}
    beat_at = lambda t: np.interp(t, beats, np.arange(len(beats)))
    time_of = lambda b: float(np.interp(b, np.arange(len(beats)), beats))
    for li, (tl, t_sec, a_sec) in TEMPLATE.items():
        b_t0, b_a0 = beat_at(sec[t_sec]), beat_at(sec[a_sec])
        tw = [w for w in words if w["li"] == tl]
        for w in (w for w in words if w["li"] == li):
            src = tw[min(w["wi"], len(tw) - 1)]
            w["start"] = round(time_of(b_a0 + beat_at(src["start"]) - b_t0), 3)
            w["end"] = round(time_of(b_a0 + beat_at(src["end"]) - b_t0), 3)
            w["conf"] = 0.3
            w["rule"] = "template"
    out_lines = []
    for li, l in enumerate(lines):
        ws = [dict(w=w["w"], start=w["start"], end=w["end"], conf=w["conf"]) for w in words if w["li"] == li]
        out_lines.append(dict(i=li, section=l["section"], text=l["text"], start=ws[0]["start"], end=ws[-1]["end"], words=ws))
        print(f"L{li:02d} {l['section']:8s} {ws[0]['start']:7.2f}-{ws[-1]['end']:7.2f}  " +
              " ".join(f"{w['w']}[{w['start']:.2f} {w['conf']:.2f}]" for w in ws))
    for sec_, kind, text, ws in EXTRA:
        out_lines.append(dict(section=sec_, kind=kind, text=text, start=ws[0][1], end=ws[-1][2],
                              words=[dict(w=x[0], start=x[1], end=x[2], conf=0.5, **chop_syl(x)) for x in ws]))
    out_lines.sort(key=lambda l: (l["start"], l.get("kind") == "echo"))
    for i, l in enumerate(out_lines):
        out_lines[i] = dict(i=i, **{k: v for k, v in l.items() if k != "i"})
    doc = dict(lines=out_lines, notes=NOTES)
    (DATA / "lyrics.json").write_text(json.dumps(doc, indent=1))
    print("wrote", DATA / "lyrics.json")
    if plots:
        make_plots(out_lines, f)


NOTES = ("Word times in the gapless-mp3 timeline. CTC forced alignment (NeMo Conformer-CTC large, "
         "vocal stem from UVR-MDX-NET-Voc_FT) of the lyrics as sung, word starts snapped to vocal "
         "onsets; conf = mean CTC probability of the word's frames. Chops (the drops' vocal "
         "samples) and the backing echoes are hand-placed lines with kind 'chop' / 'echo' (align.py EXTRA), placed against audio.json onsets.")


def make_plots(lines, f):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    hop = f["hop"]
    groups, cur = [], []
    for l in lines:
        if cur and l["start"] - cur[0]["start"] > 13:
            groups.append(cur)
            cur = []
        cur.append(l)
    groups.append(cur)
    for g in groups:
        t0, t1 = g[0]["start"] - 0.5, g[-1]["end"] + 0.5
        a, b = int(t0 / hop), int(t1 / hop)
        fig, ax = plt.subplots(2, 1, figsize=(26, 7), sharex=True, gridspec_kw=dict(height_ratios=[3, 1]))
        ax[0].imshow(f["mel"][:, a:b], origin="lower", aspect="auto", cmap="magma", extent=[t0, t1, 0, 64],
                     vmin=f["mel"].max() - 70)
        ax[1].plot(np.arange(a, b) * hop, f["db"][a:b], "k", lw=0.7)
        ax[1].plot(np.arange(a, b) * hop, f["flux"][a:b] / f["flux"].max() * 40 - 60, "tab:blue", lw=0.7)
        ax[1].set_ylim(-70, 0)
        for l in g:
            for i, w in enumerate(l["words"]):
                ax[0].axvline(w["start"], color="c", lw=1.2)
                ax[0].axvline(w["end"], color="w", lw=0.6, ls=":")
                ax[0].text(w["start"] + 0.02, 58 - 6 * (i % 2), w["w"], color="w", fontsize=11)
        ax[1].set_xticks(np.arange(np.floor(t0), t1, 0.5))
        ax[1].set_xlim(t0, t1)
        fig.tight_layout()
        fig.savefig(QA / f"align_{int(g[0]['start']):03d}.png", dpi=50)
        plt.close(fig)


if __name__ == "__main__":
    main(plots="--plots" in sys.argv)
