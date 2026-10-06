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
    pre2: cut('Put your hands up', 1),
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
    // the blackout: his hands glowing on the dead car's wheel dissolve into his palms glowing on a dark roof
    E('snap1', 'phos-pre', b.pre1, b.chorus1, { params: { n: 1 }, ...X('crossfade', 0.4) }),
    // a hard cut on the ignition: the pre-chorus's point detonates in the chorus's first frame
    E('chorus1', 'phos-chorus', b.chorus1, b.drop1),
    // the drop hits: punch through the chorus's flash into the living city (people dance on balconies and roofs)
    E('drop1a', 'phos-drop', b.drop1, b.drop1mid), // point to point: chorus 1 collapses into the point the drop bursts from
    // the people's lights stream up into the sky: punch up through them into the galaxy they make
    E('drop1', 'cosmos', b.drop1mid, b.verse2, { params: { n: 1 }, ...X('zoom', 0.7, { centre: [0.5, 0.55], color: lin('cyan', 1.2) }) }),
    // verse 2 and the build: a night train of ghosts on their phones; they light up and pour out into the street
    E('verse2', 'phos-verse', b.verse2, b.pre2, X('crossfade', 0.7)),
    E('pre2', 'phos-pre', b.pre2, b.chorus2, { params: { n: 2 }, ...X('crossfade', 0.4) }),
    // out of the station and running: a whip pan on the downbeat into the street
    E('chorus2', 'phos-scope', b.chorus2, b.break2, X('light', 0.3, { color: lin('violet', 1.3) })),
    // the chorus's last light settles: a slow dissolve into the quiet blue hour on the overpass
    E('break2', 'phos-break', b.break2, b.bridge),
    // the bridge goes on from where the break leaves them, on the edge hand in hand: a hard cut on the beat to the
    // reverse angle, and they jump
    E('bridge', 'phos-fall', b.bridge, b.chorus3, X('crossfade', 0.5)),
    // the bridge ends in warm gold and the final chorus opens on the very same gold (a hard cut), which drains to its afterglow
    E('chorus3', 'phos-final', b.chorus3, b.drop3),
    E('drop3', 'cosmos-deck', b.drop3, b.outro, X('light', 0.3, { color: lin('gold', 1.4) })),
    // stars to stars
    E('outro', 'ceiling', b.outro, b.end, { params: { mode: 'outro' }, ...X('crossfade', 1.2) }),
  ];
}
