// The songs this app renders. Pick one with ?song=<id> in the preview and --song <id> in scripts/render.ts.
// Each song has its own track, timing data (lyrics.json + audio.json) and timeline of scenes; the engine is shared.
import type { TimelineEntry } from './engine/engine';
import type { Lyrics } from './engine/lyrics';
import type { AudioData } from './engine/audio';

export type MakeTimeline = (lyrics: Lyrics, audio: AudioData) => TimelineEntry[];

export interface Song {
  id: string;
  title: string;
  /** The track, from the site root (the repo's audio/ folder). */
  audio: string;
  /** Folder with the song's lyrics.json and audio.json. */
  data: string;
  timeline: () => Promise<MakeTimeline>;
}

export const SONGS: Record<string, Song> = {
  glow: {
    id: 'glow',
    title: 'Glowing In The Dark',
    audio: 'audio/glowing-in-the-dark.mp3',
    data: 'data/glow',
    timeline: async () => (await import('./glow/timeline')).makeTimeline,
  },
  pdoom: {
    id: 'pdoom',
    title: 'I’m Upping My P(doom)',
    audio: 'audio/pdoom.mp3',
    data: 'data',
    timeline: async () => (await import('./timeline')).makeTimeline,
  },
};

export const DEFAULT_SONG = 'glow';

export function songById(id: string | null): Song {
  const s = SONGS[id ?? DEFAULT_SONG];
  if (!s) throw new Error(`unknown song "${id}" (known: ${Object.keys(SONGS).join(', ')})`);
  return s;
}
