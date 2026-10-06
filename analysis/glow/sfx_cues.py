"""The SFX cue sheet for "Glowing In The Dark", derived from the same data the video's scenes use.

Every time here is computed the way the scene computes it (app/src/glow/timeline.ts and app/src/glow/scenes/*.ts):
beats, downbeats, sections and kick/snare events from data/glow/audio.json, word times from data/glow/lyrics.json.
Nothing is typed in by hand except offsets the scenes themselves use (e.g. "the dive starts 0.62 s before the cut").

    uv run python sfx_cues.py            # writes sfx_cues.json and prints the table

A cue is {t, kind, rel_db, ...}: `t` is the cue's ANCHOR (the frame the sound belongs to: a whoosh's peak, a riser's
end, an impact's hit), `rel_db` its level relative to the music around it (see sfx.py), `dur` its length (for sounds
that lead into the anchor, the part before it), `bus` how it is ducked under the vocal, `send` its reverb.
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DATA = ROOT / "data" / "glow"
CUES_JSON = HERE / "sfx_cues.json"

# The song's key (chroma of the instrumental, analysis/glow/work/inst.wav: Krumhansl fit B major 0.65 / G# minor
# 0.61, the bass sits on G# and E): G# minor. Tonal SFX are tuned to it.
KEY = "G# minor"
A4 = 440.0
NOTE = {n: i for i, n in enumerate("C C# D D# E F F# G G# A A# B".split())}


def hz(name: str) -> float:
    """'G#1' -> Hz (equal temperament, A4 = 440)."""
    m = re.fullmatch(r"([A-G]#?)(-?\d)", name)
    assert m, name
    midi = NOTE[m.group(1)] + 12 * (int(m.group(2)) + 1)
    return A4 * 2 ** ((midi - 69) / 12)


# ---------------------------------------------------------------------------------------------- the data, as TS sees it
class Au:
    """A mirror of app/src/engine/audio.ts (AudioData)."""

    def __init__(self, j: dict):
        self.duration = j["duration"]
        self.beats = j["beats"]
        self.downbeats = j["downbeats"]
        self.sections = j["sections"]
        self.fps = j.get("fps", 100)
        self.onsets = j["onsets"]
        self.feat = {k: j[k] for k in ("rms", "low", "mid", "high", "vocal", "drums", "bass", "other") if k in j}

    def env(self, name: str, t: float) -> float:
        a = self.feat[name]
        x = t * self.fps
        i = math.floor(x)
        if i < 0:
            return a[0]
        if i >= len(a) - 1:
            return a[-1]
        f = x - i
        return a[i] * (1 - f) + a[i + 1] * f

    def events(self, kind: str, t0: float, t1: float, thr: float = -1.0) -> list[tuple[float, float]]:
        return [(t, s) for t, s in self.onsets.get(kind, []) if t0 <= t < t1 and s >= thr]

    def times(self, kind: str, t0: float, t1: float, thr: float = -1.0) -> list[float]:
        return [t for t, _ in self.events(kind, t0, t1, thr)]

    def beatAt(self, t: float) -> float:
        b = self.beats
        if t <= b[0]:
            return (t - b[0]) / (b[1] - b[0])
        if t >= b[-1]:
            return len(b) - 1 + (t - b[-1]) / (b[-1] - b[-2])
        lo, hi = 0, len(b) - 1
        while hi - lo > 1:
            m = (lo + hi) >> 1
            if b[m] <= t:
                lo = m
            else:
                hi = m
        return lo + (t - b[lo]) / (b[hi] - b[lo])

    def timeOfBeat(self, i: float) -> float:
        b = self.beats
        n = len(b)
        period = (b[-1] - b[0]) / (n - 1)
        if i <= 0:
            return b[0] + i * period
        if i >= n - 1:
            return b[-1] + (i - (n - 1)) * period
        k = math.floor(i)
        return b[k] + (b[k + 1] - b[k]) * (i - k)

    def sec(self, name: str) -> float:
        return next(s for s in self.sections if s["name"] == name)["start"]

    def nearest_db(self, t: float) -> float:
        return min(self.downbeats, key=lambda d: abs(d - t))

    def db_index(self, t: float) -> int:
        """index of the downbeat nearest t (cosmos/cosmos-deck: `bars` start there)"""
        return min(range(len(self.downbeats)), key=lambda i: abs(self.downbeats[i] - t))


def _fold(s: str) -> str:
    return s.lower().replace("‘", "'").replace("’", "'").replace("“", '"').replace("”", '"')


class Ly:
    """A mirror of app/src/engine/lyrics.ts (Lyrics)."""

    def __init__(self, j: dict):
        self.lines = j["lines"]

    def get(self, q: str, nth: int = 0) -> dict:
        f = [l for l in self.lines if _fold(q) in _fold(l["text"])]
        return f[nth]

    def lines_in(self, t0: float, t1: float) -> list[dict]:
        return [l for l in self.lines if l["end"] > t0 and l["start"] < t1]

    @staticmethod
    def word(line: dict, rx: str) -> dict:
        return next(w for w in line["words"] if re.match(rx, _fold(w["w"])))


def load() -> tuple[Au, Ly]:
    return Au(json.loads((DATA / "audio.json").read_text())), Ly(json.loads((DATA / "lyrics.json").read_text()))


# ---------------------------------------------------------------------------------------------- the cue sheet
def build(au: Au, ly: Ly) -> dict:
    cues: list[dict] = []

    def cue(t: float, kind: str, rel_db: float, note: str, scene: str, **kw):
        c = {"t": round(float(t), 4), "kind": kind, "rel_db": rel_db, "scene": scene, "note": note}
        c.update({k: (round(v, 4) if isinstance(v, float) else v) for k, v in kw.items()})
        cues.append(c)

    beatBefore = lambda t: au.timeOfBeat(math.floor(au.beatAt(t + 0.03)))
    beatAfter = lambda t: au.timeOfBeat(math.ceil(au.beatAt(t - 0.03)))
    nearestBeat = lambda t: au.timeOfBeat(round(au.beatAt(t)))
    BEAT = 60 / 151

    # ---- timeline.ts boundaries
    def cut(q: str, nth: int = 0, tol: float = 0.03) -> float:
        s = ly.get(q, nth)["words"][0]["start"]
        return au.timeOfBeat(math.floor(au.beatAt(s + tol)))

    b = {
        "verse1": cut("We were running"),
        "pre1": cut("Put your hands up"),
        "chorus1": cut("We don't gotta be okay", 0),
        "drop1": au.sec("drop1"),
        "drop1mid": next(d for d in au.downbeats if d > au.sec("drop1") + 12.5),
        "verse2": cut("We've been ghosts"),
        "pre2": cut("Put your hands up", 1),
        "build2": au.sec("build2"),
        "chorus2": cut("We don't gotta be okay", 2),
        "break2": au.sec("break2"),
        "bridge": cut("And if you fall"),
        "chorus3": cut("We don't gotta be okay", 4),
        "drop3": au.sec("drop3"),
        "outro": next((d for d in au.downbeats if d > au.sec("outro") + 2.5), au.sec("outro")),
        "end": au.duration,
    }

    # ================================================================ INTRO (ceiling.ts, mode intro)
    s0, e0 = 0.0, b["verse1"]
    B = [d for d in au.downbeats if s0 - 2 <= d <= e0 + 2]
    b0 = math.ceil(au.beatAt(s0) - 0.05)
    beatT = lambda k, st=b0: au.timeOfBeat(st + k)
    T8, T9, T10 = B[8], B[9], B[10]
    E = e0
    cue(0.0, "room_tone", -30, "bedroom at night: air, a far city (fades out as the ceiling dissolves)", "intro",
        dur=T9 + 1.0, fade_in=1.2, fade_out=1.0, bus="bed", send="room")
    for st, d, dr in [(3.3, 2.4, 1), (9.6, 1.9, -1)]:   # SWEEPS_IN: headlights across the ceiling
        cue(s0 + st + d * 0.5, "car_pass_far", -24, "a car passes in the street below (its headlights sweep the ceiling)",
            "intro", dur=d + 1.6, dir=dr, bus="bed", send="room")
    for k in (0, 1, 2, 3):   # a sticker lights on every beat: the first four tick, then the music carries it
        cue(beatT(k), "sticker_tick", -22 - 2 * k, f"sticker {k + 1} lights", "intro", seed=k, bus="fx", send="room")
    tCatch = B[6]
    cue(tCatch - 2 * BEAT, "sticker_peel", -22, "a lit sticker comes loose", "intro", dur=0.35, bus="fx", send="room")
    cue(tCatch + 0.35, "swish", -21, "...and falls past the lens", "intro", dur=0.5, dir=1, bright=0.6, bus="fx", send="room")
    cue(T9 - 0.12, "chime", -20, "the light joins their hands (gold flash)", "intro", notes=["G#5", "D#6", "B6"], bus="fx", send="hall")
    cue(T9 + 0.6, "whoosh_up", -17, "lift-off: the ceiling dissolves, we climb into the sky", "intro",
        dur=0.6, tail=1.6, bus="fx", send="hall")
    cue(T9 + 0.55, "shimmer", -24, "the light writes the title above us", "intro", dur=T10 + 0.45 - (T9 + 0.55), bus="fx", send="hall")
    cue(beatT(41), "neon_on", -21, "FIREFACE17 switches on in neon (flickerOn, 4 flickers)", "intro", dur=0.7, bus="fx", send="room")
    cue(E - 0.72, "space_drone", -26, "out in space before the turn", "intro", dur=1.2, fade_in=0.4, fade_out=0.3,
        root="G#1", bus="bed", send="hall", t0=T10)
    cue(E + 0.05, "whoosh_dive", -12, "the camera swings over and dives at the night Earth into the highway (whip cut)",
        "intro", dur=1.0, tail=0.45, bus="fx", send="hall")

    # ================================================================ VERSE 1: the highway (highway.ts)
    S0, S1 = b["verse1"], b["pre1"]
    W0, W1 = S0 - 0.25, S1 + 0.3
    L0, L1, L2, L3 = ly.get("We were running"), ly.get("Painting smiles"), ly.get("Now the sun"), ly.get("And I'd pay")
    downs = [d for d in au.downbeats if W0 < d < W1 + 0.5]
    nextDown = lambda t: next((d for d in downs if d > t), t + 1)
    T = {}
    T["gauge"] = nextDown(L0["words"][6]["start"] + 0.2)
    T["l1"] = beatBefore(L1["start"])
    T["l2"] = beatBefore(L2["start"])
    T["sun"] = nearestBeat(L2["words"][3]["start"])
    T["sank"] = L2["words"][7]["start"]
    T["l3"] = beatBefore(L3["start"])
    kicks = au.times("kick", T["sank"] + 0.15, T["l3"] - 0.15)
    fail = [kicks[0], kicks[1], kicks[-1]] if len(kicks) >= 3 else [beatAfter(T["sank"] + 0.03) + BEAT * x for x in (0.5, 1, 1.5)]
    T["dead"] = fail[2] + 0.036
    T["pylon"] = nextDown(L3["words"][2]["start"] - 0.1)
    T["out"] = min(next((x for x in downs if x > L3["words"][4]["start"] + 0.2), S1 - 0.4), S1 - 0.3)
    T["stall"] = T["out"] + 0.05
    sun = L2["words"][2]["start"]
    wipes, dur = [], 0.66   # WIPER.dur
    t = T["l2"] - dur * 0.5
    while t > W0 - 3:
        wipes.insert(0, t)
        t -= 1.25
    t = sun + 0.2
    while t < T["stall"] - dur * 0.36 - 0.9:
        wipes.append(t)
        t += 1.25
    wipes.append(T["stall"] - dur * 0.36)

    # the car and the night: engine, tyres and rain, under everything until the stall (outside shots: road roar of the
    # drone chase; inside shots: the cabin). One continuous bed, its character switching on the shot cuts.
    cue(S0, "car_bed", -17, "night drive: engine hum (G#), tyres on wet asphalt, rain; stalls with the blackout",
        "highway", dur=S1 - S0, stall=T["stall"], inside=[[T["l2"], T["sun"]], [T["out"], S1]],
        gauge=[T["gauge"], T["l1"]], bus="bed", send="room")
    cue(S0 + 0.9, "car_pass", -19, "drone chase: a car in the next lane goes by", "highway", dir=1, dur=2.2, bus="fx", send="room")
    cue(S0 + 3.1, "car_pass", -21, "the truck's marker lights pass", "highway", dir=-1, dur=2.8, big=1, bus="fx", send="room")
    cue(T["gauge"] + 0.12, "dash_chime", -20, "macro on the fuel gauge: the low-fuel lamp", "highway", note_hz=hz("D#5"), bus="fx", send="room")
    for w in wipes:
        if T["l2"] - 0.6 <= w <= T["sun"] or w >= T["out"] - 0.1:   # only in the inside shots
            cue(w + dur * 0.5, "wiper", -24, "wiper sweep (inside the car)", "highway", dur=dur, bus="fx", send="room",
                stuck=1 if abs(w - (T["stall"] - dur * 0.36)) < 1e-6 else 0)
    cue(T["sank"] + 0.15, "led_buzz", -20, "\"sank\": the LED sun glitches; electric buzz until it dies",
        "highway", dur=T["dead"] - (T["sank"] + 0.15), bus="fx", send="room")
    for i, k in enumerate(fail):
        cue(k, "elec_zap", -16 + (2 if i == 2 else 0), f"LED screen hit {i + 1}: tearing, dead blocks (kick)", "highway",
            seed=i, big=1 if i == 2 else 0, bus="fx", send="room")
    cue(T["dead"], "power_down", -16, "the screen dies module by module: discharge and power-down whine", "highway",
        dur=1.3, root="G#2", bus="fx", send="hall")
    cue(T["out"] + 0.03, "blackout", -12, "the blackout catches up: breakers clunk (station LEDs, canopy, pumps, shop), mains die",
        "highway", taps=[T["out"] + x for x in (0.03, 0.05, 0.07, 0.09, 0.11)], dur=1.6, bus="impact", send="hall")
    cue(T["stall"], "engine_stall", -14, "the engine stalls and the dash dies", "highway", dur=1.1, bus="fx", send="room")
    cue(S1, "rev_swell", -20, "the push into the dashboard star sticker, the last light in the car (hard cut)",
        "highway", dur=S1 - (T["stall"] + 0.06), bright=1.0, bus="fx", send="hall")

    # ================================================================ PRE 1 (phos-pre n=1)
    st, en = b["pre1"], b["chorus1"]
    L = [l for l in ly.lines_in(st - 0.3, en + 0.2) if not l.get("kind")]
    ton = next(l for l in L if re.match(r"tonight", _fold(l["text"])))
    turn = next(l for l in L if re.match(r"turn the pain", _fold(l["text"])))
    here = next(l for l in L if re.match(r"here we go", _fold(l["text"])))
    put = next(l for l in L if re.match(r"put your hands", _fold(l["text"])))
    peel = Ly.word(ton, r"^let$")["start"] + 0.25
    for i, w in enumerate(put["words"][:4]):
        cue(w["start"], "sticker_tick", -24 - i, f"sticker letters land: {w['w'].upper()}", "pre1", seed=10 + i, bus="fx", send="room")
    cue(peel + 0.45, "sticker_peel", -21, "on \"let it all go\" the stickers peel off the letters and float up", "pre1",
        dur=1.1, many=1, bus="fx", send="room")
    cue(peel + 1.2, "sparkle", -25, "...floating up", "pre1", dur=1.4, bus="fx", send="hall")
    tInto = Ly.word(turn, r"^into")["start"] - 0.05
    tGold = Ly.word(turn, r"^gold")["start"]
    cue(tGold, "gold_sweep", -19, "\"into gold\": a front sweeps the frame, recharging everything gold", "pre1",
        dur=tGold - tInto, tail=0.6, bus="fx", send="hall")
    stomps = au.times("kick", here["start"] + 0.2, en + 0.05, 0.78)
    tCrush, tPoint = here["words"][5]["start"], (stomps[3] if len(stomps) > 3 else en) - 0.03
    cue(en, "riser", -15, "HERE WE GO: the slab is crushed into one white-hot point (riser into chorus 1)", "pre1",
        dur=en - tCrush, root="G#2", bus="fx", send="hall")
    cue(en, "rev_cymbal", -17, "reverse cymbal into the ignition", "pre1", dur=1.6, bus="fx", send="hall")

    # ================================================================ CHORUS 1 (phos-chorus)
    st, en = b["chorus1"], b["drop1"]
    L = [l for l in ly.lines_in(st - 0.3, en + 0.2) if not l.get("kind") and st - 0.4 <= l["start"] < en - 0.2]
    db = au.nearest_db
    on = lambda li, rx: Ly.word(L[li], rx)["start"]
    cue(st, "impact", -10, "the pre-chorus's point DETONATES: shrapnel of stickers", "chorus1", size=0.8, bus="impact", send="hall")
    cue(st, "sparkle", -22, "sticker shrapnel", "chorus1", dur=1.2, bus="fx", send="hall")
    cue(on(1, r"^glow"), "uv_flash", -21, "GLOWING: a UV flash charges everything", "chorus1", bus="fx", send="hall")
    tWhip = on(1, r"^take")
    cue(tWhip + 0.12, "swish", -17, "TAKE: whip pan to the right", "chorus1", dur=0.28, dir=1, bright=0.8, bus="fx", send="room")
    tSh = db(on(2, r"^broken"))
    if tSh < on(2, r"^broken") + 0.05:
        tSh = on(2, r"^broken") + 0.12
    cue(tSh, "shatter", -16, "BROKEN shatters on the downbeat (shards fly, the frame shakes)", "chorus1", size=0.7, bus="fx", send="hall")
    tStar = on(2, r"^star")
    tLand = db(tStar + 0.35)
    cue(tLand, "swirl", -21, "STAR: the shards burst into stickers that fly into the word", "chorus1",
        dur=tLand - tStar, tail=0.3, bus="fx", send="hall")
    dw = Ly.word(L[4], r"^down")
    tRoll = db(dw["start"])
    if tRoll > dw["start"]:
        tRoll = dw["start"] - 0.08
    cue(tRoll + 0.35, "whoosh", -17, "DOWN: the world rolls 180 degrees", "chorus1", dur=0.45, tail=0.5, dir=-1, bus="fx", send="hall")
    cue(on(5, r"^loud"), "thump", -16, "LOUD: full frame, hard shake", "chorus1", bus="impact", send="room")
    cue(on(5, r"^wake"), "charge_front", -22, "WAKE: a town of dead stickers wakes, a charge front runs out", "chorus1",
        dur=0.9, bus="fx", send="hall")
    cue(en, "riser", -17, "IN THE DARK: everything collapses into the centre point (riser into drop 1)", "chorus1",
        dur=en - on(7, r"^in$"), root="G#2", noise_only=1, bus="fx", send="hall")
    cue(en, "implode", -16, "the last 0.35 s: everything is sucked into the point", "chorus1", dur=0.5, bus="fx", send="hall")

    # ================================================================ DROP 1a: the light switch (phos-drop)
    st, en = b["drop1"], b["drop1mid"]
    bars = [d for d in au.downbeats if st - 0.05 <= d < en - 0.05]
    tLift, tSpiral = bars[6], bars[7]
    cue(st, "impact", -8, "DROP 1: the light goes on (the switch, first hit)", "drop1a", size=1.0, bus="impact", send="hall")
    cue(st, "sub_drop", -9, "drop 1 sub drop", "drop1a", dur=1.6, f0=hz("G#2"), f1=hz("G#1"), bus="impact", send="none")
    cue(st - 0.004, "switch_click", -14, "the light switch", "drop1a", bus="fx", send="room")
    cue(tLift + 0.2, "sticker_peel", -19, "bar 7: the lamp is gone, the stickers come off the ceiling", "drop1a",
        dur=1.2, many=1, bus="fx", send="room")
    cue(en, "swirl", -17, "bar 8: they swirl into the two arms of the star-dust spiral", "drop1a",
        dur=en - tSpiral, tail=0.6, bus="fx", send="hall")

    # ================================================================ DROP 1b: the galaxy (cosmos n=1)
    st, en = b["drop1mid"], b["verse2"]
    i0 = au.db_index(st)
    bars = au.downbeats[i0:i0 + 18]
    Bk = lambda k: bars[k] if k < len(bars) else bars[-1] + (k - len(bars) + 1) * 1.58
    cue(st, "space_drone", -22, "the galaxy: deep space drone (G# minor), wide", "cosmos1", dur=en - st + 0.6,
        fade_in=1.0, fade_out=0.9, root="G#1", bus="bed", send="hall", t0=st)
    # after punchUp() the flights are <=0.55 s whips into B1, B2, B3, B4, B5, B7 (B2 = the supernova)
    for k, d, why in [(1, -1, "punch into the core"), (3, 1, "fly down an arm into a cluster"), (4, -1, "reframe on the bar"),
                      (5, 1, "across a dust lane to the next cluster"), (7, -1, "dive into the core")]:
        cue(Bk(k), "whoosh", -19, f"cosmos flight: {why}", "cosmos1", dur=0.55, tail=0.5, dir=d, bus="fx", send="hall")
    cue(Bk(2), "supernova", -10, "the supernova (hardest hit of the drop's first half)", "cosmos1", bus="impact", send="hall")
    for i, l in enumerate([l for l in ly.lines_in(st, en) if re.search("take my hand", _fold(l["text"]))]):
        th = l["words"][-1]["start"] + 0.04
        cue(th, "star_join", -19, f"\"take my hand\" {i + 1}: two stars curve in and join", "cosmos1",
            dur=1.5, seed=i, bus="fx", send="hall")
    cue(en, "riser", -19, "the dive into the white core, white-out for the cut to verse 2", "cosmos1",
        dur=en - (Bk(7) + 0.45), root="G#2", noise_only=1, bus="fx", send="hall")

    # ================================================================ VERSE 2 (phos-verse)
    st, en = b["verse2"], b["pre2"]
    spot = ly.get("light up the spot")
    for i, w in enumerate(spot["words"][2:]):
        cue(w["start"], "bulb_on", -23, f"marquee of sticker bulbs: {w['w'].upper()} switches on", "verse2", seed=i,
            bus="fx", send="room")

    # ================================================================ PRE 2 (phos-pre n=2)
    st, en = b["pre2"], b["chorus2"]
    L = [l for l in ly.lines_in(st - 0.3, en + 0.2) if not l.get("kind")]
    put = next(l for l in L if re.match(r"put your hands", _fold(l["text"])))
    turn = next(l for l in L if re.match(r"turn the pain", _fold(l["text"])))
    here = next(l for l in L if re.match(r"here we go", _fold(l["text"])))
    P = put["words"]
    tUpWhip = P[3]["start"] + 0.24
    cue(tUpWhip + 0.2, "whoosh", -17, "UP is thrown out of frame: the camera whips down", "pre2", dur=0.3, tail=0.35, dir=-1,
        bright=0.9, bus="fx", send="room")
    echo = next((l for l in ly.lines_in(st - 0.3, en + 0.2) if l.get("kind") == "echo" and "felt" in _fold(l["text"])), None)
    tE = echo["start"] if echo else ly.get("Tonight", 1)["start"] - 0.7
    cue(tE + 0.55, "fall_whoosh", -21, "(felt low): the echo falls through the floor, the camera dives after it", "pre2",
        dur=0.55, tail=0.4, bus="fx", send="hall")
    iw, gw = Ly.word(turn, r"^into"), Ly.word(turn, r"^gold")
    cue(iw["start"], "odometer", -22, "PAIN -> GOLD: the letters roll like an odometer", "pre2", dur=gw["start"] - iw["start"],
        bus="fx", send="room")
    cue(gw["start"], "gold_sweep", -21, "GOLD lands with an inversion", "pre2", dur=0.25, tail=0.5, bus="fx", send="hall")
    stomps = au.times("kick", here["start"] + 0.2, en + 0.05, 0.78)
    Hw = here["words"]
    d1 = next((x for x in stomps if x > Hw[2]["start"] + 0.2), Hw[2]["start"] + 0.45)
    cue(d1 + 0.3, "whoosh", -18, "HERE WE GO: the camera dives through the O", "pre2", dur=0.3, tail=0.4, dir=1, bus="fx", send="hall")
    cue(en, "riser", -15, "the last dive hits the light inside the last O (riser into chorus 2)", "pre2",
        dur=en - Hw[3]["start"], root="G#2", bus="fx", send="hall")
    cue(en, "rev_cymbal", -17, "reverse cymbal into chorus 2", "pre2", dur=1.6, bus="fx", send="hall")

    # ================================================================ CHORUS 2: the oscilloscope (phos-scope)
    st, en = b["chorus2"], b["break2"]
    L = [l for l in ly.lines_in(st - 0.3, en + 0.2) if not l.get("kind") and st - 0.4 <= l["start"] < en - 0.2]
    cue(st, "impact", -11, "chorus 2: violet light cut onto the scope", "chorus2", size=0.6, bus="impact", send="hall")
    cue(st + 0.02, "crt_on", -17, "POWER ON: the tube lights from a flat line (degauss thunk, the flyback whine)", "chorus2",
        bus="fx", send="room")
    cue(st, "crt_hum", -27, "analog CRT hum under the whole chorus", "chorus2", dur=en - st + 0.05, fade_in=0.4, fade_out=0.15,
        root="G#2", bus="bed", send="room")
    for i, l in enumerate(L[1:], start=2):
        cue(l["start"] - 0.02, "crt_zap", -20, f"a Lissajous burst marks line {i}", "chorus2", seed=i, bus="fx", send="room")
    for i, g in enumerate([144.42, 145.04, 145.42]):   # phos-scope: the three "glo-" freeze frames (typed in there)
        cue(g, "crt_zap", -22, f"glo- freeze frame {i + 1}", "chorus2", seed=20 + i, short=1, bus="fx", send="room")

    # ================================================================ BREAK (phos-break)
    st, en = b["break2"], b["bridge"]
    cue(st, "crt_off", -15, "the scope collapses like a tube (to a line, to a dot): CRT power-off", "break2",
        dur=0.8, bus="fx", send="hall")
    fk = au.times("kick", en - 2.1, en - 1.0, 0.8)
    tFall = min(fk, key=lambda k: abs(k - (en - 1.6))) if fk else en - 1.6
    qt, qv = tFall - 1.5, 9.0
    x = st + 6
    while x < tFall - 0.4:
        v = au.env("rms", x)
        if v < qv:
            qv, qt = v, x
        x += 0.05
    tOut = qt - 0.12
    tIn = next(iter(au.times("kick", qt, tFall, 0.8)), qt + 0.5)
    first = next(iter(au.times("kick", st + 0.9, st + 2.0, 0.85)), st + 1.3)
    cue(first, "sticker_slap", -19, "the dot's afterglow becomes the first sticker", "break2", seed=0, bus="fx", send="room")
    t0, t1 = first + 0.9, tOut - 0.15
    hits = sorted(au.times("kick", t0, t1, 0.45) + au.times("snare", t0, t1, 0.88))
    hits = [h for i, h in enumerate(hits) if i == 0 or h - hits[i - 1] > 0.09]
    for i, h in enumerate(hits[:3]):
        cue(h, "sticker_slap", -22 - i, f"stickers slapped on around it (hit {i + 1})", "break2", seed=1 + i, bus="fx", send="room")
    cue(tOut, "power_down", -21, "the band drops out: the whole ceiling goes dead", "break2", dur=0.5, root="G#3", small=1,
        bus="fx", send="hall")
    cue(tIn, "rev_swell", -18, "...recharged at once on the hit after it (into the blaze)", "break2", dur=min(0.9, tIn - tOut),
        bright=0.7, bus="fx", send="hall")
    cue(tIn, "sparkle", -19, "the giant star blazes", "break2", dur=1.4, bus="fx", send="hall")
    cue(tFall - 0.3, "sticker_peel", -20, "the star sticker shivers and lets go", "break2", dur=0.35, bus="fx", send="room")
    cue(en + 0.35, "fall_whoosh", -18, "...and falls: the bridge's fall takes over", "break2", dur=en + 0.35 - tFall, tail=0.6,
        bus="fx", send="hall")

    # ================================================================ BRIDGE: the fall (phos-fall)
    st, en = b["bridge"], b["chorus3"]
    cue(st, "fall_wind", -21, "falling through space: wind and air rush, gathering speed toward the gold light", "bridge",
        dur=en - st, bus="bed", send="hall")
    cue(st + 0.2, "space_drone", -27, "nebula sheets rushing up past us", "bridge", dur=en - st - 0.2, fade_in=1.5, fade_out=0.3,
        root="G#1", bus="bed", send="hall", t0=st)
    lines = [l for l in ly.lines_in(st - 0.2, en + 0.01) if st - 0.3 <= l["start"] and l["end"] <= en + 0.3]
    tCol = Ly.word(lines[1], r"^colors")["start"] - 0.15
    tBlue = Ly.word(lines[1], r"^blue")["start"] - 0.2
    tG = lines[2]["words"][2]["start"] - 0.25
    for tt, why in [(tCol, "every colour"), (tBlue, "deep blue"), (tG, "gold")]:
        cue(tt, "swell", -24, f"the space turns {why}", "bridge", dur=0.8, tail=1.2, bus="fx", send="hall")
    cue(en, "riser", -16, "the gold light below takes the frame (riser into chorus 3)", "bridge", dur=2.6, root="G#2",
        bus="fx", send="hall")

    # ================================================================ CHORUS 3 (phos-final)
    st, en = b["chorus3"], b["drop3"]
    L = [l for l in ly.lines_in(st - 0.3, en + 0.2) if not l.get("kind") and st - 0.4 <= l["start"] < en - 0.2]
    on = lambda li, rx: Ly.word(L[li], rx)["start"]
    cue(st, "swell", -18, "chorus 3 opens on the bridge's gold", "chorus3", dur=0.2, tail=1.6, bus="fx", send="hall")
    tBe = on(0, r"^be$")
    cue(tBe, "impact", -11, "BE: the drums come in and the gold SHATTERS", "chorus3", size=0.7, bus="impact", send="hall")
    cue(tBe, "shatter", -14, "a carpet of gold stickers blows out from the centre", "chorus3", size=1.0, bus="fx", send="hall")
    tDance = on(0, r"^dance")
    batches = sorted(au.times("snare", tDance + 0.1, L[1]["start"] - 0.12, 0.6))
    batches = [x for i, x in enumerate(batches) if i == 0 or x - batches[i - 1] > 0.15] or [tDance + 0.3]
    for i, x in enumerate(batches[:2]):
        cue(x + 0.05, "swish", -22, f"the survivors fly back in (batch {i + 1}, on the snare)", "chorus3", dur=0.3, dir=(-1) ** i,
            bright=0.5, bus="fx", send="room")
    for w in L[1]["words"]:
        if re.match(r"^(glowing|dark|hand)", _fold(w["w"])):
            cue(w["start"], "whoosh", -21, f"flight through the line: the camera lands on {w['w'].upper()}", "chorus3",
                dur=0.35, tail=0.3, dir=1, bus="fx", send="room")
    tb = on(2, r"^broken")
    tBreak = next(iter(au.times("kick", tb + 0.05, tb + 0.45, 0.85)), tb + 0.15)
    cue(tBreak, "shatter", -16, "BROKEN (made of stickers) is blown apart on the kick", "chorus3", size=0.6, bus="fx", send="hall")
    tStar = on(2, r"^star")
    cue(tStar, "swirl", -20, "the pieces swirl (BECOMES)...", "chorus3", dur=tStar - on(2, r"^becomes"), tail=0.1, bus="fx", send="hall")
    cue(tStar, "chime", -18, "...and slam together into one GIANT STAR", "chorus3", notes=["G#4", "D#5", "B5", "F#6"], bus="fx", send="hall")
    tGlow, tDark = on(4, r"^glow"), on(4, r"^dark")
    cue(tGlow + 0.6, "phos_hum", -23, "the band drops out: GLOWING glows on alone, fades to green afterglow", "chorus3",
        dur=tDark - tGlow - 0.6, bus="fx", send="hall")
    cue(en, "riser", -15, "IN THE DARK!: the last kick blows the frame to gold-white (riser into drop 3)", "chorus3",
        dur=en - tDark + 0.4, root="G#2", bus="fx", send="hall")
    cue(en, "rev_cymbal", -16, "reverse cymbal into drop 3", "chorus3", dur=1.8, bus="fx", send="hall")

    # ================================================================ DROP 3: warp / nebula / black hole / Earth (cosmos-deck)
    st, en = b["drop3"], b["outro"]
    i0 = au.db_index(st)
    bars = au.downbeats[i0:i0 + 20]
    Bk = lambda k: bars[k] if k < len(bars) else bars[-1] + (k - len(bars) + 1) * 1.58
    j = au.db_index(en)
    b14, b15, b16 = au.downbeats[j - 2], au.downbeats[j - 1], au.downbeats[j]
    tE = Bk(14) + 0.9
    kk = lambda a, z: [[round(x, 4), round(y, 3)] for x, y in au.events("kick", a - 0.5, z)]
    cue(st, "impact", -7, "DROP 3: the gold finale hits", "drop3", size=1.0, bus="impact", send="hall")
    cue(st, "sub_drop", -8, "drop 3 sub drop", "drop3", dur=1.8, f0=hz("G#2"), f1=hz("G#1"), bus="impact", send="none")
    runs = [("warp", 0, 2), ("neb", 2, 6), ("hole", 6, 9), ("warp", 9, 10), ("neb", 10, 11), ("hole", 11, 12), ("neb", 12, 13),
            ("hole", 13, 14), ("warp", 14, None)]
    xf = {2: ("iris", 0.65), 6: ("collapse", 0.75), 9: ("lens", 0.7), 10: ("iris", 0.6), 11: ("collapse", 0.6), 12: ("lens", 0.6),
          13: ("collapse", 0.6), 14: ("lens", 0.45)}
    for w, k0, k1 in runs:
        a = Bk(k0)
        z = Bk(k1) if k1 is not None else tE
        if w == "warp":
            cue(a, "warp", -17 if k0 else -18, "WARP: star tunnel, gold gas rushing past (kicks surge the speed)", "drop3",
                dur=z - a, inside=1 if k0 == 14 else 0, kicks=kk(a, z), bus="bed", send="hall")
        elif w == "neb":
            cue(a, "nebula", -21, "NEBULA: a corridor between cloud walls lit from within", "drop3", dur=z - a, kicks=kk(a, z), bus="bed", send="hall")
        else:
            cue(a, "hole_rumble", -16, "BLACK HOLE: deep rumble, the disk flares on the kicks", "drop3", dur=z - a,
                fall=1 if k0 == 13 else 0, root="G#0", kicks=kk(a, z), bus="bed", send="hall")
    for k, (kind, xd) in xf.items():
        t = Bk(k) + 0.1
        if kind == "collapse":
            cue(t, "implode", -15 if k == 6 else -17, "COLLAPSE: the nebula's light is pulled into one point, the black hole appears",
                "drop3", dur=xd, bus="fx", send="hall")
            cue(t, "thump", -14, "...the hole's flash", "drop3", deep=1, bus="impact", send="hall")
        elif kind == "lens":
            cue(t, "whoosh", -16, "LENS: the hole's shadow grows over the frame; the next world is inside it", "drop3",
                dur=xd, tail=0.5, dir=-1, low=1, bus="fx", send="hall")
        else:
            cue(t, "whoosh", -16, "IRIS: the warp's vanishing point opens onto the next world, we fly through", "drop3",
                dur=xd, tail=0.5, dir=1, bus="fx", send="hall")
    for k in (3, 4, 5):   # whips of the roll inside the nebula run
        cue(Bk(k) + 0.04, "swish", -23, "downbeat roll whip in the nebula", "drop3", dur=0.36, dir=(-1) ** k, bright=0.3,
            bus="fx", send="hall")
    for k in (7, 8):   # the hole's swoops to the next angle
        cue(Bk(k), "whoosh", -18, "the camera swoops around the hole to the next angle", "drop3", dur=0.45, tail=0.5,
            dir=(-1) ** k, low=1, bus="fx", send="hall")
    cue(Bk(14), "fall_in", -12, "we fall into the hole (spaghetti whoosh into the dark inside)", "drop3", dur=Bk(14) - Bk(13),
        bus="impact", send="hall")
    cue(tE, "whoosh", -15, "inside, a warp: its vanishing point opens onto the Earth", "drop3", dur=0.7, tail=0.4, dir=1,
        bus="fx", send="hall")
    cue(tE, "earth_dive", -15, "the dive at New York: wind, atmosphere, re-entry roar (lib/dive.ts altitude curve)", "drop3",
        dur=b16 + 0.8 - tE, keys=[[b14 + 0.9, 150], [b15, 24], [b15 + 0.88, 2.5], [b16, 0.25], [b16 + 0.8, 0.02]],
        bus="fx", send="hall")

    # ================================================================ OUTRO (ceiling.ts, mode outro)
    st, en = b["outro"], b["end"]
    B = [d for d in au.downbeats if st - 2 <= d <= en + 2]
    tEnd = [d for d in B if d <= en - 0.3][-1]
    lines = ly.lines_in(st - 1, en)
    hand = next((l for l in lines if re.search("take my hand", _fold(l["text"]))), None)
    b0o = math.ceil(au.beatAt(st) - 0.05)
    tHand = hand["words"][0]["start"] if hand else au.timeOfBeat(b0o + 14)
    cue(st - 0.5, "room_tone", -28, "back in bed: the room's air", "outro", dur=en - st + 0.5, fade_in=1.6, fade_out=0.3,
        bus="bed", send="room")
    cue(st + 2.6 + 1.3, "car_pass_far", -25, "a car passes below (headlights across the ceiling)", "outro", dur=2.6 + 1.6, dir=1,
        bus="bed", send="room")
    cue(tHand + 0.7, "chime", -20, "\"take my hand\": the light joins the two hands again", "outro",
        notes=["B4", "F#5", "D#6"], bus="fx", send="hall")
    cue(tEnd, "sticker_tick", -22, "the two last stars merge and go out on the final downbeat", "outro", seed=40, soft=1,
        bus="fx", send="hall")
    cue(tEnd + 0.12, "window_light", -17, "in the dark, a warm light comes on across the street: her lantern (click, warm hum)",
        "outro", dur=en - tEnd - 0.12, bus="fx", send="room")

    cues.sort(key=lambda c: c["t"])
    return {
        "song": "Glowing In The Dark (Fireface17)",
        "duration": au.duration,
        "key": KEY,
        "bounds": {k: round(v, 4) for k, v in b.items()},
        "levels": "rel_db = level of the cue's loudest 400 ms relative to the music's RMS around it (sfx.py)",
        "cues": cues,
    }


def table(sheet: dict) -> str:
    rows = [f"{'time':>8}  {'scene':<8} {'kind':<14} {'dB':>4}  note"]
    for c in sheet["cues"]:
        m, s = divmod(c["t"], 60)
        rows.append(f"{int(m):>2}:{s:06.3f}  {c['scene']:<8} {c['kind']:<14} {c['rel_db']:>4}  {c['note']}")
    return "\n".join(rows)


def main():
    au, ly = load()
    sheet = build(au, ly)
    CUES_JSON.write_text(json.dumps(sheet, indent=1, ensure_ascii=False) + "\n")
    print(table(sheet))
    from collections import Counter
    print(f"\n{len(sheet['cues'])} cues -> {CUES_JSON.relative_to(ROOT)}")
    print(dict(Counter(c["kind"] for c in sheet["cues"])))


if __name__ == "__main__":
    main()
