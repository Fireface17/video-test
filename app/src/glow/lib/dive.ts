// The dive that ends drop 3 and lands in the ceiling outro, shared by both scenes so they stay in register:
// the altitude over New York (1 unit = 1000 km) through drop 3's last bars, and the factor by which the ceiling
// outro's camera starts out farther from the ceiling (the same rate of approach: the city's lights and the
// stickers grow together), easing into the outro's own drift.

/** the last three downbeats of drop 3 (B14, B15) and the outro's start (B16) */
export function diveBars(downbeats: number[], outroStart: number): [number, number, number] {
  let i = 0, best = 1e9;
  downbeats.forEach((d, j) => { if (Math.abs(d - outroStart) < best) { best = Math.abs(d - outroStart); i = j; } });
  const b16 = downbeats[i]!;
  return [downbeats[i - 2] ?? b16 - 3.16, downbeats[i - 1] ?? b16 - 1.58, b16];
}

/** altitude at t: log-linear between keys, extrapolated at both ends (it never stands still) */
export function diveAlt(t: number, [b14, b15, b16]: [number, number, number]) {
  const K: [number, number][] = [[b14 + 0.9, 150], [b15, 24], [b15 + 0.88, 2.5], [b16, 0.25], [b16 + 0.8, 0.02]];
  let i = 1;
  while (i < K.length - 1 && t > K[i]![0]) i++;
  const [t0, a0] = K[i - 1]!, [t1, a1] = K[i]!;
  return Math.exp(Math.log(a0) + (Math.log(a1) - Math.log(a0)) * (t - t0) / (t1 - t0));
}

/** the moment the lights have become the stickers */
export const diveMatch = (b: [number, number, number]) => b[2] + 0.3;

/** the outro camera's distance factor (>= 1): the dive's rate of approach, decelerating smoothly to 1 */
export function diveFactor(t: number, b: [number, number, number]) {
  const x = Math.log(diveAlt(t, b) / diveAlt(diveMatch(b), b));
  const k = 3;
  const sp = x * k > 30 ? x : Math.log(1 + Math.exp(k * x)) / k;
  return Math.exp(sp);
}
