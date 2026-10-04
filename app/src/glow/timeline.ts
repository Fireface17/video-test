// The edit of "Glowing In The Dark": which scene plays when. Boundaries come from the aligned lyrics
// (data/glow/lyrics.json) and the beat grid / sections (data/glow/audio.json), never typed-in times.
import type { TimelineEntry } from '../engine/engine';
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
    outro: sec('outro'),
    end: au.duration,
  };

  const E = (id: string, file: string, start: number, end: number, extra: Partial<TimelineEntry> = {}): TimelineEntry =>
    ({ id, load: scene(file), start, end, ...extra });

  return [
    E('intro', 'ceiling', 0, b.verse1, { params: { mode: 'intro' } }),
    E('highway', 'highway', b.verse1, b.pre1),
    E('snap1', 'snap', b.pre1, b.chorus1, { params: { n: 1 } }),
    E('chorus1', 'chorus', b.chorus1, b.drop1, { params: { n: 1 } }),
    E('drop1', 'rave', b.drop1, b.verse2, { params: { n: 1 } }),
    E('ghosts', 'ghosts', b.verse2, b.build2),
    E('snap2', 'snap', b.build2, b.chorus2, { params: { n: 2 } }),
    E('chorus2', 'chorus', b.chorus2, b.break2, { params: { n: 2 } }),
    E('break2', 'rave', b.break2, b.bridge, { params: { n: 2 } }),
    E('bridge', 'fall', b.bridge, b.chorus3),
    E('chorus3', 'chorus', b.chorus3, b.drop3, { params: { n: 3 } }),
    E('drop3', 'rave', b.drop3, b.outro, { params: { n: 3 } }),
    E('outro', 'ceiling', b.outro, b.end, { params: { mode: 'outro' } }),
  ];
}
