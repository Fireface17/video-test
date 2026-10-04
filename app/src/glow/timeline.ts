// The edit of "Glowing In The Dark": which scene plays when. Boundaries come from the aligned lyrics
// (data/glow/lyrics.json) and the beat grid / sections (data/glow/audio.json), never typed-in times.
import type { TimelineEntry } from '../engine/engine';
import type { TransitionSpec } from '../engine/transitions';
import { lin } from './lib/palette';
import type { SceneClass } from '../engine/scene';
import type { Lyrics } from '../engine/lyrics';
import type { AudioData } from '../engine/audio';

const modules = import.meta.glob<{ default: SceneClass }>('./scenes/*.ts');
const scene = (name: string) => () => {
  const m = modules[`./scenes/${name}.ts`];
  return m ? m() : Promise.reject(new Error(`scene module not found: glow/scenes/${name}.ts`));
};

export function makeTimeline(ly: Lyrics, au: AudioData): TimelineEntry[] {
  /** The last beat at/before the first word of the nth line containing q (a cut never splits a line). */
  const cut = (q: string, nth = 0, tol = 0.03) => {
    const s = ly.get(q, nth).words[0]!.start;
    return au.timeOfBeat(Math.floor(au.beatAt(s + tol)));
  };
  const sec = (name: string) => {
    const s = au.sections.find((x) => x.name === name);
    if (!s) throw new Error(`section not found: ${name}`);
    return s.start;
  };

  const b = {
    verse1: cut('We were running'),
    pre1: cut('Put your hands up'),
    chorus1: cut('We don’t gotta be okay', 0),
    drop1: sec('drop1'),
    verse2: cut('We’ve been ghosts'),
    build2: sec('build2'),
    chorus2: cut('We don’t gotta be okay', 2),
    break2: sec('break2'),
    bridge: cut('And if you fall'),
    chorus3: cut('We don’t gotta be okay', 4),
    drop3: sec('drop3'),
    // the outro proper starts where the drop's tail dies away, two bars into the outro section
    outro: au.downbeats.find((d) => d > sec('outro') + 2.5) ?? sec('outro'),
    end: au.duration,
  };

  const E = (id: string, file: string, start: number, end: number, extra: Partial<TimelineEntry> = {}): TimelineEntry =>
    ({ id, load: scene(file), start, end, ...extra });
  // ?lab=<scene> (render.ts --lab): a test timeline of that one scene over the whole song
  const lab = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lab') : null;
  if (lab) return [E('lab', lab, 0, au.duration)];
  // how each scene comes in (engine/transitions.ts); the overlap is centred on the cut
  const X = (kind: TransitionSpec['kind'], dur: number, o: Partial<TransitionSpec> = {}): { transition: TransitionSpec } => ({ transition: { kind, dur, ...o } });

  return [
    E('intro', 'ceiling', 0, b.verse1, { params: { mode: 'intro' } }),
    // the camera tilts down out of the sky onto the road
    E('highway', 'highway', b.verse1, b.pre1, X('whip', 0.5, { dir: [0, 1] })),
    // the night drive burns away in embers, leaving the dark and one glow stick
    E('snap1', 'rooftop', b.pre1, b.chorus1, X('sparks', 0.7, { color: lin('ember', 1.4), seed: 3 })),
    // the stick snaps: light
    E('chorus1', 'space-chorus', b.chorus1, b.drop1, { params: { n: 1 }, ...X('light', 0.36) }),
    // the drop breaks the chorus like glass
    E('drop1', 'cosmos', b.drop1, b.verse2, { params: { n: 1 }, ...X('shatter', 0.9, { color: lin('cyan', 1.2), centre: [0.5, 0.45] }) }),
    // verse 2 and the build: ghosts in a crowded room become people of light
    E('ghosts', 'ghosts', b.verse2, b.chorus2, X('glitch', 0.4, { seed: 7 })),
    E('chorus2', 'space-chorus', b.chorus2, b.break2, { params: { n: 2 }, ...X('light', 0.36) }),
    E('break2', 'cosmos', b.break2, b.bridge, { params: { n: 2 }, ...X('shatter', 0.9, { color: lin('violet', 1.4), centre: [0.5, 0.5] }) }),
    // up and through, into space
    E('bridge', 'fall', b.bridge, b.chorus3, X('zoom', 0.9, { centre: [0.5, 0.62], color: lin('blue', 1.2) })),
    // a golden star opens onto the final chorus
    E('chorus3', 'space-chorus', b.chorus3, b.drop3, { params: { n: 3 }, ...X('iris', 0.75, { color: lin('gold', 1.6), centre: [0.5, 0.5], seed: 0.3 }) }),
    E('drop3', 'cosmos', b.drop3, b.outro, { params: { n: 3 }, ...X('shatter', 0.9, { color: lin('gold', 1.4), centre: [0.5, 0.42] }) }),
    // stars to stars
    E('outro', 'ceiling', b.outro, b.end, { params: { mode: 'outro' }, ...X('crossfade', 1.2) }),
  ];
}
