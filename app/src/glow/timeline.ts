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
    // drop 1's first eight bars are the city (citydrop); the galaxy takes over on the ninth downbeat
    drop1mid: au.downbeats.find((d) => d > sec('drop1') + 12.5)!,
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
    // the dawn sun flares white and opens on a rooftop over the night city
    E('snap1', 'rooftop', b.pre1, b.chorus1, X('light', 0.5)),
    // the lanterns' star bursts: light
    E('chorus1', 'space-chorus', b.chorus1, b.drop1, { params: { n: 1 }, ...X('light', 0.36) }),
    // the drop hits: punch through the chorus's flash into the living city (people dance on balconies and roofs)
    E('drop1a', 'citydrop', b.drop1, b.drop1mid, X('zoom', 0.5, { centre: [0.5, 0.5], color: lin('#fff1dc', 1.3) })),
    // the people's lights stream up into the sky: punch up through them into the galaxy they make
    E('drop1', 'cosmos', b.drop1mid, b.verse2, { params: { n: 1 }, ...X('zoom', 0.7, { centre: [0.5, 0.78], color: lin('cyan', 1.2) }) }),
    // verse 2 and the build: a night train of ghosts on their phones; they light up and pour out into the street
    E('train', 'train', b.verse2, b.chorus2, X('glitch', 0.4, { seed: 7 })),
    // out of the station and running: a whip pan on the downbeat into the street
    E('chorus2', 'run', b.chorus2, b.break2, X('whip', 0.4, { dir: [1, 0] })),
    // the chorus's last light swells and settles into the blue hour on the overpass
    E('break2', 'overpass', b.break2, b.bridge, X('light', 0.7, { color: lin('#bcd4ff', 0.9) })),
    // up and through, into space
    E('bridge', 'fall', b.bridge, b.chorus3, X('zoom', 0.9, { centre: [0.5, 0.62], color: lin('blue', 1.2) })),
    // a golden star opens onto the final chorus
    E('chorus3', 'space-chorus', b.chorus3, b.drop3, { params: { n: 3 }, ...X('iris', 0.75, { color: lin('gold', 1.6), centre: [0.5, 0.5], seed: 0.3 }) }),
    E('drop3', 'cosmos', b.drop3, b.outro, { params: { n: 3 }, ...X('shatter', 0.9, { color: lin('gold', 1.4), centre: [0.5, 0.42] }) }),
    // stars to stars
    E('outro', 'ceiling', b.outro, b.end, { params: { mode: 'outro' }, ...X('crossfade', 1.2) }),
  ];
}
